import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLinesX, AudioWaveform, EarOff, List, ListPlus, PhoneOff, Scissors, TextSearch, WandSparkles } from "lucide-react";
import { isLite } from "../../shared/edition";
import type { AudioMatchItem, PreviewSummary, ValidationIssue } from "../../shared/types";
import {
  busy,
  checkupCounts,
  chooseAudioDir,
  chooseWorkbook,
  drop,
  fileName,
  isModify,
  missingItems,
  isKnowledge,
  isTrimmed,
  openCheckup,
  phraseCounts,
  qaCounts,
  saveTemplate,
  set,
  setMode,
  subtitle as sessionSubtitle,
  update,
  useModel,
  type Mode,
  type State,
} from "./model";
import { AttentionRow, RecordingMap, type DotState, type Mood } from "./Recordings";
import { Banners, Button, CheckCircleFill, InfoCircleFill, Page, PageHeader, Panel, QuestionCircleFill, SegmentedTabs, TriangleFill, XOctagonFill } from "./ui";

// MARK: Import

function useFileIcon(path: string, kind: "workbook" | "folder"): string | null {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    window.tungee.fileIcon(path, kind).then((url) => live && setIcon(url)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path, kind]);
  return icon;
}

/** Soft file well: system icon, name, and a drop highlight. */
function FileDrop({ path, kind, title, hint, detail, choose, leading, trailing, tour, disabled }: {
  path: string;
  kind: "workbook" | "folder";
  title: string;
  hint: string;
  detail: string;
  choose: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  tour: string;
  disabled: boolean;
}) {
  const icon = useFileIcon(path, kind);
  const [targeted, setTargeted] = useState(false);
  const chosen = path !== "";
  return (
    <div className={`card well${targeted ? " is-targeted" : ""}`} data-tour={tour}
      onClick={(event) => {
        if (!disabled && !(event.target as HTMLElement).closest("button")) choose();
      }}
      onDragEnter={() => setTargeted(true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTargeted(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setTargeted(false);
        if (disabled) return;
        void drop([...event.dataTransfer.files].map((file) => window.tungee.getPathForFile(file)));
      }}>
      <div className={`well-icon${chosen ? "" : " is-empty"}`}>
        {icon && <img src={icon} alt="" draggable={false} />}
        {chosen && <span className="well-check"><CheckCircleFill size={18} /></span>}
      </div>
      <div className="well-title">{chosen ? fileName(path) : title}</div>
      <div className="well-detail">{chosen ? detail : hint}</div>
      <div className="well-actions">
        {leading}
        <Button onClick={choose} disabled={disabled}>{chosen ? "更换…" : "选取…"}</Button>
        {trailing}
      </div>
    </div>
  );
}

function FieldRow({ title, value, limit, onChange, tour, inputRef, disabled, placeholder = "必填" }: {
  title: string;
  value: string;
  limit: number;
  onChange: (value: string) => void;
  tour: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  placeholder?: string;
}) {
  const count = [...value].length;
  return (
    <div className="panel-row" data-tour={tour}>
      <span style={{ width: 90, flex: "none" }}>{title}</span>
      <input ref={inputRef} className="field" value={value} placeholder={placeholder} aria-label={title} disabled={disabled}
        onChange={(event) => onChange([...event.target.value].slice(0, limit).join(""))} />
      <span className={`count${count >= limit ? " is-full" : ""}`}>{count}/{limit}</span>
    </div>
  );
}

export function ImportPage() {
  const s = useModel();
  const { config } = s;
  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);
  const [audioCount, setAudioCount] = useState<number | null>(null);

  useEffect(() => {
    if (!s.focusRequest) return;
    (s.focusRequest === "talkName" ? nameRef : categoryRef).current?.focus();
    set({ focusRequest: null });
  }, [s.focusRequest]);

  useEffect(() => {
    let live = true;
    setAudioCount(null);
    if (config.audioDir && !s.saved) window.tungee.countAudio(config.audioDir).then((count) => live && setAudioCount(count)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [config.audioDir, s.saved]);

  const modify = isModify(s);
  const filesReady = Boolean(config.workbookPath && config.audioDir);
  const title = modify ? (filesReady ? "文件都齐了" : "修改一套已有话术")
    : filesReady ? "文件都齐了"
    : !config.workbookPath && !config.audioDir ? "从两份文件开始"
    : !config.workbookPath ? "还差话术表格" : "还差录音文件夹";
  const subtitle = modify
    ? !filesReady ? "拖入改好的 Excel 和要换的录音，只改有变化的地方。"
      : !config.talkName ? "填上探迹里这套话术的名字，就可以检查数据了。" : "点右上角“检查数据”，我帮你从头过一遍。"
    : !filesReady ? "把 Excel 话术表和录音文件夹拖进窗口，或者点下面选取。"
      : !config.talkName ? "起个话术名称，就可以检查数据了。" : "点右上角“检查数据”，我帮你从头过一遍。";
  const count = audioCount ?? (s.saved ? s.summary?.audioMatch.files.length ?? null : null);
  const disabled = busy(s);

  return (
    <Page>
      <div className="mode-switch" data-tour="mode">
        <SegmentedTabs items={[{ value: "create", title: "新建话术" }, { value: "modify", title: "修改已有话术" }]}
          value={modify ? "modify" : "create"} onChange={(mode: Mode) => !disabled && setMode(mode)} />
      </div>
      <PageHeader title={title} subtitle={subtitle}
        caption={isLite() ? "轻量版 Lite · 保留语音识别，不含本地大模型" : null} />
      <Banners />
      <div className="wells" data-tour="files">
        <FileDrop path={config.workbookPath} kind="workbook" title={modify ? "改好的话术表格" : "话术表格"} hint="探迹标准模板 .xlsx" detail="Excel 表格"
          choose={() => void chooseWorkbook()} tour="well-workbook" disabled={disabled}
          leading={modify ? undefined : <Button tour="template" onClick={() => void saveTemplate()} disabled={disabled}>下载模板</Button>}
          trailing={<Button tour="templateGuide" onClick={() => set({ templateGuideOpen: true })}>怎么填？</Button>} />
        <FileDrop path={config.audioDir} kind="folder" title={modify ? "要换的录音" : "录音文件夹"} hint={modify ? "只放改过的，名字随意" : "WAV、MP3、M4A 都可以"}
          detail={count !== null ? `${count} 个录音` : "文件夹"} choose={() => void chooseAudioDir()} tour="well-audio" disabled={disabled} />
      </div>
      <Panel title={modify ? "要修改的话术" : "话术信息"} tour="fields">
        <FieldRow title="话术名称" value={config.talkName} limit={19} tour="field-talkName" inputRef={nameRef} disabled={disabled}
          placeholder={modify ? "和探迹里的名字一样" : "必填"} onChange={(talkName) => update((c) => ({ ...c, talkName }))} />
        {!modify && (
          <FieldRow title="知识库分类" value={config.categoryName} limit={9} tour="field-category" inputRef={categoryRef} disabled={disabled}
            onChange={(categoryName) => update((c) => ({ ...c, categoryName }))} />
        )}
      </Panel>
    </Page>
  );
}

// MARK: Checkup

export function checkupMood(summary: PreviewSummary, modify = false): Mood {
  if (!summary.canUpload) return "error";
  return summary.warningCount > 0 || (!modify && missingItems(summary).length > 0) || summary.audioMatch.reviewCount > 0 ? "attention" : "calm";
}

function dotState(item: AudioMatchItem, summary: PreviewSummary, modify: boolean): DotState {
  if (item.fileName === null) return modify ? "pending" : "missing";
  if (item.needsReview) return "review";
  return summary.convertAudioNumbers.includes(item.audioNumber) || isTrimmed(summary, item) ? "converted" : "matched";
}

const MODIFY_LEGEND: Array<[DotState, string]> = [["matched", "有新录音"], ["converted", "上传前处理"], ["pending", "不换录音"]];

function checkupTitle(summary: PreviewSummary, modify: boolean): string {
  if (!summary.canUpload) return `还有 ${summary.errorCount} 处要先改`;
  if (summary.audioMatch.reviewCount > 0) return `有 ${summary.audioMatch.reviewCount} 条录音想请你确认`;
  if (modify) {
    const matched = summary.audioMatch.items.filter((item) => item.fileName !== null).length;
    return matched ? `${matched} 条新录音都配好了` : "表格检查通过";
  }
  return `${summary.plannedUploadCount} 条录音都就位了`;
}

function checkupSubtitle(summary: PreviewSummary, modify: boolean): string {
  if (!summary.canUpload) return modify ? "改好 Excel 后重新检查，再和线上对比。" : "改好 Excel 后重新检查，就能上传。";
  if (summary.audioMatch.reviewCount > 0) return "我不太确定它们和话术的对应关系，点一下逐条听就好。";
  if (modify) return "没有新录音的保持线上原样。下一步和线上对比，看哪些要改。";
  const missing = missingItems(summary);
  if (missing.length === 0) return "每一条都有录音，可以直接上传。";
  const numbers = missing.slice(0, 3).map((item) => item.audioNumber).join("、");
  const head = `还差 ${numbers}${missing.length > 3 ? " 等" : " "}号的录音`;
  const these = missing.length > 1 ? "这几条" : "这条";
  const skipped = missing.filter((item) => isKnowledge(summary, item)).length;
  if (skipped === 0) return `${head}，${these}会只上传文字。`;
  if (skipped === missing.length) return `${head}，${these}知识库问题不会上传。`;
  return `${head}。缺录音的知识库问题不会上传，其余只传文字。`;
}

interface Row {
  id: string;
  icon: ReactNode;
  title: string;
  detail?: string;
  action?: string;
  run?: () => void;
}

function issueDetail(issue: ValidationIssue): string {
  const row = issue.rowNumber ? ` 第 ${issue.rowNumber} 行` : "";
  return `${issue.sheetName ?? "Excel"}${row} · ${issue.suggestion}`;
}

const glyph = { size: 19, strokeWidth: 1.8 };

function attentionRows(s: State, summary: PreviewSummary): Row[] {
  const rows: Row[] = [];
  const weight: Record<string, number> = { error: 0, warning: 1, info: 2 };
  const issues = summary.issues.filter((issue) => issue.code !== "W-AUDIO-001")
    .sort((a, b) => (weight[a.severity] ?? 3) - (weight[b.severity] ?? 3));
  issues.forEach((issue, index) => {
    if (issue.severity === "error") rows.push({ id: `issue-${index}`, icon: <XOctagonFill size={17} />, title: issue.message, detail: issueDetail(issue) });
  });
  if (summary.canUpload && summary.audioMatch.reviewCount > 0) {
    rows.push({ id: "review", icon: <QuestionCircleFill size={17} />, title: `${summary.audioMatch.reviewCount} 条录音没把握`,
      detail: "按语音内容猜的，听一下确认更稳。", action: "逐条确认", run: () => set({ matchMode: "review" }) });
  }
  for (const item of isModify(s) ? [] : missingItems(summary)) {
    rows.push({ id: `missing-${item.audioNumber}`, icon: <AudioLinesX {...glyph} color="var(--orange)" />, title: `${item.audioNumber} 号没有找到录音`,
      detail: `${item.label} · ${isKnowledge(summary, item) ? "知识库问题没有录音不会上传" : "文字照常上传"}，补上录音后重新检查即可。`, action: "打开文件夹", run: () => void window.tungee.openPath(s.config.audioDir) });
  }
  const phrases = phraseCounts(s);
  if (phrases.few + phrases.some > 0) {
    rows.push({
      id: "phrases",
      icon: <ListPlus {...glyph} color="var(--blue)" />,
      title: isLite()
        ? `${phrases.few + phrases.some} 个问题问法偏少（轻量版请手补）`
        : `${phrases.few + phrases.some} 个问题问法偏少，AI 可以帮你补`,
      detail: isLite()
        ? (phrases.few > 0
          ? `其中 ${phrases.few} 个不到 6 条。轻量版不含 AI，请在 Excel 里补到 6–10 条；或改用标准版。`
          : "轻量版不含 AI 补问法，请在 Excel 里补到 10 条左右，或改用标准版。")
        : (phrases.few > 0 ? `其中 ${phrases.few} 个不到 6 条，客户换个说法机器人就可能识别不到。` : "补到 10 条左右识别更稳。"),
      action: isLite() ? "去看看" : "去补充",
      run: () => openCheckup("few"),
    });
  }
  const qa = qaCounts(s);
  if (qa.warnings > 0) {
    rows.push({ id: "qa-warning", icon: <TriangleFill size={17} />, title: `${qa.warnings} 条特殊QA的话术是问句`,
      detail: "特殊QA 命中后立即挂断，客户来不及回答。", action: "去看看", run: () => openCheckup("qa") });
  }
  if (qa.special + qa.invalid > 0) {
    const parts = [qa.special > 0 ? `${qa.special} 条建议设为特殊QA（命中即挂断）` : null, qa.invalid > 0 ? `${qa.invalid} 条可以设为无效QA（不计入意向）` : null].filter(Boolean);
    rows.push({ id: "qa", icon: <PhoneOff {...glyph} color="var(--blue)" />, title: `有 ${qa.special + qa.invalid} 条 QA 设置建议`,
      detail: `${parts.join("，")}。`, action: "去看看", run: () => openCheckup("qa") });
  }
  const counts = checkupCounts(s);
  if (counts.fixable > 0) {
    rows.push({ id: "fix", icon: <WandSparkles {...glyph} color="var(--blue)" />, title: `有 ${counts.fixable} 处可以一键修好`,
      detail: "重复的问法、多余的语气词。修好的表格另存一份，原文件不动。", action: "去看看", run: () => openCheckup() });
  } else if (counts.hints > 0) {
    rows.push({ id: "fix", icon: <TextSearch {...glyph} color="var(--blue)" />, title: `话术里有 ${counts.hints} 处值得留意`,
      detail: "不影响上传，有空可以看看。", action: "去看看", run: () => openCheckup("hint") });
  }
  issues.forEach((issue, index) => {
    if (issue.severity === "error") return;
    rows.push({ id: `issue-${index}`, icon: issue.severity === "warning" ? <TriangleFill size={17} /> : <InfoCircleFill size={17} />,
      title: issue.message, detail: issueDetail(issue) });
  });
  if (summary.audioMatch.speechUnavailable) {
    rows.push({ id: "speech", icon: <EarOff {...glyph} color="var(--text-2)" />, title: "这次只按文件名配对", detail: `语音识别没能启动：${summary.audioMatch.speechUnavailable}` });
  }
  if (summary.trimAudioNumbers.length > 0) {
    rows.push({ id: "trim", icon: <Scissors {...glyph} color="var(--text-2)" />, title: `${summary.trimAudioNumbers.length} 条录音头尾空白太长，上传前自动剪掉`,
      detail: "开头留 0.2 秒、结尾留 0.3 秒，中间不动，原文件不变。", action: "查看", run: () => set({ matchMode: "trim" }) });
  }
  if (summary.convertAudioNumbers.length > 0) {
    rows.push({ id: "convert", icon: <AudioWaveform {...glyph} color="var(--text-2)" />, title: `${summary.convertAudioNumbers.length} 个录音会先转格式`,
      detail: "上传前转成探迹要求的 8k 单声道 WAV，原文件不变。" });
  }
  if (summary.audioMatch.smart) {
    rows.push({ id: "matches", icon: <List {...glyph} color="var(--text-2)" />, title: "录音和话术的对应关系",
      detail: `已自动配对 ${summary.audioMatch.autoCount}/${summary.audioMatch.items.length}。`, action: "查看", run: () => set({ matchMode: "list" }) });
  }
  return rows;
}

function Attention({ s, summary }: { s: State; summary: PreviewSummary }) {
  const [showAll, setShowAll] = useState(false);
  const all = attentionRows(s, summary);
  const limit = 8;
  const shown = showAll ? all : all.slice(0, limit);
  let missingTagged = false;
  return (
    <section className="attention" data-tour="attention">
      <div className="section-title">需要你看一眼</div>
      <div>
        {shown.map((row) => {
          let tour = `row-${row.id}`;
          if (row.id.startsWith("missing-")) {
            tour = missingTagged ? "" : "row-missing";
            missingTagged = true;
          }
          return <AttentionRow key={row.id} icon={row.icon} title={row.title} detail={row.detail} action={row.action} run={row.run}
            tour={tour || undefined} disabled={busy(s)} />;
        })}
      </div>
      {all.length > limit && (
        <button className="link attention-more" onClick={() => setShowAll(!showAll)}>{showAll ? "收起" : `还有 ${all.length - limit} 条`}</button>
      )}
    </section>
  );
}

export function CheckupPage() {
  const s = useModel();
  const summary = s.summary;
  if (!summary) {
    return (
      <Page>
        <PageHeader title={s.checking ? "正在检查…" : "还没有检查"}
          subtitle={s.checking ? "读取表格、配对录音，稍等几秒。" : "导入文件后点右上角“检查数据”。"} />
        <Banners />
      </Page>
    );
  }
  const modify = isModify(s);
  return (
    <Page>
      <PageHeader title={checkupTitle(summary, modify)} subtitle={checkupSubtitle(summary, modify)} caption={`${sessionSubtitle(s)} · ${summary.detectedSheetName}`} tour="header" />
      <Banners />
      <RecordingMap summary={summary} state={(item) => dotState(item, summary, modify)} legend={modify ? MODIFY_LEGEND : undefined} />
      <Attention s={s} summary={summary} />
    </Page>
  );
}
