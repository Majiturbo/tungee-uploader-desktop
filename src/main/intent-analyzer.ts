import crypto from "node:crypto";
import fs from "node:fs";
import { isLite, LITE_LLM_UNAVAILABLE } from "../shared/edition";
import { keywordSignal, questionKey, referenceSignal } from "./intent-reference";
import { LLM_MODEL_FILE, LlmUnavailableError, type LocalLlm } from "./local-llm";
import { splitPhrases } from "./script-checkup";
import { INTENT_SIGNALS, type IntentAnalysis, type IntentQuestion, type IntentSignal } from "../shared/intent-plan";

export const INTENT_CACHE_STORE = "intent-cache.json";
const CACHE_VERSION = 2;
const CACHE_LIMIT = 2000;
const PROMPT_PHRASES = 8;
const DISPLAY_PHRASES = 5;

const CLASSIFY_SYSTEM = `你是电话销售机器人的意向分析助手。用户会给你一个知识库问题（问题名称和客户的常见说法），请判断客户说出这类话时代表的行为信号，只能选一个：
- action：客户要求下一步行动，例如加微信/QQ、留号码、发资料、面谈、演示、试用、以后怎么联系。
- price：客户主动询问价格、费用、收费方式、报价（不是嫌贵）。
- consult：客户在了解业务，例如能做什么、某项业务能不能办、优势、案例、流程、周期、团队、资质、是否可靠。
- objection：客户没有拒绝但在拖延或有异议，例如在忙、考虑一下、已有合作方、嫌贵要优惠、距离远、没预算。
- reject：明确拒绝或无效通话，例如不需要、骂人举报、打错、同行、语音信箱或系统提示。
- other：普通身份确认或沟通问题，例如你是谁、公司名称地址、怎么知道我电话、是不是机器人、没听清、再见。
只输出 JSON。`;

const FEW_SHOT: Array<[string, { signal: IntentSignal }]> = [
  ["问题名称：课程收费\n客户常见说法：一节课多少钱；学费怎么算；收费标准是什么", { signal: "price" }],
  ["问题名称：能打折吗\n客户常见说法：能便宜点吗；有没有折扣；太贵了", { signal: "objection" }],
  ["问题名称：发宣传册\n客户常见说法：把介绍发我邮箱；资料发我看看；发个链接给我", { signal: "action" }],
  ["问题名称：以后怎么找你\n客户常见说法：我怎么联系你；回头打哪个电话；你的号码是多少", { signal: "action" }],
  ["问题名称：换个号加我\n客户常见说法：这个不是微信；加我另一个号；我报个号码你记下", { signal: "action" }],
  ["问题名称：门店在哪\n客户常见说法：你们在哪个区；叫什么店；地址发一下", { signal: "other" }],
  ["问题名称：已经装修了\n客户常见说法：我们已经找好装修公司了；有人在做了", { signal: "objection" }],
  ["问题名称：听不清\n客户常见说法：喂喂；你说慢点；刚才说啥", { signal: "other" }],
  ["问题名称：我也做装修\n客户常见说法：我也是干这行的；同行", { signal: "reject" }],
  ["问题名称：老师资历\n客户常见说法：老师有几年经验；你们老师专业吗；有证书吗", { signal: "consult" }],
  ["问题名称：旧房翻新\n客户常见说法：旧房子能翻新吗；二手房改造你们做不做；老房子怎么装", { signal: "consult" }],
];

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    signal: { enum: [...INTENT_SIGNALS] },
  },
} as const;

interface CachedSignal {
  signal: IntentSignal;
}

export interface IntentTask {
  question: string;
  commonQuestions: string;
  invalidQa: boolean;
}

export interface IntentInput {
  flowCount: number;
  vagueCount: number;
  knowledgeTasks: IntentTask[];
}

export interface IntentProgress {
  current: number;
  total: number;
}

function isCachedSignal(value: unknown): value is CachedSignal {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (INTENT_SIGNALS as readonly unknown[]).includes(item.signal);
}

class IntentCache {
  private entries?: Map<string, CachedSignal>;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  get(key: string): CachedSignal | undefined {
    return this.load().get(key);
  }

  set(key: string, value: CachedSignal): void {
    const entries = this.load();
    entries.delete(key);
    entries.set(key, value);
    while (entries.size > CACHE_LIMIT) entries.delete(entries.keys().next().value as string);
  }

  async save(): Promise<void> {
    if (!this.entries) return;
    await fs.promises.writeFile(this.filePath, JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(this.entries) }), "utf8");
  }

  forget(): void {
    this.entries = undefined;
  }

  private load(): Map<string, CachedSignal> {
    if (this.entries) return this.entries;
    this.entries = new Map();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as { version?: number; entries?: Record<string, unknown> };
      if (parsed.version !== CACHE_VERSION) return this.entries;
      for (const [key, value] of Object.entries(parsed.entries ?? {})) {
        if (isCachedSignal(value)) this.entries.set(key, value);
      }
    } catch {
      // A missing or damaged cache only means questions are classified again.
    }
    return this.entries;
  }
}

export function classifyQuestion(llm: LocalLlm, name: string, phrases: string[], signal?: AbortSignal): Promise<CachedSignal> {
  return llm.promptJson<CachedSignal>(
    { system: CLASSIFY_SYSTEM, examples: FEW_SHOT, user: `问题名称：${name}\n客户常见说法：${phrases.slice(0, PROMPT_PHRASES).join("；")}` },
    CLASSIFY_SCHEMA,
    { maxTokens: 40, signal },
  );
}

function modelResult(signal: IntentSignal, keyword: IntentSignal): Pick<IntentQuestion, "signal" | "source" | "alternative"> {
  return { signal, source: "model", alternative: keyword === signal ? undefined : keyword };
}

function cacheKey(name: string, phrases: string[]): string {
  return crypto.createHash("sha1").update([LLM_MODEL_FILE, questionKey(name), ...phrases].join("\n")).digest("hex");
}

export class IntentAnalyzer {
  private readonly cache: IntentCache;
  private readonly llm: LocalLlm;

  constructor(llm: LocalLlm, cachePath: string) {
    this.llm = llm;
    this.cache = new IntentCache(cachePath);
  }

  forget(): void {
    this.cache.forget();
  }

  async analyze(input: IntentInput, options: { signal?: AbortSignal; onProgress?: (progress: IntentProgress) => void } = {}): Promise<IntentAnalysis> {
    const seen = new Set<string>();
    const tasks = input.knowledgeTasks.filter((task) => {
      const key = questionKey(task.question);
      if (task.invalidQa || !key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const questions: IntentQuestion[] = [];
    const pending: Array<{ index: number; key: string; name: string; phrases: string[] }> = [];
    for (const task of tasks) {
      const allPhrases = splitPhrases(task.commonQuestions);
      const promptPhrases = allPhrases.slice(0, PROMPT_PHRASES);
      const question: IntentQuestion = { name: task.question, phrases: allPhrases.slice(0, DISPLAY_PHRASES), signal: "consult", source: "reference" };
      const reference = referenceSignal(task.question);
      if (reference) {
        questions.push({ ...question, signal: reference.signal, alternative: reference.alternative });
        continue;
      }
      const key = cacheKey(task.question, promptPhrases);
      const cached = isLite() ? undefined : this.cache.get(key);
      if (cached) {
        questions.push({ ...question, ...modelResult(cached.signal, keywordSignal(task.question, allPhrases)) });
        continue;
      }
      pending.push({ index: questions.length, key, name: task.question, phrases: promptPhrases });
      questions.push({ ...question, signal: keywordSignal(task.question, allPhrases), source: "keyword" });
    }

    if (isLite()) {
      return {
        flowCount: input.flowCount,
        vagueCount: input.vagueCount,
        knowledgeCount: input.knowledgeTasks.length,
        questions,
        modelUsed: false,
        modelUnavailable: LITE_LLM_UNAVAILABLE,
      };
    }

    let modelUnavailable: string | undefined;
    let classified = 0;
    options.onProgress?.({ current: 0, total: pending.length });
    try {
      for (const item of pending) {
        const answer = await classifyQuestion(this.llm, item.name, item.phrases, options.signal);
        this.cache.set(item.key, answer);
        const question = questions[item.index];
        if (question) Object.assign(question, modelResult(answer.signal, question.signal));
        classified += 1;
        options.onProgress?.({ current: classified, total: pending.length });
      }
    } catch (error: unknown) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      modelUnavailable = error.message;
    } finally {
      if (classified) await this.cache.save().catch(() => undefined);
    }

    return {
      flowCount: input.flowCount,
      vagueCount: input.vagueCount,
      knowledgeCount: input.knowledgeTasks.length,
      questions,
      modelUsed: questions.some((question) => question.source === "model"),
      modelUnavailable,
    };
  }
}
