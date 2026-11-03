import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AppErrorInfo, AudioMatchCandidate, AudioMatchItem, PreviewSummary } from "../../shared/types";
import { bridgeError, get, isTrimmed, matchesSaved, missingNote, sections, set, trimNote, type MatchMode } from "./model";
import { Button, Callout, SegmentedTabs, Sheet, Spinner, XOctagonFill } from "./ui";

type ListFilter = "attention" | "missing" | "trim" | "all";
type Tab = "review" | ListFilter;
type RowState = "matched" | "inferred" | "edited" | "review" | "missing";

export const BASIS_LABELS: Record<string, string> = {
  confirmed: "已确认", number: "文件名编号", "name-number": "文件名含编号", name: "文件名", speech: "语音内容", order: "录音顺序",
};
const BASIS_SHORT: Record<string, string> = {
  confirmed: "已确认", number: "按编号", "name-number": "按编号", name: "按文件名", speech: "按内容", order: "按顺序",
};

/** Rows that start out unsure or without a recording. Fixed at open so rows don't vanish while being edited. */
const needsLook = (item: AudioMatchItem) => item.needsReview || item.fileName === null;

export function usePlayer(audioDir: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  };
  const play = (file: string | null) => {
    audio.current?.pause();
    audio.current = null;
    if (!file || get().saved) {
      setPlaying(null);
      return;
    }
    const element = new Audio(window.tungee.audioUrl(audioDir, file));
    element.onended = () => setPlaying((current) => (current === file ? null : current));
    audio.current = element;
    setPlaying(file);
    element.play().catch(() => setPlaying(null));
  };
  useEffect(() => () => audio.current?.pause(), []);
  return { playing, play, stop };
}

export function PlayButton({ file, playing, play, stop }: { file: string | null; playing: string | null; play: (file: string | null) => void; stop: () => void }) {
  const active = file !== null && playing === file;
  return (
    <button className="play-button" disabled={file === null} title={active ? "停止" : "试听"} onClick={() => (active ? stop() : play(file))}>
      {active ? (
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden><rect x="1.5" y="1.5" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden><path d="M2.5 1.6v7.8a.6.6 0 0 0 .9.5l6.3-3.9a.6.6 0 0 0 0-1L3.4 1.1a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>
      )}
    </button>
  );
}

export function AudioMatchSheet({ summary, initialMode, focus = null }: { summary: PreviewSummary; initialMode: MatchMode; focus?: number | null }) {
  const match = summary.audioMatch;
  const [mode, setMode] = useState<"review" | "list">(initialMode === "review" && match.items.some((item) => item.needsReview) && focus === null ? "review" : "list");
  const [filter, setFilter] = useState<ListFilter>(
    initialMode === "trim" ? "trim" : match.items.some(needsLook) && focus === null ? "attention" : "all",
  );
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus !== null) list.current?.querySelector(`[data-number="${focus}"]`)?.scrollIntoView({ block: "center" });
  }, []);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<Map<number, string | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const player = usePlayer(match.audioDir);

  const reviewItems = match.items.filter((item) => item.needsReview);
  const current = mode === "review" && index < reviewItems.length ? reviewItems[index]! : null;
  const transcripts = new Map(match.files.flatMap((file) => (file.transcript ? [[file.name, file.transcript] as const] : [])));

  const choice = (item: AudioMatchItem): string | null => (choices.has(item.audioNumber) ? choices.get(item.audioNumber)! : item.fileName);
  const owner = (file: string) => match.items.find((item) => choice(item) === file)?.audioNumber;

  const choose = (item: AudioMatchItem, file: string | null) => {
    setError(null);
    setChoices((previous) => {
      const next = new Map(previous);
      const pick = (other: AudioMatchItem) => (next.has(other.audioNumber) ? next.get(other.audioNumber)! : other.fileName);
      next.set(item.audioNumber, file);
      if (file) {
        for (const other of match.items) {
          if (other.audioNumber === item.audioNumber || pick(other) !== file) continue;
          next.delete(other.audioNumber);
          if (other.fileName === file) next.set(other.audioNumber, null);
        }
      }
      return next;
    });
    player.play(file);
  };

  useEffect(() => {
    if (current) player.play(choice(current));
  }, [index, mode]);

  const save = async (entries: Map<number, string | null>) => {
    setSaving(true);
    setError(null);
    player.stop();
    const decisions = Object.fromEntries([...entries].map(([number, file]) => [String(number), file]));
    try {
      const result = await window.tungee.confirmAudioMatches(get().config, decisions);
      if (result.status === "saved") matchesSaved();
      else setError(result.error);
    } catch (caught) {
      setError(bridgeError(caught));
    } finally {
      setSaving(false);
    }
  };

  const finishReview = () => {
    const entries = new Map(choices);
    for (const item of reviewItems) entries.set(item.audioNumber, choice(item));
    void save(entries);
  };
  const confirmCurrent = () => (index + 1 < reviewItems.length ? setIndex(index + 1) : finishReview());
  const close = () => set({ matchMode: null, matchFocus: null });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!current || saving || (event.target as HTMLElement).tagName === "SELECT") return;
      if (event.key === " ") {
        event.preventDefault();
        player.play(choice(current));
      } else if (event.key === "ArrowLeft" && index > 0) {
        setIndex(index - 1);
      } else if (event.key === "Enter") {
        confirmCurrent();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const options = [...current.candidates.map((candidate) => candidate.fileName), null];
        const at = options.indexOf(choice(current));
        const next = options[Math.max(0, Math.min(options.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))] ?? null;
        choose(current, next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const look = match.items.filter(needsLook).length;
  const missing = match.items.filter((item) => item.fileName === null).length;
  const tabs: Array<{ value: Tab; title: string }> = [];
  if (reviewItems.length > 0) tabs.push({ value: "review", title: "逐条确认" });
  if (look > 0) tabs.push({ value: "attention", title: `需要看 ${look}` });
  if (missing > 0 && missing !== look) tabs.push({ value: "missing", title: `没录音 ${missing}` });
  if (summary.trimAudioNumbers.length > 0) tabs.push({ value: "trim", title: `剪空白 ${summary.trimAudioNumbers.length}` });
  tabs.push({ value: "all", title: `全部 ${match.items.length}` });
  const tab: Tab = mode === "review" ? "review" : filter;

  const shown = (item: AudioMatchItem) => {
    if (filter === "attention") return needsLook(item);
    if (filter === "missing") return item.fileName === null;
    if (filter === "trim") return isTrimmed(summary, item);
    return true;
  };

  const rowState = (item: AudioMatchItem): RowState => {
    const file = choice(item);
    if (!file) return "missing";
    const touched = choices.has(item.audioNumber);
    if (touched && file !== item.fileName) return "edited";
    if (item.needsReview && !touched) return "review";
    return ["number", "name-number", "confirmed"].includes(item.basis) ? "matched" : "inferred";
  };

  const tag = (item: AudioMatchItem, state: RowState) => {
    if (state === "edited") return "已修改";
    if (state === "review") return item.reason ?? "待确认";
    const label = BASIS_SHORT[item.basis] ?? "";
    return item.basis === "speech" && item.score > 0 ? `${label} ${Math.round(item.score * 100)}%` : label;
  };

  const files = (item: AudioMatchItem) => {
    const suggested = item.candidates.map((candidate) => candidate.fileName);
    return [...suggested, ...match.files.map((file) => file.name).filter((name) => !suggested.includes(name))];
  };

  const changedCount = [...choices].filter(([number, file]) => match.items.find((item) => item.audioNumber === number)?.fileName !== file).length;
  const parts = sections(summary);
  const groups = ([["主流程", parts.flow], ["含糊话术", parts.vague], ["知识库", parts.knowledge]] as const).filter(([, items]) => items.length > 0);

  const candidateRow = (item: AudioMatchItem, candidate: AudioMatchCandidate) => {
    const takenBy = owner(candidate.fileName);
    const detail = [BASIS_LABELS[candidate.basis], candidate.score > 0 ? `相似度 ${Math.round(candidate.score * 100)}%` : null,
      takenBy !== undefined && takenBy !== item.audioNumber ? `现在分给第 ${takenBy} 号` : null].filter(Boolean).join(" · ");
    const transcript = transcripts.get(candidate.fileName);
    const selected = choice(item) === candidate.fileName;
    return (
      <div key={candidate.fileName} className={`pick-row${selected ? " is-selected" : ""}`} onClick={() => choose(item, candidate.fileName)}>
        <div className="grow">
          <span>{candidate.fileName}</span>
          <small>{detail || "未识别出对应关系"}</small>
          {transcript && <small className="clamp-2">“{transcript}”</small>}
        </div>
        <span onClick={(event) => event.stopPropagation()}><PlayButton file={candidate.fileName} {...player} /></span>
      </div>
    );
  };

  return (
    <Sheet width={720} height={mode === "review" ? 600 : 640} onClose={saving ? undefined : close}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, padding: "28px 32px 12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 30, lineHeight: 1.2 }}>{current ? "确认录音" : "录音匹配"}</h2>
          <span className="secondary num">
            {current ? `第 ${Math.min(index + 1, reviewItems.length)} 条，共 ${reviewItems.length} 条` : `已自动匹配 ${match.autoCount}/${match.items.length}`}
          </span>
        </div>
        {tabs.length > 1 && (
          <SegmentedTabs items={tabs} value={tab} onChange={(next) => {
            if (next === "review") setMode("review");
            else {
              setMode("list");
              setFilter(next);
            }
          }} />
        )}
      </div>

      {current ? (
        <div className="sheet-body" style={{ display: "flex", flexDirection: "column", gap: 12, pointerEvents: saving ? "none" : undefined }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 32px" }}>
            <span style={{ display: "flex", gap: 8 }}>
              <span className="secondary">第 {current.audioNumber} 号 · {current.label}</span>
              {current.reason && <span style={{ color: "var(--orange)" }}>{current.reason}</span>}
            </span>
            <span style={{ fontSize: 17, userSelect: "text" }}>{current.speech}</span>
          </div>
          <div className="pick-list">
            {current.candidates.map((candidate) => candidateRow(current, candidate))}
            <div className={`pick-row${choice(current) === null ? " is-selected" : ""}`} onClick={() => choose(current, null)}>
              <div className="grow"><span>这条没有录音</span><small>{missingNote(summary, current)}</small></div>
            </div>
          </div>
        </div>
      ) : (
        <div ref={list} className="sheet-body match-list" style={{ pointerEvents: saving ? "none" : undefined }}>
          {groups.map(([title, items]) => {
            const visible = items.filter(shown);
            if (visible.length === 0) return null;
            return (
              <section key={title}>
                <header>{title} {visible.length}</header>
                {visible.map((item) => {
                  const state = rowState(item);
                  const file = choice(item);
                  // The cut was measured on the matched file; another pick is uploaded as it is until checked again.
                  const trim = file !== null && file === item.fileName ? trimNote(item.trim) : null;
                  return (
                    <div key={item.audioNumber} className={`match-row${item.audioNumber === focus ? " is-focus" : ""}`} data-number={item.audioNumber}>
                      <span className="num secondary" style={{ width: 26, textAlign: "right", flex: "none" }}>{item.audioNumber}</span>
                      <div className="grow" title={item.speech}>
                        <span className="ellipsis">{item.label}</span>
                        <small className="ellipsis">{item.speech}</small>
                        <small className="match-meta ellipsis">
                          <span className={state === "missing" || state === "review" ? "is-orange" : state === "edited" ? "is-blue" : undefined}>
                            {state === "missing" ? missingNote(summary, item) : tag(item, state)}
                          </span>
                          {trim && <> · {trim}</>}
                        </small>
                      </div>
                      <PlayButton file={file} {...player} />
                      <select className="popup" value={file ?? ""} title={file && transcripts.get(file) ? `“${transcripts.get(file)}”` : ""}
                        onChange={(event) => choose(item, event.target.value || null)}>
                        <option value="">没有录音</option>
                        <hr />
                        {files(item).map((name) => {
                          const taken = owner(name);
                          return <option key={name} value={name}>{taken !== undefined && taken !== item.audioNumber ? `${name}（现在分给第 ${taken} 号）` : name}</option>;
                        })}
                      </select>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      {error && <div style={{ padding: "12px 32px" }}><Callout icon={<XOctagonFill size={18} />} title={error.message} detail={error.suggestion} /></div>}
      <div className="sheet-foot" style={{ padding: "16px 32px" }}>
        {current ? (
          <>
            <Button disabled={saving || index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={14} strokeWidth={2} />上一条</Button>
            <span className="tertiary" style={{ flex: 1, whiteSpace: "nowrap" }}>↑↓ 选择 · 空格重播</span>
            <Button disabled={saving} onClick={finishReview}>剩下的都用推荐</Button>
            <Button prominent disabled={saving} onClick={confirmCurrent}>{index + 1 < reviewItems.length ? "确认，下一条" : "确认完成"}</Button>
          </>
        ) : (
          <>
            <span className="secondary ellipsis" style={{ flex: 1 }}>
              {changedCount > 0 ? `已修改 ${changedCount} 条` : match.unusedFiles.length === 0 ? "可以在这里改任意一条" : `没用上的文件不会上传：${match.unusedFiles.join("、")}`}
            </span>
            <Button disabled={saving} onClick={close}>关闭</Button>
            <Button prominent disabled={saving || choices.size === 0} onClick={() => void save(choices)}>保存修改</Button>
          </>
        )}
        {saving && <Spinner />}
      </div>
    </Sheet>
  );
}
