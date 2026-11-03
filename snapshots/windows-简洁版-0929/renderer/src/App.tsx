import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import type {
  AppErrorInfo,
  PreviewSummary,
  ProgressEvent,
  ProgressStage,
  UploadCheckpointInfo,
  UploadConfig,
} from "../../shared/types";
import type { IntentSetup } from "../../shared/intent-plan";
import { AudioMatchDialog } from "./AudioMatchDialog";
import { CheckupDialog } from "./CheckupDialog";
import { IntentDialog } from "./IntentDialog";
import { SettingsDialog } from "./SettingsDialog";
import { StorageDialog } from "./StorageDialog";
import { Tour, TOUR_KEY } from "./Tour";
import { demoConfig, demoIntents, demoLogs, demoSummary } from "./demo";
import {
  AudioLines,
  CheckupIcon,
  ErrorIcon,
  FileDown,
  FolderIcon,
  ImportIcon,
  InfoIcon,
  LoaderCircle,
  PaneIcon,
  SettingsIcon,
  Stethoscope,
  StopIcon,
  SuccessIcon,
  Target,
  UploadIcon,
  WarningIcon,
  WorkbookIcon,
  X,
} from "./icons";

type Step = "import" | "checkup" | "intent" | "upload";

const steps: Array<{ id: Step; label: string; Icon: typeof ImportIcon }> = [
  { id: "import", label: "导入", Icon: ImportIcon },
  { id: "checkup", label: "体检", Icon: CheckupIcon },
  { id: "intent", label: "意向", Icon: Target },
  { id: "upload", label: "上传", Icon: UploadIcon },
];

const initialConfig: UploadConfig = {
  talkName: "",
  workbookPath: "",
  audioDir: "",
  categoryName: "客户问答",
  submitReview: false,
};

const runningStages = new Set<ProgressStage>([
  "reading", "matching", "converting", "launching", "login", "rename", "flow", "vague", "knowledge", "intent", "review",
]);

const uploadStages = new Set<ProgressStage>([
  "converting", "launching", "login", "rename", "flow", "vague", "knowledge", "intent", "review", "completed", "cancelled", "error",
]);

const stageNames: Record<ProgressStage, string> = {
  idle: "等待开始",
  reading: "检查数据",
  matching: "识别录音",
  ready: "可以上传",
  blocked: "需要修正",
  converting: "转换录音",
  launching: "启动浏览器",
  login: "等待登录",
  rename: "需要换名字",
  flow: "主流程",
  vague: "含糊话术",
  knowledge: "知识库",
  intent: "意向设置",
  review: "提交审核",
  completed: "已完成",
  cancelled: "已停止",
  error: "失败",
};

const params = new URLSearchParams(window.location.search);
const platform = params.get("platform") ?? "";

function fileName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? value;
}

function timeLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fallbackError(error: unknown): AppErrorInfo {
  return {
    code: "E-APP-001",
    message: "桌面应用通信失败。",
    suggestion: "请关闭本工具后重新打开；若仍出现，请把技术详情发给维护人员。",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function InfoBar({ tone, title, children, onClose, action }: {
  tone: "success" | "error" | "warning" | "info";
  title: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
  action?: ReactNode;
}) {
  const Glyph = tone === "success" ? SuccessIcon : tone === "error" ? ErrorIcon : tone === "warning" ? WarningIcon : InfoIcon;
  return (
    <div className={`infobar is-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Glyph size={16} className="infobar-icon" />
      <div className="infobar-text"><b>{title}</b>{children && <span>{children}</span>}</div>
      {action}
      {onClose && <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={16} /></button>}
    </div>
  );
}

function Row({ icon, title, detail, children }: { icon?: ReactNode; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      {icon && <span className="row-icon">{icon}</span>}
      <span className="row-text"><b>{title}</b>{detail && <small>{detail}</small>}</span>
      {children && <span className="row-trail">{children}</span>}
    </div>
  );
}

function App() {
  const [config, setConfig] = useState<UploadConfig>(initialConfig);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [stage, setStage] = useState<ProgressStage>("idle");
  const [progress, setProgress] = useState<{ current?: number; total?: number }>({});
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const [errorInfo, setErrorInfo] = useState<AppErrorInfo | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [reportSaving, setReportSaving] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [checkupOpen, setCheckupOpen] = useState(false);
  const [intentOpen, setIntentOpen] = useState(false);
  const [scheduledIntents, setScheduledIntents] = useState<IntentSetup[] | null>(null);
  const [matchMode, setMatchMode] = useState<"review" | "list" | null>(null);
  const [step, setStep] = useState<Step>("import");
  const [paneOpen, setPaneOpen] = useState(true);
  const [checking, setChecking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [checkpoint, setCheckpoint] = useState<UploadCheckpointInfo | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const snapshot = useRef<{
    config: UploadConfig;
    summary: PreviewSummary | null;
    scheduledIntents: IntentSetup[] | null;
    stage: ProgressStage;
    progress: { current?: number; total?: number };
    logs: ProgressEvent[];
    step: Step;
    paneOpen: boolean;
  } | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => window.tungee.onProgress((event) => {
    setStage(event.stage);
    setProgress({ current: event.current, total: event.total });
    setLogs((items) => [...items.slice(-199), event]);
    if (event.stage === "error") {
      setErrorInfo(event.error ?? {
        code: "E-UNKNOWN-001",
        message: event.message,
        suggestion: "请重新检查数据后再试；若仍出现，请把错误代码发给维护人员。",
      });
    }
    if (event.stage === "completed") setErrorInfo(null);
  }), []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs]);

  useEffect(() => {
    if (!saveNotice) return;
    const timer = setTimeout(() => setSaveNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [saveNotice]);

  const startTour = () => {
    if (!tourOpen) snapshot.current = { config, summary, scheduledIntents, stage, progress, logs, step, paneOpen };
    setSettingsOpen(false);
    setStorageOpen(false);
    setErrorInfo(null);
    setSaveNotice(null);
    setConfig(demoConfig);
    setSummary(demoSummary);
    setScheduledIntents(demoIntents);
    setProgress({});
    setPaneOpen(true);
    setTourOpen(true);
  };

  const tourPage = useCallback((page: Step) => {
    setStep(page);
    setStage(page === "upload" ? "login" : "idle");
    setLogs(page === "upload" ? demoLogs() : []);
  }, []);

  const endTour = () => {
    const saved = snapshot.current;
    snapshot.current = null;
    if (saved) {
      setConfig(saved.config);
      setSummary(saved.summary);
      setScheduledIntents(saved.scheduledIntents);
      setStage(saved.stage);
      setProgress(saved.progress);
      setLogs(saved.logs);
      setStep(saved.step);
      setPaneOpen(saved.paneOpen);
    }
    localStorage.setItem(TOUR_KEY, "done");
    setTourOpen(false);
  };

  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY) !== "done") startTour();
  }, []);

  const isRunning = runningStages.has(stage);
  const uploading = isRunning && uploadStages.has(stage);
  const busy = isRunning || checking;
  const canRun = Boolean(
    config.workbookPath
    && config.audioDir
    && config.talkName
    && [...config.talkName].length < 20
    && config.categoryName
    && [...config.categoryName].length < 10,
  );
  const canStart = canRun && summary?.canUpload === true;
  const pendingMatches = summary?.canUpload ? summary.audioMatch.reviewCount : 0;

  useEffect(() => {
    if (tourOpen || isRunning || !config.workbookPath || !config.audioDir) {
      if (!isRunning) setCheckpoint(null);
      return;
    }
    let live = true;
    void window.tungee.checkpoint(config).then((info) => { if (live) setCheckpoint(info); }, () => undefined);
    return () => { live = false; };
  }, [tourOpen, isRunning, config.workbookPath, config.audioDir, config.categoryName]);

  useEffect(() => {
    if (stage === "rename") setRenameDraft([...`${config.talkName}-2`].slice(0, 19).join(""));
  }, [stage]);

  const renameValid = renameDraft.trim().length > 0 && [...renameDraft.trim()].length < 20 && renameDraft.trim() !== config.talkName;
  const submitRename = async () => {
    const name = renameDraft.trim();
    if (!renameValid) return;
    if (await window.tungee.rename(name)) setConfig((current) => ({ ...current, talkName: name }));
  };
  const visibleIssues = useMemo(() => {
    if (!summary) return [];
    const weight = { error: 0, warning: 1, info: 2 } as const;
    return [...summary.issues].sort((left, right) => weight[left.severity] - weight[right.severity]);
  }, [summary]);
  const checkupCounts = useMemo(() => {
    const findings = summary?.checkup.findings ?? [];
    const fixable = findings.filter((item) => item.options.length > 0).length;
    return { total: findings.length, fixable, hints: findings.length - fixable };
  }, [summary]);
  const progressPercent = useMemo(() => {
    if (!progress.current || !progress.total) return 0;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  }, [progress]);

  const updateConfig = <K extends keyof UploadConfig>(key: K, value: UploadConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    if (key === "workbookPath" || key === "audioDir") {
      setSummary(null);
      setScheduledIntents(null);
      setStage("idle");
    }
    if (stage === "error" || stage === "cancelled" || stage === "completed") setStage("idle");
    setErrorInfo(null);
  };

  const chooseWorkbook = async () => {
    const selected = await window.tungee.selectWorkbook();
    if (selected) updateConfig("workbookPath", selected);
  };

  const chooseAudioDir = async () => {
    const selected = await window.tungee.selectAudioDir();
    if (selected) updateConfig("audioDir", selected);
  };

  const showDropError = (code: string, message: string, suggestion: string, detail?: string) => {
    setErrorInfo({ code, message, suggestion, detail });
  };

  const onDragEnter = (event: ReactDragEvent) => {
    if (busy || tourOpen || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: ReactDragEvent) => {
    if (busy || tourOpen || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = async (event: ReactDragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) {
      showDropError("E-DROP-001", "没有识别到拖入内容。", "请从文件资源管理器重新拖入 Excel 或录音文件夹。");
      return;
    }
    for (const file of files) {
      const droppedPath = window.tungee.getPathForFile(file);
      if (!droppedPath) {
        showDropError("E-DROP-002", "无法读取拖入内容的本地路径。", "请改用“选取”，或重新启动软件后再拖入。");
        return;
      }
      const kind = await window.tungee.inspectLocalPath(droppedPath);
      if (kind === "directory") updateConfig("audioDir", droppedPath);
      else if (kind === "file" && droppedPath.toLowerCase().endsWith(".xlsx")) updateConfig("workbookPath", droppedPath);
      else showDropError("E-DROP-003", "无法识别拖入的内容。", "请拖入 .xlsx 话术表格，或包含录音的文件夹。", droppedPath);
    }
    setStep("import");
  };

  const preview = async (target: UploadConfig = config): Promise<PreviewSummary | null> => {
    setErrorInfo(null);
    setChecking(true);
    try {
      const result = await window.tungee.preview(target);
      if (result.status === "ok") {
        setSummary(result.summary);
        return result.summary;
      }
      setErrorInfo(result.error);
      setStage("error");
    } catch (error: unknown) {
      setErrorInfo(fallbackError(error));
      setStage("error");
    } finally {
      setChecking(false);
    }
    return null;
  };

  const runCheck = async () => {
    const result = await preview();
    if (result) setStep("checkup");
  };

  const matchesSaved = () => {
    setMatchMode(null);
    setSaveNotice("录音匹配已保存");
    void preview();
  };

  const useFixedWorkbook = (fixedPath: string) => {
    setCheckupOpen(false);
    const next = { ...config, workbookPath: fixedPath };
    updateConfig("workbookPath", fixedPath);
    setSaveNotice(`已改用修正版：${fileName(fixedPath)}`);
    void preview(next);
  };

  const saveStandardTemplate = async () => {
    setErrorInfo(null);
    try {
      const result = await window.tungee.saveStandardTemplate();
      if (result.status === "saved") setSaveNotice(`标准模板已保存：${fileName(result.path)}`);
      if (result.status === "error") setErrorInfo(result.error);
    } catch (error: unknown) {
      setErrorInfo(fallbackError(error));
    }
  };

  const saveValidationReport = async () => {
    if (!summary) return;
    setReportSaving(true);
    setErrorInfo(null);
    try {
      const result = await window.tungee.saveValidationReport(config);
      if (result.status === "saved") setSaveNotice(`检查报告已保存：${fileName(result.path)}`);
      if (result.status === "error") setErrorInfo(result.error);
    } catch (error: unknown) {
      setErrorInfo(fallbackError(error));
    } finally {
      setReportSaving(false);
    }
  };

  const start = async (resume = false) => {
    if (!summary?.canUpload) {
      setErrorInfo({ code: "E-DATA-003", message: "尚未通过数据检查。", suggestion: "请先在“体检”中修正错误。" });
      setStep("checkup");
      return;
    }
    setErrorInfo(null);
    setLogs([]);
    setProgress({});
    if (resume && checkpoint) setConfig((current) => ({ ...current, talkName: checkpoint.talkName }));
    if (!resume && checkpoint) {
      await window.tungee.discardCheckpoint(config).catch(() => undefined);
      setCheckpoint(null);
    }
    try {
      const result = await window.tungee.start(config, scheduledIntents ?? [], { resume });
      if (result.status === "error") setErrorInfo(result.error ?? fallbackError(result.message));
    } catch (error: unknown) {
      setErrorInfo(fallbackError(error));
      setStage("error");
    }
  };

  const stepStatus: Record<Step, string> = {
    import: config.workbookPath && config.audioDir ? "已添加" : "",
    checkup: checking ? "检查中" : !summary ? "" : !summary.canUpload ? `${summary.errorCount} 个错误` : pendingMatches ? `${pendingMatches} 条待确认` : "已通过",
    intent: scheduledIntents ? `${scheduledIntents.length} 条` : "",
    upload: uploading ? stageNames[stage] : stage === "completed" ? "已完成" : "",
  };

  const primary = (() => {
    if (step === "import") {
      return { label: checking ? "检查中…" : "检查数据", disabled: !canRun || busy, run: () => void runCheck() };
    }
    if (step === "checkup") {
      if (!summary) return { label: "检查数据", disabled: !canRun || busy, run: () => void runCheck() };
      if (pendingMatches > 0) return { label: `确认录音（${pendingMatches}）`, disabled: busy, run: () => setMatchMode("review") };
      return { label: "下一步：意向", disabled: !summary.canUpload || busy, run: () => setStep("intent") };
    }
    if (step === "intent") return { label: "下一步：上传", disabled: !canStart || busy, run: () => setStep("upload") };
    if (checkpoint) return { label: "接着传", disabled: !canStart || busy, run: () => void start(true) };
    return { label: "开始上传", disabled: !canStart || busy, run: () => void start() };
  })();

  const subtitle = config.workbookPath ? fileName(config.workbookPath) : "未导入";
  const StepTitle = steps.find((item) => item.id === step)?.label ?? "";

  const importPage = (
    <>
      <section className="group" data-tour="files">
        <h2>文件</h2>
        <div className="card-group">
          <Row icon={<WorkbookIcon size={20} />} title="话术表格" detail={config.workbookPath ? fileName(config.workbookPath) : ".xlsx"}>
            <button className="button subtle" onClick={() => void saveStandardTemplate()} disabled={busy}>下载模板</button>
            <button className="button" onClick={() => void chooseWorkbook()} disabled={busy}>选取…</button>
          </Row>
          <Row icon={<AudioLines size={20} />} title="录音文件夹" detail={config.audioDir ? fileName(config.audioDir) : "WAV、MP3、M4A"}>
            <button className="button" onClick={() => void chooseAudioDir()} disabled={busy}>选取…</button>
          </Row>
        </div>
      </section>
      <section className="group">
        <h2>话术</h2>
        <div className="card-group">
          <Row title="话术名称" detail={`${[...config.talkName].length}/19`}>
            <input className="textbox" value={config.talkName} maxLength={19} onChange={(event) => updateConfig("talkName", event.target.value)} disabled={busy} aria-label="话术名称" />
          </Row>
          <Row title="知识库分类" detail={`${[...config.categoryName].length}/9`}>
            <input className="textbox" value={config.categoryName} maxLength={9} onChange={(event) => updateConfig("categoryName", event.target.value)} disabled={busy} aria-label="知识库分类" />
          </Row>
        </div>
      </section>
    </>
  );

  const checkupPage = !summary ? (
    <div className="empty"><CheckupIcon size={40} /><b>还没有检查</b><span>导入文件后点“检查数据”。</span></div>
  ) : (
    <>
      {summary.canUpload
        ? <InfoBar tone="success" title="检查通过">{summary.detectedSheetName} · 提醒 {summary.warningCount}</InfoBar>
        : <InfoBar tone="error" title={`${summary.errorCount} 个错误，暂不能上传`}>{summary.detectedSheetName}</InfoBar>}
      <section className="group">
        <h2>概览</h2>
        <div className="card-group is-list">
          <Row title="计划上传" detail={`无效 QA ${summary.invalidQaCount} · 特殊 QA ${summary.specialQaCount} · 同时存在 ${summary.bothQaCount}`}>
            <span className="value">{summary.plannedUploadCount} 个录音</span>
          </Row>
          <Row title="主流程"><span className="value">{summary.flowCount} 条 · {summary.flowAudioCount} 个录音</span></Row>
          <Row title="含糊话术"><span className="value">{summary.vagueCount} 条 · {summary.vagueAudioCount} 个录音</span></Row>
          <Row title="知识库"><span className="value">{summary.knowledgeCount} 条 · {summary.knowledgeAudioCount} 个录音</span></Row>
        </div>
      </section>
      <section className="group" data-tour="checks">
        <h2>检查项</h2>
        <div className="card-group">
          {summary.audioMatch.smart && (
            <Row icon={<AudioLines size={20} />} title="录音匹配" detail={`已自动匹配 ${summary.audioMatch.autoCount}/${summary.audioMatch.items.length}${summary.audioMatch.reviewCount ? ` · ${summary.audioMatch.reviewCount} 条待确认` : ""}`}>
              <button className="button" onClick={() => setMatchMode(summary.audioMatch.reviewCount ? "review" : "list")} disabled={busy}>{summary.audioMatch.reviewCount ? "确认…" : "查看…"}</button>
            </Row>
          )}
          <Row
            icon={<Stethoscope size={20} />}
            title="话术体检"
            detail={checkupCounts.total ? [checkupCounts.fixable && `${checkupCounts.fixable} 项可修正`, checkupCounts.hints && `${checkupCounts.hints} 项提醒`].filter(Boolean).join(" · ") : "未发现问题"}
          >
            {checkupCounts.total > 0 && <button className="button" onClick={() => setCheckupOpen(true)} disabled={busy}>查看…</button>}
          </Row>
          {summary.convertAudioNumbers.length > 0 && (
            <Row icon={<InfoIcon size={20} />} title="录音格式" detail={`${summary.convertAudioNumbers.length} 个录音会在上传前转成 8k 单声道 WAV，原文件不变`} />
          )}
          {summary.audioMatch.speechUnavailable && (
            <Row icon={<WarningIcon size={20} />} title="语音识别不可用" detail={`只按文件名匹配：${summary.audioMatch.speechUnavailable}`} />
          )}
        </div>
      </section>
      {visibleIssues.length > 0 && (
        <section className="group">
          <h2>需要处理 · {visibleIssues.length}</h2>
          <div className="card-group">
            {visibleIssues.slice(0, 8).map((item, index) => (
              <Row
                key={`${item.code}-${item.rowNumber ?? "sheet"}-${index}`}
                icon={item.severity === "error" ? <ErrorIcon size={20} className="tone-error" /> : item.severity === "warning" ? <WarningIcon size={20} className="tone-warning" /> : <InfoIcon size={20} className="tone-info" />}
                title={item.message}
                detail={`${item.sheetName ?? "Excel"}${item.rowNumber ? ` · 第 ${item.rowNumber} 行` : ""} · ${item.suggestion}`}
              />
            ))}
          </div>
          {visibleIssues.length > 8 && <p className="footnote">另有 {visibleIssues.length - 8} 条，导出报告查看全部。</p>}
        </section>
      )}
    </>
  );

  const intentPage = !summary ? (
    <div className="empty"><Target size={40} /><b>还没有检查</b><span>先完成体检，再生成意向建议。</span></div>
  ) : summary.knowledgeCount === 0 ? (
    <div className="empty"><Target size={40} /><b>无需设置意向</b><span>这份话术没有知识库问题。</span></div>
  ) : (
    <section className="group" data-tour="intent">
      <h2>意向设置</h2>
      <div className="card-group">
        <Row icon={<Target size={20} />} title={scheduledIntents ? `上传后新建 ${scheduledIntents.length} 条意向` : "意向建议"} detail={scheduledIntents ? "只新建，不修改已有意向" : "按知识库问题生成，可在上传时自动设置"}>
          <button className="button" onClick={() => setIntentOpen(true)} disabled={busy}>{scheduledIntents ? "修改…" : "生成…"}</button>
        </Row>
      </div>
      {scheduledIntents && <div className="card-group is-list">
        {scheduledIntents.map((setup, index) => (
          <Row key={`${setup.level}-${index}`} title={<><span className={`level level-${setup.level.charAt(0)}`}>{setup.level}</span>{setup.description}</>} detail={`${setup.match}问题 · ${setup.questions.length} 个`} />
        ))}
      </div>}
    </section>
  );

  const uploadPage = (
    <>
      {stage === "login" && (
        <InfoBar tone="info" title="请在 Chrome 中登录探迹" action={<button className="button accent" onClick={() => void window.tungee.confirmLogin()}>已登录，继续</button>}>
          打开“客户成功-智能呼叫中心”页面后，返回本工具确认登录。
        </InfoBar>
      )}
      {stage === "rename" && (
        <InfoBar
          tone="warning"
          title="探迹里已有同名话术"
          action={<>
            <input className="textbox" value={renameDraft} maxLength={19} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitRename(); }} aria-label="新的话术名称" autoFocus />
            <button className="button accent" onClick={() => void submitRename()} disabled={!renameValid}>用新名字继续</button>
          </>}
        >
          换个名字，就从这里接着传。
        </InfoBar>
      )}
      {checkpoint && !isRunning && (
        <InfoBar
          tone="info"
          title="上次传到一半"
          action={<>
            <button className="button" onClick={() => void start(false)} disabled={!canStart || busy}>重新开始</button>
            <button className="button accent" onClick={() => void start(true)} disabled={!canStart || busy}>接着传</button>
          </>}
        >
          “{checkpoint.talkName}”已完成 {checkpoint.doneAudioNumbers.length} 条，接着传会跳过它们。
        </InfoBar>
      )}
      <section className="group">
        <h2>上传设置</h2>
        <div className="card-group">
          <Row title="话术名称" detail={config.talkName || "未填写"} />
          <Row title="完成后提交审核" detail="建议先人工检查">
            <label className="toggle">
              <span>{config.submitReview ? "开" : "关"}</span>
              <input type="checkbox" role="switch" checked={config.submitReview} onChange={(event) => updateConfig("submitReview", event.target.checked)} disabled={busy} />
              <i />
            </label>
          </Row>
        </div>
      </section>
      <section className="group" data-tour="progress">
        <h2>进度</h2>
        <div className="card-group">
          <div className="progress-card">
            <div className="progress-head">
              <b>{stageNames[stage]}</b>
              <span>{progress.current && progress.total ? `${progress.current} / ${progress.total}` : ""}</span>
            </div>
            <div className={`progressbar ${uploading && !progress.total ? "is-indeterminate" : ""}`}><span style={{ width: `${progressPercent}%` }} /></div>
          </div>
          <div className="log" aria-live="polite">
            {logs.length === 0 ? <p className="log-empty">运行记录会显示在这里。</p> : logs.map((item, index) => (
              <p key={`${item.timestamp}-${index}`} className={`log-line log-${item.stage}`}>
                <time>{timeLabel(item.timestamp)}</time><b>{item.message}</b>
              </p>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </section>
    </>
  );

  const pages: Record<Step, ReactNode> = { import: importPage, checkup: checkupPage, intent: intentPage, upload: uploadPage };

  const aiRows: Array<{ label: string; status: string; Icon: typeof ImportIcon; active?: boolean }> = [
    {
      label: "录音配对",
      Icon: AudioLines,
      active: stage === "matching",
      status: stage === "matching" ? (progress.total ? `${progress.current}/${progress.total}` : "识别中") : !summary ? "等待导入" : !summary.audioMatch.smart ? "按编号" : pendingMatches ? `${pendingMatches} 条待确认` : "已完成",
    },
    {
      label: "话术体检",
      Icon: Stethoscope,
      active: checking && stage !== "matching",
      status: checking ? "检查中" : !summary ? "等待导入" : checkupCounts.total ? `${checkupCounts.total} 项` : "无问题",
    },
    { label: "意向建议", Icon: Target, status: scheduledIntents ? `${scheduledIntents.length} 条` : summary ? "未生成" : "等待导入" },
    { label: "上传", Icon: UploadIcon, active: uploading, status: uploading ? stageNames[stage] : stage === "completed" ? "已完成" : "未开始" },
  ];

  return (
    <div
      className={`app ${paneOpen ? "" : "no-pane"} ${dragging ? "is-dragging" : ""}`}
      data-platform={platform}
     
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <nav className="nav" aria-label="步骤">
        <div className="brand">
          <img src="./icon.png" alt="" />
          <span>话术上传助手</span>
        </div>
        {steps.map(({ id, label, Icon }) => (
          <button key={id} data-tour="steps" className={`nav-item ${step === id ? "is-selected" : ""}`} onClick={() => setStep(id)} aria-current={step === id ? "page" : undefined}>
            <Icon size={16} />
            <span>{label}</span>
            {stepStatus[id] && <small>{stepStatus[id]}</small>}
          </button>
        ))}
        <div className="nav-spacer" />
        <button className="nav-item" data-tour="settings" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon size={16} />
          <span>设置</span>
        </button>
      </nav>

      <main className="page">
        <div className="commandbar">
          <div className="page-title">
            <h1>{StepTitle}</h1>
            <span>{subtitle}</span>
          </div>
          <div className="commands">
            <div className="tool-group">
              {step === "checkup" && summary && (
                <button className="tool" onClick={() => void saveValidationReport()} disabled={reportSaving} aria-label="导出报告" title="导出报告">
                  <FileDown size={18} />
                </button>
              )}
              {step === "upload" && (
                <button className="tool" onClick={() => void window.tungee.openLogFolder()} aria-label="打开日志" title="打开日志">
                  <FolderIcon size={18} />
                </button>
              )}
              <button className={`tool ${paneOpen ? "is-on" : ""}`} onClick={() => setPaneOpen((open) => !open)} aria-label="详细信息" aria-pressed={paneOpen} title="详细信息">
                <PaneIcon size={18} />
              </button>
            </div>
            {uploading ? (
              <button className="prominent is-stop" onClick={() => void window.tungee.cancel()}><StopIcon size={16} />停止</button>
            ) : (
              <button className="prominent" data-tour="primary" onClick={primary.run} disabled={primary.disabled}>
                {checking && <LoaderCircle size={14} />}{primary.label}
              </button>
            )}
          </div>
        </div>
        <div className="page-body" key={step}>
          {errorInfo && (
            <InfoBar tone="error" title={errorInfo.message} onClose={() => setErrorInfo(null)}>
              {errorInfo.suggestion}
              {errorInfo.detail && <details><summary>技术详情 · {errorInfo.code}</summary><pre>{errorInfo.detail}</pre></details>}
            </InfoBar>
          )}
          {saveNotice && <InfoBar tone="success" title={saveNotice} onClose={() => setSaveNotice(null)} />}
          {pages[step]}
        </div>
      </main>

      <aside className="pane" aria-label="详细信息">
        <h2 data-tour="pane">本机 AI</h2>
        {aiRows.map(({ label, status, Icon, active }) => (
          <div className="pane-row" data-tour="pane" key={label}>
            <Icon size={16} />
            <span>{label}</span>
            <small>{active && <LoaderCircle size={12} />}{status}</small>
          </div>
        ))}
      </aside>

      {dragging && <div className="drop-overlay"><div><FolderIcon size={32} /><b>松开以添加</b><span>.xlsx 话术表格或录音文件夹</span></div></div>}

      {settingsOpen && (
        <SettingsDialog
          taskRunning={isRunning}
          onTour={startTour}
          onStorage={() => { setSettingsOpen(false); setStorageOpen(true); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {tourOpen && <Tour onPage={tourPage} onClose={endTour} />}
      {storageOpen && <StorageDialog taskRunning={isRunning} onClose={() => setStorageOpen(false)} />}
      {matchMode && summary && (
        <AudioMatchDialog match={summary.audioMatch} config={config} initialMode={matchMode} onClose={() => setMatchMode(null)} onSaved={matchesSaved} />
      )}
      {intentOpen && summary && (
        <IntentDialog
          config={config}
          scheduled={scheduledIntents}
          onSchedule={(setups) => {
            setScheduledIntents(setups);
            if (setups) setSaveNotice(`已安排：上传后新建 ${setups.length} 条意向`);
          }}
          onClose={() => setIntentOpen(false)}
        />
      )}
      {checkupOpen && summary && (
        <CheckupDialog checkup={summary.checkup} config={config} onClose={() => setCheckupOpen(false)} onUseFixed={useFixedWorkbook} />
      )}
    </div>
  );
}

export default App;
