import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { CONVERTED_AUDIO_DIR } from "./audio-format";
import type { AudioDecoder } from "./audio-decoder";
import type { AudioMatchProvider } from "./audio-matcher";
import {
  buildPreview,
  loadData,
  type AudioFields,
  type AudioKnowledgeTask,
  type AudioSpeechTask,
  type FlowSection,
  type LoadOptions,
} from "./data-validation";
import { applyIntents, type IntentApplyReport } from "./intent-web";
import { normalizeCommonQuestions } from "./script-checkup";
import { buildModifyItems, tasksById } from "./talk-diff";
import { ModifyProgress, SentAudio, audioFingerprint, modifyQuestion, modifyScene } from "./talk-modifier";
import { readTalk, restMouse, saveBackup } from "./talk-reader";
import type { IntentSetup } from "../shared/intent-plan";
import type { ModifyCompareResult, ModifyItem, OnlineTalk } from "../shared/modify";
import { chromeProfileDir, rememberConvertedAudioDir } from "./storage";
import { UploadCheckpointStore, checkpointKey, type UploadCheckpoint } from "./upload-checkpoint";
import type {
  AppErrorInfo,
  PreviewSummary,
  ProgressEvent,
  ProgressStage,
  RunResult,
  StartOptions,
  UploadCheckpointInfo,
  UploadConfig,
} from "../shared/types";

const TALK_NAME_PLACEHOLDER = "请输入少于20个字符的话术名称";
const DUPLICATE_NAME = /已存在|已被(?:系统)?(?:使用|占用)|重复|同名/;
const SESSION_FILE = "tungee-session.json";
const CALL_COMPANY = "客户成功";

const modifyKey = (config: UploadConfig) => JSON.stringify([config.talkName, config.workbookPath, config.audioDir]);

function modifySummary(item: ModifyItem): string {
  if (item.status === "new") return "新增问题";
  return [item.textChanged ? "改文字" : "", item.phrasesChanged ? "改问法" : "", item.audioFile ? "换录音" : ""].filter(Boolean).join("、");
}

interface SavedSession {
  cookies: Parameters<BrowserContext["addCookies"]>[0];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

/**
 * Waits for the create dialog to either open the editor or keep reporting the name as taken.
 * A taken-name message only counts while the dialog stays open for a moment after submitting,
 * because the previous attempt's message can linger until the page re-validates the new name.
 */
async function creationOutcome(editor: Locator, duplicate: Locator, nameInput: Locator): Promise<"created" | "duplicate" | "timeout"> {
  const deadline = Date.now() + 60000;
  let takenSince = 0;
  while (Date.now() < deadline) {
    if (await editor.isVisible().catch(() => false)) return "created";
    const open = await nameInput.isVisible().catch(() => false);
    if (open && await duplicate.isVisible().catch(() => false)) {
      takenSince ||= Date.now();
      if (Date.now() - takenSince >= 2500) return "duplicate";
    } else {
      takenSince = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return "timeout";
}

type ProgressEmitter = (event: ProgressEvent) => void;

function errorInfo(code: string, message: string, suggestion: string, detail: string): AppErrorInfo {
  return { code, message, suggestion, detail };
}

export function describeAutomationError(error: unknown): AppErrorInfo {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();

  if (normalized.includes("target page, context or browser has been closed")
    || normalized.includes("page has been closed")) {
    if (normalized.includes("launchpersistentcontext")) {
      return errorInfo(
        "E-BROWSER-003",
        "浏览器会话启动失败。",
        "请关闭之前由本工具打开的 Chrome 窗口，再重新开始任务。",
        detail,
      );
    }
    return errorInfo(
      "E-BROWSER-002",
      "浏览器窗口已被关闭。",
      "已传的部分都记下了，点“接着传”会重新打开 Chrome，找到这套话术继续。",
      detail,
    );
  }
  if (normalized.includes("executable doesn't exist")
    || normalized.includes("failed to launch")
    || normalized.includes("browsertypelaunch")) {
    return errorInfo(
      "E-BROWSER-001",
      "无法启动 Chrome。",
      "请确认电脑已安装 Google Chrome，然后重新开始任务。",
      detail,
    );
  }
  if (detail.includes("找不到上次的话术")) {
    return errorInfo(
      "E-RESUME-001",
      "在探迹里找不到上次的话术。",
      "它可能被改名或删除了。点“重新开始”会新建一套话术。",
      detail,
    );
  }
  if (normalized.includes("登录后未进入") || normalized.includes("我的话术")) {
    return errorInfo(
      "E-LOGIN-001",
      "尚未进入探迹“我的话术”页面。",
      "请在自动打开的 Chrome 中完成登录并进入话术页面，再点击“已登录，继续”。",
      detail,
    );
  }
  if (normalized.includes("net::err_") || normalized.includes("name_not_resolved")) {
    return errorInfo(
      "E-NET-001",
      "无法连接探迹网页。",
      "请检查网络和 user.tungee.com / call.tungee.com 是否能正常打开，然后重试。",
      detail,
    );
  }
  if (detail.includes("创建话术没有成功")) {
    return errorInfo(
      "E-WEB-002",
      "探迹没有创建这套话术。",
      `${detail.replace(/^Error:\s*/, "")}。按提示处理后重新开始；如果是名字被占用，换一个话术名称即可。`,
      detail,
    );
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return errorInfo(
      "E-WEB-001",
      "网页响应超时。",
      "探迹页面可能仍在加载，请保持窗口打开，稍后重新开始任务。",
      detail,
    );
  }
  if (normalized.includes("strict mode violation")) {
    return errorInfo(
      "E-PAGE-002",
      "网页上出现了多个相同控件，工具无法确认操作位置。",
      "请保持页面为默认布局并重试；若仍出现，请把当前页面截图发给维护人员。",
      detail,
    );
  }
  if (detail.includes("未找到对应编辑框")
    || detail.includes("独立场景卡片")
    || detail.includes("未找到对应")) {
    return errorInfo(
      "E-PAGE-001",
      "当前探迹页面结构与工具预期不一致。",
      "请确认页面没有缩放或改版；若仍出现，请把当前页面截图发给维护人员。",
      detail,
    );
  }
  if (normalized.includes("enoent") || normalized.includes("no such file")) {
    return errorInfo(
      "E-FILE-001",
      "选中的文件或文件夹已不存在。",
      "请重新选择 Excel 和录音文件夹后再检查。",
      detail,
    );
  }
  if (detail.includes("Excel 中未找到") || detail.includes("QA 类型只能填写")) {
    return errorInfo(
      "E-DATA-001",
      "Excel 内容格式不符合要求。",
      `请按模板检查对应工作表和字段。${detail}`,
      detail,
    );
  }
  if (detail.includes("请选择") || detail.includes("话术名称") || detail.includes("分类名称") || detail.includes("参数格式")) {
    return errorInfo(
      "E-CONFIG-001",
      "任务参数不完整或格式不正确。",
      detail,
      detail,
    );
  }
  return errorInfo(
    "E-UNKNOWN-001",
    "任务遇到未识别的问题。",
    "请先重新检查数据并重试；若仍出现，请把错误代码和技术详情发给维护人员。",
    detail,
  );
}

/** The first visible form error, toast or dialog message on the page, if any. */
async function pageNotice(page: Page): Promise<string> {
  const selectors = [".ant-form-item-explain-error", ".ant-message-notice", ".ant-notification-notice", "[role=alert]", ".el-form-item__error", ".el-message"];
  for (const selector of selectors) {
    const texts = await page.locator(selector).filter({ visible: true }).allInnerTexts().catch(() => [] as string[]);
    const text = texts.map((item) => item.trim()).find(Boolean);
    if (text) return text.slice(0, 120);
  }
  return "";
}

function intentMessage(report: IntentApplyReport, submitReview: boolean): string {
  const attempted = report.created.length + report.existing.length + report.problems.length > 0;
  if (report.problems.length) {
    return `话术已上传，意向设置有 ${report.problems.length} 处需要处理（见运行记录）${submitReview ? "，已暂停提交审核，请检查后手动提交" : ""}`;
  }
  const intentPart = attempted ? `，已新建 ${report.created.length} 条意向` : "";
  return submitReview ? `全部完成${intentPart}，已点击提交审核` : `全部完成${intentPart}，话术保留为编辑中`;
}

export class AutomationEngine {
  private context: BrowserContext | null = null;
  private running = false;
  private cancelled = false;

  get isRunning(): boolean {
    return this.running;
  }
  private loginResolver: (() => void) | null = null;
  /** Resolves with a new talk name, or null to continue into the existing talk of that name. */
  private renameResolver: ((name: string | null) => void) | null = null;
  private readonly checkpoints: UploadCheckpointStore;
  private checkpoint: UploadCheckpoint | null = null;
  /** The first question left after an interruption may have been saved just before it. */
  private verifyNextQuestion = false;
  private readonly modifyProgress: ModifyProgress;
  private readonly sentAudio: SentAudio;
  /** The talk as read by the last comparison, and the editor tab it was read in. */
  private modifySession: { key: string; online: OnlineTalk; page: Page } | null = null;

  constructor(
    private readonly userDataPath: string,
    private readonly converter: AudioDecoder,
    private readonly emitEvent: ProgressEmitter,
    private readonly matcher?: AudioMatchProvider,
  ) {
    this.checkpoints = new UploadCheckpointStore(userDataPath);
    this.modifyProgress = new ModifyProgress(userDataPath);
    this.sentAudio = new SentAudio(userDataPath);
  }

  checkpointInfo(config: UploadConfig): Promise<UploadCheckpointInfo | null> {
    return this.checkpoints.info(config);
  }

  linkWorkbook(source: string, target: string): Promise<void> {
    return this.checkpoints.link(source, target);
  }

  async discardCheckpoint(config: UploadConfig): Promise<void> {
    if (await this.checkpoints.load(config)) await this.checkpoints.clear();
  }

  /** Supplies a new talk name after the web page reported a duplicate. */
  rename(name: string): boolean {
    if (!this.renameResolver) return false;
    const resolve = this.renameResolver;
    this.renameResolver = null;
    resolve(name);
    return true;
  }

  /** Continues into the talk that already has this name, e.g. one left half uploaded. */
  useExisting(): boolean {
    if (!this.renameResolver) return false;
    const resolve = this.renameResolver;
    this.renameResolver = null;
    resolve(null);
    return true;
  }

  /** Leaves the name clash to edit that existing talk instead. Unlike cancel, the browser stays open for the comparison. */
  modifyExisting(): boolean {
    if (!this.renameResolver) return false;
    this.cancelled = true;
    const resolve = this.renameResolver;
    this.renameResolver = null;
    resolve(null);
    return true;
  }

  private get sessionFile(): string {
    return path.join(chromeProfileDir(this.userDataPath), SESSION_FILE);
  }

  /** Stores cookies (including session cookies Chrome drops on exit) and local storage so the next launch stays logged in. */
  private async saveSession(): Promise<void> {
    if (!this.context) return;
    try {
      const state = await this.context.storageState();
      const origins = state.origins.filter((item) => item.origin.includes("tungee.com"));
      const cookies = state.cookies.filter((cookie) => cookie.domain.includes("tungee.com"));
      await fs.writeFile(this.sessionFile, JSON.stringify({ cookies, origins } satisfies SavedSession), "utf8");
    } catch {
      // The browser may already be gone; the previous session file stays as it was.
    }
  }

  private async restoreSession(context: BrowserContext): Promise<void> {
    let saved: SavedSession;
    try {
      saved = JSON.parse(await fs.readFile(this.sessionFile, "utf8")) as SavedSession;
    } catch {
      return;
    }
    if (saved.cookies?.length) await context.addCookies(saved.cookies).catch(() => undefined);
    if (saved.origins?.length) {
      await context.addInitScript((origins: SavedSession["origins"]) => {
        const entry = origins.find((item) => item.origin === location.origin);
        if (!entry) return;
        for (const { name, value } of entry.localStorage) {
          if (localStorage.getItem(name) === null) localStorage.setItem(name, value);
        }
      }, saved.origins);
    }
  }

  private async browserPage(): Promise<Page> {
    const open = this.context?.pages().find((item) => !item.isClosed());
    if (this.context && open) return open;
    if (this.context) await this.closeContext();
    const profileDir = chromeProfileDir(this.userDataPath);
    await fs.mkdir(profileDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
    });
    this.context.on("close", () => {
      this.context = null;
    });
    await this.restoreSession(this.context);
    return this.context.pages()[0] ?? await this.context.newPage();
  }

  private async markDone(scene?: number, question?: { question: string; audioNumber: number }): Promise<void> {
    if (!this.checkpoint) return;
    if (scene !== undefined && !this.checkpoint.scenes.includes(scene)) this.checkpoint.scenes.push(scene);
    if (question && !this.checkpoint.questions.some((item) => item.question === question.question)) this.checkpoint.questions.push(question);
    await this.checkpoints.save(this.checkpoint).catch(() => undefined);
  }

  private emit(stage: ProgressStage, message: string, current?: number, total?: number, error?: AppErrorInfo): void {
    this.emitEvent({ stage, message, current, total, timestamp: new Date().toISOString(), error });
  }

  private assertActive(): void {
    if (this.cancelled) throw new Error("__CANCELLED__");
  }

  loadOptions(): LoadOptions {
    return {
      matcher: this.matcher,
      onMatchProgress: (current, total, fileName) => this.emit("matching", `正在识别录音内容：${fileName}`, current, total),
      onTrimProgress: (current, total, fileName) => this.emit("matching", `正在检查录音头尾空白：${fileName}`, current, total),
    };
  }

  async preview(config: UploadConfig): Promise<PreviewSummary> {
    this.emit("reading", "正在读取 Excel 与录音目录…");
    const summary = buildPreview(await loadData(config, this.loadOptions()));
    if (summary.canUpload && summary.audioMatch.reviewCount > 0) {
      this.emit("ready", `检查通过，还有 ${summary.audioMatch.reviewCount} 条录音需要确认`);
    } else if (summary.canUpload) {
      this.emit("ready", `检查通过：计划上传 ${summary.plannedUploadCount} 个录音`);
    } else {
      this.emit("blocked", `检查发现 ${summary.errorCount} 个错误，已禁止开始上传`);
    }
    return summary;
  }

  confirmLogin(): boolean {
    if (!this.loginResolver) return false;
    const resolve = this.loginResolver;
    this.loginResolver = null;
    resolve();
    return true;
  }

  async cancel(): Promise<boolean> {
    if (!this.running) return false;
    this.cancelled = true;
    this.confirmLogin();
    this.rename("");
    this.converter.dispose();
    await this.saveSession();
    if (this.context) {
      await this.closeContext();
      this.context = null;
    }
    return true;
  }

  private async closeContext(): Promise<void> {
    await this.context?.close().catch(() => undefined);
  }

  async releaseBrowser(): Promise<boolean> {
    if (this.running) return false;
    await this.saveSession();
    if (this.context) await this.closeContext();
    this.context = null;
    return true;
  }

  async dispose(): Promise<void> {
    this.cancelled = true;
    this.confirmLogin();
    this.rename("");
    this.converter.dispose();
    await this.saveSession();
    if (this.context) await this.closeContext();
    this.context = null;
  }

  private async convertAudio(tasks: Array<AudioFields & { audioNumber: number }>, audioDir: string): Promise<AppErrorInfo | null> {
    const pending = tasks.filter((task) => task.audioExists && (task.audioNeedsConversion || task.audioTrim));
    if (!pending.length) return null;
    const outputDir = path.join(audioDir, CONVERTED_AUDIO_DIR);
    await fs.mkdir(outputDir, { recursive: true });
    await rememberConvertedAudioDir(this.userDataPath, outputDir);
    const failures: string[] = [];
    try {
      for (const [index, task] of pending.entries()) {
        this.assertActive();
        const sourceName = path.basename(task.audioPath);
        const targetPath = path.join(outputDir, `${task.audioNumber}.wav`);
        this.emit("converting", `${task.audioTrim ? "正在剪掉空白" : "正在转换"} ${sourceName}`, index + 1, pending.length);
        try {
          await this.converter.convertFile(task.audioPath, targetPath, task.audioTrim);
          task.audioPath = targetPath;
        } catch (error: unknown) {
          this.assertActive();
          failures.push(`${sourceName}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      this.converter.dispose();
    }
    if (!failures.length) {
      const trimmed = pending.filter((task) => task.audioTrim).length;
      const done = trimmed ? `${pending.length} 个录音已处理（${trimmed} 个剪掉了头尾空白）` : `${pending.length} 个录音已转换为 8k 单声道 WAV`;
      this.emit("converting", `${done}，保存在「${CONVERTED_AUDIO_DIR}」`, pending.length, pending.length);
      return null;
    }
    return errorInfo(
      "E-AUDIO-005",
      `${failures.length} 个录音无法转换，已停止上传。`,
      "请确认这些文件能在播放器中正常播放；损坏的文件请重新导出后再试。此时尚未打开探迹，不会留下草稿。",
      failures.join("\n"),
    );
  }

  private async fillIntents(page: Page, intents: IntentSetup[]): Promise<IntentApplyReport> {
    if (!intents.length) return { created: [], existing: [], problems: [] };
    this.emit("intent", `开始设置 ${intents.length} 条意向`, 0, intents.length);
    let report: IntentApplyReport;
    try {
      report = await applyIntents(page, intents, {
        assertActive: () => this.assertActive(),
        onIntent: (title, current, total) => this.emit("intent", `正在新建意向：${title}`, current, total),
      });
    } catch (error: unknown) {
      if (this.cancelled || (error instanceof Error && error.message === "__CANCELLED__")) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      report = { created: [], existing: [], problems: [`意向设置中断：${detail}`] };
    }
    for (const title of report.existing) this.emit("intent", `「${title}」网页里已经有了，没有重复创建`);
    for (const problem of report.problems) this.emit("intent", problem);
    if (report.created.length) this.emit("intent", `已新建 ${report.created.length} 条意向：${report.created.join("、")}`, intents.length, intents.length);
    return report;
  }

  async run(config: UploadConfig, intents: IntentSetup[] = [], options: StartOptions = {}): Promise<RunResult> {
    if (this.running) {
      const error = errorInfo(
        "E-TASK-001",
        "已有任务正在运行。",
        "请等待当前任务结束，或先点击“停止任务”。",
        "AutomationEngine.run called while another task was running",
      );
      return { status: "error", message: `${error.code}｜${error.message}`, error };
    }
    this.running = true;
    this.cancelled = false;
    try {
      const data = await loadData(config, this.loadOptions());
      const summary = buildPreview(data);
      if (summary.canUpload && summary.audioMatch.reviewCount > 0) {
        const info = errorInfo(
          "E-AUDIO-006",
          `还有 ${summary.audioMatch.reviewCount} 条录音需要确认，已停止上传。`,
          "请点击“确认录音”，逐条确认后再开始上传。此时尚未打开探迹，不会留下草稿。",
          summary.audioMatch.items
            .filter((item) => item.needsReview)
            .slice(0, 10)
            .map((item) => `${item.audioNumber} ${item.label}：${item.reason ?? ""}`)
            .join("\n"),
        );
        this.emit("blocked", `${info.code}｜${info.message}`, undefined, undefined, info);
        return { status: "error", message: `${info.code}｜${info.message}`, error: info };
      }
      if (!summary.canUpload) {
        const firstIssue = summary.issues.find((item) => item.severity === "error");
        const detail = summary.issues
          .filter((item) => item.severity === "error")
          .slice(0, 10)
          .map((item) => `${item.code} ${item.sheetName ?? ""}${item.rowNumber ? `第${item.rowNumber}行` : ""} ${item.message}`.trim())
          .join("\n");
        const info = errorInfo(
          "E-DATA-002",
          "Excel 数据检查未通过，已停止上传。",
          firstIssue
            ? `${firstIssue.sheetName ?? "Excel"}${firstIssue.rowNumber ? `第 ${firstIssue.rowNumber} 行` : ""}：${firstIssue.message} ${firstIssue.suggestion}`
            : "请先点击“检查数据”并修正红色错误。",
          detail,
        );
        this.emit("blocked", `${info.code}｜${info.message}`, undefined, undefined, info);
        return { status: "error", message: `${info.code}｜${info.message}`, error: info };
      }
      const conversionError = await this.convertAudio(
        [...data.flowTasks, ...data.vagueTasks, ...data.knowledgeTasks],
        config.audioDir,
      );
      if (conversionError) {
        this.emit("blocked", `${conversionError.code}｜${conversionError.message}`, undefined, undefined, conversionError);
        return { status: "error", message: `${conversionError.code}｜${conversionError.message}`, error: conversionError };
      }
      this.emit("launching", `数据检查完成，准备处理 ${summary.plannedUploadCount} 个录音`);
      const previous = options.resume ? await this.checkpoints.load(config) : null;
      let page = await this.browserPage();
      const inTalk = previous !== null && await page.getByRole("button", { name: "主流程", exact: true }).isVisible().catch(() => false);
      if (!inTalk) await this.ensureLoggedIn(page);
      this.assertActive();
      const opened = previous && !inTalk ? await this.openTalk(page, previous.talkName) : null;
      if (previous && (inTalk || opened)) {
        if (opened) page = opened;
        this.checkpoint = previous;
        this.verifyNextQuestion = true;
        this.emit("launching", `接着上次继续：已完成 ${previous.scenes.length + previous.questions.length} 条，会自动跳过`);
      } else {
        if (previous) this.emit("launching", `探迹里没找到上次的话术“${previous.talkName}”，重新创建`);
        const created = await this.createTalk(page, previous?.talkName ?? config.talkName);
        if (created.existing) {
          const existing = await this.openTalk(page, created.name);
          if (!existing) throw new Error(`找不到已有的话术“${created.name}”`);
          page = existing;
        }
        await this.checkpoints.clear();
        this.checkpoint = {
          key: checkpointKey(config), talkName: created.name, scenes: [], questions: [], updatedAt: "",
          ...(created.existing ? { unknownProgress: true } : {}),
        };
        await this.checkpoints.save(this.checkpoint);
        if (created.existing) this.emit("launching", `接着传到已有的“${created.name}”：主流程会重新保存一遍，已有的知识库问题会跳过`);
      }

      const grouped = new Map<FlowSection, AudioSpeechTask[]>();
      for (const task of data.flowTasks) {
        if (task.sectionName) grouped.set(task.sectionName, [...(grouped.get(task.sectionName) ?? []), task]);
      }
      let flowOffset = 0;
      for (const sectionName of ["开场白", "产品介绍", "客户邀约", "结束话语"] as const) {
        const sectionTasks = grouped.get(sectionName) ?? [];
        await this.fillSection(page, sectionName, sectionTasks, flowOffset, data.flowTasks.length);
        flowOffset += sectionTasks.length;
      }
      await this.fillVague(page, data.vagueTasks);
      const knowledgeWithAudio = data.knowledgeTasks.filter((task) => task.audioExists);
      await this.fillKnowledge(page, config.categoryName, knowledgeWithAudio);
      this.assertActive();
      const intentReport = await this.fillIntents(page, intents);
      this.assertActive();
      const intentOk = intentReport.problems.length === 0;
      if (config.submitReview && intentOk) {
        this.emit("review", "正在提交审核…");
        await page.getByRole("button", { name: "提交审核", exact: true }).click();
        await page.waitForTimeout(1200);
      }
      const message = intentMessage(intentReport, config.submitReview);
      await this.checkpoints.clear();
      this.checkpoint = null;
      await this.saveSession();
      this.emit("completed", message, summary.plannedUploadCount, summary.plannedUploadCount);
      return { status: "completed", message };
    } catch (error: unknown) {
      if (this.cancelled || (error instanceof Error && error.message === "__CANCELLED__")) {
        const message = "任务已停止";
        this.emit("cancelled", message);
        return { status: "cancelled", message };
      }
      await this.saveSession();
      const info = describeAutomationError(error);
      const message = `${info.code}｜${info.message}`;
      this.emit("error", message, undefined, undefined, info);
      return { status: "error", message, error: info };
    } finally {
      this.loginResolver = null;
      this.renameResolver = null;
      this.checkpoint = null;
      this.verifyNextQuestion = false;
      this.running = false;
    }
  }

  /** The change list, minus recordings that were already uploaded to the same item in an earlier run. */
  private async planItems(data: Parameters<typeof buildModifyItems>[0], online: OnlineTalk, talkName: string): Promise<ModifyItem[]> {
    const tasks = tasksById(data);
    const sent = await this.sentAudio.get(talkName);
    return Promise.all(buildModifyItems(data, online).map(async (item) => {
      const task = tasks.get(item.id);
      if (!item.audioFile || item.status !== "changed" || !task || !sent[item.id]) return item;
      if ((await audioFingerprint(task.audioPath)) !== sent[item.id]) return item;
      const rest: ModifyItem = { ...item, audioFile: null, audioBasis: undefined, warnings: item.warnings.filter((warning) => !warning.includes("录音念的像")) };
      return rest.textChanged || rest.phrasesChanged ? rest : { ...rest, status: "same", selected: false };
    }));
  }

  /** Reads the existing talk (read-only), backs it up, and lists what the workbook and recordings would change. */
  async compare(config: UploadConfig): Promise<ModifyCompareResult> {
    if (this.running) return { ok: false, message: "已有任务正在运行，请等它结束" };
    this.running = true;
    this.cancelled = false;
    const fail = (message: string): ModifyCompareResult => {
      this.emit("blocked", message);
      return { ok: false, message };
    };
    try {
      const data = await loadData({ ...config, mode: "modify" }, this.loadOptions());
      const summary = buildPreview(data);
      if (!summary.canUpload) return fail(`Excel 有 ${summary.errorCount} 处错误，先在体检里改好`);
      if (summary.audioMatch.reviewCount) return fail(`还有 ${summary.audioMatch.reviewCount} 条录音需要确认`);
      this.emit("comparing", `正在打开探迹里的“${config.talkName}”…`);
      const page = await this.browserPage();
      await this.ensureLoggedIn(page);
      this.assertActive();
      const editor = await this.openTalk(page, config.talkName);
      if (!editor) return fail(`探迹里没有找到“${config.talkName}”，名字要和探迹里一模一样`);
      const online = await readTalk(editor, config.talkName, (message, current, total) => {
        this.assertActive();
        this.emit("comparing", message, current, total);
      });
      const backupPath = await saveBackup(this.userDataPath, online);
      const key = modifyKey(config);
      const done = await this.modifyProgress.done(key);
      const items = (await this.planItems(data, online, config.talkName)).map((item) => (done.has(item.id) && item.selected
        ? { ...item, selected: false, warnings: [...item.warnings, "上次已经改过"] }
        : item));
      this.modifySession = { key, online, page: editor };
      await this.saveSession();
      const count = items.filter((item) => item.selected).length;
      this.emit("ready", count ? `对比完成：${count} 处要改，改之前的内容已备份` : "对比完成：线上和表格一致，没有要改的");
      return { ok: true, plan: { talkName: config.talkName, readAt: online.readAt, backupPath, items, unusedFiles: summary.audioMatch.unusedFiles } };
    } catch (error: unknown) {
      if (this.cancelled || (error instanceof Error && error.message === "__CANCELLED__")) {
        this.emit("cancelled", "已停止对比");
        return { ok: false, message: "已停止对比" };
      }
      await this.saveSession();
      const info = describeAutomationError(error);
      this.emit("error", `${info.code}｜${info.message}`, undefined, undefined, info);
      return { ok: false, message: `${info.message}${info.suggestion}` };
    } finally {
      this.loginResolver = null;
      this.running = false;
    }
  }

  /** Applies only the ticked items of the last comparison to the talk online. */
  async modify(config: UploadConfig, ids: string[]): Promise<RunResult> {
    if (this.running) {
      const error = errorInfo("E-TASK-001", "已有任务正在运行。", "请等待当前任务结束，或先点击“停止任务”。", "AutomationEngine.modify called while another task was running");
      return { status: "error", message: `${error.code}｜${error.message}`, error };
    }
    this.running = true;
    this.cancelled = false;
    try {
      const session = this.modifySession;
      const key = modifyKey(config);
      if (!session || session.key !== key) {
        const info = errorInfo("E-MODIFY-001", "还没有和线上对比。", "请先点“开始对比”，确认修改清单后再改。", "modify called without a matching comparison");
        this.emit("blocked", `${info.code}｜${info.message}`, undefined, undefined, info);
        return { status: "error", message: `${info.code}｜${info.message}`, error: info };
      }
      const data = await loadData({ ...config, mode: "modify" }, this.loadOptions());
      const tasks = tasksById(data);
      const chosen = new Set(ids);
      const items = (await this.planItems(data, session.online, config.talkName))
        .filter((item) => chosen.has(item.id) && (item.status === "changed" || item.status === "new") && tasks.has(item.id));
      const prints = new Map<string, string>();
      for (const item of items.filter((entry) => entry.audioFile)) {
        const print = await audioFingerprint(tasks.get(item.id)!.audioPath);
        if (print) prints.set(item.id, print);
      }
      const conversionError = await this.convertAudio(
        items.filter((item) => item.audioFile).map((item) => tasks.get(item.id)!),
        config.audioDir,
      );
      if (conversionError) {
        this.emit("blocked", `${conversionError.code}｜${conversionError.message}`, undefined, undefined, conversionError);
        return { status: "error", message: `${conversionError.code}｜${conversionError.message}`, error: conversionError };
      }
      let page = session.page;
      if (page.isClosed() || !(await page.getByRole("button", { name: "主流程", exact: true }).isVisible().catch(() => false))) {
        page = await this.browserPage();
        await this.ensureLoggedIn(page);
        this.assertActive();
        const editor = await this.openTalk(page, config.talkName);
        if (!editor) throw new Error(`找不到上次的话术“${config.talkName}”`);
        page = editor;
        session.page = editor;
      }
      const category = session.online.categories.includes(config.categoryName)
        ? config.categoryName
        : session.online.categories[0] ?? (config.categoryName || "客户问答");
      const done = await this.modifyProgress.done(key);
      for (const [index, item] of items.entries()) {
        this.assertActive();
        const stage = item.kind;
        if (done.has(item.id)) {
          this.emit(stage, `${item.label}：上次已改好，跳过`, index + 1, items.length);
          continue;
        }
        this.emit(stage, `正在修改${item.label}：${modifySummary(item)}`, index + 1, items.length);
        const task = tasks.get(item.id)!;
        if (item.kind === "knowledge") {
          const question = task as AudioKnowledgeTask;
          if (item.status === "new") {
            await this.ensureKnowledgeCategory(page, category);
            await this.createQuestion(page, category, question);
          } else {
            await modifyQuestion(page, item, question);
          }
        } else {
          await modifyScene(page, item, task as AudioSpeechTask);
        }
        await this.modifyProgress.add(key, item.id);
        const print = prints.get(item.id);
        if (print) await this.sentAudio.add(config.talkName, item.id, print);
        this.emit(stage, `${item.label} 已改好`, index + 1, items.length);
      }
      this.assertActive();
      if (config.submitReview) {
        this.emit("review", "正在提交审核…");
        await page.getByRole("button", { name: "提交审核", exact: true }).click();
        await page.waitForTimeout(1200);
      }
      await this.modifyProgress.clear();
      this.modifySession = null;
      await this.saveSession();
      const message = `改好了 ${items.length} 处${config.submitReview ? "，已点击提交审核" : "，话术保留为编辑中"}`;
      this.emit("completed", message, items.length, items.length);
      return { status: "completed", message };
    } catch (error: unknown) {
      if (this.cancelled || (error instanceof Error && error.message === "__CANCELLED__")) {
        this.emit("cancelled", "任务已停止");
        return { status: "cancelled", message: "任务已停止" };
      }
      await this.saveSession();
      const info = describeAutomationError(error);
      const message = `${info.code}｜${info.message}`;
      this.emit("error", message, undefined, undefined, info);
      return { status: "error", message, error: info };
    } finally {
      this.loginResolver = null;
      this.running = false;
    }
  }

  /** Skips the login wait when the restored or still-open session already shows “我的话术”. */
  private async ensureLoggedIn(page: Page): Promise<void> {
    await this.openGraphs(page);
    const newTalk = page.getByRole("button", { name: "新建话术", exact: true });
    const loggedIn = await newTalk.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
    if (loggedIn || (await this.enterCallCenter() && await this.onGraphs(page))) {
      this.emit("launching", "探迹仍是登录状态，不用重新登录");
      await this.ensureCompany(page);
      return;
    }
    this.emit("login", "请在 Chrome 中登录探迹，登录后回到本工具确认");
    await new Promise<void>((resolve) => {
      this.loginResolver = resolve;
    });
    this.assertActive();
    await this.enterCallCenter();
    await this.openGraphs(page);
    await this.ensureCompany(page);
    await this.saveSession();
  }

  /** Talks live under the 客户成功 company; an account that entered through another company is switched over in the account menu. */
  private async ensureCompany(page: Page): Promise<void> {
    if ((await this.companyName(page))?.includes(CALL_COMPANY)) return;
    const switcher = await this.openAccountMenu(page);
    if (!switcher) return;
    const current = await switcher.evaluate((el) => el.parentElement?.innerText.split("\n")[0]?.trim() ?? "");
    if (current.includes(CALL_COMPANY)) {
      await restMouse(page);
      return;
    }
    this.emit("launching", `当前是“${current}”，正在切换到客户成功企业…`);
    await switcher.click();
    const options = page.locator(".ant-dropdown-menu-item").filter({ visible: true });
    await options.first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
    const exact = options.filter({ hasText: /^\s*客户成功企业\s*$/ });
    const option = (await exact.count()) ? exact.first() : options.filter({ hasText: CALL_COMPANY }).first();
    if (!(await option.count())) throw new Error(`切换企业的列表里没有“客户成功企业”，当前是“${current}”`);
    await option.click();
    await page.waitForTimeout(3000);
    await this.openGraphs(page);
    await restMouse(page);
    const switched = await this.companyName(page);
    if (switched && !switched.includes(CALL_COMPANY)) throw new Error(`没能切换到客户成功企业，当前还是“${switched}”`);
  }

  /** Hovers the account menu at the right end of the top bar until its 切换企业 row shows. */
  private async openAccountMenu(page: Page): Promise<Locator | null> {
    const switcher = page.getByText("切换企业", { exact: true }).filter({ visible: true }).first();
    const width = await page.evaluate(() => innerWidth);
    for (let offset = 30; offset <= 240; offset += 30) {
      await page.mouse.move(width - offset, 30);
      if (await switcher.waitFor({ state: "visible", timeout: 1200 }).then(() => true, () => false)) return switcher;
    }
    await restMouse(page);
    return null;
  }

  private companyName(page: Page): Promise<string | null> {
    return page.evaluate(async () => {
      const response = await fetch("/common-api/company/info", { credentials: "include" });
      if (!response.ok) return null;
      const info = await response.json() as { name?: unknown };
      return typeof info.name === "string" ? info.name : null;
    }).catch(() => null);
  }

  private async onGraphs(page: Page): Promise<boolean> {
    await this.openGraphs(page);
    return page.getByRole("button", { name: "新建话术", exact: true }).waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false);
  }

  /** The call center only grants access when entered from a company's 探迹智能呼叫 on the Tungee home page. */
  private async enterCallCenter(): Promise<boolean> {
    for (const home of this.context?.pages() ?? []) {
      if (home.isClosed() || !home.url().includes("tungee.com")) continue;
      const marked = await home.evaluate(() => {
        const entries = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => el.children.length === 0 && el.textContent?.trim() === "探迹智能呼叫" && el.offsetParent);
        const companyOf = (entry: HTMLElement): string => {
          let card = entry;
          while (card.parentElement && entries.filter((other) => card.parentElement!.contains(other)).length === 1) card = card.parentElement;
          return card.innerText;
        };
        const chosen = entries.find((entry) => companyOf(entry).includes("客户成功企业"))
          ?? entries.find((entry) => companyOf(entry).includes("客户成功"))
          ?? (entries.length === 1 ? entries[0] : undefined);
        chosen?.setAttribute("data-tungee-entry", "");
        return Boolean(chosen);
      }).catch(() => false);
      if (!marked) continue;
      this.emit("launching", "正在进入探迹智能呼叫…");
      await home.locator("[data-tungee-entry]").first().click();
      for (let waited = 0; waited < 30000; waited += 500) {
        if (this.context?.pages().some((item) => !item.isClosed() && item.url().startsWith("https://call.tungee.com/"))) break;
        await home.waitForTimeout(500);
      }
      await home.waitForTimeout(1500);
      return true;
    }
    return false;
  }

  /** Searches “我的话术” for the talk and opens its editor; null when no row has exactly this name. */
  private async openTalk(page: Page, talkName: string): Promise<Page | null> {
    this.emit("launching", `正在找到话术“${talkName}”并打开编辑…`);
    await this.openGraphs(page);
    const search = page.getByPlaceholder("请输入话术名称", { exact: true });
    await search.waitFor({ state: "visible", timeout: 30000 });
    await search.fill(talkName);
    await search.press("Enter");
    const row = page.locator("tr").filter({ has: page.getByText(talkName, { exact: true }) }).filter({ visible: true }).first();
    if (!(await row.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false))) return null;
    const popup = page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = (target: Page) => target.getByRole("button", { name: "主流程", exact: true });
    const outcome = await Promise.race([
      editor(page).waitFor({ state: "visible", timeout: 60000 }).then(() => page),
      popup.then((opened) => opened ?? new Promise<never>(() => undefined)),
    ]);
    await editor(outcome).waitFor({ state: "visible", timeout: 60000 });
    return outcome;
  }

  private async openGraphs(page: Page): Promise<void> {
    try {
      await page.goto("https://call.tungee.com/graphs", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (error: unknown) {
      if (!(error instanceof Error) || !error.message.includes("Timeout")) throw error;
    }
    await page.waitForTimeout(1200);
  }

  /** Creates the talk; if the name is taken, waits for a new name to retry with, or for the choice to continue the existing talk. */
  private async createTalk(page: Page, talkName: string): Promise<{ name: string; existing: boolean }> {
    this.assertActive();
    const newTalk = page.getByRole("button", { name: "新建话术", exact: true });
    if (!(await newTalk.count())) {
      throw new Error(`登录后未进入“我的话术”页面，当前地址：${page.url()}`);
    }
    this.emit("launching", `正在创建话术“${talkName}”…`);
    await newTalk.click();
    const nameInput = page.getByPlaceholder(TALK_NAME_PLACEHOLDER, { exact: true });
    await nameInput.fill(talkName);
    await page.getByRole("radio", { name: "人工录音", exact: true }).check();
    const editor = page.getByRole("button", { name: "主流程", exact: true });
    const duplicate = page.getByText(DUPLICATE_NAME).filter({ visible: true }).first();
    let name = talkName;
    for (;;) {
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      const outcome = await creationOutcome(editor, duplicate, nameInput);
      if (outcome === "created") return { name, existing: false };
      if (outcome === "timeout") {
        const notice = await pageNotice(page);
        throw new Error(notice ? `创建话术没有成功，探迹提示：${notice}` : "创建话术等了 60 秒还没进入编辑页（Timeout）");
      }
      this.emit("rename", `探迹里已经有“${name}”了：是上次没传完的就接着传，否则换个名字`);
      const choice = await new Promise<string | null>((resolve) => {
        this.renameResolver = resolve;
      });
      this.assertActive();
      if (choice === null) return { name, existing: true };
      if (await editor.isVisible().catch(() => false) || !(await nameInput.isVisible().catch(() => false))) {
        await editor.waitFor({ state: "visible", timeout: 30000 });
        this.emit("launching", `“${name}”其实已经创建好了，就用这个名字接着传`);
        return { name, existing: false };
      }
      name = choice;
      await nameInput.fill(name);
      await nameInput.press("Tab").catch(() => undefined);
      this.emit("launching", `正在用新名字“${name}”创建话术…`);
    }
  }

  private async fillSection(
    page: Page,
    sectionName: string,
    tasks: AudioSpeechTask[],
    offset: number,
    total: number,
  ): Promise<void> {
    if (!tasks.length) return;
    await page.getByRole("button", { name: sectionName, exact: true }).click();
    await page.waitForTimeout(900);
    await this.fillIndependentCards(page, "flow", sectionName, tasks, offset, total);
  }

  private async fillVague(page: Page, tasks: AudioSpeechTask[]): Promise<void> {
    if (!tasks.length) return;
    await page.getByRole("button", { name: "含糊话术", exact: true }).click();
    await page.waitForTimeout(900);
    await this.fillIndependentCards(page, "vague", "含糊话术", tasks, 0, tasks.length);
  }

  private async fillIndependentCards(
    page: Page,
    stage: "flow" | "vague",
    pageName: string,
    tasks: AudioSpeechTask[],
    offset: number,
    total: number,
  ): Promise<void> {
    const headings = page.getByText("话术01：", { exact: true }).filter({ visible: true });
    await headings.first().waitFor({ state: "visible", timeout: 60000 });
    const cardCount = await headings.count();
    if (cardCount < tasks.length) {
      throw new Error(`${pageName}只有 ${cardCount} 个独立场景卡片，但 Excel 有 ${tasks.length} 条任务`);
    }
    for (let index = 0; index < tasks.length; index += 1) {
      this.assertActive();
      const task = tasks[index];
      if (!task) continue;
      const current = offset + index + 1;
      const label = `${pageName}第 ${index + 1} 个场景`;
      if (this.checkpoint?.scenes.includes(task.audioNumber)) {
        this.emit(stage, `${label}：上次已完成，跳过`, current, total);
        continue;
      }
      this.emit(stage, `${label}：正在保存文本`, current, total);
      const heading = headings.nth(index);
      const answerBlock = heading.locator("xpath=../..");
      await heading.scrollIntoViewIfNeeded();
      const editButton = answerBlock.getByRole("button", { name: "编辑", exact: true });
      const fileInput = answerBlock.locator('input[type="file"]');
      if (!(await editButton.count()) || !(await fileInput.count())) {
        throw new Error(`${label}未找到对应编辑框或录音文件输入框`);
      }
      await editButton.click();
      const editor = answerBlock.getByPlaceholder("请输入文本", { exact: true });
      await editor.waitFor({ state: "visible", timeout: 30000 });
      await editor.fill(task.speech);
      await answerBlock.getByRole("button", { name: "保 存", exact: true }).click();
      await editor.waitFor({ state: "hidden", timeout: 60000 });
      await page.waitForTimeout(1200);
      if (!task.audioExists) {
        await this.markDone(task.audioNumber);
        this.emit(stage, `${label}缺少 ${task.audioNumber}.wav，已保存文本并跳过录音`, current, total);
        continue;
      }
      const audioName = path.basename(task.audioPath);
      const uploadedName = answerBlock.getByText(audioName, { exact: true });
      const alreadyUploaded = (await uploadedName.count()) > 0 && await uploadedName.first().isVisible();
      if (!alreadyUploaded) {
        await fileInput.first().setInputFiles(task.audioPath);
        await uploadedName.first().waitFor({ state: "visible", timeout: 90000 });
        await answerBlock.getByRole("button", { name: /重新上传/ }).first().waitFor({ state: "visible", timeout: 90000 });
      }
      await page.waitForTimeout(1800);
      await this.markDone(task.audioNumber);
      this.emit(stage, `${label}：${audioName} 已确认上传`, current, total);
    }
  }

  private knowledgeCategory(page: Page, categoryName: string) {
    return page.getByText(categoryName, { exact: true }).first().locator("xpath=..");
  }

  private async ensureKnowledgeCategory(page: Page, categoryName: string): Promise<void> {
    await page.getByRole("button", { name: "知识库", exact: true }).click();
    await page.getByPlaceholder("搜索问题名称", { exact: true }).waitFor({ state: "visible", timeout: 60000 });
    let category = this.knowledgeCategory(page, categoryName);
    if (await category.count()) return;
    await page.getByRole("button", { name: "新建分类", exact: true }).click();
    const categoryInput = page.getByPlaceholder("请输入少于10个字符的分类名称", { exact: true });
    await categoryInput.fill(categoryName);
    await page.getByRole("button", { name: "确 定", exact: true }).click({ force: true });
    await categoryInput.waitFor({ state: "hidden", timeout: 30000 });
    category = this.knowledgeCategory(page, categoryName);
    await category.waitFor({ state: "visible", timeout: 30000 });
  }

  private async knowledgeExists(page: Page, question: string): Promise<boolean> {
    const search = page.getByPlaceholder("搜索问题名称", { exact: true });
    await search.fill(question);
    await search.press("Enter");
    await page.waitForTimeout(1200);
    const found = await page.getByText(question, { exact: true }).filter({ visible: true }).count() > 0;
    await search.fill("");
    await search.press("Enter");
    await page.waitForTimeout(800);
    return found;
  }

  private async fillKnowledge(page: Page, categoryName: string, tasks: AudioKnowledgeTask[]): Promise<void> {
    if (!tasks.length) return;
    await this.ensureKnowledgeCategory(page, categoryName);
    for (let index = 0; index < tasks.length; index += 1) {
      this.assertActive();
      const task = tasks[index];
      if (!task) continue;
      if (this.checkpoint?.questions.some((item) => item.question === task.question)) {
        this.emit("knowledge", `${task.question}：上次已完成，跳过`, index + 1, tasks.length);
        continue;
      }
      if (this.checkpoint?.unknownProgress || this.verifyNextQuestion) {
        this.verifyNextQuestion = false;
        if (await this.knowledgeExists(page, task.question)) {
          await this.markDone(undefined, { question: task.question, audioNumber: task.audioNumber });
          this.emit("knowledge", `${task.question}：探迹里已有，跳过`, index + 1, tasks.length);
          continue;
        }
      }
      this.emit("knowledge", `正在新增知识库：${task.question}`, index + 1, tasks.length);
      await this.createQuestion(page, categoryName, task);
      await this.markDone(undefined, { question: task.question, audioNumber: task.audioNumber });
      this.emit("knowledge", `${task.question} / ${path.basename(task.audioPath)} 已保存`, index + 1, tasks.length);
    }
  }

  private async createQuestion(page: Page, categoryName: string, task: AudioKnowledgeTask): Promise<void> {
    const category = this.knowledgeCategory(page, categoryName);
    await category.getByRole("button", { name: "新建问题", exact: true }).click();
    const heading = page.getByRole("heading", { name: "新建问题", exact: true });
    await heading.waitFor({ state: "visible", timeout: 30000 });
    const form = heading.locator("xpath=..");
    await form.getByPlaceholder("20个字以内", { exact: true }).fill(task.question);
    await form.getByPlaceholder("控制在100个字以内用户最愿意听下去哦～最多不能超过200个字～", { exact: true }).fill(task.answer);
    const commonQuestionRow = form.locator("label").filter({ hasText: "常用问法" }).first().locator("xpath=../..");
    const commonQuestionInput = commonQuestionRow.locator("input").first();
    await commonQuestionInput.fill(normalizeCommonQuestions(task.question, task.commonQuestions));
    await commonQuestionInput.press("Enter");
    if (task.invalidQa) await form.getByRole("checkbox", { name: /无效QA/ }).check();
    if (task.specialQa) await form.getByRole("checkbox", { name: /特殊QA/ }).check();
    const audioName = path.basename(task.audioPath);
    await form.locator('input[type="file"]').first().setInputFiles(task.audioPath);
    await form.getByText(audioName, { exact: true }).first().waitFor({ state: "visible", timeout: 90000 });
    await form.getByRole("button", { name: /重新上传/ }).first().waitFor({ state: "visible", timeout: 90000 });
    await page.waitForTimeout(1800);
    await form.getByRole("button", { name: "保 存", exact: true }).click();
    await heading.waitFor({ state: "hidden", timeout: 60000 });
    await this.knowledgeCategory(page, categoryName).waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(900);
  }
}
