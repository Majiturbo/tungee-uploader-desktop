import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCheckup, normalizeCommonQuestions, rewritePhraseCell, splitPhrases, stripFillers } from "../src/main/script-checkup.ts";
import { SYSTEM_PROMPT_PHRASES } from "../src/main/system-prompt-phrases.ts";

test("去掉问法里的语气词", () => {
  assert.equal(stripFillers("嗯"), null);
  assert.equal(stripFillers("嗯嗯"), null);
  assert.equal(stripFillers("哈哈"), null);
  assert.equal(stripFillers("额"), null);
  assert.equal(stripFillers("嗯，拜拜"), "拜拜");
  assert.equal(stripFillers("嗯拜拜"), "拜拜");
  assert.equal(stripFillers("啊，你说什么"), "你说什么");
  assert.equal(stripFillers("好的嗯"), "好的");
  assert.equal(stripFillers("额度多少"), "额度多少");
  assert.equal(stripFillers("就这样吧"), "就这样吧");
  assert.equal(stripFillers("你好啊"), "你好啊");
  assert.equal(stripFillers("我是机主的小爱助理，你有什么事情吗"), "我是机主的小爱助理，你有什么事情吗");
});

test("上传前整理问法：语气词去掉、重复合并、分隔符保留", () => {
  assert.equal(normalizeCommonQuestions("拜拜", "嗯，拜拜；拜拜；再见；就这样吧；"), "拜拜；再见；就这样吧；");
  assert.equal(normalizeCommonQuestions("拜拜", "嗯拜拜；拜拜；再见；就这样吧"), "拜拜；再见；就这样吧");
  assert.equal(normalizeCommonQuestions("价格", "多少钱;怎么收费"), "多少钱;怎么收费");
});

test("系统提示问法换成最新完整版，原有的其他问法保留", () => {
  const old = "按一号键直接留言留言;你拨打的号码是空号;我们自己加的一句";
  const result = normalizeCommonQuestions("系统提示", old);
  const phrases = splitPhrases(result);
  assert.deepEqual(phrases.slice(0, SYSTEM_PROMPT_PHRASES.length), [...SYSTEM_PROMPT_PHRASES]);
  assert.equal(phrases.at(-1), "我们自己加的一句");
  assert.equal(phrases.length, SYSTEM_PROMPT_PHRASES.length + 1);
  assert.equal(new Set(SYSTEM_PROMPT_PHRASES).size, SYSTEM_PROMPT_PHRASES.length);
  assert.equal(normalizeCommonQuestions("系统提示", result), result);
});

test("话术体检：无效QA里的语气词和系统提示也会提醒并可一键修正", () => {
  const plan = buildCheckup({
    flowTasks: [],
    vagueTasks: [],
    knowledgeTasks: [
      { question: "拜拜", commonQuestions: "嗯，拜拜；拜拜；再见；就这样吧；", answer: "再见", invalidQa: true, sourceRow: 57 },
      { question: "系统提示", commonQuestions: "分机号;挂机通知", answer: "嗯", invalidQa: true, sourceRow: 51 },
    ],
  });
  const kinds = plan.result.findings.map((finding) => `${finding.kind}:${finding.rowNumbers.join(",")}`);
  assert.ok(kinds.includes("filler-phrase:57"));
  assert.ok(kinds.includes("system-prompt:51"));
  const decisions = Object.fromEntries(plan.result.findings.filter((finding) => finding.defaultOption).map((finding) => [finding.id, finding.defaultOption!]));
  const { edits } = plan.apply(decisions);
  assert.equal(rewritePhraseCell("嗯，拜拜；拜拜；再见；就这样吧；", edits.get(57)!), "拜拜；再见；就这样吧；");
  assert.equal(splitPhrases(rewritePhraseCell("分机号;挂机通知", edits.get(51)!)).length, SYSTEM_PROMPT_PHRASES.length);
});

test("系统提示已是完整版时不提醒（读表时全角逗号会变成半角）", () => {
  const plan = buildCheckup({
    flowTasks: [],
    vagueTasks: [],
    knowledgeTasks: [
      { question: "系统提示", commonQuestions: SYSTEM_PROMPT_PHRASES.join(";").normalize("NFKC"), answer: "嗯", invalidQa: true, sourceRow: 51 },
    ],
  });
  assert.equal(plan.result.findings.filter((finding) => finding.kind === "system-prompt").length, 0);
});

test("勾选的补充问法追加到末尾：去重、跳过别的问题已有的、无效QA也能补", () => {
  const plan = buildCheckup({
    flowTasks: [],
    vagueTasks: [],
    knowledgeTasks: [
      { question: "价格", commonQuestions: "多少钱；怎么收费；", answer: "看情况", invalidQa: false, sourceRow: 10 },
      { question: "地址", commonQuestions: "你们在哪", answer: "在上海", invalidQa: false, sourceRow: 11 },
      { question: "拜拜", commonQuestions: "再见", answer: "再见", invalidQa: true, sourceRow: 12 },
    ],
  });
  const { edits, appliedCount } = plan.apply({}, {
    10: ["收费标准是啥", "多少钱。", "你们在哪", " 贵不贵；便宜点 ", "收费标准是啥", ""],
    11: ["", "   "],
    12: ["拜拜了"],
    99: ["不存在的行"],
  });
  assert.equal(appliedCount, 2);
  assert.deepEqual([...edits.keys()], [10, 12]);
  assert.equal(rewritePhraseCell("多少钱；怎么收费；", edits.get(10)!), "多少钱；怎么收费；收费标准是啥；贵不贵，便宜点；");
  assert.equal(rewritePhraseCell("再见", edits.get(12)!), "再见;拜拜了");
  assert.deepEqual(plan.phraseOwner("你们在哪"), [11]);
});

test("补充问法和其他修正同时作用在一个单元格", () => {
  const plan = buildCheckup({
    flowTasks: [],
    vagueTasks: [],
    knowledgeTasks: [{ question: "价格", commonQuestions: "嗯，多少钱;多少钱", answer: "看情况", invalidQa: false, sourceRow: 5 }],
  });
  const decisions = Object.fromEntries(plan.result.findings.filter((finding) => finding.defaultOption).map((finding) => [finding.id, finding.defaultOption!]));
  const { edits } = plan.apply(decisions, { 5: ["多少钱", "咋收费"] });
  assert.equal(rewritePhraseCell("嗯，多少钱;多少钱", edits.get(5)!), "多少钱;咋收费");
});
