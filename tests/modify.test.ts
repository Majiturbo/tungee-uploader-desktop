import assert from "node:assert/strict";
import { test } from "node:test";
import { matchAudioFiles, type MatchSlot } from "../src/main/audio-matching.ts";
import type { AudioKnowledgeTask, AudioSpeechTask } from "../src/main/data-validation.ts";
import { buildModifyItems, type DiffInput } from "../src/main/talk-diff.ts";
import type { OnlineTalk } from "../src/shared/modify.ts";
import type { AudioMatchItem, AudioMatchSummary } from "../src/shared/types.ts";

const slots: MatchSlot[] = [
  { audioNumber: 1, label: "开场白", speech: "您好，我是法保网的顾问小李，打扰您一分钟时间。" },
  { audioNumber: 2, label: "产品介绍", speech: "我们专门为中小企业提供法律顾问服务，一年只要几千块。" },
  { audioNumber: 3, label: "客户邀约-意向邀约01", speech: "方便加一下您的微信吗，我把详细资料发给您看看。" },
  { audioNumber: 18, label: "价格多少", speech: "价格要看您企业的规模和需求，我们有好几个套餐可以选。" },
];
const rules = { numbersAreHints: true, partial: true };

test("修改模式：编号和内容一致时直接用，其余行没有录音也不用确认", () => {
  const result = matchAudioFiles(slots, [{ name: "2.wav", transcript: "我们专门为中小企业提供法律顾问服务一年只要几千块" }], new Map(), rules);
  const two = result.slots.find((slot) => slot.audioNumber === 2)!;
  assert.equal(two.fileName, "2.wav");
  assert.equal(two.needsReview, false);
  assert.ok(result.slots.filter((slot) => slot.audioNumber !== 2).every((slot) => slot.fileName === null && !slot.needsReview));
});

test("修改模式：文件名写 1 但内容像价格，不按编号替换，交给人确认", () => {
  const result = matchAudioFiles(slots, [{ name: "录音 1.m4a", transcript: "价格要看您企业的规模和需求我们有好几个套餐可以选" }, { name: "1.wav", transcript: "价格要看企业规模和需求有好几个套餐" }], new Map(), rules);
  const one = result.slots.find((slot) => slot.audioNumber === 1)!;
  assert.equal(one.fileName, null);
  assert.equal(one.needsReview, true);
  assert.ok(one.candidates.some((item) => item.fileName === "1.wav"));
  assert.equal(result.slots.find((slot) => slot.audioNumber === 18)!.fileName, "录音 1.m4a");
});

test("修改模式：没有语音识别时不按录音顺序猜", () => {
  const result = matchAudioFiles(slots, [{ name: "新录音 1.m4a", transcript: null }], new Map(), rules);
  assert.ok(result.slots.every((slot) => slot.fileName === null && !slot.needsReview));
  assert.deepEqual(result.unusedFiles, ["新录音 1.m4a"]);
});

function speech(sectionName: AudioSpeechTask["sectionName"], moduleName: string, audioNumber: number, text: string): AudioSpeechTask {
  return { moduleName, sectionName, audioNumber, speech: text, sheetName: "话术", sourceRow: audioNumber, audioPath: "", audioExists: false, audioNeedsConversion: false };
}

function knowledge(question: string, answer: string, audioNumber: number, commonQuestions: string): AudioKnowledgeTask {
  return { question, answer, audioNumber, commonQuestions, invalidQa: false, specialQa: false, sheetName: "话术", sourceRow: 100 + audioNumber, audioPath: "", audioExists: false, audioNeedsConversion: false };
}

function matchSummary(files: Array<[number, string, string]>): AudioMatchSummary {
  const items = files.map(([audioNumber, fileName]) => ({ audioNumber, fileName, basis: "speech", score: 0.9, needsReview: false, candidates: [] }) as unknown as AudioMatchItem);
  return {
    audioDir: "/tmp",
    items,
    files: files.map(([, name, transcript]) => ({ name, transcript })),
    unusedFiles: [],
    smart: true,
    autoCount: items.length,
    reviewCount: 0,
    failedFiles: [],
  };
}

const online: OnlineTalk = {
  talkName: "示例话术",
  readAt: "2026-09-29T00:00:00.000Z",
  categories: ["客户问答"],
  scenes: [
    { section: "开场白", index: 0, text: "喂,您好!", audioName: "1.wav" },
    { section: "产品介绍", index: 0, text: "我们做代理记账,一个月三百。", audioName: "2.wav" },
    { section: "含糊话术", index: 0, text: "不好意思,听的不是很清楚。", audioName: "14.wav" },
  ],
  questions: [
    { category: "客户问答", question: "价格多少", answer: "三百一个月", audioName: "18.wav", phrases: ["多少钱", "怎么收费"] },
    { category: "客户问答", question: "公司地址", answer: "在官渡区", audioName: "19.wav", phrases: ["你们在哪"] },
    { category: "客户问答", question: "老客户优惠", answer: "老客户打九折", audioName: "20.wav", phrases: ["有优惠吗"] },
  ],
};

test("比对：只列出有变化的，标点不同不算改", () => {
  const input: DiffInput = {
    flowTasks: [speech("开场白", "开场白", 1, "喂，您好！"), speech("产品介绍", "产品介绍", 2, "我们做代理记账，一个月两百。")],
    vagueTasks: [speech(null, "含糊话术01", 14, "不好意思，听的不是很清楚。")],
    knowledgeTasks: [
      knowledge("价格多少", "三百一个月", 18, "多少钱；怎么收费；贵不贵"),
      knowledge("公司地址", "在官渡区", 19, "你们在哪"),
      knowledge("能开发票吗", "可以开发票", 21, "开票吗"),
    ],
    audioMatch: matchSummary([[19, "地址.m4a", "在官渡区"], [21, "新录音 3.m4a", "可以开发票"]]),
  };
  const items = buildModifyItems(input, online);
  const byId = new Map(items.map((item) => [item.id, item]));

  assert.equal(byId.get("flow:开场白:0")!.status, "same");
  const product = byId.get("flow:产品介绍:0")!;
  assert.equal(product.status, "changed");
  assert.equal(product.textChanged, true);
  assert.deepEqual(product.warnings, ["文字改了，但没有新录音，线上还是旧录音"]);
  assert.equal(byId.get("vague:含糊话术:0")!.status, "same");

  const price = byId.get("knowledge:价格多少")!;
  assert.equal(price.phrasesChanged, true);
  assert.deepEqual(price.addedPhrases, ["贵不贵"]);
  assert.equal(price.textChanged, false);

  const address = byId.get("knowledge:公司地址")!;
  assert.equal(address.status, "changed");
  assert.equal(address.audioFile, "地址.m4a");
  assert.equal(address.textChanged, false);

  const invoice = byId.get("knowledge:能开发票吗")!;
  assert.equal(invoice.status, "new");
  assert.equal(invoice.selected, true);

  const oldOnly = byId.get("online:老客户优惠")!;
  assert.equal(oldOnly.status, "online-only");
  assert.equal(oldOnly.selected, false);
});

test("比对：新问题没有录音不加；录音念的是旧文字要提醒", () => {
  const input: DiffInput = {
    flowTasks: [speech("产品介绍", "产品介绍", 2, "我们做代理记账和工商注册，价格很实惠，您可以了解一下。")],
    vagueTasks: [],
    knowledgeTasks: [knowledge("能开发票吗", "可以开发票", 21, "开票吗")],
    audioMatch: matchSummary([[2, "2.wav", "我们做代理记账一个月三百"]]),
  };
  const items = buildModifyItems(input, online);
  const product = items.find((item) => item.id === "flow:产品介绍:0")!;
  assert.deepEqual(product.warnings, ["这条录音念的像修改前的文字"]);
  const invoice = items.find((item) => item.id === "knowledge:能开发票吗")!;
  assert.equal(invoice.status, "blocked");
  assert.equal(invoice.selected, false);
});
