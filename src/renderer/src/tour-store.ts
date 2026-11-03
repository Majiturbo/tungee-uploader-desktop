import { useSyncExternalStore } from "react";
import { isLite } from "../../shared/edition";
import { nextStep, perform, type NextStep } from "./coach";
import { advanceDemoUpload, enterDemo, exitDemo, showDemo, type TourScene } from "./demo";
import { busy, get, set as setModel, subscribe as subscribeModel, type Step } from "./model";
import type { DotState } from "./Recordings";

export type PointIcon =
  | "import" | "checkup" | "intent" | "upload" | "check" | "number" | "waveform" | "cursor" | "folder" | "mood"
  | "copy" | "sparkles" | "plus" | "skip" | "hand" | "globe" | "lock" | "stop" | "restart" | "drive" | "shield";

export type TourPoint = { text: string; icon?: PointIcon; dot?: DotState; badge?: string };

export interface TourStep {
  page: Step;
  target: string | null;
  title: string;
  body?: string;
  points?: TourPoint[];
  scene?: TourScene;
}

export const DONE_KEY = isLite() ? "tour.v1.lite.done" : "tour.v1.done";

const standardSteps: TourStep[] = [
  { page: "importFiles", target: null, title: "欢迎使用",
    body: "用一份示例话术，把整个流程完整走一遍。示例不会动你的文件，随时按 Esc 退出。",
    points: [{ icon: "import", text: "导入：Excel 话术表 + 录音文件夹" }, { icon: "checkup", text: "体检：检查表格，给录音配对" },
      { icon: "intent", text: "意向：按客户问题建议意向" }, { icon: "upload", text: "上传：自动填进探迹" }] },
  { page: "importFiles", target: "steps", title: "四个步骤",
    body: "从上往下做，可以随时点回前面的步骤。右边的小字是每一步的状态，比如“已通过”“3 条待确认”。" },
  { page: "importFiles", target: "files", title: "导入文件", body: "拖进窗口任意位置都可以，也可以点“选取”。",
    points: [{ icon: "check", text: "选好后会显示文件图标和蓝色对勾" }, { icon: "number", text: "录音会听内容自动对应表格，文件名随意" },
      { icon: "waveform", text: "支持 WAV、MP3、M4A 等常见格式" }] },
  { page: "importFiles", target: "template", title: "下载模板",
    body: "手上没有表格，就先下一份标准模板。直接在模板里填，不要增删列或改表头，否则会检查不过。" },
  { page: "importFiles", target: "templateGuide", title: "怎么填模板", body: "不会填就点这里，四张图讲清楚每一列填什么、从哪一行开始粘贴。" },
  { page: "importFiles", target: "fields", title: "话术信息",
    points: [{ icon: "cursor", text: "话术名称最多 19 个字，就是探迹里显示的名字" }, { icon: "folder", text: "知识库分类最多 9 个字，所有问答都放进这个分类" }] },
  { page: "importFiles", target: "primary", title: "检查数据",
    body: "填好后点这里。我会检查表格格式，再听录音内容给每句配上录音。第一次录音多时要一两分钟。" },

  { page: "checkup", target: "header", title: "一眼看结论", body: "大标题直接告诉你能不能传。页面顶部的光也会跟着变色。",
    points: [{ icon: "mood", text: "蓝色：一切正常" }, { icon: "mood", text: "橙色：有提醒，不影响上传" }, { icon: "mood", text: "红色：有错误，要先改" }] },
  { page: "checkup", target: "map", title: "话术结构", body: "按话术的真实结构排列，每个点是一条录音。鼠标放在点上能看到编号和文件名。",
    points: [{ dot: "matched", text: "已配对" }, { dot: "converted", text: "上传前自动剪掉头尾空白，或转成 8k 单声道 WAV" },
      { dot: "missing", text: "缺录音，只传文字；知识库问题不上传" }, { dot: "review", text: "没把握，需要你听一下确认" }] },
  { page: "checkup", target: "row-missing", title: "缺录音", body: "点“打开文件夹”补上录音，再重新检查。不补也能传，只是这一条没有声音；知识库问题没有录音会跳过。" },
  { page: "checkup", target: "row-fix", title: "一键修正", body: "重复的问法、多余的语气词、异常符号，都能一键修好。",
    points: [{ icon: "copy", text: "修好的表格另存为新文件，原文件不动" }, { icon: "sparkles", text: "还可以让本机 AI 查错字、补充问法" }] },
  { page: "checkup", target: "row-matches", title: "录音对应关系",
    body: "核对每条录音配给了哪句话术。按语音内容猜的、没把握的，右上角会出现“确认录音”，逐条听一下就好。" },
  { page: "checkup", target: "report", title: "导出报告", body: "把检查结果存成 Excel，方便发给同事一起改。" },

  { page: "intent", target: "intentCards", title: "意向建议", body: "按知识库里客户会问的问题，建议新增这几条意向。默认的 5 条意向保持不动。",
    points: [{ badge: "A级", text: "明确想要，优先跟进" }, { badge: "B级", text: "在了解，值得跟进" }, { badge: "C级", text: "有顾虑，暂缓" }] },
  { page: "intent", target: "chip-有什么优势", title: "换一个意向",
    body: "带橙点的是我拿不准的问题。点一下，选它该去的意向，建议会立刻更新；换过的会有蓝色描边。" },
  { page: "intent", target: "schedule", title: "上传时自动设置", body: "确认后，上传完会顺手新建这些意向。",
    points: [{ icon: "plus", text: "只新建，默认的 5 条不改不删" }, { icon: "skip", text: "探迹里已有的会跳过" }, { icon: "hand", text: "任何一步失败，都不会自动提交审核" }] },
  { page: "intent", target: "intentFooter", title: "自己配置也行", body: "复制或导出这份建议，照着在探迹里手动设置。" },

  { page: "upload", target: "uploadSettings", title: "上传设置",
    body: "最后确认一遍话术名称和意向安排。“完成后提交审核”默认关闭，建议传完先在探迹里检查一遍。", scene: "scheduled" },
  { page: "upload", target: "primary", title: "开始上传", body: "一切就绪后点这里，会自动打开 Chrome。", scene: "scheduled" },
  { page: "upload", target: "login", title: "登录探迹", body: "在 Chrome 中登录探迹后，返回本工具确认登录。",
    points: [{ icon: "globe", text: "用你自己的探迹账号在 Chrome 里登录" }, { icon: "lock", text: "账号密码只在 Chrome 里输入，不经过这个工具" }], scene: "login" },
  { page: "upload", target: "map", title: "自动上传", body: "确认登录后就全自动了：每传完一条，对应的点就亮起来。",
    points: [{ dot: "done", text: "已上传" }, { dot: "active", text: "正在传" }, { dot: "pending", text: "等待" },
      { icon: "stop", text: "想停随时点右上角“停止”，已传的会保留" }], scene: "running" },
  { page: "upload", target: "log", title: "运行记录",
    body: "在右边进度下面，每一步都记在这里，最新的在最下面。出了问题，设置里可以打开完整日志发给维护人员。", scene: "running" },
  { page: "upload", target: "inspector", title: "进度", body: "右边这一栏随时告诉你四个步骤各做到哪了。", scene: "running" },
  { page: "upload", target: "inspectorToggle", title: "收起进度栏", body: "点这个按钮收起或展开右侧进度，页面会更宽。", scene: "running" },
  { page: "upload", target: "settings", title: "设置",
    points: [{ icon: "restart", text: "重新看一遍这个引导" }, { icon: "drive", text: "清理浏览器缓存、转换后的录音等" },
      { icon: "shield", text: "录音识别、体检、意向建议都在本机完成，不联网" }] },
];

function forLite(steps: TourStep[]): TourStep[] {
  return steps.map((step) => {
    if (step.target === null && step.title === "欢迎使用") {
      return {
        ...step,
        title: "欢迎使用轻量版 Lite",
        body: "这是轻量版：体积更小、不含本地大模型。示例不会动你的文件，随时按 Esc 退出。",
        points: [
          { icon: "import", text: "导入：Excel 话术表 + 录音文件夹" },
          { icon: "checkup", text: "体检：检查表格，语音识别配对录音（无 AI 补问法）" },
          { icon: "intent", text: "意向：按关键词粗分，请你确认" },
          { icon: "upload", text: "上传：自动填进探迹" },
        ],
      };
    }
    if (step.target === "row-fix") {
      return {
        ...step,
        points: [
          { icon: "copy", text: "修好的表格另存为新文件，原文件不动" },
          { icon: "sparkles", text: "AI 补问法与查错字仅标准版提供" },
        ],
      };
    }
    if (step.target === "intentCards") {
      return {
        ...step,
        body: "轻量版按关键词给出意向建议，把握不如标准版，请逐条确认。默认的 5 条意向保持不动。",
      };
    }
    if (step.target === "settings") {
      return {
        ...step,
        points: [
          { icon: "restart", text: "重新看一遍这个引导" },
          { icon: "drive", text: "清理浏览器缓存、转换后的录音等" },
          { icon: "shield", text: "轻量版：语音识别在本机；不含本地大模型" },
        ],
      };
    }
    return step;
  });
}

export const steps: TourStep[] = isLite() ? forLite(standardSteps) : standardSteps;

interface TourState {
  index: number | null;
  coach: NextStep | null;
  follow: boolean;
}

let state: TourState = { index: null, coach: null, follow: false };
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function update(patch: Partial<TourState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useTour(): TourState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => state);
}

export const tourState = () => state;
export const currentStep = () => (state.index === null ? null : steps[state.index]!);
export const focusTarget = () => currentStep()?.target ?? state.coach?.target ?? null;
export const shouldAutoStart = () => localStorage.getItem(DONE_KEY) !== "1";

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function go(index: number): void {
  const step = steps[index]!;
  showDemo(step.scene ?? "idle", step.page);
  update({ index });
  stopTicker();
  if (step.scene === "running" && step.target === "map") ticker = setInterval(advanceDemoUpload, 700);
}

export function start(first = 0): void {
  if (state.coach) update({ coach: null });
  if (state.index !== null || busy(get())) return;
  setModel({ matchMode: null, checkupOpen: false, settingsOpen: false, templateGuideOpen: false, intentConfirming: false });
  enterDemo();
  go(Math.min(Math.max(first, 0), steps.length - 1));
}

export function next(): void {
  if (state.index === null) return;
  if (state.index === steps.length - 1) finish();
  else go(state.index + 1);
}

export function back(): void {
  if (state.index === null || state.index === 0) return;
  go(state.index - 1);
}

export function finish(): void {
  if (state.index === null) return;
  stopTicker();
  update({ index: null });
  exitDemo();
  localStorage.setItem(DONE_KEY, "1");
}

// MARK: Next-step guide

/** Points a popover at the real control for `step`. The page stays usable; clicking elsewhere or Esc closes it. */
export function guide(step: NextStep): void {
  if (state.index !== null) return;
  update({ coach: step });
}

export function stopCoach(): void {
  if (state.coach) update({ coach: null });
}

export function setFollow(follow: boolean): void {
  update({ follow });
}

export function skipCoach(): void {
  const coach = state.coach;
  if (!coach) return;
  setModel((s) => ({ coachSkipped: new Set(s.coachSkipped).add(coach.id) }));
  update({ coach: nextStep(get()) });
}

export function performCoach(): void {
  const action = state.coach?.help;
  if (action) perform(action);
}

/** The user clicked elsewhere. Unless that click moved things forward, stop. */
export function coachDismissed(): void {
  const coach = state.coach;
  if (!coach) return;
  setTimeout(() => {
    const s = get();
    const sheetOpen = s.matchMode !== null || s.checkupOpen || s.settingsOpen || s.templateGuideOpen || s.intentConfirming;
    if (state.coach?.id === coach.id && nextStep(s)?.id === coach.id && !sheetOpen) stopCoach();
  }, 600);
}

subscribeModel(() => {
  const coach = state.coach;
  if (!coach) return;
  const upcoming = nextStep(get());
  if (upcoming?.id === coach.id) return;
  if (state.follow && upcoming) update({ coach: upcoming });
  else stopCoach();
});
