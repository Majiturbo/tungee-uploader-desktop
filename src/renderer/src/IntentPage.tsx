import { useEffect, useRef, useState } from "react";
import { CircleAlert, Copy, Share, WandSparkles } from "lucide-react";
import { isLite } from "../../shared/edition";
import { cardTitle, type IntentCard, type IntentSetup, type IntentSkipped } from "../../shared/intent-plan";
import {
  analyzeIntents,
  copyIntents,
  exportIntents,
  moveQuestion,
  resetIntent,
  set,
  useModel,
  type IntentPlanResult,
  type State,
} from "./model";
import type { Mood } from "./Recordings";
import { Alert, Banners, Button, Callout, CheckCircleFill, Page, PageHeader, Popover, Progress, QuestionCircleFill, Soft, XOctagonFill } from "./ui";

const MOVE_TARGETS: Array<{ signal: "action" | "price" | "consult" | "objection" | "other"; label: string }> = [
  { signal: "action", label: "A级｜明确行动" },
  { signal: "price", label: "A级｜主动询价" },
  { signal: "consult", label: "B级｜业务咨询" },
  { signal: "objection", label: "C级｜暂缓或异议" },
  { signal: "other", label: "不建意向" },
];

export function intentMood(s: State): Mood {
  if (s.intentError) return "error";
  if (s.scheduledIntents) return "done";
  return s.intentResult && s.intentResult.flagged.length > 0 ? "attention" : "calm";
}

const sameSetups = (a: IntentSetup[], b: IntentSetup[]) => JSON.stringify(a) === JSON.stringify(b);

export function IntentPage() {
  const s = useModel();
  const ready = s.summary?.canUpload === true;
  const noKnowledge = (s.summary?.knowledgeCount ?? 0) === 0;

  useEffect(() => {
    if (!ready || noKnowledge || s.saved || s.intentAnalysis || s.intentLoading || s.intentError) return;
    void analyzeIntents();
  }, [ready, noKnowledge, s.saved, s.intentAnalysis, s.intentLoading, s.intentError, s.summary]);

  const title = !ready ? "先完成体检"
    : noKnowledge ? "这套话术不用设置意向"
    : s.intentLoading ? (isLite() ? "正在按关键词归类" : "正在读懂客户会问什么")
    : s.intentError ? "意向建议没生成"
    : !s.intentResult ? (isLite() ? "意向建议（轻量版）" : "意向建议")
    : s.intentResult.plan.cards.length === 0 ? "默认意向已经够用" : `建议新增 ${s.intentResult.plan.cards.length} 条意向`;

  const subtitle = (() => {
    if (!ready) {
      return isLite()
        ? "体检通过后，轻量版会按关键词给出意向建议，请你逐条确认。"
        : "体检通过后，我会按知识库里的问题给出意向建议。";
    }
    if (noKnowledge) return "没有知识库问题，默认的 5 条意向就够了。";
    if (s.intentLoading) {
      if (isLite()) return "轻量版不含本地大模型，这次用关键词粗分。";
      return s.intentProgress && s.intentProgress.total > 0 ? `本地 AI 在归类第 ${s.intentProgress.current}/${s.intentProgress.total} 个问题。` : "读取知识库…";
    }
    if (!s.intentResult) return "";
    if (s.intentResult.plan.cards.length === 0) return "知识库里没有能区分客户意向的问题。";
    return isLite()
      ? "轻量版按关键词粗分，把握不如标准版。默认的 5 条意向不动；觉得放错了，点一下换过去。"
      : "默认的 5 条意向保持不动。觉得哪个问题放错了，点一下换过去。";
  })();

  const caption = (() => {
    const analysis = s.intentAnalysis;
    if (!analysis || s.intentLoading) return null;
    if (isLite()) return `${analysis.knowledgeCount} 个知识库问题 · 轻量版按关键词归类`;
    if (analysis.modelUnavailable) return `本地 AI 没启动，这次按关键词归类：${analysis.modelUnavailable}`;
    return `${analysis.knowledgeCount} 个知识库问题 · 本地 AI 归类，不联网`;
  })();

  const result = s.intentResult;
  const flagged = new Set(result?.flagged ?? []);

  return (
    <Page>
      <PageHeader title={title} subtitle={subtitle || undefined} caption={caption} />
      <Banners />
      {s.intentLoading && (
        <div style={{ maxWidth: 360 }}><Progress value={s.intentProgress?.current} total={s.intentProgress?.total || undefined} /></div>
      )}
      {s.intentError && (
        <>
          <Callout icon={<XOctagonFill size={18} />} title={s.intentError.message} detail={s.intentError.suggestion} />
          <div><Button onClick={() => void analyzeIntents()}>重新分析</Button></div>
        </>
      )}
      {result && !s.intentLoading && (
        <>
          {result.setups.length > 0 && <Schedule s={s} result={result} />}
          <div className="intent-cards" data-tour="intentCards">
            {result.plan.cards.map((card) => <IntentCardView key={card.id} card={card} flagged={flagged} />)}
          </div>
          {result.plan.skipped.length > 0 && <Skipped items={result.plan.skipped} flagged={flagged} />}
          <div className="intent-footer" data-tour="intentFooter">
            <Button onClick={() => void copyIntents()}><Copy size={13} strokeWidth={1.8} />复制建议</Button>
            <Button onClick={() => void exportIntents()}><Share size={13} strokeWidth={1.8} />导出…</Button>
            <span style={{ flex: 1 }} />
            <Button onClick={() => {
              resetIntent();
              void analyzeIntents();
            }}>重新分析</Button>
          </div>
        </>
      )}
      {s.intentConfirming && result && (
        <Alert title={`上传时自动设置 ${result.setups.length} 条意向？`}
          message={[...result.setups.map((setup) => cardTitle(setup)), "", "只新建这些意向，默认的 5 条不改不删；探迹里已有的会跳过。有任何一步失败，就不会自动提交审核。"].join("\n")}
          confirm="自动设置"
          onConfirm={() => set({ scheduledIntents: result.setups, intentConfirming: false })}
          onCancel={() => set({ intentConfirming: false })} />
      )}
    </Page>
  );
}

function Schedule({ s, result }: { s: State; result: IntentPlanResult }) {
  const scheduled = s.scheduledIntents;
  const current = scheduled ? sameSetups(scheduled, result.setups) : true;
  return (
    <Soft tour="schedule">
      <div className="banner-row">
        {scheduled ? <CheckCircleFill size={22} /> : <WandSparkles size={22} strokeWidth={1.6} color="var(--blue)" />}
        <div className="text">
          {scheduled ? (
            <>
              <b>上传完成后，自动新建这 {scheduled.length} 条</b>
              <span style={current ? undefined : { color: "var(--orange)" }}>{current ? "只新建，不动默认意向。" : "你刚调整过问题，自动设置还是之前的版本。"}</span>
            </>
          ) : (
            <>
              <b>让我在上传时顺手设置好</b>
              <span>也可以复制下面的建议，自己去探迹里配置。</span>
            </>
          )}
        </div>
        {scheduled ? (
          <>
            {!current && <Button onClick={() => set({ intentConfirming: true })}>更新</Button>}
            <Button onClick={() => set({ scheduledIntents: null })}>不自动设置</Button>
          </>
        ) : (
          <Button prominent onClick={() => set({ intentConfirming: true })}>上传时自动设置</Button>
        )}
      </div>
    </Soft>
  );
}

function IntentCardView({ card, flagged }: { card: IntentCard; flagged: Set<string> }) {
  const tint = card.level === "A级" ? "var(--blue)" : card.level === "B级" ? "var(--indigo)" : "var(--text-2)";
  return (
    <Soft className="intent-card">
      <div className="intent-card-head">
        <span className="level" style={{ color: tint }}>{card.level}</span>
        <span className="name">{card.description}</span>
        <span className="match">{card.match === "所有" ? "问到全部才算" : "问到任意一个就算"}</span>
      </div>
      <div className="secondary">{card.when}</div>
      <div className="flow-wrap">
        {card.questions.map((name) => <QuestionChip key={name} name={name} flagged={flagged.has(name)} />)}
      </div>
      {card.confirms.map((note) => (
        <div key={note} className="intent-note"><CircleAlert size={13} strokeWidth={2} />{note}</div>
      ))}
    </Soft>
  );
}

function Skipped({ items, flagged }: { items: IntentSkipped[]; flagged: Set<string> }) {
  const groups = new Map<string, string[]>();
  for (const item of items) groups.set(item.reason, [...(groups.get(item.reason) ?? []), item.name]);
  return (
    <section className="section" style={{ gap: 6 }}>
      <div className="section-title">不建意向</div>
      <div>
        {[...groups].map(([reason, names]) => (
          <div key={reason} className="skipped-group">
            <span className="callout secondary">{reason}</span>
            <div className="flow-wrap">{names.map((name) => <QuestionChip key={name} name={name} flagged={flagged.has(name)} />)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuestionChip({ name, flagged }: { name: string; flagged: boolean }) {
  const s = useModel();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const question = s.intentQuestions.find((item) => item.name === name);
  const isCurrent = (signal: string) => Boolean(question && (question.signal === signal || (signal === "other" && ["other", "reject"].includes(question.signal))));
  return (
    <>
      <button ref={ref} className={`btn chip${question?.source === "user" ? " is-user" : ""}`} data-tour={`chip-${name}`}
        title={flagged ? "我不太确定它属于哪一类，点一下确认" : "点一下换到别的意向"}
        onClick={() => ref.current && setAnchor(ref.current.getBoundingClientRect())}>
        {flagged && <QuestionCircleFill size={13} />}
        {name}
      </button>
      {anchor && (
        <Popover anchor={anchor} edge="bottom" onDismiss={() => setAnchor(null)}>
          <div className="mover">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="strong">{name}</span>
              {question && question.phrases.length > 0 && <span className="callout secondary">{question.phrases.slice(0, 3).join(" / ")}</span>}
              {flagged && <span className="callout" style={{ color: "var(--orange)" }}>我不太确定它属于哪一类。</span>}
            </div>
            <hr />
            <span className="callout secondary">放到</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MOVE_TARGETS.map((target) => (
                <label key={target.signal} className="check">
                  <input type="radio" name={`move-${name}`} checked={isCurrent(target.signal)} onChange={() => {
                    moveQuestion(name, target.signal);
                    setAnchor(null);
                  }} />
                  <span>{target.label}</span>
                </label>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
