import { isLite } from "../../shared/edition";
import {
  analyzeIntents,
  canRun,
  checkupCounts,
  chooseAudioDir,
  chooseWorkbook,
  get,
  isModify,
  openCheckup,
  pendingMatches,
  phraseCounts,
  runCheck,
  selectedItems,
  set,
  startCompare,
  startModify,
  startUpload,
  STEP_TITLES,
  stepsFor,
  type State,
  type Step,
} from "./model";

/** The single thing the user should do next in their real session. */
export interface NextStep {
  id: string;
  hint: string;
  target?: string;
  title: string;
  body?: string;
  optional?: boolean;
  waiting?: boolean;
  help?: CoachAction;
}

export type CoachAction =
  | { kind: "chooseWorkbook" | "chooseAudio" | "focusTalkName" | "focusCategory" | "runCheck" | "openReview" | "openCheckup" | "openWorkbook" | "schedule" | "retryIntent" | "startUpload" | "resumeUpload" | "openPhrases" | "startCompare" | "startModify" }
  | { kind: "go"; page: Step };

export function actionLabel(action: CoachAction): string {
  switch (action.kind) {
    case "chooseWorkbook":
    case "chooseAudio": return "帮我选取";
    case "focusTalkName":
    case "focusCategory": return "帮我定位";
    case "runCheck": return "帮我检查";
    case "openReview":
    case "openCheckup":
    case "openPhrases": return "帮我打开";
    case "openWorkbook": return "打开表格";
    case "schedule": return "帮我设置";
    case "retryIntent": return "重新分析";
    case "startUpload":
    case "startCompare":
    case "startModify": return "帮我开始";
    case "go": return "带我过去";
    case "resumeUpload": return "帮我继续";
  }
}

/** Optional steps never pull the user back to a page they have already moved past. */
function passed(s: State, page: Step): boolean {
  const steps = stepsFor(s);
  return steps.indexOf(s.step) > steps.indexOf(page);
}

export function nextStep(s: State): NextStep | null {
  if (s.saved) return null;
  const raw = rawNextStep(s);
  if (!raw) return null;
  const [page, next] = raw;
  if (!page || page === s.step) return next;
  const viaPrimary = (s.step === "checkup" && (page === "intent" || page === "compare")) || (s.step === "intent" && page === "upload")
    || (s.step === "compare" && page === "modify");
  const title = STEP_TITLES[page];
  return {
    id: `go-${page}-${next.id}`,
    hint: `去「${title}」页，${next.hint}`,
    target: viaPrimary ? "primary" : `nav-${page}`,
    title: `去「${title}」`,
    body: `下一步在「${title}」页：${next.hint}。`,
    help: { kind: "go", page },
  };
}

/** The next step and the page it happens on; a null page means it can be shown anywhere. */
function rawNextStep(s: State): [Step | null, NextStep] | null {
  switch (s.stage) {
    case "converting":
    case "launching":
      return [null, { id: "launching", hint: "正在打开 Chrome，稍等", title: "正在打开 Chrome", waiting: true }];
    case "rename":
      return ["upload", { id: "rename", hint: "探迹里已有同名话术：改它、接着传或换个名字", target: "rename", title: "同名话术",
        body: "想改探迹里那套就点“改这套话术”；是上次没传完的就点“接着传到…”；是别的话术，就改个名字点“用新名字继续”。" }];
    case "login":
      return [s.modifyTask ?? "upload", { id: "login", hint: "在 Chrome 里登录探迹，再回来确认", target: "login", title: "登录探迹",
        body: "在 Chrome 中登录探迹后，返回本工具确认登录。" }];
    case "comparing":
      return [null, { id: "comparing", hint: "正在读取探迹里的话术，只读不改", title: "正在读取",
        body: "读完会列出要改的地方，改之前的内容先备份。", waiting: true }];
    case "flow":
    case "vague":
    case "knowledge":
    case "intent":
    case "review":
      if (s.modifyTask === "modify") {
        return [null, { id: "modifying", hint: "正在修改，不用操作，改完会告诉你", title: "交给我就行",
          body: "只改勾选的地方。想停随时点右上角“停止”，下次接着改。", waiting: true }];
      }
      return [null, { id: "uploading", hint: "正在上传，不用操作，传完会告诉你", title: "交给我就行",
        body: "可以去忙别的，传完这里会显示结果。想停随时点右上角“停止”。", waiting: true }];
    default:
      break;
  }
  if (isModify(s)) return modifyNextStep(s);
  const { checkpoint, error, summary, config } = s;
  if (checkpoint && (s.stage === "error" || s.stage === "cancelled" || !error) && summary?.canUpload && canRun(s)) {
    const done = checkpoint.doneAudioNumbers.length;
    return ["upload", { id: "resume", hint: "上次传到一半，点“接着传”", target: "resume", title: "接着上次传",
      body: [error && `${error.message}${error.suggestion}`, `已完成的 ${done} 条会自动跳过；想从头来就点“重新开始”。`].filter(Boolean).join("\n"),
      help: { kind: "resumeUpload" } }];
  }
  if (error) {
    return [null, { id: `error-${error.code}`, hint: error.suggestion, target: "error", title: "先处理这个问题", body: `${error.message}${error.suggestion}` }];
  }
  if (s.checking) return [null, { id: "checking", hint: "正在检查，稍等几秒", title: "正在检查", waiting: true }];
  if (s.stage === "completed") {
    return ["upload", { id: "done", hint: config.submitReview ? "去探迹看看审核结果" : "去探迹检查一遍，没问题再提交审核",
      title: "传完了", body: config.submitReview ? "已经提交审核，结果在探迹里查看。" : "在探迹里打开这套话术检查一遍，确认无误后再提交审核。" }];
  }
  if (!config.workbookPath) {
    return ["importFiles", { id: "workbook", hint: "把话术表格拖进来", target: "well-workbook", title: "导入话术表格",
      body: "把 Excel 话术表拖到这里，或者点“帮我选取”。还没有表格，就先点“下载模板”；不会填就点旁边的“怎么填？”。", help: { kind: "chooseWorkbook" } }];
  }
  if (!config.audioDir) {
    return ["importFiles", { id: "audio", hint: "把录音文件夹拖进来", target: "well-audio", title: "导入录音文件夹",
      body: "录音会听内容自动对应表格，文件名怎么起都行。", help: { kind: "chooseAudio" } }];
  }
  if (!config.talkName) {
    return ["importFiles", { id: "talkName", hint: "起个话术名称", target: "field-talkName", title: "起个话术名称",
      body: "就是探迹里显示的名字，最多 19 个字。", help: { kind: "focusTalkName" } }];
  }
  if (!config.categoryName) {
    return ["importFiles", { id: "category", hint: "填一个知识库分类", target: "field-category", title: "填知识库分类",
      body: "所有问答都放进这个分类，最多 9 个字。", help: { kind: "focusCategory" } }];
  }
  if (!summary) {
    return [s.step === "checkup" ? "checkup" : "importFiles", { id: "check", hint: "点右上角“检查数据”", target: "primary", title: "检查数据",
      body: "我会检查表格格式，再给录音配对，大概几秒钟。", help: { kind: "runCheck" } }];
  }
  if (!summary.canUpload) {
    const first = summary.issues.find((issue) => issue.severity === "error");
    return ["checkup", { id: "errors", hint: `改好 Excel 里的 ${summary.errorCount} 处错误，再重新检查`, target: "row-issue-0", title: "先改这处错误",
      body: [first?.message, first?.suggestion, "改好保存后，点右上角“重新检查”。"].filter(Boolean).join(""), help: { kind: "openWorkbook" } }];
  }
  const pending = pendingMatches(s);
  if (pending > 0) {
    return ["checkup", { id: "review", hint: `确认 ${pending} 条没把握的录音`, target: "primary", title: "确认录音",
      body: "这几条是按语音内容猜的，逐条听一下，选对的那个。", help: { kind: "openReview" } }];
  }
  const fixable = checkupCounts(s).fixable;
  if (fixable > 0 && !s.coachSkipped.has("fix") && !passed(s, "checkup")) {
    return ["checkup", { id: "fix", hint: `有 ${fixable} 处可以一键修好`, target: "row-fix", title: "一键修正",
      body: "修好的表格另存一份，原文件不动。不修也能上传。", optional: true, help: { kind: "openCheckup" } }];
  }
  const phrases = phraseCounts(s).few;
  if (phrases > 0 && !s.coachSkipped.has("phrases") && !passed(s, "checkup")) {
    return ["checkup", {
      id: "phrases",
      hint: isLite() ? `${phrases} 个问题问法太少，请在 Excel 里手补` : `${phrases} 个问题问法太少，让 AI 帮你补`,
      target: "row-phrases",
      title: "补问法",
      body: isLite()
        ? "问法太少，客户换个说法机器人就可能识别不到。轻量版不含 AI，请在 Excel 里补到 6–10 条，或改用标准版。不补也能上传。"
        : "问法太少，客户换个说法机器人就可能识别不到。AI 会按你的业务写几条，勾选后另存一份。不补也能上传。",
      optional: true,
      help: { kind: "openPhrases" },
    }];
  }
  if (summary.knowledgeCount > 0) {
    if (s.intentLoading) {
      return [null, {
        id: "intent-loading",
        hint: isLite() ? "正在按关键词归类意向" : "正在分析意向，稍等",
        title: isLite() ? "正在按关键词归类" : "正在分析意向",
        waiting: true,
      }];
    }
    if (s.intentError && !passed(s, "intent")) {
      return ["intent", { id: "intent-error", hint: "意向建议没生成，重新分析一次", title: "重新分析意向", help: { kind: "retryIntent" } }];
    }
    if (!s.intentResult && !passed(s, "intent")) {
      return ["intent", {
        id: "intent-open",
        hint: isLite() ? "看看关键词意向建议" : "看看意向建议",
        title: isLite() ? "看看意向建议（轻量版）" : "看看意向建议",
        body: isLite()
          ? "轻量版按关键词粗分意向，请你确认。不需要也可以直接上传。"
          : "按知识库里的问题建议新增哪些意向。不需要也可以直接上传。",
        optional: true,
        help: { kind: "go", page: "intent" },
      }];
    }
    const result = s.intentResult;
    if (result && result.setups.length > 0 && !s.scheduledIntents && !s.coachSkipped.has("schedule") && !passed(s, "intent")) {
      return ["intent", { id: "schedule", hint: "决定要不要上传时自动设置意向", target: "schedule", title: "上传时自动设置",
        body: `确认后，传完会顺手新建这 ${result.setups.length} 条意向，默认的 5 条不动。也可以复制建议自己配。`, optional: true, help: { kind: "schedule" } }];
    }
  }
  return ["upload", { id: "upload", hint: "点右上角“开始上传”", target: "primary", title: "开始上传",
    body: "会打开 Chrome，登录后就全自动了。", help: { kind: "startUpload" } }];
}

function modifyNextStep(s: State): [Step | null, NextStep] | null {
  const { error, summary, config, modifyPlan } = s;
  if (error) {
    return [null, { id: `error-${error.code}`, hint: error.suggestion, target: "error", title: "先处理这个问题", body: `${error.message}${error.suggestion}` }];
  }
  if (s.checking) return [null, { id: "checking", hint: "正在检查，稍等几秒", title: "正在检查", waiting: true }];
  if (s.stage === "completed" && s.modifyMessage) {
    return ["modify", { id: "modify-done", hint: config.submitReview ? "去探迹看看审核结果" : "去探迹检查一遍，没问题再提交审核",
      title: "改好了", body: "想确认改没改对，点右上角“再对比一次”。" }];
  }
  if (!config.workbookPath) {
    return ["importFiles", { id: "workbook", hint: "把改好的话术表格拖进来", target: "well-workbook", title: "导入改好的表格",
      body: "就是上传时用的那份表格，改好内容再拖进来。", help: { kind: "chooseWorkbook" } }];
  }
  if (!config.audioDir) {
    return ["importFiles", { id: "audio", hint: "把要换的录音拖进来", target: "well-audio", title: "导入要换的录音",
      body: "只放改过的录音，名字随意，我会听内容配对。", help: { kind: "chooseAudio" } }];
  }
  if (!config.talkName) {
    return ["importFiles", { id: "talkName", hint: "填上要修改的话术名称", target: "field-talkName", title: "要修改的话术",
      body: "和探迹里的名字一模一样。", help: { kind: "focusTalkName" } }];
  }
  if (!summary) {
    return [s.step === "checkup" ? "checkup" : "importFiles", { id: "check", hint: "点右上角“检查数据”", target: "primary", title: "检查数据",
      body: "先检查表格，再听一遍新录音，大概几秒钟。", help: { kind: "runCheck" } }];
  }
  if (!summary.canUpload) {
    const first = summary.issues.find((issue) => issue.severity === "error");
    return ["checkup", { id: "errors", hint: `改好 Excel 里的 ${summary.errorCount} 处错误，再重新检查`, target: "row-issue-0", title: "先改这处错误",
      body: [first?.message, first?.suggestion, "改好保存后，点右上角“重新检查”。"].filter(Boolean).join(""), help: { kind: "openWorkbook" } }];
  }
  const pending = pendingMatches(s);
  if (pending > 0) {
    return ["checkup", { id: "review", hint: `确认 ${pending} 条没把握的录音`, target: "primary", title: "确认录音",
      body: "这几条是按语音内容猜的，逐条听一下，选对的那个。", help: { kind: "openReview" } }];
  }
  if (!modifyPlan) {
    return ["compare", { id: "compare", hint: "点右上角“开始对比”", target: "primary", title: "开始对比",
      body: "会打开 Chrome 读取探迹里的这套话术，只读不改。", help: { kind: "startCompare" } }];
  }
  if (!selectedItems(s).length) {
    const selectable = modifyPlan.items.some((item) => item.status === "changed" || item.status === "new");
    return ["compare", { id: selectable ? "tick" : "same", hint: selectable ? "勾选要改的地方" : "线上和表格一致，不用改", title: selectable ? "勾选要改的地方" : "不用改",
      body: selectable ? "只会改勾选的地方，没勾的保持原样。" : "表格里的内容和探迹里一样。" }];
  }
  return ["modify", { id: "modify", hint: "点右上角“开始修改”", target: "primary", title: "开始修改",
    body: "只改勾选的地方，改之前的内容已经备份。", help: { kind: "startModify" } }];
}

export function perform(action: CoachAction): void {
  switch (action.kind) {
    case "chooseWorkbook": void chooseWorkbook(); break;
    case "chooseAudio": void chooseAudioDir(); break;
    case "focusTalkName": set({ focusRequest: "talkName" }); break;
    case "focusCategory": set({ focusRequest: "category" }); break;
    case "runCheck": void runCheck(); break;
    case "openReview": set({ matchMode: "review" }); break;
    case "openCheckup": openCheckup(); break;
    case "openPhrases": openCheckup("few"); break;
    case "openWorkbook": void window.tungee.openPath(get().config.workbookPath); break;
    case "schedule": set({ intentConfirming: true }); break;
    case "retryIntent":
      set({ intentError: null });
      void analyzeIntents();
      break;
    case "startUpload": void startUpload(); break;
    case "resumeUpload": void startUpload(true); break;
    case "startCompare": void startCompare(); break;
    case "startModify": void startModify(); break;
    case "go": set({ step: action.page }); break;
  }
}
