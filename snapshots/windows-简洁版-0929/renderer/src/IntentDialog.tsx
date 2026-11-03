import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, FileDown, LoaderCircle, RefreshCw, Target, Wand2, X } from "./icons";
import {
  buildIntentPlan,
  cardTitle,
  intentMarkdown,
  intentSetups,
  needsConfirm,
  type IntentAnalysis,
  type IntentQuestion,
  type IntentSetup,
  type IntentSignal,
} from "../../shared/intent-plan";
import type { AiProgress, AppErrorInfo, UploadConfig } from "../../shared/types";

const moveTargets: Array<{ signal: IntentSignal; label: string }> = [
  { signal: "action", label: "A级｜明确行动" },
  { signal: "price", label: "A级｜主动询价" },
  { signal: "consult", label: "B级｜业务咨询" },
  { signal: "objection", label: "C级｜暂缓或异议" },
  { signal: "other", label: "不建意向" },
];

function toError(error: unknown): AppErrorInfo {
  return {
    code: "E-APP-001",
    message: "桌面应用通信失败。",
    suggestion: "请关闭本工具后重新打开；若仍出现，请把技术详情发给维护人员。",
    detail: error instanceof Error ? error.message : String(error),
  };
}

interface IntentDialogProps {
  config: UploadConfig;
  scheduled: IntentSetup[] | null;
  onSchedule: (setups: IntentSetup[] | null) => void;
  onClose: () => void;
}

export function IntentDialog({ config, scheduled, onSchedule, onClose }: IntentDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [analysis, setAnalysis] = useState<IntentAnalysis | null>(null);
  const [questions, setQuestions] = useState<IntentQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setSelected(null);
    setProgress(null);
    try {
      const result = await window.tungee.analyzeIntent(config);
      if (result.status === "ok") {
        setAnalysis(result.analysis);
        setQuestions(result.analysis.questions);
      }
      if (result.status === "error") setError(result.error);
      if (result.status === "cancelled") onClose();
    } catch (reason: unknown) {
      setError(toError(reason));
    } finally {
      setLoading(false);
    }
  }, [config, onClose]);

  useEffect(() => window.tungee.onAiProgress(setProgress), []);
  useEffect(() => { void analyze(); }, [analyze]);

  const close = useCallback(() => {
    if (loading) void window.tungee.cancelAi();
    onClose();
  }, [loading, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirming) setConfirming(false);
      else if (selected) setSelected(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, confirming, close]);

  const plan = useMemo(() => buildIntentPlan(questions), [questions]);
  const byName = useMemo(() => new Map(questions.map((question) => [question.name, question])), [questions]);
  const markdown = useMemo(() => analysis ? intentMarkdown(analysis, plan) : "", [analysis, plan]);
  const setups = useMemo(() => intentSetups(plan), [plan]);
  const flaggedCount = useMemo(() => {
    const names = new Set(plan.cards.flatMap((card) => card.questions));
    return [...names].filter((name) => {
      const question = byName.get(name);
      return question !== undefined && needsConfirm(question);
    }).length;
  }, [plan, byName]);

  const schedule = () => {
    onSchedule(setups);
    onClose();
  };
  const skippedGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const item of plan.skipped) groups.set(item.reason, [...(groups.get(item.reason) ?? []), item.name]);
    return [...groups];
  }, [plan]);

  const move = (signal: IntentSignal) => {
    if (!selected) return;
    setQuestions((current) => current.map((question) => question.name === selected ? { ...question, signal, source: "user", alternative: undefined } : question));
    setSelected(null);
    setNotice(null);
  };

  const copy = async () => {
    await window.tungee.copyText(markdown);
    setNotice("已复制全部建议，可以粘贴到文档或聊天里");
  };

  const exportDoc = async () => {
    setError(null);
    try {
      const result = await window.tungee.exportIntent(config, markdown);
      if (result.status === "saved") setNotice(`已导出：${result.path}`);
      if (result.status === "error") setError(result.error);
    } catch (reason: unknown) {
      setError(toError(reason));
    }
  };

  const chip = (name: string) => {
    const question = byName.get(name);
    const flagged = question ? needsConfirm(question) : false;
    return (
      <button
        key={name}
        className={`intent-chip ${flagged ? "is-flagged" : ""} ${question?.source === "user" ? "is-moved" : ""} ${selected === name ? "is-active" : ""}`}
        title={question?.phrases.length ? `客户会说：${question.phrases.join("；")}` : undefined}
        onClick={() => setSelected(selected === name ? null : name)}
      >
        {name}{flagged && <i>需确认</i>}
      </button>
    );
  };

  const selectedQuestion = selected ? byName.get(selected) : undefined;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="storage-dialog intent-dialog" role="dialog" aria-modal="true" aria-labelledby="intent-dialog-title">
        <header className="dialog-head">
          <div>
            <Target size={18} />
            <h3 id="intent-dialog-title">意向建议</h3>
          </div>
          <button className="icon-button" onClick={close} aria-label="关闭"><X size={16} /></button>
        </header>

        {loading ? (
          <div className="intent-loading">
            <LoaderCircle size={22} className="spin" />
            <b>
              {!progress || progress.total === 0
                ? "正在读取话术"
                : progress.current === 0
                  ? `正在加载本地 AI 模型（${progress.total} 个行业问题待归类）`
                  : `本地 AI 正在归类行业问题 ${progress.current}/${progress.total}`}
            </b>
            {progress && progress.total > 0 && (
              <div className="progress-track"><span style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} /></div>
            )}
            <small>首次加载模型可能需要几分钟。</small>
            <button className="button outline" onClick={close}>取消</button>
          </div>
        ) : (
          <div className="checkup-body intent-body">
            {analysis && (
              <>
                <p className="checkup-intro">
                  共 {analysis.questions.length} 个可用问题，建议新增 <b>{plan.cards.length}</b> 条意向。默认 5 条基础意向保留，不重复创建。
                  点任意问题可以换到别的意向；标“需确认”的是没把握的归类。调整好后可以点“上传时自动设置”，上传完成后程序会在探迹里新建这些意向。
                </p>
                {analysis.modelUnavailable && (
                  <div className="storage-hint">
                    <AlertTriangle size={14} />
                    <span>{analysis.modelUnavailable}。行业问题先按关键词粗分，都标了“需确认”。</span>
                  </div>
                )}
                {selected && (
                  <div className="intent-move">
                    <b>把「{selected}」移到：</b>
                    <div className="checkup-options">
                      {moveTargets.map((target) => (
                        <button
                          key={target.signal}
                          className={`choice-pill ${selectedQuestion?.signal === target.signal ? "is-active" : ""}`}
                          onClick={() => move(target.signal)}
                        >
                          {target.label}
                        </button>
                      ))}
                      <button className="choice-pill" onClick={() => setSelected(null)}>取消</button>
                    </div>
                    {selectedQuestion?.phrases.length ? <small>客户会说：{selectedQuestion.phrases.join("；")}</small> : null}
                  </div>
                )}
                <div className="intent-cards">
                  {plan.cards.map((card) => (
                    <div key={card.id} className={`intent-card level-${card.level.charAt(0)}`}>
                      <div className="intent-card-head">
                        <span>{card.level}</span>
                        <b>{card.description}</b>
                      </div>
                      <small>{card.when}</small>
                      <div className="intent-condition">条件匹配：{card.match} · 条件 1：命中特定问题名称</div>
                      <div className="intent-chips">{card.questions.map(chip)}</div>
                      <small className="intent-order">建议顺序：{card.order}</small>
                      {card.confirms.length > 0 && <small className="intent-confirm">需要确认：{card.confirms.join(" ")}</small>}
                    </div>
                  ))}
                  {plan.cards.length === 0 && <p className="checkup-intro">没有需要新增的意向，默认基础意向已经够用。</p>}
                </div>
                {skippedGroups.length > 0 && (
                  <div className="checkup-section">
                    <div className="mini-heading"><b>不建议新增</b><span>{plan.skipped.length} 个问题</span></div>
                    {skippedGroups.map(([reason, names]) => (
                      <div key={reason} className="intent-skipped">
                        <small>{reason}</small>
                        <div className="intent-chips">{names.map(chip)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {plan.cards.length > 0 && (
                  <details className="checkup-section checkup-hints">
                    <summary>手动配置的网页操作顺序</summary>
                    <ol className="intent-steps">
                      <li>打开话术编辑页的“话术设置 → 意向设置”，点击“新建意向”，填写意向等级和意向描述（描述只是显示名称）。</li>
                      <li>条件匹配选“所有”，条件类型选“命中特定问题名称”，勾选卡片里的问题。</li>
                      <li>保存后按“建议顺序”用“上移”调整判断顺序。</li>
                    </ol>
                  </details>
                )}
                <small className="intent-legend">鼠标停在问题上可以看到客户的常见说法。</small>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="storage-hint is-error">
            <AlertTriangle size={14} />
            <span><code>{error.code}</code>{error.message}{error.suggestion}</span>
          </div>
        )}
        {notice && (
          <div className="storage-hint is-success">
            <CheckCircle2 size={14} />
            <span>{notice}</span>
          </div>
        )}

        {confirming && (
          <div className="intent-confirm-panel">
            <b>上传完成后、提交审核前，程序会在探迹里新建这 {setups.length} 条意向：</b>
            <ul>
              {setups.map((setup) => (
                <li key={setup.description}>
                  {cardTitle(setup)}<small>{setup.questions.length} 个问题 · {setup.placement === "end" ? "排在最后" : `排在默认「B级｜主流程命中肯定」之前`}</small>
                </li>
              ))}
            </ul>
            <small>
              默认 5 条基础意向不改动；网页里已有同名意向的会跳过。
              {flaggedCount > 0 && <>其中 <em>{flaggedCount}</em> 个问题标了“需确认”，会按当前卡片设置。</>}
              意向没设置完整时，不会自动提交审核。
            </small>
            <div>
              <button className="button outline" onClick={() => setConfirming(false)}>返回修改</button>
              <button className="button primary" onClick={schedule}><Check size={15} />确认，上传时自动设置</button>
            </div>
          </div>
        )}

        <footer className="dialog-foot">
          <span>{scheduled ? `已安排：上传后自动设置 ${scheduled.length} 条意向` : "可以复制建议手动配置，也可以上传时自动设置"}</span>
          <div>
            <button className="button outline" onClick={() => void analyze()} disabled={loading}><RefreshCw size={15} />重新分析</button>
            <button className="button outline" onClick={() => void exportDoc()} disabled={loading || !analysis}><FileDown size={15} />导出</button>
            <button className="button outline" onClick={() => void copy()} disabled={loading || !analysis}><Copy size={15} />复制</button>
            {scheduled && <button className="button outline" onClick={() => { onSchedule(null); setNotice("已取消自动设置，上传时不会改动意向"); }}>取消自动设置</button>}
            <button className="button primary" onClick={() => setConfirming(true)} disabled={loading || !analysis || plan.cards.length === 0 || confirming}>
              <Wand2 size={15} />{scheduled ? "更新自动设置" : "上传时自动设置"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

