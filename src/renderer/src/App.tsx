import { useEffect, useRef, useState, type DragEvent } from "react";
import { CloudUpload, Crosshair, Download, GitCompareArrows, Import, PanelLeft, PanelRight, PencilLine, Settings, Stethoscope, type LucideIcon } from "lucide-react";
import { EDITION_ZH, isLite, LITE_BADGE } from "../../shared/edition";
import { AudioMatchSheet } from "./AudioMatchSheet";
import { CheckupSheet } from "./CheckupSheet";
import { IntentPage, intentMood } from "./IntentPage";
import {
  comparing,
  drop,
  get,
  isModify,
  isRunning,
  logTime,
  modifying,
  pendingMatches,
  primaryAction,
  received,
  saveReport,
  selectedItems,
  set,
  STAGE_TITLES,
  STEP_TITLES,
  stepsFor,
  stepStatus,
  uploading,
  useModel,
  type State,
  type Step,
} from "./model";
import { ComparePage, compareMood, ModifyPage, modifyMood } from "./ModifyPages";
import { CheckupPage, checkupMood, ImportPage } from "./Pages";
import { AmbientLight, MOOD_COLORS, type Mood } from "./Recordings";
import { SettingsSheet } from "./SettingsSheet";
import { TemplateGuideSheet } from "./TemplateGuide";
import { Tour } from "./Tour";
import { currentStep, shouldAutoStart, start as startTour } from "./tour-store";
import { Button, CheckCircleFill, Spinner } from "./ui";
import { UploadPage, uploadMood } from "./UploadPage";

const params = new URLSearchParams(window.location.search);
const platform = params.get("platform") ?? "";

const STEP_ICONS: Record<Step, LucideIcon> = {
  importFiles: Import, checkup: Stethoscope, intent: Crosshair, upload: CloudUpload, compare: GitCompareArrows, modify: PencilLine,
};

function mood(s: State): Mood {
  switch (s.step) {
    case "importFiles": return s.error ? "error" : "calm";
    case "checkup": return s.summary ? checkupMood(s.summary, isModify(s)) : s.error ? "error" : "calm";
    case "intent": return intentMood(s);
    case "upload": return uploadMood(s);
    case "compare": return compareMood(s);
    case "modify": return modifyMood(s);
  }
}

function Sidebar({ s }: { s: State }) {
  return (
    <aside className={`sidebar${s.showSidebar ? "" : " is-hidden"}`}>
      <div className="sidebar-top">
        {isLite() && (
          <div className="edition-mark" title="轻量版不含本地大模型；保留语音识别与上传">
            <span className="edition-zh">{EDITION_ZH}</span>
            <span className="lite-badge">{LITE_BADGE}</span>
          </div>
        )}
        <button className="btn is-icon" title="隐藏边栏" onClick={() => set({ showSidebar: false })}><PanelLeft size={17} strokeWidth={1.6} /></button>
      </div>
      <div className="sidebar-mode text-swap" key={isModify(s) ? "modify" : "create"}>{isModify(s) ? "修改已有话术" : "新建话术"}</div>
      <nav className="nav" data-tour="steps">
        {stepsFor(s).map((step) => {
          const Icon = STEP_ICONS[step];
          const status = stepStatus(s, step);
          return (
            <button key={step} className={`nav-row${s.step === step ? " is-selected" : ""}`} data-tour={`nav-${step}`}
              onClick={() => set({ step })}>
              <Icon size={18} strokeWidth={1.7} />
              {STEP_TITLES[step]}
              {status && <span className="badge text-swap" key={status}>{status}</span>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-bottom">
        <button className="settings-link" data-tour="settings" onClick={() => set({ settingsOpen: true })}>
          <Settings size={14} strokeWidth={1.7} />设置
        </button>
      </div>
    </aside>
  );
}

function Toolbar({ s }: { s: State }) {
  const action = primaryAction(s);
  const inspectorToggle = (
    <button className="btn is-icon" title="详细信息" data-tour="inspectorToggle" onClick={() => set({ showInspector: !s.showInspector })}>
      <PanelRight size={17} strokeWidth={1.6} />
    </button>
  );
  return (
    <div className="toolbar">
      {!s.showSidebar && (
        <span className="toolbar-leading">
          <button className="btn is-icon" title="显示边栏" onClick={() => set({ showSidebar: true })}><PanelLeft size={17} strokeWidth={1.6} /></button>
          {isLite() && <span className="lite-badge" title="轻量版">{LITE_BADGE}</span>}
        </span>
      )}
      {s.step === "checkup" && s.summary ? (
        <span className="btn-group">
          <button className="btn is-icon" title="导出报告" data-tour="report" disabled={s.reportSaving} onClick={() => void saveReport()}>
            <Download size={17} strokeWidth={1.6} />
          </button>
          {inspectorToggle}
        </span>
      ) : inspectorToggle}
      <Button prominent size="large" disabled={!action.enabled} tour="primary" onClick={action.run}>
        {s.checking && <Spinner />}{action.label}
      </Button>
    </div>
  );
}

function Inspector({ s }: { s: State }) {
  const rowState = (active: boolean, done: boolean) => (active ? "active" : done ? "done" : "pending");
  const matchStatus = (() => {
    if (s.stage === "matching") return s.progress.current !== undefined && s.progress.total !== undefined ? `${s.progress.current}/${s.progress.total}` : "识别中";
    if (!s.summary) return "等待导入";
    if (!s.summary.audioMatch.smart && !isModify(s)) return "按编号";
    return pendingMatches(s) > 0 ? `${pendingMatches(s)} 条待确认` : "已完成";
  })();
  const checkupStatus = (() => {
    if (s.checking) return "检查中";
    if (!s.summary) return "等待导入";
    const total = s.summary.checkup.findings.length;
    return total > 0 ? `${total} 项` : "无问题";
  })();
  const intentStatus = (() => {
    if (s.intentLoading) return s.intentProgress && s.intentProgress.total > 0 ? `${s.intentProgress.current}/${s.intentProgress.total}` : "分析中";
    if (s.scheduledIntents) return `上传时新建 ${s.scheduledIntents.length} 条`;
    if (s.intentResult) return s.intentResult.plan.cards.length === 0 ? "无需新增" : `建议 ${s.intentResult.plan.cards.length} 条`;
    if (s.summary?.knowledgeCount === 0) return "无需设置";
    return s.summary ? "未生成" : "等待导入";
  })();
  const uploadStatus = (() => {
    if (uploading(s)) {
      const title = STAGE_TITLES[s.stage];
      return s.progress.current !== undefined && s.progress.total !== undefined ? `${title} ${s.progress.current}/${s.progress.total}` : title;
    }
    return ({ completed: "已完成", error: "未完成", cancelled: "已停止" } as Record<string, string>)[s.stage] ?? "未开始";
  })();
  const running = (title: string) => (s.progress.current !== undefined && s.progress.total !== undefined ? `${title} ${s.progress.current}/${s.progress.total}` : title);
  const compareStatus = comparing(s) ? running(STAGE_TITLES[s.stage]) : s.modifyPlan ? `${selectedItems(s).length} 处要改` : "未开始";
  const modifyStatus = modifying(s) ? running(STAGE_TITLES[s.stage])
    : s.modifyMessage ? ({ completed: "已完成", error: "未完成", cancelled: "已停止" } as Record<string, string>)[s.stage] ?? "未开始" : "未开始";
  const rows: Array<[string, string, string]> = [
    ["录音配对", matchStatus, rowState(s.stage === "matching", Boolean(s.summary))],
    ["话术体检", checkupStatus, rowState(s.checking && s.stage !== "matching", Boolean(s.summary))],
    ...(isModify(s) ? [
      ["线上对比", compareStatus, rowState(comparing(s), Boolean(s.modifyPlan))],
      ["修改", modifyStatus, rowState(modifying(s), s.stage === "completed" && Boolean(s.modifyMessage))],
    ] as Array<[string, string, string]> : [
      [isLite() ? "意向建议（关键词）" : "意向建议", intentStatus, rowState(s.intentLoading, Boolean(s.intentResult || s.scheduledIntents))],
      ["上传", uploadStatus, rowState(uploading(s), s.stage === "completed")],
    ] as Array<[string, string, string]>),
  ];
  return (
    <aside className="inspector" data-tour="inspector">
      <h3>进度</h3>
      {rows.map(([title, status, state]) => (
        <div key={title} className={`step-row is-${state}`}>
          <span className="icon" key={state}>
            {state === "done" ? <CheckCircleFill size={14} /> : state === "active" ? <Spinner size={12} /> : (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="6" fill="none" stroke="var(--text-3)" strokeWidth="1.1" /></svg>
            )}
          </span>
          <span className="text"><span className="title">{title}</span><span className="status text-swap" key={status}>{status}</span></span>
        </div>
      ))}
      {s.logs.length > 0 && <RunLog s={s} />}
    </aside>
  );
}

/** Newest-last run log in the progress column; follows new lines as they arrive. */
function RunLog({ s }: { s: State }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [s.logs.length]);
  return (
    <div className="log" data-tour="log">
      <h3>运行记录</h3>
      <div className="log-list" ref={list}>
        {s.logs.map((event, index) => (
          <div key={index} className={`log-item${event.stage === "error" ? " is-error" : index === s.logs.length - 1 ? " is-last" : ""}`}>
            <time>{logTime(event.timestamp)}</time>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CurrentPage({ step }: { step: Step }) {
  switch (step) {
    case "importFiles": return <ImportPage />;
    case "checkup": return <CheckupPage />;
    case "intent": return <IntentPage />;
    case "upload": return <UploadPage />;
    case "compare": return <ComparePage />;
    case "modify": return <ModifyPage />;
  }
}

export default function App() {
  const s = useModel();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => window.tungee.onProgress(received), []);

  useEffect(() => {
    if (!shouldAutoStart() || params.has("shot")) return;
    // A remembered file set may start a check right away, and the window may open behind others; keep waiting
    // until the user is looking at an idle window instead of giving up after one try.
    let timer = setTimeout(function attempt() {
      if (!shouldAutoStart() || currentStep()) return;
      if (document.hasFocus()) startTour();
      timer = setTimeout(attempt, 500);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (get().saved || isRunning(get())) return;
    const paths = [...event.dataTransfer.files].map((file) => window.tungee.getPathForFile(file));
    void drop(paths);
  };

  const [moodA, moodB, moodC] = MOOD_COLORS[mood(s)];
  return (
    <div className={`app${platform === "win32" ? " is-win" : ""}${isLite() ? " is-lite" : ""}`}
      style={{ ["--mood-a" as string]: `var(${moodA})`, ["--mood-b" as string]: `var(${moodB})`, ["--mood-c" as string]: `var(${moodC})` }}
      onDragEnter={onDragEnter} onDragLeave={onDragLeave}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={onDrop}>
      <div className="backdrop"><AmbientLight mood={mood(s)} /></div>
      <Sidebar s={s} />
      <main className="detail">
        <Toolbar s={s} />
        <div className="detail-body">
          <div className="page-scroll" key={s.step}><CurrentPage step={s.step} /></div>
          {s.showInspector && <Inspector s={s} />}
        </div>
      </main>
      {dragging && <div className="drop-overlay" />}
      {s.matchMode && s.summary && <AudioMatchSheet summary={s.summary} initialMode={s.matchMode} focus={s.matchFocus} />}
      {s.checkupOpen && s.summary && <CheckupSheet />}
      {s.settingsOpen && <SettingsSheet />}
      {s.templateGuideOpen && <TemplateGuideSheet />}
      <Tour />
    </div>
  );
}
