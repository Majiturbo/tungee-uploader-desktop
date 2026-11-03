import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { IntentAnalyzer } from "../src/main/intent-analyzer.ts";
import { LlmUnavailableError, type LocalLlm } from "../src/main/local-llm.ts";
import { buildIntentPlan, cardTitle, intentMarkdown, intentSetups, type IntentQuestion } from "../src/shared/intent-plan.ts";

function fakeLlm(answers: Record<string, { signal: string }>, calls: string[] = []): LocalLlm {
  return {
    promptJson: async (prompt: { user: string }, _schema: unknown, options?: { signal?: AbortSignal }) => {
      options?.signal?.throwIfAborted();
      const name = /问题名称：(.+)/.exec(prompt.user)?.[1] ?? "";
      calls.push(name);
      const answer = answers[name];
      if (!answer) throw new Error(`unexpected ${name}`);
      return answer;
    },
  } as unknown as LocalLlm;
}

const unavailableLlm = {
  promptJson: async () => {
    throw new LlmUnavailableError("没有找到本地 AI 模型文件");
  },
} as unknown as LocalLlm;

const tempCache = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "intent-")), "cache.json");

const tasks = [
  { question: "加我微信", commonQuestions: "你加我微信吧;加一下微信", invalidQa: false },
  { question: "价格介绍", commonQuestions: "多少钱;怎么收费", invalidQa: false },
  { question: "便宜一点/太贵了/优惠", commonQuestions: "太贵了;能便宜吗", invalidQa: false },
  { question: "考虑一下/再说", commonQuestions: "我考虑一下", invalidQa: false },
  { question: "公司叫什么", commonQuestions: "你们叫什么", invalidQa: false },
  { question: "系统提示", commonQuestions: "分机号", invalidQa: true },
  { question: "法律详细咨询", commonQuestions: "劳动纠纷怎么处理;合同纠纷能做吗", invalidQa: false },
  { question: "帮打官司", commonQuestions: "能帮我打官司吗", invalidQa: false },
  { question: "我们有法律顾问", commonQuestions: "我们有法务;有顾问了", invalidQa: false },
];

test("标准问题查参考表，行业问题交给模型，结果缓存", async () => {
  const calls: string[] = [];
  const llm = fakeLlm({
    法律详细咨询: { signal: "consult" },
    帮打官司: { signal: "objection" },
    我们有法律顾问: { signal: "objection" },
  }, calls);
  const cachePath = tempCache();
  const analyzer = new IntentAnalyzer(llm, cachePath);
  const progress: number[] = [];
  const analysis = await analyzer.analyze({ flowCount: 13, vagueCount: 4, knowledgeTasks: tasks }, { onProgress: (item) => progress.push(item.current) });

  assert.deepEqual(calls, ["法律详细咨询", "帮打官司", "我们有法律顾问"]);
  assert.deepEqual(progress, [0, 1, 2, 3]);
  assert.equal(analysis.questions.length, 8);
  assert.ok(!analysis.questions.some((question) => question.name === "系统提示"));
  assert.equal(analysis.questions.find((question) => question.name === "加我微信")?.source, "reference");
  const lawsuit = analysis.questions.find((question) => question.name === "帮打官司");
  assert.equal(lawsuit?.alternative, "consult");
  assert.ok(buildIntentPlan(analysis.questions).confirms.includes("「帮打官司」本地 AI 判为暂缓或异议，也可能算业务咨询。"));
  assert.equal(analysis.questions.find((question) => question.name === "法律详细咨询")?.alternative, undefined);
  assert.equal(analysis.modelUsed, true);

  const again = await new IntentAnalyzer(fakeLlm({}, calls), cachePath).analyze({ flowCount: 13, vagueCount: 4, knowledgeTasks: tasks });
  assert.equal(calls.length, 3);
  assert.deepEqual(again.questions.map((question) => question.signal), analysis.questions.map((question) => question.signal));
});

test("按 skill 规则组卡：询价单独 A 级、太贵归 C 级、在忙考虑不重复、身份确认不建", async () => {
  const analysis = await new IntentAnalyzer(fakeLlm({
    法律详细咨询: { signal: "consult" },
    帮打官司: { signal: "consult" },
    我们有法律顾问: { signal: "objection" },
  }), tempCache()).analyze({ flowCount: 13, vagueCount: 4, knowledgeTasks: tasks });
  const plan = buildIntentPlan(analysis.questions);
  const byId = Object.fromEntries(plan.cards.map((card) => [card.id, card]));

  assert.deepEqual(plan.cards.map((card) => card.id), ["action", "price", "consult", "objection"]);
  assert.equal(byId.action?.description, "要联系方式");
  assert.deepEqual(byId.price?.questions, ["价格介绍"]);
  assert.match(byId.price?.order ?? "", /「A级｜要联系方式」之后/);
  assert.deepEqual(byId.consult?.questions, ["法律详细咨询", "帮打官司"]);
  assert.deepEqual(byId.objection?.questions, ["便宜一点/太贵了/优惠", "我们有法律顾问"]);
  assert.equal(byId.objection?.description, "价格异议/已有合作");
  assert.ok(plan.skipped.some((item) => item.name === "考虑一下/再说" && /默认/.test(item.reason)));
  assert.ok(plan.skipped.some((item) => item.name === "公司叫什么"));

  const markdown = intentMarkdown(analysis, plan);
  assert.match(markdown, /本次建议新增 4 条意向/);
  assert.match(markdown, /- 知识库：9 条/);
  assert.match(markdown, /- 可用于意向设置的问题：8 条/);
  assert.match(markdown, /### 1\. A级｜要联系方式/);
  assert.ok(!markdown.includes("系统提示"));
});

test("自动设置：卡片转成网页设置，A/B 级排在主流程命中肯定之前，C 级排最后，描述不超过 19 字", () => {
  const questions: IntentQuestion[] = [
    { name: "加我微信", phrases: ["加个微信"], signal: "action", source: "reference" },
    { name: "给我发资料/短信/邮件", phrases: ["发资料"], signal: "action", source: "reference" },
    { name: "面谈", phrases: ["见面聊"], signal: "action", source: "reference" },
    { name: "产品演示/试用", phrases: ["演示一下"], signal: "action", source: "reference" },
    { name: "价格介绍", phrases: [], signal: "price", source: "reference" },
    { name: "办理周期", phrases: [], signal: "consult", source: "model" },
    { name: "优势/亮点", phrases: [], signal: "consult", source: "reference" },
    { name: "便宜一点/太贵了/优惠", phrases: ["太贵了"], signal: "objection", source: "reference" },
  ];
  const setups = intentSetups(buildIntentPlan(questions));
  assert.deepEqual(setups.map((setup) => [cardTitle(setup), setup.placement]), [
    ["A级｜要联系方式/资料/面谈/演示", "before-main-affirm"],
    ["A级｜主动询价", "before-main-affirm"],
    ["B级｜业务咨询/合作评估", "before-main-affirm"],
    ["C级｜价格异议", "end"],
  ]);
  assert.deepEqual(setups[2]?.questions, ["办理周期", "优势/亮点"]);
  assert.ok(setups.every((setup) => setup.match === "所有" && [...setup.description].length <= 19));

  const long = buildIntentPlan(questions);
  long.cards[0]!.description = "要联系方式/资料/面谈/演示/报价单/合同样本";
  assert.equal([...intentSetups(long)[0]!.description].length, 19);
});

test("只有一个业务咨询问题时不建 B 级；用户移动后重新组卡", () => {
  const questions: IntentQuestion[] = [
    { name: "办理周期", phrases: [], signal: "consult", source: "model" },
    { name: "加我微信", phrases: [], signal: "action", source: "reference" },
  ];
  assert.deepEqual(buildIntentPlan(questions).cards.map((card) => card.id), ["action"]);
  const moved = questions.map((question) => question.name === "办理周期" ? { ...question, signal: "action" as const, source: "user" as const } : question);
  assert.deepEqual(buildIntentPlan(moved).cards[0]?.questions, ["办理周期", "加我微信"]);
});

test("模型不可用时按关键词粗分并全部标需确认", async () => {
  const analysis = await new IntentAnalyzer(unavailableLlm, tempCache()).analyze({ flowCount: 13, vagueCount: 4, knowledgeTasks: tasks });
  assert.equal(analysis.modelUnavailable, "没有找到本地 AI 模型文件");
  assert.equal(analysis.modelUsed, false);
  const lawyer = analysis.questions.find((question) => question.name === "我们有法律顾问");
  assert.equal(lawyer?.source, "keyword");
  assert.equal(lawyer?.signal, "objection");
  assert.ok(buildIntentPlan(analysis.questions).confirms.some((item) => item.includes("法律详细咨询")));
});

test("取消分析时抛出中止错误", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new IntentAnalyzer(fakeLlm({}), tempCache()).analyze({ flowCount: 13, vagueCount: 4, knowledgeTasks: tasks }, { signal: controller.signal }),
    (error: Error) => error.name === "AbortError",
  );
});
