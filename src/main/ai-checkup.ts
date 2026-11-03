import type { LocalLlm } from "./local-llm";
import { phraseKey } from "./script-checkup";
import { isSystemPromptQuestion } from "./system-prompt-phrases";
import type { CheckupFinding } from "../shared/types";

const BUSINESS_CHARS = 240;
const MAX_TYPO_CHARS = 6;
const EXPAND_COUNT = 8;
const PLACEHOLDER = /^[*＊xX×\s]+$/;

const TYPO_SYSTEM = "你是中文校对助手。找出明显写错的字（同音字、形近字），以及明显漏掉的字（例如“3-7个工作”漏了“日”）。wrong 填原文里出错的那几个字，right 填改正后的写法。不要改写句子、不要挑标点和用词风格。没有问题就返回空数组。只输出 JSON。";
const TYPO_SCHEMA = {
  type: "object",
  properties: {
    typos: {
      type: "array",
      items: { type: "object", properties: { wrong: { type: "string" }, right: { type: "string" } } },
      maxItems: 5,
    },
  },
} as const;

const EXPAND_SCHEMA = {
  type: "object",
  properties: { phrases: { type: "array", items: { type: "string" }, minItems: EXPAND_COUNT, maxItems: EXPAND_COUNT } },
} as const;

interface Speech {
  moduleName: string;
  sectionName?: string | null;
  speech: string;
  sourceRow: number;
}

interface Qa {
  question: string;
  answer: string;
  invalidQa: boolean;
  sourceRow: number;
}

export interface AiCheckupInput {
  flowTasks: Speech[];
  vagueTasks: Speech[];
  knowledgeTasks: Qa[];
}

export interface AiRunOptions {
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

const quote = (text: string) => `「${text}」`;

export function businessSummary(input: Pick<AiCheckupInput, "flowTasks">): string {
  const intro = input.flowTasks.filter((task) => task.sectionName === "开场白" || task.sectionName === "产品介绍");
  const source = intro.length ? intro : input.flowTasks.slice(0, 3);
  return source.map((task) => task.speech).join(" ").replace(/\s+/g, " ").slice(0, BUSINESS_CHARS);
}

export function validTypos(text: string, typos: Array<{ wrong: string; right: string }>): Array<{ wrong: string; right: string }> {
  const seen = new Set<string>();
  return typos.filter(({ wrong, right }) => {
    const key = `${wrong}→${right}`;
    const ok = wrong.trim() !== ""
      && right.trim() !== ""
      && wrong !== right
      && [...wrong].length <= MAX_TYPO_CHARS
      && [...right].length <= MAX_TYPO_CHARS + 2
      && !PLACEHOLDER.test(wrong)
      && text.includes(wrong)
      && !text.includes(right)
      && !seen.has(key);
    seen.add(key);
    return ok;
  });
}

export async function runAiCheckup(llm: LocalLlm, input: AiCheckupInput, options: AiRunOptions = {}): Promise<CheckupFinding[]> {
  const qas = input.knowledgeTasks.filter((qa) => !qa.invalidQa && !isSystemPromptQuestion(qa.question));
  const texts = [
    ...input.flowTasks.map((task) => ({ title: task.moduleName, text: task.speech, row: task.sourceRow })),
    ...input.vagueTasks.map((task) => ({ title: task.moduleName, text: task.speech, row: task.sourceRow })),
    ...qas.map((qa) => ({ title: qa.question, text: qa.answer, row: qa.sourceRow })),
  ].filter((item) => [...item.text.trim()].length >= 4);
  const findings: CheckupFinding[] = [];
  options.onProgress?.(0, texts.length);

  for (const [index, item] of texts.entries()) {
    const answer = await llm.promptJson<{ typos: Array<{ wrong: string; right: string }> }>(
      { system: TYPO_SYSTEM, user: `请校对这句电话销售话术：${item.text}` },
      TYPO_SCHEMA,
      { maxTokens: 200, signal: options.signal },
    );
    const typos = validTypos(item.text, answer.typos ?? []);
    if (typos.length) {
      findings.push({
        id: `typo:${item.row}`,
        kind: "typo",
        title: item.title,
        message: `AI 发现 ${typos.length} 处可能的错字或漏字，机器人会照着念出来。AI 的改法不一定对，请核对后在 Excel 里修改。`,
        examples: typos.map((typo) => `${quote(typo.wrong)} → ${quote(typo.right)}`),
        rowNumbers: [item.row],
        options: [],
      });
    }
    options.onProgress?.(index + 1, texts.length);
  }
  return findings;
}

const EXPAND_SYSTEM = `你在帮电话销售机器人整理知识库。机器人给客户打电话，知识库里的“问法”是被叫的客户在电话里对机器人说的话，客户说出其中任意一句，机器人就播放这个问题对应的回答录音。
写问法的要求：
1. 必须是客户的口吻：客户提问、表态或提要求。绝对不要写成销售或机器人说的话，例如“您需要办理吗”“要不要了解一下”“不打扰您了”“祝您生活愉快”。
2. 意思必须和问题名称、客户已有的说法完全一样，只换说法、不换意思。先想清楚客户说这句话是想表达什么，不要加进原来没有的理由、情况或追问。
3. 人称不能换：句子里的“我”永远是客户自己，“你/你们”永远是机器人和它的公司。例如“你知道我是谁吗”是客户问机器人认不认识自己，不能写成“你是谁”。
4. 机器人所在公司的业务只用来理解行业用词。问题本身和业务无关时（例如问号码哪来的、问你是谁、道别、没听清），句子里不要出现任何业务或产品词。
5. 像普通人打电话时说的话，不要用网上聊天的说法（例如“下线”）。
6. 问法是靠关键词命中的：每条 4 到 10 个字，保留能认出这个问题的关键词，去掉“好的、嗯、那个、请问、啊、呢、吧”这类不带信息的字。太长太完整的句子客户很难原样说出来，太短太笼统的（例如“好的”“是吗”“多少”）又会误命中别的问题。
只输出 JSON。`;

const expandRequest = (business: string, question: string, existing: string[]) =>
  `${business ? `机器人所在公司的业务：${business}\n` : ""}知识库问题：${question}\n客户已有的说法：${existing.slice(0, 12).join("；")}\n请再写 ${EXPAND_COUNT} 条客户在电话里可能对机器人说的、意思相同但说法不同的问法，每条 4 到 10 个字，带上关键词，不要和已有说法重复。`;

const EXPAND_EXAMPLES: Array<[string, { phrases: string[] }]> = [
  [
    expandRequest("我们提供家装设计和施工服务", "旧房翻新", ["旧房子能翻新吗", "老房子你们做不做"]),
    { phrases: ["二手房能改造吗", "老房子能装吗", "老房翻新怎么收费", "旧房子重新装修", "接老房子的活吗", "老小区房子能做吗", "旧房改造要多久", "房子旧了想翻新"] },
  ],
  [
    expandRequest("我们提供家装设计和施工服务", "你怎么知道我电话", ["你哪来的我号码"]),
    { phrases: ["谁给你的我电话", "从哪查到我的", "我号码怎么有的", "谁给的我手机号", "怎么找到我的", "我电话哪来的", "哪弄的我号码", "怎么有我电话"] },
  ],
  [
    expandRequest("我们提供家装设计和施工服务", "你知道我是谁吗", ["你认识我吗"]),
    { phrases: ["知道我叫啥吗", "你认得我吗", "晓得我是谁不", "知道我是哪位吗", "你清楚我是谁吗", "知不知道我是谁", "知道跟谁说话吗", "不知道我是谁吧"] },
  ],
  [
    expandRequest("我们是少儿英语培训机构", "拜拜", ["再见", "就这样吧"]),
    { phrases: ["先这样吧", "我挂了", "没事我挂了", "先这样再见", "不聊了挂了", "行了挂了", "我先挂了", "那就这样"] },
  ],
  [
    expandRequest("我们是少儿英语培训机构", "课程收费", ["一节课多少钱"]),
    { phrases: ["学费怎么算", "一个月交多少钱", "怎么收费的", "报名要多少钱", "课时费贵不贵", "收费标准是什么", "问下课程价格", "一年课要多少钱"] },
  ],
];

const FILLER_START = /^((嗯+|哦+|噢|喂|请问)[，,、\s]*|(好的|好|那个|那|就是|行|对)[，,、\s]+)/;
const FILLER_END = /[啊呀呢吧啦]+$/;
export const PHRASE_MIN = 3;
export const PHRASE_MAX = 12;

/** Trims filler that adds nothing to a keyword hit. */
export function tidyPhrase(phrase: string): string {
  let text = phrase.trim().replace(/^[\d.、\s]+/, "").replace(/[;；\n]/g, "，").replace(/[，,。.！!？?\s]+$/, "");
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(FILLER_START, "").replace(FILLER_END, "").replace(/[，,。.！!\s]+$/, "");
  }
  return text;
}

const CALLER_START = /^(请问)?(您|你)(是否|要不要|需不需要|需要|要|想|有没有|考虑|感兴趣)|^(是否|有没有兴趣|考虑一下|要不要(了解|试试|考虑))|感兴趣吗$/;
const CALLER_WORDS = /不打扰|打扰(您|你)了|祝(您|你)|加(您|你)|给(您|你)(发|打|介绍|安排)|(您|你)留意|稍后(联系|回电)|为(您|你)服务/;
const BARE_OFFER = /^(需要|要|想)/;
const QUESTION_WORD = /什么|多少|怎么|哪|几|谁|为什么|多久|多长/;
const CUSTOMER_SUBJECT = /你们|你家|贵司|贵公司|你这/;

/** Whether a phrase reads like the salesperson asking the customer instead of the customer speaking. */
export function soundsLikeCaller(phrase: string): boolean {
  const text = phrase.replace(/[\s？?。！!，,]+$/g, "");
  if (CALLER_START.test(text) || CALLER_WORDS.test(text)) return true;
  if (/(需求|需要)吗$/.test(text)) return true;
  return BARE_OFFER.test(text) && /[吗么]$/.test(text) && !QUESTION_WORD.test(text) && !CUSTOMER_SUBJECT.test(text);
}

export async function expandPhrases(
  llm: LocalLlm,
  question: string,
  existing: string[],
  business: string,
  { signal, seed = 1 }: { signal?: AbortSignal; seed?: number } = {},
): Promise<string[]> {
  const request = expandRequest(business, question, existing);
  const answer = await llm.promptJson<{ phrases: string[] }>(
    { system: EXPAND_SYSTEM, examples: EXPAND_EXAMPLES, user: request },
    EXPAND_SCHEMA,
    { temperature: 0.7, maxTokens: 400, seed, signal },
  );
  const existingKeys = new Set(existing.map(phraseKey));
  const result: string[] = [];
  for (const phrase of answer.phrases ?? []) {
    const cleaned = tidyPhrase(phrase);
    const key = phraseKey(cleaned);
    const length = [...cleaned.replace(/[，,、\s]/g, "")].length;
    if (!key || length < PHRASE_MIN || length > PHRASE_MAX || existingKeys.has(key) || soundsLikeCaller(cleaned)) continue;
    existingKeys.add(key);
    result.push(cleaned);
  }
  if (!result.length) return result;
  const verdict = await llm.promptJson<{ checks: Array<{ n: number; ok: boolean }> }>(
    { system: EXPAND_SYSTEM, examples: [...EXPAND_EXAMPLES, [request, answer]], user: verifyRequest(question, result) },
    verifySchema(result.length),
    { temperature: 0, maxTokens: 60 + result.length * 40, seed, signal },
  );
  const rejected = new Set((verdict.checks ?? []).filter((check) => check.ok === false).map((check) => check.n));
  return result.filter((_, index) => !rejected.has(index + 1));
}

const verifyRequest = (question: string, candidates: string[]) =>
  `现在严格检查下面这些问法（已整理过），逐条判断能不能用在「${question}」下。ok 为 false 的情况：
- 意思和问题、已有说法不一样，或者加了原来没有的内容。
- 人称换了：“我”是客户、“你/你们”是机器人和它的公司，原来问“你知道我……”的变成了问“你是……”。
- 像销售或机器人说的话（推销、邀约、客套道别）。
- 不像打电话时会说的话，或者太笼统、放在别的问题下也说得通。
其余 ok 为 true。n 是下面的编号。
${candidates.map((phrase, index) => `${index + 1}. ${phrase}`).join("\n")}`;

const verifySchema = (count: number) => ({
  type: "object",
  properties: {
    checks: {
      type: "array",
      items: { type: "object", properties: { n: { type: "integer" }, ok: { type: "boolean" } } },
      minItems: count,
      maxItems: count,
    },
  },
}) as const;
