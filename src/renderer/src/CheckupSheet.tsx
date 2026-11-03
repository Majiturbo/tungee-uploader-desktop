import { useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCw, Sparkles } from "lucide-react";
import { isLite } from "../../shared/edition";
import type { AiProgress, AppErrorInfo, CheckupFinding } from "../../shared/types";
import { bridgeError, fileName, get, isPhraseCount, isQaFlag, set, useFixedWorkbook, useModel } from "./model";
import { Button, Callout, Check, CheckCircleFill, Progress, SegmentedTabs, Sheet, Spinner, TriangleFill, XOctagonFill } from "./ui";

type Tab = "choice" | "few" | "qa" | "auto" | "hint";
const TAB_TITLES: Record<Tab, string> = { choice: "需选择", few: "补问法", qa: "QA 设置", auto: "自动修正", hint: "提醒" };
const ALL_TABS: Tab[] = ["choice", "few", "qa", "auto", "hint"];

export const KIND_LABELS: Record<string, string> = {
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

const KIND_NOTES: Record<string, string> = {
  "filler-phrase": "探迹会把带语气词的问法当成另一句，上传时也会自动去掉。",
  "duplicate-phrase": "重复的问法删除后不影响识别。",
  "phrase-format": "多余符号，或两句粘成了一句。",
  "few-phrases": isLite() ? "不到 6 条，轻量版请在 Excel 里手补。" : "不到 6 条，AI 写的已勾选。",
  "some-phrases": isLite() ? "6–9 条，轻量版请在 Excel 里手补。" : "6–9 条，AI 写的默认不勾，需要再勾。",
  "special-qa": "命中后立即挂断。回答以结束语收尾的，一般都该设。",
  "invalid-qa": "不计入意向。默认不勾，按你的业务判断。",
  "special-question": "命中后立即挂断，但话术在提问，客户来不及回答。去 Excel 里去掉特殊QA，或把结尾改成结束语。",
};

const isAutoFix = (finding: CheckupFinding) => finding.options.length > 0 && finding.defaultOption !== undefined;

type TypoState = { kind: "idle" | "running" | "cancelled" } | { kind: "done"; count: number };
type InvalidState = { kind: "idle" } | { kind: "running" } | { kind: "done"; count: number } | { kind: "failed"; message: string };

function grouped(findings: CheckupFinding[]): Array<{ kind: string; items: CheckupFinding[] }> {
  const groups = new Map<string, CheckupFinding[]>();
  for (const finding of findings) groups.set(finding.kind, [...(groups.get(finding.kind) ?? []), finding]);
  return [...groups].map(([kind, items]) => ({ kind, items }));
}

function GroupHeader({ kind, count }: { kind: string; count: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "22px 0 4px" }}>
      <div className="section-title">{KIND_LABELS[kind] ?? kind}<span className="secondary" style={{ fontWeight: 400 }}>{count}</span></div>
      {KIND_NOTES[kind] && <span className="secondary">{KIND_NOTES[kind]}</span>}
    </div>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <div className="title3 secondary" style={{ paddingBottom: 12 }}>{children}</div>;
}

function Divided({ index, count, inset = 0, children, pad = 11 }: { index: number; count: number; inset?: number; children: ReactNode; pad?: number }) {
  return (
    <div>
      <div style={{ padding: `${pad}px 0` }}>{children}</div>
      {index < count - 1 && <hr className="divider" style={{ marginLeft: inset, width: `calc(100% - ${inset}px)` }} />}
    </div>
  );
}

export function CheckupSheet() {
  const s = useModel();
  const checkup = s.summary!.checkup;
  const findings = checkup.findings;
  const hasKnowledge = (s.summary?.knowledgeCount ?? 0) > 0;

  const [decisions, setDecisions] = useState<Record<string, string>>(() =>
    Object.fromEntries(findings.flatMap((finding) => (finding.defaultOption ? [[finding.id, finding.defaultOption]] : []))));
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [typo, setTypo] = useState<TypoState>({ kind: "idle" });
  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null);
  const [aiFindings, setAiFindings] = useState<CheckupFinding[]>([]);
  const [expanding, setExpanding] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Record<number, string[]>>({});
  const [picked, setPicked] = useState<Record<number, Set<string>>>({});
  const [expandFailed, setExpandFailed] = useState<Set<number>>(new Set());
  const [aiUnavailable, setAiUnavailable] = useState<AppErrorInfo | null>(null);
  const [invalidAi, setInvalidAi] = useState<InvalidState>({ kind: "idle" });
  const [aiInvalid, setAiInvalid] = useState<CheckupFinding[]>([]);
  const alive = useRef(true);

  const autoFixes = findings.filter((finding) => isAutoFix(finding) && !isQaFlag(finding.kind));
  const choices = findings.filter((finding) => finding.options.length > 0 && !isAutoFix(finding) && !isQaFlag(finding.kind));
  const fewPhrases = [...findings.filter((finding) => finding.kind === "few-phrases"), ...findings.filter((finding) => finding.kind === "some-phrases")];
  const hints = [...aiFindings, ...findings.filter((finding) => finding.options.length === 0 && !isPhraseCount(finding.kind) && !isQaFlag(finding.kind))];
  const specialSuggestions = findings.filter((finding) => finding.kind === "special-qa");
  const invalidRules = findings.filter((finding) => finding.kind === "invalid-qa");
  const invalidSuggestions = [...invalidRules, ...aiInvalid.filter((finding) => !invalidRules.some((rule) => rule.id === finding.id))];
  const qaWarnings = findings.filter((finding) => finding.kind === "special-question");

  const tabs = ALL_TABS.filter((tab) => {
    switch (tab) {
      case "choice": return choices.length > 0;
      case "few": return fewPhrases.length > 0;
      case "qa": return hasKnowledge || specialSuggestions.length > 0 || qaWarnings.length > 0;
      case "auto": return autoFixes.length > 0;
      case "hint": return true;
    }
  });
  const count = (tab: Tab) => ({ choice: choices.length, few: fewPhrases.length, qa: specialSuggestions.length + invalidSuggestions.length + qaWarnings.length,
    auto: autoFixes.length, hint: hints.length })[tab];

  const [tab, setTab] = useState<Tab>(() => {
    const requested = s.checkupTab as Tab | null;
    return requested && tabs.includes(requested) ? requested : tabs[0] ?? "hint";
  });

  const rowOf = (finding: CheckupFinding) => finding.rowNumbers[0];
  const selectedCount = Object.keys(decisions).length + Object.values(picked).filter((phrases) => phrases.size > 0).length;
  const aiBusy = typo.kind === "running" || expanding !== null || invalidAi.kind === "running";
  const saveBlocked = typo.kind === "running" || expanding !== null;
  const doneCount = fewPhrases.filter((finding) => {
    const row = rowOf(finding);
    return row === undefined || candidates[row] !== undefined || expandFailed.has(row);
  }).length;

  const choose = (id: string, option: string | null | undefined) => {
    setSavedPath(null);
    setError(null);
    setDecisions((current) => {
      const next = { ...current };
      if (option) next[id] = option;
      else delete next[id];
      return next;
    });
  };

  const togglePhrase = (row: number, phrase: string, on: boolean) => {
    setSavedPath(null);
    setPicked((current) => {
      const next = new Set(current[row] ?? []);
      if (on) next.add(phrase);
      else next.delete(phrase);
      return { ...current, [row]: next };
    });
  };

  const expand = async (row: number, fresh: boolean): Promise<boolean> => {
    setSavedPath(null);
    setExpanding(row);
    try {
      const result = await window.tungee.expandPhrases(get().config, row, fresh);
      if (!alive.current) return false;
      if (result.status === "cancelled") return false;
      if (result.status === "error") {
        if (result.error.code === "E-AI-001") {
          setAiUnavailable(result.error);
          return false;
        }
        setExpandFailed((current) => new Set(current).add(row));
        return true;
      }
      setExpandFailed((current) => {
        const next = new Set(current);
        next.delete(row);
        return next;
      });
      setCandidates((current) => ({ ...current, [row]: result.phrases }));
      const optional = findings.find((finding) => finding.rowNumbers[0] === row)?.kind === "some-phrases";
      setPicked((current) => ({ ...current, [row]: optional ? new Set() : new Set(result.phrases) }));
      return true;
    } catch (caught) {
      if (alive.current) setError(bridgeError(caught));
      return false;
    } finally {
      if (alive.current) setExpanding(null);
    }
  };

  const runInvalidAi = async () => {
    setInvalidAi({ kind: "running" });
    setAiProgress(null);
    try {
      const result = await window.tungee.aiInvalidQa(get().config);
      if (!alive.current) return;
      if (result.status === "ok") {
        const known = new Set(findings.map((finding) => finding.id));
        const fresh = result.findings.filter((finding) => !known.has(finding.id));
        setAiInvalid(fresh);
        setInvalidAi({ kind: "done", count: fresh.length });
      } else if (result.status === "cancelled") {
        setInvalidAi({ kind: "idle" });
      } else {
        setInvalidAi({ kind: "failed", message: result.error.message });
      }
    } catch (caught) {
      if (alive.current) setInvalidAi({ kind: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  };

  const runTypoCheck = async () => {
    setSavedPath(null);
    setError(null);
    setTypo({ kind: "running" });
    setAiProgress(null);
    try {
      const result = await window.tungee.aiCheckup(get().config);
      if (!alive.current) return;
      if (result.status === "ok") {
        setAiFindings(result.findings);
        setTypo({ kind: "done", count: result.findings.length });
      } else if (result.status === "cancelled") {
        setTypo({ kind: "cancelled" });
      } else {
        setError(result.error);
        setTypo({ kind: "idle" });
      }
    } catch (caught) {
      if (!alive.current) return;
      setError(bridgeError(caught));
      setTypo({ kind: "idle" });
    }
  };

  useEffect(() => {
    alive.current = true;
    set({ checkupTab: null });
    const unsubscribe = window.tungee.onAiProgress((progress) => alive.current && setAiProgress(progress));
    void (async () => {
      if (get().saved || isLite()) return;
      for (const finding of fewPhrases) {
        const row = rowOf(finding);
        if (row === undefined || !(await expand(row, false))) return;
      }
      if (hasKnowledge && alive.current) await runInvalidAi();
    })();
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, []);

  const close = () => {
    if (aiBusy) void window.tungee.cancelAi();
    set({ checkupOpen: false });
  };

  const save = async () => {
    setSaving(true);
    setSavedPath(null);
    setError(null);
    const additions: Record<string, string[]> = {};
    for (const [row, phrases] of Object.entries(picked)) {
      if (phrases.size > 0) additions[row] = (candidates[Number(row)] ?? []).filter((phrase) => phrases.has(phrase));
    }
    try {
      const result = await window.tungee.saveCheckupFix(get().config, decisions, additions);
      if (result.status === "saved") setSavedPath(result.path);
      else if (result.status === "error") setError(result.error);
    } catch (caught) {
      setError(bridgeError(caught));
    } finally {
      setSaving(false);
    }
  };

  const fewStatus = isLite() ? "轻量版不含 AI 补问法，请在 Excel 里手动补充到 6–10 条。"
    : aiUnavailable ? "本地 AI 不可用，请在 Excel 里手动补充。"
    : doneCount < fewPhrases.length ? `AI 正在写候选问法 ${doneCount}/${fewPhrases.length}`
    : fewPhrases.some((finding) => finding.kind === "some-phrases") ? "太少的已勾选 AI 写的问法，偏少的按需勾选。" : "AI 写的问法已勾选，点一下可取消。";

  const typoStatus = isLite() ? "轻量版不含本地大模型，查错字请用标准版，或在 Excel 里人工核对。"
    : typo.kind === "running"
    ? aiProgress && aiProgress.total > 0 && aiProgress.current > 0 ? `正在逐句检查 ${aiProgress.current}/${aiProgress.total}` : "正在加载本地 AI 模型…"
    : typo.kind === "done" ? typo.count > 0 ? `发现 ${typo.count} 处，请逐条核对。` : "没有发现错字漏字。" : "在本机运行，约 1–3 分钟。";

  const invalidStatus = isLite() ? "轻量版只按问题名称给出规则建议；更细的判断请用标准版。"
    : invalidAi.kind === "idle" ? "按问题名称找出的建议；AI 稍后会再看一遍。"
    : invalidAi.kind === "running" ? aiProgress && aiProgress.total > 0 && aiProgress.current > 0 ? `AI 正在逐个看问题 ${aiProgress.current}/${aiProgress.total}` : "AI 正在看哪些问题和意向无关…"
    : invalidAi.kind === "done" ? invalidAi.count > 0 ? `AI 又找到 ${invalidAi.count} 条，默认不勾。` : "AI 看完了，没有更多建议。"
    : `AI 没能完成：${invalidAi.message}`;

  const flagRow = (finding: CheckupFinding, detail: string | undefined, index: number, total: number) => (
    <Divided key={finding.id} index={index} count={total} inset={29}>
      <Check checked={decisions[finding.id] !== undefined} onChange={(on) => choose(finding.id, on ? "fix" : null)}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>{finding.title}</span>
          {detail && <span className="callout secondary">{detail}</span>}
        </span>
      </Check>
    </Divided>
  );

  const content = (() => {
    switch (tab) {
      case "choice":
        return (
          <>
            <Lead>同一句问法写在了两个问题里，选一个保留。</Lead>
            {choices.map((finding, index) => (
              <Divided key={finding.id} index={index} count={choices.length} pad={18}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {finding.examples.map((example) => <span key={example} className="title3">{example}</span>)}
                  </div>
                  <div className="flow-wrap" style={{ gap: 8 }}>
                    {finding.options.map((option) => (
                      <Button key={option.id} prominent={decisions[finding.id] === option.id} onClick={() => choose(finding.id, option.id)}>
                        {option.label.startsWith("只") ? option.label.slice(1) : option.label}
                      </Button>
                    ))}
                    <Button prominent={decisions[finding.id] === undefined} onClick={() => choose(finding.id, null)}>不处理</Button>
                  </div>
                </div>
              </Divided>
            ))}
          </>
        );
      case "few":
        return (
          <>
            <Lead>{fewStatus}</Lead>
            {isLite() && (
              <div style={{ paddingBottom: 12 }}>
                <Callout icon={<TriangleFill size={18} />} title="轻量版 Lite 不含 AI 补问法"
                  detail="请在 Excel 里手动补充常用问法。需要本机 AI 代写，请改用标准版。" />
              </div>
            )}
            {aiUnavailable && !isLite() && (
              <div style={{ paddingBottom: 12 }}>
                <Callout icon={<TriangleFill size={18} />} title={aiUnavailable.message} detail={aiUnavailable.suggestion} />
              </div>
            )}
            {grouped(fewPhrases).map((group) => (
              <div key={group.kind}>
                <GroupHeader kind={group.kind} count={group.items.length} />
                {group.items.map((finding, index) => {
                  const row = rowOf(finding) ?? 0;
                  const list = candidates[row];
                  const chosen = picked[row] ?? new Set<string>();
                  if (isLite()) {
                    return (
                      <Divided key={finding.id} index={index} count={group.items.length} pad={18}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <span className="title3 strong">{finding.title}</span>
                          <span className="secondary">现有 {finding.examples.length} 条 · 请在 Excel 里继续补</span>
                          {finding.examples.length > 0 && (
                            <span className="callout secondary" style={{ userSelect: "text" }}>{finding.examples.join("  ")}</span>
                          )}
                        </div>
                      </Divided>
                    );
                  }
                  return (
                    <Divided key={finding.id} index={index} count={group.items.length} pad={18}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span className="title3 strong">{finding.title}</span>
                          <span className="secondary" title={finding.examples.join("\n")}>现有 {finding.examples.length} 条</span>
                          <span style={{ flex: 1 }} />
                          {(list !== undefined || expandFailed.has(row)) && (
                            <>
                              {list && list.length > 0 && (
                                <button className="link" onClick={() => {
                                  setPicked((current) => ({ ...current, [row]: chosen.size === list.length ? new Set() : new Set(list) }));
                                  setSavedPath(null);
                                }}>{chosen.size === list.length ? "全不选" : "全选"}</button>
                              )}
                              <button className="link" disabled={aiBusy} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                                onClick={() => void expand(row, true)}><RotateCw size={12} strokeWidth={2} />换一批</button>
                            </>
                          )}
                        </div>
                        {expanding === row ? (
                          <span className="secondary" style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner />正在写…</span>
                        ) : expandFailed.has(row) ? (
                          <span className="secondary">没写出来，点“换一批”再试。</span>
                        ) : list ? (
                          <>
                            {list.length === 0 && <span className="secondary">这批没有合适的（重复或意思不准的已去掉），点“换一批”再试。</span>}
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {list.map((phrase) => (
                                <Check key={phrase} checked={chosen.has(phrase)} onChange={(on) => togglePhrase(row, phrase, on)}>{phrase}</Check>
                              ))}
                            </div>
                          </>
                        ) : !aiUnavailable ? <span className="tertiary">排队中</span> : null}
                      </div>
                    </Divided>
                  );
                })}
              </div>
            ))}
          </>
        );
      case "qa":
        return (
          <>
            <Lead>特殊QA 命中后立即挂断；无效QA 不计入意向。勾选的会在修正版里填「是」。</Lead>
            {qaWarnings.length > 0 && (
              <>
                <GroupHeader kind="special-question" count={qaWarnings.length} />
                {qaWarnings.map((finding, index) => (
                  <Divided key={finding.id} index={index} count={qaWarnings.length} inset={29}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                      <TriangleFill size={14} style={{ flex: "none", alignSelf: "center" }} />
                      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span>{finding.title}</span>
                        {finding.examples[0] && <span className="callout secondary">{finding.examples[0]}</span>}
                      </span>
                    </div>
                  </Divided>
                ))}
              </>
            )}
            <GroupHeader kind="special-qa" count={specialSuggestions.length} />
            {specialSuggestions.length === 0 && <div className="secondary" style={{ padding: "11px 0" }}>没有发现以结束语收尾却没设特殊QA的问题。</div>}
            {specialSuggestions.map((finding, index) => flagRow(finding, finding.examples[0], index, specialSuggestions.length))}
            <GroupHeader kind="invalid-qa" count={invalidSuggestions.length} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
              {invalidAi.kind === "running" && <Spinner />}
              <span className="callout secondary">{invalidStatus}</span>
              {invalidAi.kind === "running" && aiProgress && aiProgress.total > 0 && (
                <span style={{ width: 160 }}><Progress value={aiProgress.current} total={aiProgress.total} /></span>
              )}
            </div>
            {invalidSuggestions.map((finding, index) => flagRow(finding, finding.message, index, invalidSuggestions.length))}
          </>
        );
      case "auto": {
        const all = autoFixes.every((finding) => decisions[finding.id] !== undefined);
        return (
          <>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <Lead>默认全部修正，不需要的点一下取消。</Lead>
              <span style={{ flex: 1 }} />
              <button className="link" onClick={() => autoFixes.forEach((finding) => choose(finding.id, all ? null : finding.defaultOption))}>
                {all ? "全部不选" : "全部选中"}
              </button>
            </div>
            {grouped(autoFixes).map((group) => (
              <div key={group.kind}>
                <GroupHeader kind={group.kind} count={group.items.length} />
                {group.items.map((finding, index) => {
                  const leading = /^(\d+) 条/.exec(finding.message)?.[1];
                  return (
                    <Divided key={finding.id} index={index} count={group.items.length} inset={29}>
                      <Check checked={decisions[finding.id] !== undefined} onChange={(on) => choose(finding.id, on ? finding.defaultOption : null)}>
                        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                            <span>{finding.title}</span>
                            {finding.examples[0] && (
                              <span className="callout secondary" title={finding.examples.join("\n")}
                                style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{finding.examples[0]}</span>
                            )}
                          </span>
                          {leading && <span className="callout secondary num">{leading} 条</span>}
                        </span>
                      </Check>
                    </Divided>
                  );
                })}
              </div>
            ))}
          </>
        );
      }
      case "hint":
        return (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 6 }}>
              <Sparkles size={22} strokeWidth={1.6} color="var(--blue)" style={{ width: 28, flex: "none" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                <span className="title3 strong">{isLite() ? "查错字漏字（标准版）" : "AI 查错字漏字"}</span>
                <span className="secondary">{typoStatus}</span>
                {!isLite() && typo.kind === "running" && aiProgress && aiProgress.total > 0 && (
                  <span style={{ maxWidth: 320 }}><Progress value={aiProgress.current} total={aiProgress.total} /></span>
                )}
              </div>
              {!isLite() && (typo.kind === "running" ? (
                <Button onClick={() => void window.tungee.cancelAi()}>取消</Button>
              ) : (
                <Button disabled={expanding !== null || aiUnavailable !== null || Boolean(s.saved)} onClick={() => void runTypoCheck()}>
                  {typo.kind === "idle" ? "开始检查" : "重新检查"}
                </Button>
              ))}
            </div>
            {hints.length === 0 && (
              <>
                <hr className="divider" style={{ margin: "14px 0" }} />
                <span className="secondary">没有其它提醒。</span>
              </>
            )}
            {grouped(hints).map((group) => (
              <div key={group.kind}>
                <GroupHeader kind={group.kind} count={group.items.length} />
                {group.items.map((finding, index) => (
                  <Divided key={finding.id} index={index} count={group.items.length}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span>{finding.title}</span>
                      <span className="callout secondary">{finding.message}</span>
                      {finding.examples.length > 0 && <span className="callout secondary" style={{ userSelect: "text" }}>{finding.examples.join("  ")}</span>}
                    </div>
                  </Divided>
                ))}
              </div>
            ))}
          </>
        );
    }
  })();

  return (
    <Sheet width={720} height={680} onClose={saving ? undefined : close}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "28px 32px 8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <h2 className="serif" style={{ margin: 0, fontSize: 30, lineHeight: 1.2, display: "flex", alignItems: "center", gap: 10 }}>
            话术体检
            {isLite() && <span className="lite-badge">Lite</span>}
          </h2>
          <span className="secondary">
            {findings.length} 项 · 修正会另存为新文件，原文件不变
            {isLite() ? " · 轻量版不含 AI 补问法与查错字" : ""}
          </span>
        </div>
        <SegmentedTabs items={tabs.map((item) => ({ value: item, title: count(item) > 0 ? `${TAB_TITLES[item]} ${count(item)}` : TAB_TITLES[item] }))}
          value={tab} onChange={setTab} />
      </div>
      <div className="sheet-body" style={{ padding: "16px 32px", pointerEvents: saving ? "none" : undefined }}>
        {error && <div style={{ paddingBottom: 16 }}><Callout icon={<XOctagonFill size={18} />} title={error.message} detail={error.suggestion} /></div>}
        {savedPath && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 16 }}>
            <div style={{ flex: 1 }}><Callout icon={<CheckCircleFill size={18} color="var(--green)" />} title="已另存并复查通过" detail={fileName(savedPath)} /></div>
            <Button onClick={() => useFixedWorkbook(savedPath)}>改用修正版</Button>
          </div>
        )}
        <div key={tab} style={{ animation: "page-in 0.3s ease" }}>{content}</div>
      </div>
      <div className="sheet-foot" style={{ padding: "16px 32px" }}>
        <span className="note" style={{ fontSize: 13 }}>{!isLite() && saveBlocked ? "AI 写完后可以保存" : `已选 ${selectedCount} 项`}</span>
        <Button disabled={saving} onClick={close}>关闭</Button>
        <Button prominent disabled={selectedCount === 0 || saving || saveBlocked || Boolean(s.saved)} onClick={() => void save()}>
          {saving && <Spinner />}{saving ? "正在生成" : "另存修正版"}
        </Button>
      </div>
    </Sheet>
  );
}
