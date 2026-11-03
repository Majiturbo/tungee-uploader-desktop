import assert from "node:assert/strict";
import { test } from "node:test";
import { expandPhrases, soundsLikeCaller, tidyPhrase } from "../src/main/ai-checkup.ts";
import type { LocalLlm } from "../src/main/local-llm.ts";

test("销售口吻的问法会被识别出来", () => {
  for (const phrase of ["要办营业执照变更吗", "需要改企业登记信息吗", "想更新公司注册资料吗", "有工商登记变更需求吗",
    "需要变更公司登记吗", "想改下企业执照吗", "您需要办理工商变更吗", "要不要了解一下", "请问您有没有兴趣",
    "好的，不打扰了", "那不打扰您了", "祝您生活愉快", "稍后加您微信"]) {
    assert.equal(soundsLikeCaller(phrase), true, phrase);
  }
});

test("客户口吻的问法保留", () => {
  for (const phrase of ["你们能办工商变更吗", "变更法人要多少钱", "我想改个公司名字", "要多少钱", "需要什么材料吗",
    "想问下价格", "有优惠吗", "要不要提前预约", "你们这个要收费吗", "变更要多久",
    "我先挂了", "你知道我是干嘛的吗", "你加我微信吧"]) {
    assert.equal(soundsLikeCaller(phrase), false, phrase);
  }
});

const fakeLlm = (phrases: string[], rejected: number[] = []) => {
  const checked: string[][] = [];
  const llm = {
    promptJson: async (prompt: { system: string; user: string; examples?: unknown[] }) => {
      assert.match(prompt.system, /被叫的客户/);
      if (!prompt.user.startsWith("现在严格检查")) return { phrases };
      const candidates = prompt.user.split("\n").filter((line) => /^\d+\. /.test(line));
      checked.push(candidates);
      return { checks: candidates.map((_, index) => ({ n: index + 1, ok: !rejected.includes(index + 1) })) };
    },
  } as unknown as LocalLlm;
  return { llm, checked };
};

test("AI 写出的销售口吻问法不会出现在候选里", async () => {
  const { llm } = fakeLlm(["要办营业执照变更吗", "你们能办工商变更吗", "变更法人要多少钱", "需要变更公司登记吗", "公司变更"]);
  const phrases = await expandPhrases(llm, "公司变更/工商变更", ["公司变更"], "");
  assert.deepEqual(phrases, ["你们能办工商变更吗", "变更法人要多少钱"]);
});

test("问法去掉语气词，太短太长的不要", async () => {
  assert.equal(tidyPhrase("好的，我先挂了啊。"), "我先挂了");
  assert.equal(tidyPhrase("嗯嗯那个，你们怎么收费呢？"), "你们怎么收费");
  assert.equal(tidyPhrase("行不行"), "行不行");
  assert.equal(tidyPhrase("你知道我是干嘛"), "你知道我是干嘛");
  const { llm } = fakeLlm(["好的", "多少", "那你们这个变更一般整个流程下来大概需要多长时间", "变更要多久"]);
  assert.deepEqual(await expandPhrases(llm, "办理时间", ["多久能办好"], ""), ["变更要多久"]);
});

test("AI 复核判为不合适的问法会去掉", async () => {
  const { llm, checked } = fakeLlm(["你知道我干啥的吗", "你到底是做什么的", "我做哪行你清楚吗"], [2]);
  assert.deepEqual(await expandPhrases(llm, "你知道我是做什么的吗", ["你知道我是谁吗"], ""), ["你知道我干啥的吗", "我做哪行你清楚吗"]);
  assert.equal(checked[0].length, 3);
});
