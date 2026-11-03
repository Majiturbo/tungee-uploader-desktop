import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, FileDown, LoaderCircle, Sparkles, Stethoscope, X } from "./icons";
import type {
  AiProgress,
  AppErrorInfo,
  CheckupDecisions,
  CheckupFinding,
  CheckupKind,
  CheckupResult,
  PhraseAdditions,
  UploadConfig,
} from "../../shared/types";

const kindLabels: Record<CheckupKind, string> = {
  "system-prompt": "系统提示更新",
  "filler-phrase": "语气词",
  "duplicate-phrase": "问法重复",
  "phrase-format": "符号异常",
  "shared-phrase": "两个问题抢同一句",
  "few-phrases": "问法太少",
  "some-phrases": "问法偏少",
  "special-qa": "建议设为特殊QA",
  "invalid-qa": "建议设为无效QA",
  "special-question": "特殊QA是问句",
  "long-speech": "话术偏长",
  typo: "AI 查错字漏字",
};

const kindNotes: Partial<Record<CheckupKind, string>> = {
  "filler-phrase": "探迹会把带语气词的问法当成另一句，上传时也会自动去掉。",
  "duplicate-phrase": "重复的问法删除后不影响识别。",
  "phrase-format": "多余符号，或两句粘成了一句。",
};

type Tab = "choice" | "few" | "auto" | "hint";

function groupByKind(findings: CheckupFinding[]): Array<[CheckupKind, CheckupFinding[]]> {
  const groups = new Map<CheckupKind, CheckupFinding[]>();
  for (const finding of findings) groups.set(finding.kind, [...(groups.get(finding.kind) ?? []), finding]);
  return [...groups];
}

function countOf(message: string): string | null {
  const match = /^(\d+) 条/.exec(message);
  return match ? `${match[1]} 条` : null;
}

export function isAutoFix(finding: CheckupFinding): boolean {
  return finding.options.length > 0 && finding.defaultOption !== undefined;
}

function toError(error: unknown): AppErrorInfo {
  return {
    code: "E-APP-001",
    message: "桌面应用通信失败。",
    suggestion: "请关闭本工具后重新打开；若仍出现，请把技术详情发给维护人员。",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function defaultDecisions(checkup: CheckupResult): CheckupDecisions {
  const decisions: CheckupDecisions = {};
  for (const finding of checkup.findings) {
    if (finding.defaultOption) decisions[finding.id] = finding.defaultOption;
  }
  return decisions;
}

type TypoState = { status: "idle" } | { status: "done"; count: number } | { status: "cancelled" };

interface CheckupDialogProps {
  checkup: CheckupResult;
  config: UploadConfig;
  onClose: () => void;
  onUseFixed: (path: string) => void;
}

export function CheckupDialog({ checkup, config, onClose, onUseFixed }: CheckupDialogProps) {
  const [decisions, setDecisions] = useState<CheckupDecisions>(() => defaultDecisions(checkup));
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [typoRunning, setTypoRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null);
  const [typoState, setTypoState] = useState<TypoState>({ status: "idle" });
  const [aiFindings, setAiFindings] = useState<CheckupFinding[]>([]);
  const [expanding, setExpanding] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Record<number, string[]>>({});
  const [expandFailed, setExpandFailed] = useState<Record<number, boolean>>({});
  const [aiUnavailable, setAiUnavailable] = useState<AppErrorInfo | null>(null);
  const [picked, setPicked] = useState<Record<number, string[]>>({});

  const autoFixes = useMemo(() => checkup.findings.filter(isAutoFix), [checkup]);
  const choices = useMemo(() => checkup.findings.filter((item) => item.options.length > 0 && !isAutoFix(item)), [checkup]);
  const fewPhrases = useMemo(() => checkup.findings.filter((item) => item.kind === "few-phrases"), [checkup]);
  const hints = useMemo(
    () => [...aiFindings, ...checkup.findings.filter((item) => item.options.length === 0 && item.kind !== "few-phrases")],
    [checkup, aiFindings],
  );
  const tabs = ([
    ["choice", "需选择", choices.length],
    ["few", "补问法", fewPhrases.length],
    ["auto", "自动修正", autoFixes.length],
    ["hint", "提醒", hints.length],
  ] as Array<[Tab, string, number]>).filter(([id, , count]) => count > 0 || id === "hint");
  const [tab, setTab] = useState<Tab>(() => tabs[0]?.[0] ?? "hint");
  const pickedRows = Object.values(picked).filter((items) => items.length > 0).length;
  const selectedCount = Object.keys(decisions).length + pickedRows;
  const doneCount = fewPhrases.filter((finding) => {
    const row = finding.rowNumbers[0] ?? 0;
    return candidates[row] !== undefined || expandFailed[row];
  }).length;
  const aiBusy = typoRunning || expanding !== null;

  useEffect(() => window.tungee.onAiProgress(setAiProgress), []);

  useEffect(() => {
    let active = true;
    const rows = fewPhrases.map((finding) => finding.rowNumbers[0]).filter((row): row is number => row !== undefined);
    void (async () => {
      for (const row of rows) {
        if (!active || !(await expand(row, false))) return;
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const close = () => {
    if (aiBusy) void window.tungee.cancelAi();
    onClose();
  };

  const resetSaved = () => {
    setSavedPath(null);
    setError(null);
  };

  const choose = (findingId: string, optionId: string | null) => {
    resetSaved();
    setDecisions((current) => {
      const next = { ...current };
      if (optionId === null) delete next[findingId];
      else next[findingId] = optionId;
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    resetSaved();
    setDecisions((current) => {
      const next = { ...current };
      for (const finding of autoFixes) {
        if (checked && finding.defaultOption) next[finding.id] = finding.defaultOption;
        else delete next[finding.id];
      }
      return next;
    });
  };

  const runTypoCheck = async () => {
    resetSaved();
    setTypoRunning(true);
    setAiProgress(null);
    try {
      const result = await window.tungee.aiCheckup(config);
      if (result.status === "ok") {
        setAiFindings(result.findings);
        setTypoState({ status: "done", count: result.findings.length });
      }
      if (result.status === "cancelled") setTypoState({ status: "cancelled" });
      if (result.status === "error") setError(result.error);
    } catch (reason: unknown) {
      setError(toError(reason));
    } finally {
      setTypoRunning(false);
    }
  };

  const expand = async (row: number, fresh: boolean): Promise<boolean> => {
    resetSaved();
    setExpanding(row);
    try {
      const result = await window.tungee.expandPhrases(config, row, fresh);
      if (result.status === "cancelled") return false;
      if (result.status === "error") {
        if (result.error.code === "E-AI-001") {
          setAiUnavailable(result.error);
          return false;
        }
        setExpandFailed((current) => ({ ...current, [row]: true }));
        return true;
      }
      setExpandFailed((current) => ({ ...current, [row]: false }));
      setCandidates((current) => ({ ...current, [row]: result.phrases }));
      setPicked((current) => ({ ...current, [row]: result.phrases }));
      return true;
    } catch (reason: unknown) {
      setError(toError(reason));
      return false;
    } finally {
      setExpanding(null);
    }
  };

  const pickAll = (row: number, checked: boolean) => {
    resetSaved();
    setPicked((current) => ({ ...current, [row]: checked ? candidates[row] ?? [] : [] }));
  };

  const togglePhrase = (row: number, phrase: string) => {
    resetSaved();
    setPicked((current) => {
      const items = current[row] ?? [];
      return { ...current, [row]: items.includes(phrase) ? items.filter((item) => item !== phrase) : [...items, phrase] };
    });
  };

  const save = async () => {
    setSaving(true);
    resetSaved();
    const additions: PhraseAdditions = {};
    for (const [row, items] of Object.entries(picked)) {
      if (items.length) additions[row] = items;
    }
    try {
      const result = await window.tungee.saveCheckupFix(config, decisions, additions);
      if (result.status === "saved") setSavedPath(result.path);
      if (result.status === "error") setError(result.error);
    } catch (reason: unknown) {
      setError(toError(reason));
    } finally {
      setSaving(false);
    }
  };

  const allAutoSelected = autoFixes.every((finding) => decisions[finding.id]);

  const aiStatus = typoRunning
    ? aiProgress && aiProgress.total > 0 && aiProgress.current > 0
      ? `正在逐句检查 ${aiProgress.current}/${aiProgress.total}`
      : "正在加载本地 AI 模型…"
    : typoState.status === "done"
      ? typoState.count ? `发现 ${typoState.count} 处，请逐条核对。` : "没有发现错字漏字。"
      : "在本机运行，约 1–3 分钟。";

  const fewStatus = aiUnavailable
    ? "本地 AI 不可用，请在 Excel 里手动补充。"
    : doneCount < fewPhrases.length
      ? `AI 正在写候选问法 ${doneCount}/${fewPhrases.length}`
      : "AI 写的问法已勾选，点一下可取消。";

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) close(); }}>
      <section className="storage-dialog checkup-dialog" role="dialog" aria-modal="true" aria-labelledby="checkup-dialog-title">
        <header className="dialog-head">
          <div>
            <Stethoscope size={18} />
            <h3 id="checkup-dialog-title">话术体检</h3>
          </div>
          <button className="icon-button" onClick={close} disabled={saving} aria-label="关闭"><X size={16} /></button>
        </header>

        <div className="segmented" role="tablist">
          {tabs.map(([id, label, count]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
              {label}{count > 0 && <small>{count}</small>}
            </button>
          ))}
        </div>

        <div className="checkup-body" key={tab}>
          {tab === "choice" && (
            <>
              <p className="checkup-lead">同一句问法写在了两个问题里，选一个保留。</p>
              {choices.map((finding) => (
                <div key={finding.id} className="checkup-card">
                  <b>{finding.examples.join("  ")}</b>
                  <div className="checkup-options">
                    {finding.options.map((option) => (
                      <button
                        key={option.id}
                        className={`choice-pill ${decisions[finding.id] === option.id ? "is-active" : ""}`}
                        onClick={() => choose(finding.id, option.id)}
                        disabled={saving}
                      >
                        {option.label.replace(/^只/, "")}
                      </button>
                    ))}
                    <button className={`choice-pill ${decisions[finding.id] ? "" : "is-active"}`} onClick={() => choose(finding.id, null)} disabled={saving}>
                      不处理
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "few" && (
            <>
              <p className="checkup-lead">{fewStatus}</p>
              {aiUnavailable && (
                <div className="storage-hint">
                  <AlertTriangle size={14} />
                  <span>{aiUnavailable.message}{aiUnavailable.suggestion}</span>
                </div>
              )}
              {fewPhrases.map((finding) => {
                const row = finding.rowNumbers[0] ?? 0;
                const list = candidates[row];
                const chosen = picked[row] ?? [];
                const allPicked = list !== undefined && list.length > 0 && chosen.length === list.length;
                return (
                  <div key={finding.id} className="checkup-card">
                    <div className="checkup-card-head">
                      <span>
                        <b>{finding.title}</b>
                        <small title={finding.examples.join("\n")}>现有 {finding.examples.length} 条</small>
                      </span>
                      {(list !== undefined || expandFailed[row]) && (
                        <span>
                          {list !== undefined && list.length > 0 && (
                            <button className="text-action" onClick={() => pickAll(row, !allPicked)} disabled={saving}>
                              {allPicked ? "全不选" : "全选"}
                            </button>
                          )}
                          <button className="text-action" onClick={() => void expand(row, true)} disabled={saving || aiBusy}>
                            <Sparkles size={12} />换一批
                          </button>
                        </span>
                      )}
                    </div>
                    {expanding === row && <small className="checkup-pending"><LoaderCircle size={12} />正在写…</small>}
                    {expanding !== row && list === undefined && !expandFailed[row] && !aiUnavailable && <small className="checkup-pending">排队中</small>}
                    {expanding !== row && expandFailed[row] && <small className="checkup-pending">没写出来，点“换一批”再试。</small>}
                    {expanding !== row && list !== undefined && (list.length ? (
                      <div className="checkup-options">
                        {list.map((phrase) => (
                          <button
                            key={phrase}
                            className={`choice-pill is-check ${chosen.includes(phrase) ? "is-active" : ""}`}
                            onClick={() => togglePhrase(row, phrase)}
                            disabled={saving}
                            aria-pressed={chosen.includes(phrase)}
                          >
                            <Check size={10} />{phrase}
                          </button>
                        ))}
                      </div>
                    ) : <small className="checkup-pending">这次没有可用的新问法，点“换一批”再试。</small>)}
                  </div>
                );
              })}
            </>
          )}

          {tab === "auto" && (
            <>
              <div className="checkup-lead">
                <span>默认全部修正，不需要的取消勾选。</span>
                <button className="text-action" onClick={() => toggleAll(!allAutoSelected)} disabled={saving}>
                  {allAutoSelected ? "全部不选" : "全部选中"}
                </button>
              </div>
              {groupByKind(autoFixes).map(([kind, items]) => (
                <div key={kind} className="group">
                  <h2>{kindLabels[kind]} · {items.length}{kindNotes[kind] && <span>{kindNotes[kind]}</span>}</h2>
                  <div className="storage-list">
                    {items.map((finding) => (
                      <label key={finding.id} className="storage-item checkup-item">
                        <input
                          type="checkbox"
                          checked={Boolean(decisions[finding.id])}
                          onChange={(event) => choose(finding.id, event.target.checked ? finding.defaultOption ?? null : null)}
                          disabled={saving}
                        />
                        <span className="check-box"><Check size={12} /></span>
                        <span className="storage-text">
                          <b>{finding.title}</b>
                          {finding.examples.length > 0 && <small title={finding.examples.join("\n")}>{finding.examples[0]}</small>}
                        </span>
                        {countOf(finding.message) && <em>{countOf(finding.message)}</em>}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === "hint" && (
            <>
              <div className="checkup-ai">
                <Sparkles size={16} />
                <span>
                  <b>AI 查错字漏字</b>
                  <small>{aiStatus}</small>
                  {typoRunning && aiProgress && aiProgress.total > 0 && (
                    <span className="progress-track"><span style={{ width: `${Math.round((aiProgress.current / aiProgress.total) * 100)}%` }} /></span>
                  )}
                </span>
                {typoRunning
                  ? <button className="button" onClick={() => void window.tungee.cancelAi()}>取消</button>
                  : <button className="button" onClick={() => void runTypoCheck()} disabled={saving || expanding !== null || aiUnavailable !== null} title={expanding !== null ? "AI 正在补充问法，写完后再检查" : undefined}>{typoState.status === "idle" ? "开始检查" : "重新检查"}</button>}
              </div>
              {hints.length > 0 && <p className="checkup-lead">以下需要在 Excel 里手动修改。</p>}
              {groupByKind(hints).map(([kind, items]) => (
                <div key={kind} className="group">
                  <h2>{kindLabels[kind]} · {items.length}</h2>
                  <div className="storage-list">
                    {items.map((finding) => (
                      <div key={finding.id} className="storage-item">
                        <span className="storage-text">
                          <b>{finding.title}</b>
                          <small>{finding.message}</small>
                          {finding.examples.length > 0 && <small title={finding.examples.join("\n")}>{finding.examples.join("  ")}</small>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {error && (
          <div className="storage-hint is-error">
            <AlertTriangle size={14} />
            <span><code>{error.code}</code>{error.message}{error.suggestion}</span>
          </div>
        )}
        {savedPath && (
          <div className="storage-hint is-success checkup-saved">
            <CheckCircle2 size={14} />
            <span>已另存并复查通过：{savedPath}</span>
            <button className="button" onClick={() => onUseFixed(savedPath)}>改用修正版</button>
          </div>
        )}

        <footer className="dialog-foot">
          <span>{expanding !== null ? "AI 写完后可以保存" : `已选 ${selectedCount} 项 · 另存为新文件，原文件不变`}</span>
          <div>
            <button className="button outline" onClick={close} disabled={saving}>关闭</button>
            <button className="button primary" onClick={() => void save()} disabled={!selectedCount || saving || aiBusy}>
              {saving ? <LoaderCircle size={14} /> : <FileDown size={14} />}
              {saving ? "正在生成" : "另存修正版"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
