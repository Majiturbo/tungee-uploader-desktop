import fs from "node:fs";
import path from "node:path";
import type { AudioDecoder } from "./audio-decoder";
import { isSupportedAudioFile } from "./audio-format";
import { AUDIO_MATCH_STORE, AudioMatchStore } from "./audio-match-store";
import { AudioMatcher } from "./audio-matcher";
import { AutomationEngine, describeAutomationError } from "./automation";
import { VoiceAgentEngine } from "./voice-agent-automation";
import type { VoiceAgentConfig } from "../shared/voice-agent";
import { businessSummary, expandPhrases, runAiCheckup } from "./ai-checkup";
import { CheckupFixError, createFixedWorkbook } from "./checkup-fix";
import { createValidationReport, loadData } from "./data-validation";
import { INTENT_CACHE_STORE, IntentAnalyzer } from "./intent-analyzer";
import { questionKey } from "./intent-reference";
import { isAbortError, LLM_MODEL_FILE, LlmUnavailableError, LocalLlm } from "./local-llm";
import { buildCheckup, cleanAddition, invalidReason, splitPhrases } from "./script-checkup";
import { SpeechRecognizer } from "./speech-recognizer";
import { clearStorage, getStorageUsage, STORAGE_CATEGORIES, StorageBusyError } from "./storage";
import {
  buildIntentPlan,
  INTENT_DESCRIPTION_MAX,
  INTENT_SIGNALS,
  intentMarkdown,
  intentSetups,
  needsConfirm,
  type IntentAnalysis,
  type IntentQuestion,
  type IntentSetup,
} from "../shared/intent-plan";
import type { AppErrorInfo, AudioMatchDecisions, CheckupDecisions, CheckupFinding, PhraseAdditions, StorageCategory, UploadConfig } from "../shared/types";

export interface SaveOptions {
  title: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}

export type ServiceEvent = "automation:progress" | "ai:progress";

export interface ServiceHost {
  userDataPath: string;
  logDir: string;
  downloadsPath: string;
  templatePath: string;
  asrModelDir: string;
  llmModelPath: string;
  llmWorkerPath?: string;
  decoder: AudioDecoder;
  log(message: string): void;
  emit(event: ServiceEvent, payload: unknown): void;
  pickSavePath(options: SaveOptions): Promise<string | null>;
  clearAppCache?(): Promise<void>;
}

export type ServiceHandler = (...args: unknown[]) => unknown;

export const STANDARD_TEMPLATE_NAME = "探迹话术标准模板_v1.0.xlsx";
export const VOICE_AGENT_SAMPLE_NAME = "语音Agent示例交付包.zip";

function isUploadConfig(value: unknown): value is UploadConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Record<string, unknown>;
  return typeof config.talkName === "string"
    && typeof config.workbookPath === "string"
    && typeof config.audioDir === "string"
    && typeof config.categoryName === "string"
    && typeof config.submitReview === "boolean"
    && (config.mode === undefined || config.mode === "create" || config.mode === "modify");
}

function isCheckupDecisions(value: unknown): value is CheckupDecisions {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === "string");
}

function isPhraseAdditions(value: unknown): value is PhraseAdditions {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.entries(value).every(([key, items]) => /^\d+$/.test(key)
      && Array.isArray(items) && items.every((item) => typeof item === "string"));
}

function isAudioMatchDecisions(value: unknown): value is AudioMatchDecisions {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.entries(value).every(([key, item]) => /^\d+$/.test(key) && (item === null || typeof item === "string"));
}

function isStorageCategoryList(value: unknown): value is StorageCategory[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && (STORAGE_CATEGORIES as string[]).includes(item));
}

function isIntentQuestions(value: unknown): value is IntentQuestion[] {
  return Array.isArray(value) && value.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const question = item as Record<string, unknown>;
    return typeof question.name === "string"
      && Array.isArray(question.phrases)
      && INTENT_SIGNALS.includes(question.signal as IntentQuestion["signal"]);
  });
}

function isIntentSetups(value: unknown): value is IntentSetup[] {
  return Array.isArray(value) && value.length <= 6 && value.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const setup = item as Record<string, unknown>;
    return ["A级", "B级", "C级"].includes(setup.level as string)
      && typeof setup.description === "string"
      && setup.description.trim() !== ""
      && [...setup.description].length <= INTENT_DESCRIPTION_MAX
      && ["所有", "任意"].includes(setup.match as string)
      && ["before-main-affirm", "end"].includes(setup.placement as string)
      && Array.isArray(setup.questions)
      && setup.questions.length > 0
      && setup.questions.every((name) => typeof name === "string" && name.trim() !== "");
  });
}

function safeFileName(talkName: string): string {
  return talkName.replace(/[\\/:*?"<>|]/g, "-").trim() || "话术";
}

function checkupError(error: unknown): AppErrorInfo {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof CheckupFixError && error.code === "E-CHECKUP-003") {
    return { code: error.code, message: "没有需要修正的内容。", suggestion: "请至少勾选一项修正，或为“两个问题抢同一句”选择保留位置。", detail };
  }
  if (error instanceof CheckupFixError && error.code === "E-CHECKUP-002") {
    return {
      code: error.code,
      message: "修正版没有通过重新检查，已取消保存。",
      suggestion: "原文件没有任何改动。请导出检查报告，按“话术体检”表手动修改，或把技术详情发给维护人员。",
      detail,
    };
  }
  if (error instanceof CheckupFixError) {
    return {
      code: error.code,
      message: "这份 Excel 暂时不能自动修正。",
      suggestion: "原文件没有任何改动。可以导出检查报告，按“话术体检”表手动修改。",
      detail,
    };
  }
  return describeAutomationError(error);
}

function aiError(error: unknown): AppErrorInfo {
  if (error instanceof LlmUnavailableError) {
    const lite = error.message.includes("轻量版");
    return {
      code: "E-AI-001",
      message: lite ? `${error.message}。` : `本地 AI 暂时用不了：${error.message}。`,
      suggestion: lite
        ? "上传、录音配对和规则体检不受影响。需要 AI 补问法或查错字，请改用标准版。"
        : "其他功能不受影响。如果提示缺少模型文件，请重新解压完整的安装包。",
    };
  }
  return describeAutomationError(error);
}

function storageError(error: unknown): AppErrorInfo {
  if (error instanceof StorageBusyError) {
    return {
      code: "E-STORAGE-001",
      message: "上传任务运行中，暂时不能清理浏览器数据。",
      suggestion: "请等待任务结束或先停止任务，再清理浏览器缓存或登录信息。",
    };
  }
  return {
    code: "E-STORAGE-002",
    message: "清理缓存时遇到问题。",
    suggestion: "请关闭由本工具打开的 Chrome 窗口后重试；部分文件被占用时，重启软件后再清理即可。",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function isVoiceAgentConfig(value: unknown): value is VoiceAgentConfig {
  return typeof value === "object" && value !== null && typeof (value as VoiceAgentConfig).packPath === "string";
}

export class DesktopService {
  private readonly matchStore: AudioMatchStore;
  private readonly matcher: AudioMatcher;
  private readonly llm: LocalLlm;
  private readonly intentAnalyzer: IntentAnalyzer;
  private readonly engine: AutomationEngine;
  private readonly voiceEngine: VoiceAgentEngine;
  private readonly aiControllers = new Set<AbortController>();
  private readonly expandCache = new Map<string, string[]>();
  private readonly playableAudioDirs = new Set<string>();

  constructor(private readonly host: ServiceHost) {
    this.matchStore = new AudioMatchStore(path.join(host.userDataPath, AUDIO_MATCH_STORE));
    this.matcher = new AudioMatcher({
      decode: (filePath, sampleRate) => host.decoder.decodeFile(filePath, sampleRate),
      recognizer: new SpeechRecognizer(host.asrModelDir),
      store: this.matchStore,
    });
    this.llm = new LocalLlm(host.llmModelPath, {
      log: host.log,
      statePath: path.join(host.userDataPath, "local-ai.json"),
      workerPath: host.llmWorkerPath,
    });
    this.intentAnalyzer = new IntentAnalyzer(this.llm, path.join(host.userDataPath, INTENT_CACHE_STORE));
    this.engine = new AutomationEngine(host.userDataPath, host.decoder, (event) => {
      host.emit("automation:progress", event);
      host.log(`上传[${event.stage}] ${event.message}${event.error ? `｜${event.error.code} ${event.error.detail ?? ""}` : ""}`);
    }, this.matcher);
    this.voiceEngine = new VoiceAgentEngine(host.userDataPath, (event) => {
      host.emit("automation:progress", event);
      host.log(`语音Agent[${event.stage}] ${event.message}${event.error ? `｜${event.error.code} ${event.error.detail ?? ""}` : ""}`);
    });
  }

  isPlayable(dir: string, file: string): boolean {
    return this.playableAudioDirs.has(path.resolve(dir)) && !!file && path.basename(file) === file && isSupportedAudioFile(file);
  }

  async dispose(): Promise<void> {
    this.cancelAiTasks();
    await Promise.allSettled([this.engine.dispose(), this.voiceEngine.dispose(), this.llm.dispose()]);
  }

  private startAiTask(): AbortController {
    const controller = new AbortController();
    this.aiControllers.add(controller);
    return controller;
  }

  private cancelAiTasks(): void {
    for (const controller of this.aiControllers) controller.abort();
    this.aiControllers.clear();
  }

  private sendAiProgress(current: number, total: number): void {
    this.host.emit("ai:progress", { current, total });
  }

  readonly handlers: Record<string, ServiceHandler> = {
    "template:save": async () => {
      try {
        await fs.promises.access(this.host.templatePath);
        const target = await this.host.pickSavePath({
          title: "保存探迹话术标准模板",
          defaultPath: path.join(this.host.downloadsPath, STANDARD_TEMPLATE_NAME),
          filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
        });
        if (!target) return { status: "cancelled" as const };
        await fs.promises.copyFile(this.host.templatePath, target);
        return { status: "saved" as const, path: target };
      } catch (error: unknown) {
        return { status: "error" as const, error: describeAutomationError(error) };
      }
    },

    "voice-agent:save-sample": async () => {
      try {
        const source = path.join(path.dirname(this.host.templatePath), VOICE_AGENT_SAMPLE_NAME);
        await fs.promises.access(source);
        const target = await this.host.pickSavePath({
          title: "保存语音 Agent 示例交付包",
          defaultPath: path.join(this.host.downloadsPath, VOICE_AGENT_SAMPLE_NAME),
          filters: [{ name: "Zip 压缩包", extensions: ["zip"] }],
        });
        if (!target) return { status: "cancelled" as const };
        await fs.promises.copyFile(source, target);
        return { status: "saved" as const, path: target };
      } catch (error: unknown) {
        return { status: "error" as const, error: describeAutomationError(error) };
      }
    },

    "path:inspect": async (targetPath) => {
      if (typeof targetPath !== "string" || !targetPath) return "missing" as const;
      try {
        const stats = await fs.promises.stat(targetPath);
        if (stats.isDirectory()) return "directory" as const;
        if (stats.isFile()) return "file" as const;
      } catch {
        return "missing" as const;
      }
      return "missing" as const;
    },

    "automation:preview": async (value) => {
      try {
        if (!isUploadConfig(value)) throw new Error("参数格式不正确");
        const summary = await this.engine.preview(value);
        this.playableAudioDirs.add(path.resolve(value.audioDir));
        return { status: "ok" as const, summary };
      } catch (error: unknown) {
        return { status: "error" as const, error: describeAutomationError(error) };
      }
    },

    "report:validation": async (value) => {
      try {
        if (!isUploadConfig(value)) throw new Error("参数格式不正确");
        const report = await createValidationReport(value, this.engine.loadOptions());
        const target = await this.host.pickSavePath({
          title: "导出数据检查报告",
          defaultPath: path.join(this.host.downloadsPath, `${safeFileName(value.talkName)}-数据检查报告.xlsx`),
          filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
        });
        if (!target) return { status: "cancelled" as const };
        await fs.promises.writeFile(target, report);
        return { status: "saved" as const, path: target };
      } catch (error: unknown) {
        return { status: "error" as const, error: describeAutomationError(error) };
      }
    },

    "checkup:save-fixed": async (value, decisions, additions = {}) => {
      try {
        if (!isUploadConfig(value) || !isCheckupDecisions(decisions) || !isPhraseAdditions(additions)) throw new Error("参数格式不正确");
        const { buffer, appliedCount } = await createFixedWorkbook(value, decisions, additions);
        const parsed = path.parse(value.workbookPath);
        const target = await this.host.pickSavePath({
          title: "另存修正版 Excel",
          defaultPath: path.join(parsed.dir, `${parsed.name}-修正版.xlsx`),
          filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
        });
        if (!target) return { status: "cancelled" as const };
        if (path.resolve(target) === path.resolve(value.workbookPath)) {
          throw new CheckupFixError("E-CHECKUP-001", "不能覆盖原文件，请换一个文件名");
        }
        await fs.promises.writeFile(target, buffer);
        await Promise.all([
          this.engine.linkWorkbook(value.workbookPath, target),
          this.matcher.carryOver(value.workbookPath, target, value.audioDir),
        ]).catch((error: unknown) => this.host.log(`修正版沿用上传进度或录音配对失败：${error instanceof Error ? error.message : String(error)}`));
        this.host.log(`已另存修正版 Excel：${target}，采纳 ${appliedCount} 项`);
        return { status: "saved" as const, path: target, appliedCount };
      } catch (error: unknown) {
        return { status: "error" as const, error: checkupError(error) };
      }
    },

    "audio:confirm-matches": async (value, decisions) => {
      try {
        if (!isUploadConfig(value) || !isAudioMatchDecisions(decisions)) throw new Error("参数格式不正确");
        const entries = new Map(Object.entries(decisions).map(([key, file]) => [Number(key), file]));
        await this.matcher.confirm(value.workbookPath, value.audioDir, entries);
        this.host.log(`已确认 ${entries.size} 条录音匹配`);
        return { status: "saved" as const };
      } catch (error: unknown) {
        return { status: "error" as const, error: describeAutomationError(error) };
      }
    },

    "intent:analyze": async (value) => {
      const task = this.startAiTask();
      const { signal } = task;
      try {
        if (!isUploadConfig(value)) throw new Error("参数格式不正确");
        const data = await loadData(value);
        const analysis = await this.intentAnalyzer.analyze(
          { flowCount: data.flowRowCount, vagueCount: data.vagueRowCount, knowledgeTasks: data.knowledgeTasks },
          { signal, onProgress: (progress) => this.sendAiProgress(progress.current, progress.total) },
        );
        if (analysis.modelUnavailable) this.host.log(`意向建议未使用本地 AI：${analysis.modelUnavailable}`);
        return { status: "ok" as const, analysis };
      } catch (error: unknown) {
        if (signal.aborted || isAbortError(error)) return { status: "cancelled" as const };
        return { status: "error" as const, error: describeAutomationError(error) };
      } finally {
        this.aiControllers.delete(task);
      }
    },

    "checkup:ai": async (value) => {
      const task = this.startAiTask();
      const { signal } = task;
      try {
        if (!isUploadConfig(value)) throw new Error("参数格式不正确");
        const data = await loadData(value);
        const findings = await runAiCheckup(this.llm, data, { signal, onProgress: (current, total) => this.sendAiProgress(current, total) });
        this.host.log(`AI 查错字完成：${findings.length} 处提醒`);
        return { status: "ok" as const, findings };
      } catch (error: unknown) {
        if (signal.aborted || isAbortError(error)) return { status: "cancelled" as const };
        return { status: "error" as const, error: aiError(error) };
      } finally {
        this.aiControllers.delete(task);
      }
    },

    "checkup:expand": async (value, rowNumber, fresh = false) => {
      const task = this.startAiTask();
      const { signal } = task;
      try {
        if (!isUploadConfig(value) || !Number.isInteger(rowNumber) || typeof fresh !== "boolean") throw new Error("参数格式不正确");
        const data = await loadData(value);
        const qa = data.knowledgeTasks.find((item) => item.sourceRow === rowNumber);
        if (!qa) throw new Error(`第 ${String(rowNumber)} 行不是有效的知识库问题`);
        const business = businessSummary(data);
        const cacheKey = [LLM_MODEL_FILE, qa.question, qa.commonQuestions, business].join("\u0000");
        let phrases = fresh ? undefined : this.expandCache.get(cacheKey);
        if (!phrases) {
          const seed = fresh ? Math.floor(Math.random() * 1_000_000) : 1;
          phrases = await expandPhrases(this.llm, qa.question, splitPhrases(qa.commonQuestions), business, { signal, seed });
          this.expandCache.set(cacheKey, phrases);
        }
        const owner = buildCheckup(data).phraseOwner;
        return {
          status: "ok" as const,
          phrases: phrases.map(cleanAddition).filter((phrase) => owner(phrase).every((row) => row === rowNumber)),
        };
      } catch (error: unknown) {
        if (signal.aborted || isAbortError(error)) return { status: "cancelled" as const };
        return { status: "error" as const, error: aiError(error) };
      } finally {
        this.aiControllers.delete(task);
      }
    },

    "checkup:invalid-ai": async (value) => {
      const task = this.startAiTask();
      const { signal } = task;
      try {
        if (!isUploadConfig(value)) throw new Error("参数格式不正确");
        const data = await loadData(value);
        if (data.flagColumns.invalid === null) return { status: "ok" as const, findings: [] };
        const analysis = await this.intentAnalyzer.analyze(
          { flowCount: data.flowRowCount, vagueCount: data.vagueRowCount, knowledgeTasks: data.knowledgeTasks },
          { signal, onProgress: (progress) => this.sendAiProgress(progress.current, progress.total) },
        );
        const neutral = new Set(analysis.questions.filter((question) => question.signal === "other").map((question) => questionKey(question.name)));
        const findings: CheckupFinding[] = data.knowledgeTasks
          .filter((qa) => !qa.invalidQa && neutral.has(questionKey(qa.question)) && !invalidReason(qa.question))
          .map((qa) => ({
            id: `invalid:${qa.sourceRow}`,
            kind: "invalid-qa",
            title: qa.question,
            message: `${analysis.modelUsed ? "AI 判断" : "按常见问题判断"}这是身份确认或零散沟通，计入意向意义不大，可以考虑标为无效QA（不计入意向）。`,
            examples: [],
            rowNumbers: [qa.sourceRow],
            options: [{ id: "fix", label: "标为无效QA" }],
          }));
        this.host.log(`AI 无效QA建议：${findings.length} 条`);
        return { status: "ok" as const, findings };
      } catch (error: unknown) {
        if (signal.aborted || isAbortError(error)) return { status: "cancelled" as const };
        return { status: "error" as const, error: aiError(error) };
      } finally {
        this.aiControllers.delete(task);
      }
    },

    "ai:cancel": () => {
      this.cancelAiTasks();
    },

    "intent:plan": (analysis, questions) => {
      if (typeof analysis !== "object" || analysis === null || !isIntentQuestions(questions)) throw new Error("参数格式不正确");
      const plan = buildIntentPlan(questions);
      const full = { ...(analysis as IntentAnalysis), questions };
      return {
        plan,
        setups: intentSetups(plan),
        markdown: intentMarkdown(full, plan),
        flagged: questions.filter(needsConfirm).map((question) => question.name),
      };
    },

    "intent:export": async (value, markdown) => {
      try {
        if (!isUploadConfig(value) || typeof markdown !== "string") throw new Error("参数格式不正确");
        const target = await this.host.pickSavePath({
          title: "导出意向设置建议",
          defaultPath: path.join(this.host.downloadsPath, `${safeFileName(value.talkName)}-意向设置建议.md`),
          filters: [{ name: "Markdown 文档", extensions: ["md"] }, { name: "文本文件", extensions: ["txt"] }],
        });
        if (!target) return { status: "cancelled" as const };
        await fs.promises.writeFile(target, markdown, "utf8");
        return { status: "saved" as const, path: target };
      } catch (error: unknown) {
        return { status: "error" as const, error: describeAutomationError(error) };
      }
    },

    "automation:start": async (value, intents = [], options = {}) => {
      if (!isUploadConfig(value) || !isIntentSetups(intents)) throw new Error("参数格式不正确");
      if (this.voiceEngine.isRunning) throw new Error("语音 Agent 任务还在运行，请先停止");
      const resume = typeof options === "object" && options !== null && (options as { resume?: unknown }).resume === true;
      await this.llm.releaseIfIdle();
      await this.voiceEngine.releaseBrowser();
      return this.engine.run(value, intents, { resume });
    },

    "automation:rename": (name) => {
      if (typeof name !== "string" || !name.trim() || [...name.trim()].length >= 20) throw new Error("话术名称需要 1-19 个字");
      return this.engine.rename(name.trim());
    },
    "automation:use-existing": () => this.engine.useExisting(),
    "automation:modify-existing": () => this.engine.modifyExisting(),

    "modify:compare": async (value) => {
      if (!isUploadConfig(value)) throw new Error("参数格式不正确");
      const result = await this.engine.compare(value);
      this.host.log(result.ok ? `修改对比：${value.talkName}，${result.plan.items.filter((item) => item.selected).length} 处要改，备份 ${result.plan.backupPath}` : `修改对比失败：${result.message}`);
      return result;
    },

    "modify:apply": async (value, ids) => {
      if (!isUploadConfig(value) || !Array.isArray(ids) || !ids.every((id) => typeof id === "string")) throw new Error("参数格式不正确");
      return this.engine.modify(value, ids);
    },

    "automation:checkpoint": async (value) => {
      if (!isUploadConfig(value)) throw new Error("参数格式不正确");
      return this.engine.checkpointInfo(value);
    },

    "automation:discard-checkpoint": async (value) => {
      if (!isUploadConfig(value)) throw new Error("参数格式不正确");
      await this.engine.discardCheckpoint(value);
      return true;
    },

    "automation:confirm-login": () => this.voiceEngine.confirmLogin() || this.engine.confirmLogin(),

    "automation:cancel": async () => (await this.voiceEngine.cancel()) || (await this.engine.cancel()),

    "voice-agent:preview": async (value) => {
      try {
        if (!isVoiceAgentConfig(value)) throw new Error("参数格式不正确");
        const preview = await this.voiceEngine.preview(value);
        return { status: "ok" as const, preview };
      } catch (error: unknown) {
        return { status: "error" as const, error: describeAutomationError(error) };
      }
    },

    "voice-agent:start": async (value, options = {}) => {
      if (!isVoiceAgentConfig(value)) throw new Error("参数格式不正确");
      if (this.engine.isRunning) throw new Error("话术上传还在运行，请先停止");
      const entryIndex = typeof options === "object" && options !== null && typeof (options as { entryIndex?: unknown }).entryIndex === "number"
        ? (options as { entryIndex: number }).entryIndex
        : undefined;
      await this.engine.releaseBrowser();
      return this.voiceEngine.run(value, entryIndex);
    },

    "voice-agent:pick-entry": (index) => {
      if (typeof index !== "number") throw new Error("参数格式不正确");
      return this.voiceEngine.pickEntry(index);
    },

    "voice-agent:confirm-paste": () => this.voiceEngine.confirmPaste(),

    "voice-agent:entries": () => this.voiceEngine.entryOptions,

    "storage:usage": async () => {
      try {
        return { status: "ok" as const, usage: await getStorageUsage(this.storagePaths()) };
      } catch (error: unknown) {
        return { status: "error" as const, error: storageError(error) };
      }
    },

    "storage:clear": async (value) => {
      try {
        if (!isStorageCategoryList(value) || !value.length) throw new Error("参数格式不正确");
        const result = await clearStorage(this.storagePaths(), value, {
          releaseBrowser: async () => (await this.engine.releaseBrowser()) || (await this.voiceEngine.releaseBrowser()),
          clearAppCache: async () => {
            await this.host.clearAppCache?.();
            await fs.promises.rm(path.join(this.host.userDataPath, AUDIO_MATCH_STORE), { force: true });
            await fs.promises.rm(path.join(this.host.userDataPath, INTENT_CACHE_STORE), { force: true });
            this.matchStore.forget();
            this.intentAnalyzer.forget();
            this.expandCache.clear();
          },
        });
        this.host.log(`已清理缓存：${value.join("、")}，释放 ${result.freedBytes} 字节`);
        return { status: "ok" as const, ...result };
      } catch (error: unknown) {
        return { status: "error" as const, error: storageError(error) };
      }
    },
  };

  private storagePaths() {
    return { userDataPath: this.host.userDataPath, logDir: this.host.logDir };
  }
}
