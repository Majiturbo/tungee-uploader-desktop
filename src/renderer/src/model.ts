import { useSyncExternalStore } from "react";
import {
  buildIntentPlan,
  intentMarkdown,
  intentSetups,
  needsConfirm,
  type IntentAnalysis,
  type IntentPlan,
  type IntentQuestion,
  type IntentSetup,
  type IntentSignal,
} from "../../shared/intent-plan";
import type {
  AiProgress,
  AppErrorInfo,
  AudioMatchItem,
  PreviewSummary,
  ProgressEvent,
  ProgressStage,
  UploadCheckpointInfo,
  UploadConfig,
} from "../../shared/types";
import type { ModifyItem, ModifyPlan } from "../../shared/modify";

export type Step = "importFiles" | "checkup" | "intent" | "upload" | "compare" | "modify";
export const STEPS: Step[] = ["importFiles", "checkup", "intent", "upload"];
export const MODIFY_STEPS: Step[] = ["importFiles", "checkup", "compare", "modify"];
export const STEP_TITLES: Record<Step, string> = { importFiles: "导入", checkup: "体检", intent: "意向", upload: "上传", compare: "对比", modify: "修改" };

export type Mode = "create" | "modify";

export type MatchMode = "review" | "list" | "trim";

export interface IntentPlanResult {
  plan: IntentPlan;
  setups: IntentSetup[];
  markdown: string;
  flagged: string[];
}

export const STAGE_TITLES: Record<ProgressStage, string> = {
  idle: "等待开始",
  reading: "检查数据",
  matching: "识别录音",
  ready: "可以上传",
  blocked: "需要修正",
  converting: "转换录音",
  launching: "启动浏览器",
  login: "等待登录",
  comparing: "读取线上话术",
  rename: "需要换名字",
  flow: "主流程",
  vague: "含糊话术",
  knowledge: "知识库",
  intent: "意向设置",
  review: "提交审核",
  entry: "选择入口",
  quota: "核对额度",
  creating: "创建智能体",
  generating: "等待生成",
  personalize: "知识库与热词",
  attach: "编辑页挂载",
  paste: "复制后台提示词",
  completed: "已完成",
  cancelled: "已停止",
  error: "失败",
};

const RUNNING: ProgressStage[] = ["reading", "matching", "converting", "launching", "login", "comparing", "rename", "flow", "vague", "knowledge", "intent", "review"];
const UPLOAD: ProgressStage[] = ["converting", "launching", "login", "rename", "flow", "vague", "knowledge", "intent", "review", "completed", "cancelled", "error"];

export const isRunningStage = (stage: ProgressStage) => RUNNING.includes(stage);
export const isUploadStage = (stage: ProgressStage) => UPLOAD.includes(stage);

/** Everything the tour replaces, so the real session comes back untouched afterwards. */
export interface SessionSnapshot {
  config: UploadConfig;
  summary: PreviewSummary | null;
  step: Step;
  stage: ProgressStage;
  progress: Progress;
  logs: ProgressEvent[];
  error: AppErrorInfo | null;
  showInspector: boolean;
  intentAnalysis: IntentAnalysis | null;
  intentQuestions: IntentQuestion[];
  intentResult: IntentPlanResult | null;
  scheduledIntents: IntentSetup[] | null;
  uploadDone: Set<number>;
  uploadActive: number | null;
  uploadMessage: string | null;
  checkpoint: UploadCheckpointInfo | null;
}

export interface Progress {
  current?: number;
  total?: number;
}

export interface State {
  config: UploadConfig;
  summary: PreviewSummary | null;
  stage: ProgressStage;
  progress: Progress;
  logs: ProgressEvent[];
  error: AppErrorInfo | null;
  notice: string | null;
  step: Step;
  showInspector: boolean;
  showSidebar: boolean;
  checking: boolean;
  reportSaving: boolean;
  matchMode: MatchMode | null;
  /** Row the match sheet scrolls to when it opens from a recording's card. */
  matchFocus: number | null;
  checkupOpen: boolean;
  /** Tab the checkup sheet opens on next time, e.g. "few" or "qa". */
  checkupTab: string | null;
  intentAnalysis: IntentAnalysis | null;
  intentQuestions: IntentQuestion[];
  intentResult: IntentPlanResult | null;
  intentLoading: boolean;
  intentProgress: AiProgress | null;
  intentError: AppErrorInfo | null;
  scheduledIntents: IntentSetup[] | null;
  uploadDone: Set<number>;
  uploadActive: number | null;
  uploadMessage: string | null;
  checkpoint: UploadCheckpointInfo | null;
  renameDraft: string;
  saved: SessionSnapshot | null;
  coachSkipped: Set<string>;
  focusRequest: string | null;
  intentConfirming: boolean;
  settingsOpen: boolean;
  templateGuideOpen: boolean;
  /** The change list from the last comparison with the talk online. */
  modifyPlan: ModifyPlan | null;
  modifySelected: Set<string>;
  /** Which modify-mode task the browser is running, since both use the upload stages. */
  modifyTask: "compare" | "modify" | null;
  modifyDone: Set<string>;
  modifyActive: string | null;
  modifyMessage: string | null;
}

const initial: State = {
  config: { talkName: "", workbookPath: "", audioDir: "", categoryName: "客户问答", submitReview: false },
  summary: null,
  stage: "idle",
  progress: {},
  logs: [],
  error: null,
  notice: null,
  step: "importFiles",
  showInspector: true,
  showSidebar: true,
  checking: false,
  reportSaving: false,
  matchMode: null,
  matchFocus: null,
  checkupOpen: false,
  checkupTab: null,
  intentAnalysis: null,
  intentQuestions: [],
  intentResult: null,
  intentLoading: false,
  intentProgress: null,
  intentError: null,
  scheduledIntents: null,
  uploadDone: new Set(),
  uploadActive: null,
  uploadMessage: null,
  checkpoint: null,
  renameDraft: "",
  saved: null,
  coachSkipped: new Set(),
  focusRequest: null,
  intentConfirming: false,
  settingsOpen: false,
  templateGuideOpen: false,
  modifyPlan: null,
  modifySelected: new Set(),
  modifyTask: null,
  modifyDone: new Set(),
  modifyActive: null,
  modifyMessage: null,
};

let state = initial;
const listeners = new Set<() => void>();

export function get(): State {
  return state;
}

export function set(patch: Partial<State> | ((current: State) => Partial<State>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useModel(): State {
  return useSyncExternalStore(subscribe, get);
}

export function fileName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? value;
}

export function logTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function bridgeError(error: unknown): AppErrorInfo {
  return {
    code: "E-APP-001",
    message: "后台服务通信失败。",
    suggestion: "请关闭本工具后重新打开；若仍出现，请把技术详情发给维护人员。",
    detail: error instanceof Error ? error.message : String(error),
  };
}

// MARK: Derived state

export const isRunning = (s: State) => isRunningStage(s.stage);
export const uploading = (s: State) => isRunningStage(s.stage) && isUploadStage(s.stage);
export const busy = (s: State) => isRunning(s) || s.checking;

const chars = (value: string) => [...value].length;

export const isModify = (s: State) => s.config.mode === "modify";
export const stepsFor = (s: State) => (isModify(s) ? MODIFY_STEPS : STEPS);

export function canRun(s: State): boolean {
  const { config } = s;
  const categoryOk = isModify(s) || Boolean(config.categoryName && chars(config.categoryName) < 10);
  return Boolean(config.workbookPath && config.audioDir && config.talkName && chars(config.talkName) < 20 && categoryOk);
}

/** Ticked items that can actually be changed, in the order the engine works through them. */
export function selectedItems(s: State): ModifyItem[] {
  return (s.modifyPlan?.items ?? []).filter((item) => s.modifySelected.has(item.id) && (item.status === "changed" || item.status === "new"));
}

export const comparing = (s: State) => s.modifyTask === "compare" && isRunning(s);
export const modifying = (s: State) => s.modifyTask === "modify" && isRunning(s);

export const canStart = (s: State) => canRun(s) && s.summary?.canUpload === true;
export const pendingMatches = (s: State) => (s.summary?.canUpload ? s.summary.audioMatch.reviewCount : 0);

const QA_FLAGS = ["special-qa", "invalid-qa", "special-question"];
export const isQaFlag = (kind: string) => QA_FLAGS.includes(kind);
export const isPhraseCount = (kind: string) => kind === "few-phrases" || kind === "some-phrases";

export function checkupCounts(s: State): { total: number; fixable: number; hints: number } {
  const all = s.summary?.checkup.findings ?? [];
  const findings = all.filter((item) => !isQaFlag(item.kind) && !isPhraseCount(item.kind));
  const fixable = findings.filter((item) => item.options.length > 0).length;
  return { total: all.length, fixable, hints: findings.length - fixable };
}

export function phraseCounts(s: State): { few: number; some: number } {
  const findings = s.summary?.checkup.findings ?? [];
  return { few: findings.filter((item) => item.kind === "few-phrases").length, some: findings.filter((item) => item.kind === "some-phrases").length };
}

export function qaCounts(s: State): { special: number; invalid: number; warnings: number } {
  const findings = s.summary?.checkup.findings ?? [];
  const count = (kind: string) => findings.filter((item) => item.kind === kind).length;
  return { special: count("special-qa"), invalid: count("invalid-qa"), warnings: count("special-question") };
}

export const subtitle = (s: State) => (s.config.workbookPath ? fileName(s.config.workbookPath) : "未导入");

export function stepStatus(s: State, step: Step): string {
  switch (step) {
    case "importFiles":
      return s.config.workbookPath && s.config.audioDir ? "已添加" : "";
    case "checkup":
      if (s.checking) return "检查中";
      if (!s.summary) return "";
      if (!s.summary.canUpload) return `${s.summary.errorCount} 个错误`;
      return pendingMatches(s) > 0 ? `${pendingMatches(s)} 条待确认` : "已通过";
    case "intent":
      if (s.intentLoading) return "分析中";
      return s.scheduledIntents ? `${s.scheduledIntents.length} 条` : "";
    case "upload":
      return uploading(s) ? STAGE_TITLES[s.stage] : s.stage === "completed" ? "已完成" : "";
    case "compare":
      if (comparing(s)) return "对比中";
      return s.modifyPlan ? `${selectedItems(s).length} 处` : "";
    case "modify":
      if (modifying(s)) return `${s.modifyDone.size}/${selectedItems(s).length}`;
      return s.stage === "completed" && s.modifyMessage ? "已完成" : "";
  }
}

/** Recordings in Excel order, split into main flow, vague answers and knowledge base. */
export function sections(summary: PreviewSummary): { flow: AudioMatchItem[]; vague: AudioMatchItem[]; knowledge: AudioMatchItem[] } {
  const items = [...summary.audioMatch.items].sort((a, b) => a.audioNumber - b.audioNumber);
  return {
    flow: items.slice(0, summary.flowCount),
    vague: items.slice(summary.flowCount, summary.flowCount + summary.vagueCount),
    knowledge: items.slice(summary.flowCount + summary.vagueCount),
  };
}

export function missingItems(summary: PreviewSummary): AudioMatchItem[] {
  return summary.audioMatch.items.filter((item) => item.fileName === null).sort((a, b) => a.audioNumber - b.audioNumber);
}

/** A knowledge question without a recording is left out of the upload; flow and vague answers still upload their text. */
export function isKnowledge(summary: PreviewSummary, item: AudioMatchItem): boolean {
  return sections(summary).knowledge.some((entry) => entry.audioNumber === item.audioNumber);
}

export function missingNote(summary: PreviewSummary, item: AudioMatchItem): string {
  return isKnowledge(summary, item) ? "不会上传" : "只上传文字";
}

/** "剪掉开头 1.2 秒、结尾 3.0 秒", or null when the recording is uploaded whole. */
export function trimNote(trim: AudioMatchItem["trim"]): string | null {
  if (!trim) return null;
  const parts = [trim.head > 0 ? `开头 ${trim.head.toFixed(1)} 秒` : null, trim.tail > 0 ? `结尾 ${trim.tail.toFixed(1)} 秒` : null].filter(Boolean);
  return parts.length ? `剪掉${parts.join("、")}` : null;
}

export function isTrimmed(summary: PreviewSummary, item: AudioMatchItem): boolean {
  return summary.trimAudioNumbers.includes(item.audioNumber);
}

// MARK: Actions

export function update(change: (config: UploadConfig) => UploadConfig): void {
  const before = state.config;
  const config = change(before);
  const filesChanged = before.workbookPath !== config.workbookPath || before.audioDir !== config.audioDir;
  const patch: Partial<State> = { config, error: null };
  if (filesChanged) {
    Object.assign(patch, { summary: null, stage: "idle", coachSkipped: new Set<string>() });
    resetIntent();
  }
  if (filesChanged || before.talkName !== config.talkName || before.mode !== config.mode) {
    Object.assign(patch, { modifyPlan: null, modifySelected: new Set<string>(), modifyMessage: null });
  }
  if (["error", "cancelled", "completed"].includes(state.stage)) patch.stage = "idle";
  set(patch);
  if (filesChanged || before.categoryName !== config.categoryName) void refreshCheckpoint();
}

export async function chooseWorkbook(): Promise<void> {
  const selected = await window.tungee.selectWorkbook();
  if (selected) update((config) => ({ ...config, workbookPath: selected }));
}

export async function chooseAudioDir(): Promise<void> {
  const selected = await window.tungee.selectAudioDir();
  if (selected) update((config) => ({ ...config, audioDir: selected }));
}

export async function drop(paths: string[]): Promise<void> {
  if (busy(state)) return;
  let accepted = false;
  for (const target of paths) {
    const kind = target ? await window.tungee.inspectLocalPath(target) : "missing";
    if (kind === "directory") {
      update((config) => ({ ...config, audioDir: target }));
      accepted = true;
    } else if (kind === "file" && target.toLowerCase().endsWith(".xlsx")) {
      update((config) => ({ ...config, workbookPath: target }));
      accepted = true;
    }
  }
  if (!accepted) {
    set({ error: { code: "E-DROP-003", message: "无法识别拖入的内容。", suggestion: "请拖入 .xlsx 话术表格，或包含录音的文件夹。" } });
  }
  set({ step: "importFiles" });
}

export async function preview(target?: UploadConfig): Promise<PreviewSummary | null> {
  set({ error: null, checking: true });
  try {
    const result = await window.tungee.preview(target ?? state.config);
    if (result.status === "ok") {
      set({ summary: result.summary, checking: false });
      await refreshCheckpoint();
      return result.summary;
    }
    set({ error: result.error, stage: "error" });
  } catch (error: unknown) {
    set({ error: bridgeError(error), stage: "error" });
  } finally {
    set({ checking: false });
  }
  return null;
}

export async function runCheck(): Promise<void> {
  if (await preview()) set({ step: "checkup" });
}

async function saveFile(run: () => Promise<{ status: string; path?: string; error?: AppErrorInfo }>, success: string): Promise<void> {
  set({ error: null });
  try {
    const result = await run();
    if (result.status === "saved" && result.path) set({ notice: `${success}：${fileName(result.path)}` });
    else if (result.error) set({ error: result.error });
  } catch (error: unknown) {
    set({ error: bridgeError(error) });
  }
}

export const saveTemplate = () => saveFile(() => window.tungee.saveStandardTemplate(), "标准模板已保存");

export async function saveReport(): Promise<void> {
  set({ reportSaving: true });
  await saveFile(() => window.tungee.saveValidationReport(state.config), "检查报告已保存");
  set({ reportSaving: false });
}

export function matchesSaved(): void {
  set({ matchMode: null, matchFocus: null, notice: "录音匹配已保存" });
  void preview();
}

export function useFixedWorkbook(path: string): void {
  set({ checkupOpen: false });
  update((config) => ({ ...config, workbookPath: path }));
  set({ notice: `已改用修正版：${fileName(path)}` });
  void preview();
}

export function openCheckup(tab: string | null = null): void {
  set({ checkupTab: tab, checkupOpen: true });
}

export function primaryAction(s: State): { label: string; enabled: boolean; run: () => void } {
  const check = () => void runCheck();
  switch (s.step) {
    case "importFiles":
      return { label: s.checking ? "检查中…" : "检查数据", enabled: canRun(s) && !busy(s), run: check };
    case "checkup":
      if (!s.summary) return { label: "检查数据", enabled: canRun(s) && !busy(s), run: check };
      if (pendingMatches(s) > 0) return { label: `确认录音（${pendingMatches(s)}）`, enabled: !busy(s), run: () => set({ matchMode: "review" }) };
      if (!s.summary.canUpload) return { label: "重新检查", enabled: canRun(s) && !busy(s), run: check };
      if (isModify(s)) return { label: "下一步：对比", enabled: !busy(s), run: () => set({ step: "compare" }) };
      return { label: "下一步：意向", enabled: !busy(s), run: () => set({ step: "intent" }) };
    case "compare":
      if (comparing(s)) return { label: "停止", enabled: true, run: () => void cancelUpload() };
      if (!s.modifyPlan) return { label: "开始对比", enabled: canStart(s) && pendingMatches(s) === 0 && !busy(s), run: () => void startCompare() };
      return { label: "下一步：修改", enabled: selectedItems(s).length > 0 && !busy(s), run: () => set({ step: "modify" }) };
    case "modify":
      if (modifying(s)) return { label: "停止", enabled: s.stage !== "review", run: () => void cancelUpload() };
      if (s.stage === "completed" && s.modifyMessage) return { label: "再对比一次", enabled: canStart(s) && !busy(s), run: () => { set({ step: "compare" }); void startCompare(); } };
      return { label: "开始修改", enabled: selectedItems(s).length > 0 && !busy(s), run: () => void startModify() };
    case "intent":
      return { label: "下一步：上传", enabled: canStart(s) && !busy(s), run: () => set({ step: "upload" }) };
    case "upload":
      if (uploading(s)) return { label: "停止", enabled: s.stage !== "review", run: () => void cancelUpload() };
      if (s.checkpoint) return { label: "接着传", enabled: canStart(s) && !busy(s), run: () => void startUpload(true) };
      return { label: s.stage === "completed" ? "再传一次" : "开始上传", enabled: canStart(s) && !busy(s), run: () => void startUpload() };
  }
}

// MARK: Intent

export function planIntents(analysis: IntentAnalysis, questions: IntentQuestion[]): IntentPlanResult {
  const plan = buildIntentPlan(questions);
  return {
    plan,
    setups: intentSetups(plan),
    markdown: intentMarkdown({ ...analysis, questions }, plan),
    flagged: questions.filter(needsConfirm).map((question) => question.name),
  };
}

export function resetIntent(): void {
  if (state.intentLoading) void window.tungee.cancelAi();
  set({ intentAnalysis: null, intentQuestions: [], intentResult: null, intentError: null, intentLoading: false, scheduledIntents: null });
}

let unsubscribeAi: (() => void) | null = null;

export async function analyzeIntents(): Promise<void> {
  if (state.intentLoading) return;
  set({ intentLoading: true, intentError: null, intentProgress: null });
  unsubscribeAi = window.tungee.onAiProgress((progress) => set({ intentProgress: progress }));
  try {
    const result = await window.tungee.analyzeIntent(state.config);
    if (result.status === "ok") {
      const questions = result.analysis.questions;
      set({ intentAnalysis: result.analysis, intentQuestions: questions, intentResult: planIntents(result.analysis, questions) });
    } else if (result.status === "error") {
      set({ intentError: result.error });
    }
  } catch (error: unknown) {
    set({ intentError: bridgeError(error) });
  } finally {
    unsubscribeAi?.();
    unsubscribeAi = null;
    set({ intentLoading: false });
  }
}

export function moveQuestion(name: string, signal: IntentSignal): void {
  const index = state.intentQuestions.findIndex((question) => question.name === name);
  const question = state.intentQuestions[index];
  if (!question || question.signal === signal || !state.intentAnalysis) return;
  const questions = state.intentQuestions.map((item) => (item.name === name ? { ...item, signal, source: "user" as const, alternative: undefined } : item));
  set({ intentQuestions: questions, intentResult: planIntents(state.intentAnalysis, questions) });
}

export async function exportIntents(): Promise<void> {
  const markdown = state.intentResult?.markdown;
  if (!markdown) return;
  await saveFile(() => window.tungee.exportIntent(state.config, markdown), "意向建议已导出");
}

export async function copyIntents(): Promise<void> {
  const markdown = state.intentResult?.markdown;
  if (!markdown) return;
  await window.tungee.copyText(markdown);
  set({ notice: "意向建议已复制" });
}

// MARK: Upload

export async function startUpload(resume = false): Promise<void> {
  if (!canStart(state) || busy(state)) return;
  const checkpoint = state.checkpoint;
  set({ error: null, logs: [], progress: {}, uploadActive: null, uploadMessage: null, stage: "launching" });
  if (resume && checkpoint) {
    set((s) => ({ config: { ...s.config, talkName: checkpoint.talkName }, uploadDone: new Set(checkpoint.doneAudioNumbers) }));
  } else {
    set({ uploadDone: new Set() });
    if (checkpoint) await window.tungee.discardCheckpoint(state.config).catch(() => undefined);
  }
  set({ checkpoint: null });
  try {
    const result = await window.tungee.start(state.config, state.scheduledIntents ?? [], { resume });
    set({ uploadMessage: result.message, uploadActive: null });
    if (result.status === "completed") set({ stage: "completed" });
    else if (result.status === "cancelled") set({ stage: "cancelled" });
    else set({ stage: "error", error: result.error ?? { code: "E-UNKNOWN-001", message: result.message || "上传没有完成。", suggestion: "请重新检查数据后再试。" } });
  } catch (error: unknown) {
    set({ error: bridgeError(error), stage: "error" });
  }
  void refreshCheckpoint();
}

export function confirmLogin(): void {
  void window.tungee.confirmLogin();
}

export async function cancelUpload(): Promise<void> {
  await window.tungee.cancel().catch(() => undefined);
}

export function renameValid(s: State): boolean {
  const name = s.renameDraft.trim();
  return name.length > 0 && chars(name) < 20 && name !== s.config.talkName;
}

export async function submitRename(): Promise<void> {
  if (!renameValid(state)) return;
  const name = state.renameDraft.trim();
  if (await window.tungee.rename(name)) set((s) => ({ config: { ...s.config, talkName: name } }));
}

export function useExistingTalk(): void {
  void window.tungee.useExisting();
}

// MARK: Modify

/** Switches between creating a talk and editing an existing one. Files and the name stay; the check reruns
 * because modify mode matches recordings by what they say. */
export function setMode(mode: Mode): void {
  if (busy(state) || (state.config.mode ?? "create") === mode) return;
  update((config) => ({ ...config, mode }));
  set({ summary: null, stage: "idle", step: "importFiles", error: null });
}

/** From the name clash during an upload: stop it and edit the talk that already has this name. */
export async function modifyExistingTalk(): Promise<void> {
  await window.tungee.modifyExisting().catch(() => false);
  for (let waited = 0; waited < 10000 && isRunning(state); waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
  setMode("modify");
  const summary = await preview();
  if (summary) set({ step: summary.canUpload && summary.audioMatch.reviewCount === 0 ? "compare" : "checkup" });
}

export async function startCompare(): Promise<void> {
  if (!canStart(state) || busy(state)) return;
  set({ error: null, logs: [], progress: {}, modifyPlan: null, modifySelected: new Set(), modifyMessage: null, modifyTask: "compare", stage: "launching" });
  try {
    const result = await window.tungee.compareTalk(state.config);
    if (result.ok) {
      const selected = result.plan.items.filter((item) => item.selected).map((item) => item.id);
      set({ modifyPlan: result.plan, modifySelected: new Set(selected), stage: "ready" });
    } else if (state.stage !== "cancelled" && !state.error) {
      set({ stage: "blocked", error: { code: "E-MODIFY-002", message: result.message, suggestion: "处理好后再点“开始对比”。" } });
    }
  } catch (error: unknown) {
    set({ error: bridgeError(error), stage: "error" });
  } finally {
    set({ modifyTask: null });
  }
}

export function toggleModifyItem(id: string, on: boolean): void {
  const next = new Set(state.modifySelected);
  if (on) next.add(id);
  else next.delete(id);
  set({ modifySelected: next });
}

export async function startModify(): Promise<void> {
  const items = selectedItems(state);
  if (!items.length || busy(state)) return;
  set({ error: null, logs: [], progress: {}, modifyDone: new Set(), modifyActive: null, modifyMessage: null, modifyTask: "modify", stage: "launching" });
  try {
    const result = await window.tungee.modifyTalk(state.config, items.map((item) => item.id));
    set({ modifyMessage: result.message, modifyActive: null });
    if (result.status === "completed") set({ stage: "completed" });
    else if (result.status === "cancelled") set({ stage: "cancelled" });
    else set({ stage: "error", error: result.error ?? { code: "E-UNKNOWN-001", message: result.message || "修改没有完成。", suggestion: "重新对比后再试。" } });
  } catch (error: unknown) {
    set({ error: bridgeError(error), stage: "error" });
  } finally {
    set({ modifyTask: null });
  }
}

function trackModify(event: ProgressEvent): Partial<State> {
  const items = selectedItems(state);
  if (event.stage === "completed") return { modifyDone: new Set(items.map((item) => item.id)), modifyActive: null };
  if (!["flow", "vague", "knowledge"].includes(event.stage)) return {};
  const item = event.current ? items[event.current - 1] : undefined;
  if (!item) return {};
  if (event.message.includes("已改好") || event.message.includes("跳过")) {
    return { modifyDone: new Set(state.modifyDone).add(item.id), modifyActive: null };
  }
  return { modifyActive: item.id };
}

export async function refreshCheckpoint(): Promise<void> {
  const s = state;
  if (s.saved || isRunning(s) || !s.config.workbookPath || !s.config.audioDir) {
    if (!isRunning(s)) set({ checkpoint: null });
    return;
  }
  const checkpoint = await window.tungee.checkpoint(s.config).catch(() => null);
  if (!state.saved) set({ checkpoint });
}

function mark(items: AudioMatchItem[], event: ProgressEvent): Partial<State> {
  const current = event.current;
  if (!current || current < 1 || current > items.length) return {};
  const finished = ["已确认上传", "跳过录音", "已保存", "已完成"].some((word) => event.message.includes(word));
  const done = new Set(state.uploadDone);
  for (const item of items.slice(0, finished ? current : current - 1)) done.add(item.audioNumber);
  return { uploadDone: done, uploadActive: finished ? null : items[current - 1]!.audioNumber };
}

function trackUpload(event: ProgressEvent): Partial<State> {
  const summary = state.summary;
  if (!summary) return {};
  const parts = sections(summary);
  switch (event.stage) {
    case "flow": return mark(parts.flow, event);
    case "vague": return mark(parts.vague, event);
    case "knowledge": return mark(parts.knowledge.filter((item) => item.fileName !== null), event);
    case "intent":
    case "review":
    case "completed":
      return { uploadDone: new Set(summary.audioMatch.items.map((item) => item.audioNumber)), uploadActive: null };
    default:
      return {};
  }
}

export function received(event: ProgressEvent): void {
  const patch: Partial<State> = {};
  if (event.stage === "rename" && state.stage !== "rename") patch.renameDraft = [...`${state.config.talkName}-2`].slice(0, 19).join("");
  patch.stage = event.stage;
  set(patch);
  set({
    ...(state.modifyTask === "modify" ? trackModify(event) : state.modifyTask === "compare" ? {} : trackUpload(event)),
    progress: { current: event.current, total: event.total },
    logs: [...state.logs, event].slice(-200),
  });
  if (event.stage === "error") set({ error: event.error ?? { code: "E-UNKNOWN-001", message: event.message, suggestion: "请重新检查数据后再试。" } });
  if (event.stage === "completed") set({ error: null });
}
