import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, AudioLines, Check, ListChecks, LoaderCircle, Play, SkipForward, X } from "./icons";
import type { AppErrorInfo, AudioMatchBasis, AudioMatchDecisions, AudioMatchItem, AudioMatchSummary, UploadConfig } from "../../shared/types";

const basisLabels: Record<AudioMatchBasis, string> = {
  confirmed: "已确认",
  number: "文件名编号",
  "name-number": "文件名含编号",
  name: "文件名",
  speech: "语音内容",
  order: "录音顺序",
  none: "",
};

const NO_AUDIO = "__none__";

type Choice = string | null;

function toError(error: unknown): AppErrorInfo {
  return {
    code: "E-APP-001",
    message: "桌面应用通信失败。",
    suggestion: "请关闭本工具后重新打开；若仍出现，请把技术详情发给维护人员。",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function scoreLabel(score: number): string {
  return score > 0 ? `${Math.round(score * 100)}%` : "";
}

interface AudioMatchDialogProps {
  match: AudioMatchSummary;
  config: UploadConfig;
  initialMode: "review" | "list";
  onClose: () => void;
  onSaved: () => void;
}

export function AudioMatchDialog({ match, config, initialMode, onClose, onSaved }: AudioMatchDialogProps) {
  const reviewItems = useMemo(() => match.items.filter((item) => item.needsReview), [match]);
  const [mode, setMode] = useState<"review" | "list">(reviewItems.length ? initialMode : "list");
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Map<number, Choice>>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const transcripts = useMemo(() => new Map(match.files.map((file) => [file.name, file.transcript])), [match]);
  const choiceOf = useCallback((item: AudioMatchItem): Choice => (choices.has(item.audioNumber) ? choices.get(item.audioNumber)! : item.fileName), [choices]);
  const owners = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of match.items) {
      const file = choiceOf(item);
      if (file) result.set(file, item.audioNumber);
    }
    return result;
  }, [match, choiceOf]);

  const play = useCallback((fileName: string | null) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!fileName) {
      audio.pause();
      setPlaying(null);
      return;
    }
    audio.src = window.tungee.audioUrl(match.audioDir, fileName);
    setPlaying(fileName);
    void audio.play().catch(() => setPlaying(null));
  }, [match.audioDir]);

  const choose = useCallback((item: AudioMatchItem, file: Choice) => {
    setError(null);
    setChoices((current) => {
      const next = new Map(current);
      next.set(item.audioNumber, file);
      if (file) {
        for (const other of match.items) {
          if (other.audioNumber === item.audioNumber) continue;
          const otherChoice = next.has(other.audioNumber) ? next.get(other.audioNumber) : other.fileName;
          if (otherChoice === file) next.delete(other.audioNumber);
        }
      }
      return next;
    });
    play(file);
  }, [match.items, play]);

  const current = mode === "review" ? reviewItems[index] : undefined;
  const autoplayedRef = useRef<number | null>(null);

  useEffect(() => {
    const target = current?.audioNumber ?? null;
    if (autoplayedRef.current === target) return;
    autoplayedRef.current = target;
    if (current) play(choiceOf(current));
  }, [current, choiceOf, play]);

  const save = useCallback(async (entries: Map<number, Choice>) => {
    setSaving(true);
    setError(null);
    audioRef.current?.pause();
    try {
      const decisions: AudioMatchDecisions = {};
      for (const [audioNumber, file] of entries) decisions[String(audioNumber)] = file;
      const result = await window.tungee.confirmAudioMatches(config, decisions);
      if (result.status === "saved") onSaved();
      else setError(result.error);
    } catch (reason: unknown) {
      setError(toError(reason));
    } finally {
      setSaving(false);
    }
  }, [config, onSaved]);

  const finishReview = useCallback(() => {
    const entries = new Map<number, Choice>(choices);
    for (const item of reviewItems) entries.set(item.audioNumber, choiceOf(item));
    void save(entries);
  }, [reviewItems, choices, choiceOf, save]);

  const confirmCurrent = useCallback(() => {
    if (!current) return;
    if (index + 1 < reviewItems.length) setIndex(index + 1);
    else finishReview();
  }, [current, index, reviewItems.length, finishReview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (saving) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (mode !== "review" || !current) return;
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      if (event.key === "Enter") {
        event.preventDefault();
        confirmCurrent();
      } else if (event.key === " ") {
        event.preventDefault();
        play(choiceOf(current));
      } else if (event.key.toLowerCase() === "n") {
        choose(current, null);
      } else if (event.key === "ArrowLeft" && index > 0) {
        setIndex(index - 1);
      } else if (/^[1-9]$/.test(event.key)) {
        const candidate = current.candidates[Number(event.key) - 1];
        if (candidate) choose(current, candidate.fileName);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, mode, current, index, confirmCurrent, choose, choiceOf, play, onClose]);

  const changedCount = [...choices].filter(([audioNumber, file]) => match.items.find((item) => item.audioNumber === audioNumber)?.fileName !== file).length;
  const selected = current ? choiceOf(current) : null;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className={`storage-dialog match-dialog ${mode === "list" ? "is-list" : ""}`} role="dialog" aria-modal="true" aria-labelledby="match-dialog-title">
        <header className="dialog-head">
          <div>
            <AudioLines size={18} />
            <h3 id="match-dialog-title">
              {mode === "review" ? `确认录音 ${Math.min(index + 1, reviewItems.length)}/${reviewItems.length}` : "录音匹配"}
            </h3>
          </div>
          <div className="match-head-actions">
            {reviewItems.length > 0 && (
              <button className="text-action" onClick={() => setMode(mode === "review" ? "list" : "review")} disabled={saving}>
                {mode === "review" ? <><ListChecks size={14} />查看全部</> : <><Check size={14} />逐条确认</>}
              </button>
            )}
            <button className="icon-button" onClick={onClose} disabled={saving} aria-label="关闭"><X size={16} /></button>
          </div>
        </header>

        <audio ref={audioRef} onEnded={() => setPlaying(null)} />

        {mode === "review" && current ? (
          <div className="match-review">
            <div className="match-script">
              <div className="match-script-head">
                <b>第 {current.audioNumber} 号 · {current.label}</b>
                {current.reason && <span className="match-reason">{current.reason}</span>}
              </div>
              <p>{current.speech}</p>
            </div>

            <div className="match-candidates">
              {current.candidates.map((candidate, position) => {
                const owner = owners.get(candidate.fileName);
                const takenBy = owner !== undefined && owner !== current.audioNumber ? owner : null;
                return (
                  <button
                    key={candidate.fileName}
                    className={`match-candidate ${selected === candidate.fileName ? "is-active" : ""}`}
                    onClick={() => choose(current, candidate.fileName)}
                    disabled={saving}
                  >
                    <kbd>{position + 1}</kbd>
                    <span className="match-candidate-text">
                      <b>{candidate.fileName}</b>
                      <small>
                        {[basisLabels[candidate.basis], scoreLabel(candidate.score) && `相似度 ${scoreLabel(candidate.score)}`, takenBy !== null && `现在分给第 ${takenBy} 号`]
                          .filter(Boolean).join(" · ") || "未识别出对应关系"}
                      </small>
                      {transcripts.get(candidate.fileName) && <em>“{transcripts.get(candidate.fileName)}”</em>}
                    </span>
                    <Play size={14} className={playing === candidate.fileName ? "is-playing" : ""} />
                  </button>
                );
              })}
              <button
                className={`match-candidate is-none ${selected === null ? "is-active" : ""}`}
                onClick={() => choose(current, null)}
                disabled={saving}
              >
                <kbd>N</kbd>
                <span className="match-candidate-text"><b>这条没有录音</b><small>只上传文本</small></span>
              </button>
            </div>

            <p className="match-keys">数字键选择 · N 没有录音 · 回车确认并下一条 · 空格重播 · ← 上一条</p>
          </div>
        ) : (
          <div className="match-list">
            <div className="match-row match-row-head">
              <span>编号</span><span>模块或问题</span><span>录音文件</span><span>依据</span><span />
            </div>
            {match.items.map((item) => {
              const choice = choiceOf(item);
              const changed = choices.has(item.audioNumber) && choice !== item.fileName;
              return (
                <div key={item.audioNumber} className={`match-row ${item.needsReview && !choices.has(item.audioNumber) ? "is-review" : ""}`}>
                  <span>{item.audioNumber}</span>
                  <span title={item.speech}>{item.label}{item.needsReview && item.reason ? <small>{item.reason}</small> : null}</span>
                  <select
                    value={choice ?? NO_AUDIO}
                    onChange={(event) => choose(item, event.target.value === NO_AUDIO ? null : event.target.value)}
                    disabled={saving}
                  >
                    <option value={NO_AUDIO}>没有录音</option>
                    {match.files.map((file) => {
                      const owner = owners.get(file.name);
                      return (
                        <option key={file.name} value={file.name}>
                          {file.name}{owner !== undefined && owner !== item.audioNumber ? `（现在分给第 ${owner} 号）` : ""}
                        </option>
                      );
                    })}
                  </select>
                  <span>{changed ? "已修改" : item.fileName ? basisLabels[item.basis] : ""}</span>
                  <button className="icon-button" onClick={() => play(playing === choice ? null : choice)} disabled={!choice} aria-label="试听">
                    <Play size={13} className={playing === choice && choice ? "is-playing" : ""} />
                  </button>
                </div>
              );
            })}
            {match.unusedFiles.length > 0 && (
              <p className="match-unused">没用上的文件（不会上传）：{match.unusedFiles.join("、")}</p>
            )}
          </div>
        )}

        {error && (
          <div className="storage-hint is-error">
            <AlertTriangle size={14} />
            <span><code>{error.code}</code>{error.message}{error.suggestion}</span>
          </div>
        )}

        <footer className="dialog-foot">
          {mode === "review" && current ? (
            <>
              <button className="text-action" onClick={() => setIndex(index - 1)} disabled={saving || index === 0}>
                <ArrowLeft size={14} />上一条
              </button>
              <div>
                <button className="button outline" onClick={finishReview} disabled={saving}>
                  <SkipForward size={16} />剩下的都用推荐
                </button>
                <button className="button primary" onClick={confirmCurrent} disabled={saving}>
                  {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                  {index + 1 < reviewItems.length ? "确认，下一条" : "确认完成"}
                </button>
              </div>
            </>
          ) : (
            <>
              <span>{changedCount ? `已修改 ${changedCount} 条` : "可以在这里改任意一条"}</span>
              <div>
                <button className="button outline" onClick={onClose} disabled={saving}>关闭</button>
                <button className="button primary" onClick={() => void save(choices)} disabled={saving || choices.size === 0}>
                  {saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存修改
                </button>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
