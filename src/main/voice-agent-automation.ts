import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { chromeProfileDir } from "./storage";
import { describeAutomationError } from "./automation";
import { loadVoiceAgentPreview, mergeAgentFields, readHotwords, readIntents } from "./voice-agent-pack";
import type { AppErrorInfo, ProgressEvent, ProgressStage, RunResult } from "../shared/types";
import type {
  VoiceAgentConfig,
  VoiceAgentEntryOption,
  VoiceAgentFields,
  VoiceAgentIntentItem,
  VoiceAgentPackSummary,
  VoiceAgentPreview,
} from "../shared/voice-agent";

const SESSION_FILE = "tungee-session.json";
const HOME = "https://user.tungee.com/";
const AGENT_HOME = "https://call-agent.tungee.com/agents";
const NAV_URL: Record<string, string> = {
  智能体: AGENT_HOME,
  知识库: "https://call-agent.tungee.com/creation/knowledge",
  热词: "https://call-agent.tungee.com/creation/hotwords",
  意图配置: "https://call-agent.tungee.com/creation/intention",
  意图: "https://call-agent.tungee.com/creation/intention",
  音色: "https://call-agent.tungee.com/creation/timbre",
};
const MUST_UPDATE = ["询问价格", "已有供应商", "接受资料", "有采购计划", "安排演示"];

interface SavedSession {
  cookies: Parameters<BrowserContext["addCookies"]>[0];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

type ProgressEmitter = (event: ProgressEvent) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VoiceAgentEngine {
  private context: BrowserContext | null = null;
  private running = false;
  private cancelled = false;
  private loginResolver: (() => void) | null = null;
  private entryResolver: ((index: number) => void) | null = null;
  private pasteResolver: (() => void) | null = null;
  private entries: VoiceAgentEntryOption[] = [];

  constructor(
    private readonly userDataPath: string,
    private readonly emitEvent: ProgressEmitter,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get entryOptions(): VoiceAgentEntryOption[] {
    return this.entries;
  }

  private get sessionFile(): string {
    return path.join(chromeProfileDir(this.userDataPath), SESSION_FILE);
  }

  private emit(stage: ProgressStage, message: string, current?: number, total?: number, error?: AppErrorInfo): void {
    this.emitEvent({ stage, message, current, total, timestamp: new Date().toISOString(), error });
  }

  private assertActive(): void {
    if (this.cancelled) throw new Error("__CANCELLED__");
  }

  confirmLogin(): boolean {
    if (!this.loginResolver) return false;
    const resolve = this.loginResolver;
    this.loginResolver = null;
    resolve();
    return true;
  }

  pickEntry(index: number): boolean {
    if (!this.entryResolver) return false;
    const resolve = this.entryResolver;
    this.entryResolver = null;
    resolve(index);
    return true;
  }

  confirmPaste(): boolean {
    if (!this.pasteResolver) return false;
    const resolve = this.pasteResolver;
    this.pasteResolver = null;
    resolve();
    return true;
  }

  async cancel(): Promise<boolean> {
    if (!this.running) return false;
    this.cancelled = true;
    this.confirmLogin();
    this.pickEntry(0);
    this.confirmPaste();
    await this.saveSession();
    if (this.context) {
      await this.closeContext();
      this.context = null;
    }
    return true;
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
    this.pickEntry(0);
    this.confirmPaste();
    await this.saveSession();
    if (this.context) await this.closeContext();
    this.context = null;
  }

  async preview(config: VoiceAgentConfig): Promise<VoiceAgentPreview> {
    this.emit("reading", "正在核对交付包…");
    const preview = await loadVoiceAgentPreview(config, path.join(this.userDataPath, "voice-agent-unpack"));
    if (preview.canUpload) this.emit("ready", `交付包通过：${preview.pack?.companyName ?? ""}`);
    else this.emit("blocked", `交付包有 ${preview.errorCount} 处不合格`);
    return preview;
  }

  async run(config: VoiceAgentConfig, entryIndex?: number): Promise<RunResult> {
    if (this.running) throw new Error("已有语音 Agent 任务在运行");
    this.running = true;
    this.cancelled = false;
    this.loginResolver = null;
    this.entryResolver = null;
    this.pasteResolver = null;
    this.entries = [];
    try {
      this.emit("reading", "正在读取交付包…");
      const preview = await loadVoiceAgentPreview(config, path.join(this.userDataPath, "voice-agent-unpack"));
      if (!preview.canUpload || !preview.pack) {
        const info = preview.issues[0];
        const error: AppErrorInfo = {
          code: info?.code ?? "E-VOICE-002",
          message: info?.message ?? "交付包不合格。",
          suggestion: info?.suggestion ?? "按提示补齐后再开始。",
        };
        this.emit("error", `${error.code}｜${error.message}`, undefined, undefined, error);
        return { status: "error", message: `${error.code}｜${error.message}`, error };
      }
      const pack = preview.pack;
      pack.agent = mergeAgentFields(pack.agent, config.agent);
      pack.companyName = pack.agent.companyName || pack.companyName;
      this.emit("launching", "正在打开 Chrome…");
      const page = await this.browserPage();
      await this.ensureLoggedIn(page);
      this.assertActive();
      await this.openVoiceAgent(page, entryIndex);
      this.assertActive();
      const existed = await this.agentExists(page, pack.agent.name);
      if (existed) {
        this.emit("creating", `列表里已有「${pack.agent.name}」，跳过创建，继续配置`);
      } else {
        const unused = await this.readUnused(page);
        this.emit("quota", unused == null ? "没有读到未使用额度，继续尝试创建" : `未使用额度 ${unused}`);
        if (unused === 0) {
          const error: AppErrorInfo = {
            code: "E-VOICE-QUOTA-001",
            message: "未使用额度为 0，不能创建智能体。",
            suggestion: "当前企业没有可用额度。换一家有额度的企业后再试，不要用本工具切换企业。",
          };
          this.emit("error", `${error.code}｜${error.message}`, undefined, undefined, error);
          return { status: "error", message: `${error.code}｜${error.message}`, error };
        }
        await this.createAgent(page, pack.agent);
        this.assertActive();
      }
      try {
        await this.uploadKnowledgeAndHotwords(page, pack);
      } catch (error) {
        this.emit("personalize", `知识库/热词入库未完成，继续挂载：${error instanceof Error ? error.message : String(error)}`);
        await this.waitOverlaysGone(page);
      }
      this.assertActive();
      await this.attachOnEditPage(page, pack);
      this.assertActive();
      try {
        await this.updateIntents(page, pack.rootDir);
      } catch (error) {
        this.emit("intent", `意图配置未完成：${error instanceof Error ? error.message : String(error)}`);
        await this.waitOverlaysGone(page);
      }
      this.assertActive();
      this.emit("paste", "后台提示词已准备好，请复制后自行粘贴。第一版不自动打开后台页。");
      await new Promise<void>((resolve) => {
        this.pasteResolver = resolve;
      });
      this.assertActive();
      await this.saveSession();
      const message = existed
        ? `「${pack.agent.name}」已配置。后台提示词请自行粘贴。`
        : `「${pack.agent.name}」已创建。后台提示词请自行粘贴。`;
      this.emit("completed", message);
      return { status: "completed", message };
    } catch (error: unknown) {
      if (this.cancelled || (error instanceof Error && error.message === "__CANCELLED__")) {
        this.emit("cancelled", "任务已停止");
        return { status: "cancelled", message: "任务已停止" };
      }
      await this.saveSession();
      const info = describeVoiceAgentError(error);
      const message = `${info.code}｜${info.message}`;
      this.emit("error", message, undefined, undefined, info);
      return { status: "error", message, error: info };
    } finally {
      this.loginResolver = null;
      this.entryResolver = null;
      this.pasteResolver = null;
      this.running = false;
    }
  }

  private async saveSession(): Promise<void> {
    if (!this.context) return;
    try {
      const state = await this.context.storageState();
      const origins = state.origins.filter((item) => item.origin.includes("tungee.com"));
      const cookies = state.cookies.filter((cookie) => cookie.domain.includes("tungee.com"));
      await fs.writeFile(this.sessionFile, JSON.stringify({ cookies, origins } satisfies SavedSession), "utf8");
    } catch {
      // Keep the previous session file.
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

  private async closeContext(): Promise<void> {
    await this.context?.close().catch(() => undefined);
  }

  /** Stays on the current company. Never switches to 客户成功企业. */
  private async ensureLoggedIn(page: Page): Promise<void> {
    if (!page.url().includes("tungee.com")) {
      await page.goto(HOME, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    if (await this.looksLoggedIn(page)) {
      this.emit("launching", "探迹仍是登录状态，不用重新登录。当前企业不切换。");
      return;
    }
    this.emit("login", "请在 Chrome 中登录探迹，登录后回到本工具确认。不要切换企业。");
    await new Promise<void>((resolve) => {
      this.loginResolver = resolve;
    });
    this.assertActive();
    await this.saveSession();
  }

  private async looksLoggedIn(page: Page): Promise<boolean> {
    const probes = [
      page.getByText("探迹语音Agent", { exact: true }),
      page.getByText("切换企业", { exact: true }),
      page.getByText("未使用", { exact: true }),
      page.getByRole("button", { name: /创建智能体/ }),
    ];
    for (const probe of probes) {
      if (await probe.first().isVisible().catch(() => false)) return true;
    }
    return /call-agent\.tungee\.com/.test(page.url());
  }

  private voiceWorkspace(from: Page): Page {
    return this.context?.pages().find((item) => !item.isClosed() && /call-agent\.tungee\.com/.test(item.url())) ?? from;
  }

  /** Default landing is /workspace. 智能体 list is /agents — do not click the composer 「智能体」 button. */
  private async openAgentTab(page: Page): Promise<boolean> {
    this.emit("launching", "正在打开「智能体」…");
    await this.waitOverlaysGone(page);
    await page.goto(AGENT_HOME, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => undefined);
    await page.waitForURL(/call-agent\.tungee\.com\/agents(?!\/edit)/, { timeout: 15000 }).catch(() => undefined);
    await page.getByRole("button", { name: /创建智能体/ }).or(page.getByRole("button", { name: "更多操作", exact: true })).first()
      .waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    await sleep(500);
    return this.onAgentHome(page);
  }

  private async openVoiceAgent(page: Page, preset?: number): Promise<void> {
    const existing = this.voiceWorkspace(page);
    if (/call-agent\.tungee\.com/.test(existing.url()) && await this.openAgentTab(existing)) return;
    const tungeePage = this.context?.pages().find((item) => !item.isClosed() && item.url().includes("tungee.com")) ?? page;
    if (!tungeePage.url().includes("tungee.com")) await tungeePage.goto(HOME, { waitUntil: "domcontentloaded" });
    this.entries = await this.collectEntries(tungeePage);
    if (this.entries.length === 0) {
      await tungeePage.goto(HOME, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await sleep(1500);
      this.entries = await this.collectEntries(tungeePage);
    }
    if (await this.onAgentHome(tungeePage)) return;
    if (this.entries.length === 0) throw new Error("页面上找不到「探迹语音Agent」");
    let index = preset ?? 0;
    if (this.entries.length > 1 && preset === undefined) {
      this.emit("entry", `找到 ${this.entries.length} 个「探迹语音Agent」，请选择要进入的那一个`);
      index = await new Promise<number>((resolve) => {
        this.entryResolver = resolve;
      });
      this.assertActive();
    }
    const chosen = this.entries[index] ?? this.entries[0];
    if (!chosen) throw new Error("页面上找不到「探迹语音Agent」");
    this.emit("launching", `正在进入「${chosen.label}」…`);
    await tungeePage.locator(`[data-voice-agent-entry="${chosen.index}"]`).first().click();
    const deadline = Date.now() + 30000;
    let openedTab = false;
    while (Date.now() < deadline) {
      this.assertActive();
      const current = this.voiceWorkspace(tungeePage);
      if (/call-agent\.tungee\.com/.test(current.url())) {
        if (!openedTab) {
          openedTab = true;
          await this.openAgentTab(current);
        }
        if (await this.onAgentHome(current)) return;
      }
      await sleep(500);
    }
    throw new Error("进入探迹语音Agent 后，点开「智能体」仍没有看到创建入口");
  }

  private async collectEntries(page: Page): Promise<VoiceAgentEntryOption[]> {
    return page.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => (
        el.children.length === 0 && el.textContent?.trim() === "探迹语音Agent" && Boolean(el.offsetParent)
      ));
      return nodes.map((el, index) => {
        let card: HTMLElement = el;
        while (card.parentElement) {
          const parent = card.parentElement;
          const count = [...parent.querySelectorAll("*")].filter((node) => (
            (node as HTMLElement).children.length === 0 && node.textContent?.trim() === "探迹语音Agent"
          )).length;
          if (count > 1) break;
          card = parent;
        }
        el.setAttribute("data-voice-agent-entry", String(index));
        const label = card.innerText.split("\n").map((line) => line.trim()).find((line) => line && line !== "探迹语音Agent") ?? `第 ${index + 1} 个`;
        return { index, label: label.slice(0, 40) };
      });
    }).catch(() => [] as VoiceAgentEntryOption[]);
  }

  private async onAgentHome(page: Page): Promise<boolean> {
    if (/call-agent\.tungee\.com\/agents(\/)?(\?|$)/.test(page.url()) && !/\/agents\/edit/.test(page.url())) return true;
    return page.getByRole("button", { name: /创建智能体/ }).first().isVisible().catch(() => false)
      || page.getByText("未使用", { exact: true }).first().isVisible().catch(() => false)
      || page.getByRole("button", { name: "更多操作", exact: true }).first().isVisible().catch(() => false);
  }

  private async agentExists(page: Page, name: string): Promise<boolean> {
    if (!name) return false;
    // Do not fill the page 「搜索」 box — on /agents it is not a reliable agent filter and hides 更多操作.
    return page.getByText(name, { exact: true }).filter({ visible: true }).count().then((n) => n > 0);
  }

  private async readUnused(page: Page): Promise<number | null> {
    return page.evaluate(() => {
      let found: number | null = null;
      for (const node of document.querySelectorAll<HTMLElement>("body *")) {
        if (!node.offsetParent) continue;
        const text = (node.innerText ?? "").replace(/\s+/g, " ").trim();
        const match = text.match(/未使用\s+(\d+)/);
        if (!match || text.length > 160) continue;
        found = Number(match[1]);
        if (text.length < 40) return found;
      }
      return found;
    }).catch(() => null);
  }

  private async createAgent(page: Page, agent: VoiceAgentFields): Promise<void> {
    this.emit("creating", `正在创建智能体「${agent.name}」…`);
    await page.getByRole("button", { name: /创建智能体/ }).first().click();
    const nameBox = page.getByPlaceholder(/请输入智能体名称/);
    await nameBox.waitFor({ state: "visible", timeout: 20000 });
    await nameBox.fill(agent.name);
    await page.getByPlaceholder(/请输入企业对外名称/).fill(agent.companyName);
    if (agent.selfName) await page.getByPlaceholder(/请输入智能体对外自称/).fill(agent.selfName);
    await this.clickButton(page, agent.role || "业务顾问");
    if ((agent.role === "其他" || agent.role.includes("其他")) && agent.customRole) {
      await this.fillLabeled(page, "自定义角色", agent.customRole);
    }
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByText("选择外呼场景", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    if (agent.scene) await this.clickButton(page, agent.scene);
    if (agent.goal) await this.clickButton(page, agent.goal);
    if (agent.companyInfo) {
      const info = page.getByText("公司信息", { exact: true }).locator("xpath=following::textarea[1]");
      await info.waitFor({ state: "visible", timeout: 8000 });
      await info.fill(agent.companyInfo);
    }
    await page.getByRole("button", { name: "创建智能体", exact: true }).click();
    this.emit("generating", "智能体生成中，请勿关闭页面（大约 1–2 分钟）");
    const generating = page.getByText(/智能体生成中，请勿关闭页面|智能体生成中/);
    await generating.waitFor({ state: "visible", timeout: 30000 }).catch(() => undefined);
    await generating.waitFor({ state: "hidden", timeout: 180000 });
    this.assertActive();
  }

  private hotwordFileName(company: string): string {
    const raw = `${company}热词`.slice(0, 60);
    return [...raw].length >= 4 ? raw : `热词-${raw}`.slice(0, 60);
  }

  private usesFrontendOpening(agent: VoiceAgentFields): boolean {
    return !agent.opening || agent.opening.includes("前端已配置");
  }

  private async uploadKnowledgeAndHotwords(page: Page, pack: VoiceAgentPackSummary): Promise<void> {
    this.emit("personalize", "正在上传知识库和热词…");
    await this.waitOverlaysGone(page);
    await this.openNav(page, "个性化").catch(() => undefined);
    await this.openNav(page, "知识库");
    await page.getByRole("heading", { name: "知识库" }).or(page.getByText("个知识库")).first()
      .waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    const created = page.getByRole("button", { name: /新建/ }).first();
    if (await created.isVisible().catch(() => false)) await created.click();
    await this.clickText(page, "文件");
    await page.getByText("添加文件", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    const files = pack.knowledgeFiles.map((item) => item.path);
    if (files.length) await this.setFiles(page, files);
    await sleep(800);
    await this.confirmDialog(page);
    await page.getByText("添加文件", { exact: true }).first().waitFor({ state: "hidden", timeout: 20000 }).catch(() => undefined);
    await this.waitOverlaysGone(page);
    await this.openNav(page, "热词");
    const hotwordName = this.hotwordFileName(pack.companyName);
    if (await page.getByText(hotwordName, { exact: true }).first().isVisible().catch(() => false)) {
      this.emit("personalize", `热词「${hotwordName}」已在库里，跳过新建`);
    } else {
      await page.getByRole("button", { name: /添加文件/ }).filter({ visible: true }).first().click({ timeout: 15000 });
      await page.getByText("添加热词文件", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
      await this.fillLabeled(page, "文件名称", hotwordName);
      const hotwords = await readHotwords(pack.rootDir);
      await this.fillLabeled(page, "热词内容", hotwords);
      await this.confirmDialog(page);
      await page.getByText("添加热词文件", { exact: true }).waitFor({ state: "hidden", timeout: 20000 }).catch(() => undefined);
    }
    await this.waitOverlaysGone(page);
  }

  private async attachOnEditPage(page: Page, pack: VoiceAgentPackSummary): Promise<void> {
    this.emit("attach", "正在回到编辑页：音色第一项、通话 3 分钟、挂载知识库和热词");
    await this.waitOverlaysGone(page);
    if (!(await this.onEditPage(page))) {
      await this.openNav(page, "智能体");
      await this.openAgentEdit(page, pack.agent.name);
    }
    await page.getByText("最大通话时长", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    if (pack.agent.greeting) await this.fillLabeled(page, "问候语", pack.agent.greeting);
    if (!this.usesFrontendOpening(pack.agent) && pack.agent.opening) {
      await this.fillLabeled(page, "开场白", pack.agent.opening);
    }
    await this.pickFirstVoice(page);
    await this.pickDuration(page);
    try {
      await this.attachKnowledge(page, pack.knowledgeFiles.map((item) => item.name));
    } catch (error) {
      this.emit("attach", `知识库挂载未完成，继续热词和意图：${error instanceof Error ? error.message : String(error)}`);
    }
    await this.waitOverlaysGone(page);
    try {
      await this.attachHotword(page, this.hotwordFileName(pack.companyName));
    } catch (error) {
      this.emit("attach", `热词挂载未完成，继续意图：${error instanceof Error ? error.message : String(error)}`);
    }
    await this.waitOverlaysGone(page);
    const submit = page.getByRole("button", { name: /提\s*交/ }).filter({ visible: true }).first();
    if (await submit.isVisible().catch(() => false)) await this.safeClick(submit);
    await sleep(800);
  }

  private async onEditPage(page: Page): Promise<boolean> {
    if (/\/agents\/edit/.test(page.url())) return true;
    return page.getByText("最大通话时长", { exact: true }).first().isVisible().catch(() => false);
  }

  private async openAgentEdit(page: Page, name: string): Promise<void> {
    await this.waitOverlaysGone(page);
    if (await this.onEditPage(page)) return;
    const named = page.getByText(name, { exact: true }).filter({ visible: true });
    const count = await named.count();
    if (count > 1) throw new Error(`列表里有 ${count} 个「${name}」，请先只留一个再继续。`);
    if (count === 0) throw new Error(`列表里找不到「${name}」`);
    const more = named.first().locator("xpath=following::*[contains(@class,'moreButton')][1]");
    await this.safeClick(more);
    await sleep(300);
    const edit = page.getByRole("menuitem", { name: "编辑", exact: true });
    await edit.waitFor({ state: "visible", timeout: 8000 });
    await this.safeClick(edit);
    await page.getByText("最大通话时长", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
  }

  private async pickFirstVoice(page: Page): Promise<void> {
    await this.dismissOverlays(page);
    const already = page.getByText(/^(女声|男声|客服)-/).filter({ visible: true }).first();
    if (await already.isVisible().catch(() => false) && !(await page.getByText("请选择音色", { exact: true }).isVisible().catch(() => false))) {
      return;
    }
    const select = page.locator(".engage-agent-select").filter({ hasText: "请选择音色" }).first();
    const combo = page.getByRole("combobox").filter({ visible: true }).last();
    if (await select.isVisible().catch(() => false)) await this.safeClick(select);
    else if (await combo.isVisible().catch(() => false)) await this.safeClick(combo);
    else return;
    await sleep(400);
    const option = page.getByRole("option").filter({ visible: true }).filter({ hasNotText: "创建音色" }).first()
      .or(page.locator("[class*='select-item']").filter({ hasText: /女声|男声|客服/ }).filter({ hasNotText: "创建音色" }).first())
      .or(page.getByText(/^(女声|男声|客服)-/).filter({ visible: true }).first());
    await this.safeClick(option);
  }

  private async pickDuration(page: Page): Promise<void> {
    const option = page.getByRole("button", { name: "3 分钟", exact: true }).filter({ visible: true }).first();
    if (await option.isVisible().catch(() => false)) await option.click();
  }

  private knowledgePicker(page: Page) {
    return page.getByRole("dialog").filter({ hasText: "选择知识库" })
      .or(page.locator(".engage-agent-modal-wrap").filter({ hasText: "选择知识库" }))
      .or(page.locator(".engage-agent-modal-root").filter({ hasText: "选择知识库" }))
      .first();
  }

  private async waitOverlaysGone(page: Page): Promise<void> {
    await this.dismissOverlays(page);
    const title = page.getByText("选择知识库", { exact: true });
    if (await title.isVisible().catch(() => false)) {
      const panel = this.knowledgePicker(page);
      await panel.getByRole("button", { name: /取\s*消/ }).last().click({ force: true }).catch(() => undefined);
      await sleep(250);
      await page.keyboard.press("Escape").catch(() => undefined);
      await sleep(250);
    }
    await this.knowledgePicker(page).waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
    await page.locator(".engage-agent-modal-wrap, .engage-agent-modal-root").filter({ visible: true }).first()
      .waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
    await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    await page.getByText("添加文件", { exact: true }).first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    await page.getByText("添加热词文件", { exact: true }).first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  }

  private async dismissOverlays(page: Page): Promise<void> {
    for (let i = 0; i < 6; i++) {
      const wrap = page.locator(".engage-agent-modal-wrap, .engage-agent-modal-mask").filter({ visible: true });
      const close = page.getByRole("button", { name: /^(Close|关闭|取\s*消)$/ }).filter({ visible: true }).last();
      if (await close.isVisible().catch(() => false)) {
        await close.click({ force: true }).catch(() => undefined);
        await sleep(250);
        continue;
      }
      if (await wrap.count()) {
        await page.keyboard.press("Escape").catch(() => undefined);
        await sleep(250);
        if (await wrap.first().isVisible().catch(() => false)) {
          await wrap.first().click({ position: { x: 8, y: 8 }, force: true }).catch(() => undefined);
          await sleep(250);
        }
        continue;
      }
      const header = page.locator(".engage-agent-modal-header").filter({ visible: true });
      if (await header.count()) {
        await page.keyboard.press("Escape").catch(() => undefined);
        await sleep(250);
        continue;
      }
      break;
    }
  }

  private async safeClick(locator: { click: (opts?: { force?: boolean; timeout?: number }) => Promise<void> }): Promise<void> {
    try {
      await locator.click({ timeout: 8000 });
    } catch {
      await locator.click({ force: true, timeout: 5000 });
    }
  }

  private async confirmDialog(page: Page): Promise<void> {
    const save = page.getByRole("button", { name: /确\s*定|保存|完\s*成/ }).filter({ visible: true }).last();
    if (await save.isVisible().catch(() => false)) await save.click();
    await sleep(800);
  }

  private async alreadyAttached(page: Page, name: string): Promise<boolean> {
    const chip = page.locator("[class*='tag'], [class*='chip'], [class*='select-selection-item']").getByText(name, { exact: true });
    if (await chip.first().isVisible().catch(() => false)) return true;
    return page.getByText(name, { exact: true }).filter({ visible: true }).count().then((n) => n > 0);
  }

  private async clickSectionAdd(page: Page, hint: RegExp): Promise<void> {
    const add = page.getByText(hint).first()
      .locator("xpath=following::button[contains(normalize-space(.),'添加')][1]");
    if (await add.isVisible().catch(() => false)) {
      await this.safeClick(add);
      return;
    }
    const fallback = page.getByRole("button", { name: /plus\s*添加|^添\s*加$/ }).filter({ visible: true });
    if (hint.source.includes("知识库") || hint.source.includes("产品资料")) await this.safeClick(fallback.first());
    else await this.safeClick(fallback.last());
  }

  private async attachKnowledge(page: Page, names: string[]): Promise<void> {
    const files = names.map((name) => name.trim()).filter(Boolean);
    if (!files.length) return;
    const missing: string[] = [];
    for (const name of files) {
      if (await this.alreadyAttached(page, name)) continue;
      missing.push(name);
    }
    if (!missing.length) return;
    await this.waitOverlaysGone(page);
    const title = page.getByText("选择知识库", { exact: true });
    if (!(await title.isVisible().catch(() => false))) {
      await this.clickSectionAdd(page, /选择智能体可引用的产品资料/);
      await title.waitFor({ state: "visible", timeout: 15000 });
    }
    const picker = this.knowledgePicker(page);
    const search = picker.getByPlaceholder(/^搜索$/).or(picker.locator("input").first());
    let picked = 0;
    try {
      for (const name of missing) {
        this.assertActive();
        if (await search.first().isVisible().catch(() => false)) {
          await search.first().fill(name);
          await sleep(700);
        }
        const row = picker.getByText(name, { exact: true }).filter({ visible: true }).first();
        if (!(await row.isVisible().catch(() => false))) {
          this.emit("attach", `知识库里没有「${name}」，跳过`);
          continue;
        }
        await this.safeClick(row);
        picked += 1;
      }
      if (picked) await picker.getByRole("button", { name: /确\s*定/ }).last().click({ force: true });
      else await picker.getByRole("button", { name: /取\s*消/ }).last().click({ force: true });
      await title.waitFor({ state: "hidden", timeout: 15000 });
    } finally {
      await this.waitOverlaysGone(page);
    }
  }

  private async attachHotword(page: Page, name: string): Promise<void> {
    if (!name) return;
    if (await this.alreadyAttached(page, name)) return;
    await this.clickSectionAdd(page, /对行业词、产品名、品牌名/);
    await sleep(500);
    const option = page.locator("[class*='dropdown']").filter({ hasText: name })
      .getByText(name, { exact: true }).first();
    if (await option.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false)) {
      await option.click();
      return;
    }
    this.emit("attach", `热词下拉里没有「${name}」，跳过`);
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  private async updateIntents(page: Page, rootDir: string): Promise<void> {
    this.emit("intent", "正在改信息不足和五条必改意图…");
    await this.waitOverlaysGone(page);
    await this.openNav(page, "个性化").catch(() => undefined);
    await this.openNav(page, "意图配置").catch(() => this.openNav(page, "意图"));
    await page.getByPlaceholder("搜索意图名称").waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
    const intents = await readIntents(rootDir);
    const info = intents.updates.find((item) => (item.matchName || item.name) === "信息不足");
    if (info) {
      await this.editIntent(page, "信息不足", info, true).catch((error) => {
        this.emit("intent", `「信息不足」未改完：${error instanceof Error ? error.message : String(error)}`);
      });
    }
    for (const name of MUST_UPDATE) {
      this.assertActive();
      const item = intents.updates.find((row) => (row.matchName || row.name) === name);
      if (!item) continue;
      await this.editIntent(page, name, item, false).catch((error) => {
        this.emit("intent", `「${name}」未改完：${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  private async editIntent(page: Page, name: string, item: VoiceAgentIntentItem, categoryOnly: boolean): Promise<void> {
    const search = page.getByPlaceholder("搜索意图名称");
    if (await search.first().isVisible().catch(() => false)) {
      await search.first().fill(name);
      await sleep(500);
    }
    const row = page.getByRole("row").filter({ hasText: name }).first();
    if (!(await row.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false))) {
      this.emit("intent", `没有找到意图「${name}」，跳过`);
      return;
    }
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const drawer = page.getByText("编辑企业意图", { exact: true });
    await drawer.waitFor({ state: "visible", timeout: 15000 });
    try {
      if (item.category) {
        const combo = page.getByRole("combobox", { name: /意图分类/ }).filter({ visible: true }).first();
        if (await combo.isVisible().catch(() => false)) await combo.click();
        else await page.getByText("意图分类", { exact: true }).first().click();
        await page.getByText(item.category, { exact: true }).filter({ visible: true }).last().click();
      }
      if (!categoryOnly) {
        if (item.description) await this.fillLabeled(page, "意图描述", item.description);
        if (item.positiveExamples) await this.fillLabeled(page, "正面示例", item.positiveExamples);
        if (item.negativeExamples) await this.fillLabeled(page, "反面示例", item.negativeExamples);
      }
      const save = page.getByRole("button", { name: /^保\s*存$/ }).filter({ visible: true }).last();
      if (await save.isVisible().catch(() => false)) await save.click();
      else await this.confirmDialog(page);
      await drawer.waitFor({ state: "hidden", timeout: 15000 });
    } finally {
      if (await drawer.isVisible().catch(() => false)) {
        await page.getByRole("button", { name: /取\s*消/ }).last().click({ force: true }).catch(() => undefined);
        await page.keyboard.press("Escape").catch(() => undefined);
        await drawer.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
      }
    }
  }

  private async openNav(page: Page, name: string): Promise<void> {
    await this.waitOverlaysGone(page);
    const url = NAV_URL[name];
    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(600);
      return;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidates = [
      page.getByRole("menuitem", { name: new RegExp(`^${escaped}(\\s|$)`) }),
      page.getByRole("tab", { name, exact: true }),
      page.getByRole("link", { name, exact: true }),
      page.getByRole("menuitem", { name, exact: true }),
    ];
    for (const locator of candidates) {
      const item = locator.filter({ visible: true }).first();
      if (await item.isVisible().catch(() => false)) {
        await item.click();
        await sleep(500);
        return;
      }
    }
    const personal = page.getByRole("menuitem", { name: /^个性化(\\s|$)/ }).or(page.getByText("个性化", { exact: true })).filter({ visible: true }).first();
    if (await personal.isVisible().catch(() => false)) {
      await personal.click();
      await sleep(400);
    }
    await page.getByRole("menuitem", { name: new RegExp(`^${escaped}(\\s|$)`) }).filter({ visible: true }).first()
      .or(page.getByText(name, { exact: true }).filter({ visible: true }).first())
      .click({ timeout: 8000 });
    await sleep(500);
  }

  private async clickText(page: Page, name: string): Promise<void> {
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 });
  }

  private async clickButton(page: Page, name: string): Promise<void> {
    if (!name) return;
    const button = page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
    await button.waitFor({ state: "visible", timeout: 8000 });
    await button.click();
  }

  private async clickOption(page: Page, name: string): Promise<void> {
    if (!name) return;
    const button = page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
    const option = page.getByText(name, { exact: true }).filter({ visible: true }).first();
    if (await option.isVisible().catch(() => false)) await option.click();
  }

  private async fillLabeled(page: Page, label: string, value: string): Promise<void> {
    if (!value) return;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const placeholder = page.getByPlaceholder(new RegExp(escaped));
    try {
      await placeholder.first().waitFor({ state: "visible", timeout: 3000 });
      await placeholder.first().fill(value);
      return;
    } catch {
      // Labels on this page are not wired to inputs; fall through to the following field.
    }
    const heading = page.getByText(label, { exact: true }).filter({ visible: true }).first();
    const box = heading.locator("xpath=following::textarea[1] | following::input[1]").first();
    await box.waitFor({ state: "visible", timeout: 8000 });
    await box.fill(value);
  }

  private async setFiles(page: Page, files: string[]): Promise<void> {
    const input = page.locator("input[type=file]").last();
    if (await input.count()) {
      await input.setInputFiles(files);
      return;
    }
    const chooser = page.waitForEvent("filechooser", { timeout: 8000 });
    await this.clickText(page, "上传").catch(() => this.clickText(page, "文件"));
    await (await chooser).setFiles(files);
  }
}

export function describeVoiceAgentError(error: unknown): AppErrorInfo {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("未使用额度为 0")) {
    return { code: "E-VOICE-QUOTA-001", message: "未使用额度为 0，不能创建智能体。", suggestion: "当前企业没有可用额度。", detail };
  }
  if (detail.includes("找不到「探迹语音Agent」")) {
    return { code: "E-VOICE-ENTRY-001", message: "没有找到探迹语音Agent 入口。", suggestion: "登录后停在有该入口的页面，再点“已登录，继续”。", detail };
  }
  if (detail.includes("没有看到创建入口")) {
    return { code: "E-VOICE-ENTRY-002", message: "进入探迹语音Agent 后没有看到创建入口。", suggestion: "默认落地页不是智能体。确认左侧能点到「智能体」，再重试。", detail };
  }
  return describeAutomationError(error);
}
