import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autoSequence,
  exactFileNumber,
  matchAudioFiles,
  namedFileNumber,
  type MatchFile,
  type MatchSlot,
} from "../src/main/audio-matching.ts";

const slots: MatchSlot[] = [
  { audioNumber: 1, label: "开场白", speech: "您好，我是法保网的顾问小李，打扰您一分钟时间。" },
  { audioNumber: 2, label: "产品介绍", speech: "我们专门为中小企业提供法律顾问服务，一年只要几千块。" },
  { audioNumber: 3, label: "客户邀约-意向邀约01", speech: "方便加一下您的微信吗，我把详细资料发给您看看。" },
  { audioNumber: 18, label: "价格多少", speech: "价格要看您企业的规模和需求，我们有好几个套餐可以选。" },
];

const pick = (result: ReturnType<typeof matchAudioFiles>, audioNumber: number) => {
  const slot = result.slots.find((item) => item.audioNumber === audioNumber);
  assert.ok(slot, `slot ${audioNumber}`);
  return slot;
};

const noSpeech = (...names: string[]): MatchFile[] => names.map((name) => ({ name, transcript: null }));

test("解析文件名编号", () => {
  assert.equal(exactFileNumber("18.wav"), 18);
  assert.equal(exactFileNumber("018.WAV"), 18);
  assert.equal(exactFileNumber("录音18.wav"), null);
  assert.equal(namedFileNumber("录音18.mp3"), null);
  assert.equal(namedFileNumber("编号18.mp3"), 18);
  assert.equal(namedFileNumber("第3条.m4a"), 3);
  assert.equal(namedFileNumber("02_产品介绍.m4a"), 2);
  assert.equal(namedFileNumber("2 产品介绍.m4a"), 2);
  assert.equal(namedFileNumber("新录音 2.m4a"), null);
  assert.equal(namedFileNumber("含糊话术01.wav"), null);
  assert.equal(autoSequence("新录音 12.m4a"), 12);
  assert.equal(autoSequence("新录音.m4a"), 1);
  assert.equal(autoSequence("产品介绍.m4a"), null);
});

test("文件名就是编号时全部自动匹配", () => {
  const result = matchAudioFiles(slots, noSpeech("1.wav", "2.wav", "3.wav", "18.wav"));
  for (const slot of result.slots) {
    assert.equal(slot.basis, "number");
    assert.equal(slot.needsReview, false);
    assert.equal(slot.fileName, `${slot.audioNumber}.wav`);
  }
  assert.deepEqual(result.unusedFiles, []);
});

test("文件名含编号、文件名等于模块名", () => {
  const result = matchAudioFiles(slots, noSpeech("01-开场.m4a", "编号2.mp3", "客户邀约-意向邀约01.wav", "价格多少.m4a"));
  assert.equal(pick(result, 1).basis, "name-number");
  assert.equal(pick(result, 2).basis, "name-number");
  assert.equal(pick(result, 3).fileName, "客户邀约-意向邀约01.wav");
  assert.equal(pick(result, 3).basis, "name");
  assert.equal(pick(result, 3).needsReview, false);
  assert.equal(pick(result, 18).fileName, "价格多少.m4a");
  assert.equal(pick(result, 18).needsReview, false);
});

test("文件名只沾一点边时需要确认", () => {
  const result = matchAudioFiles(slots, noSpeech("1.wav", "2.wav", "3.wav", "价格表.m4a"));
  const slot = pick(result, 18);
  assert.equal(slot.fileName, "价格表.m4a");
  assert.equal(slot.needsReview, true);
});

test("乱序的新录音按语音内容自动匹配", () => {
  const files: MatchFile[] = [
    { name: "新录音 1.m4a", transcript: "价格要看您企业的规模和需求我们有好几个套餐可以选" },
    { name: "新录音 2.m4a", transcript: "您好我是法宝网的顾问小李打扰您一分钟时间" },
    { name: "新录音 3.m4a", transcript: "方便加一下您的微信吗我把详细资料发给您看看" },
    { name: "新录音 4.m4a", transcript: "我们专门为中小企业提供法律顾问服务一年只要几千块" },
  ];
  const result = matchAudioFiles(slots, files);
  assert.equal(pick(result, 18).fileName, "新录音 1.m4a");
  assert.equal(pick(result, 1).fileName, "新录音 2.m4a");
  assert.equal(pick(result, 3).fileName, "新录音 3.m4a");
  assert.equal(pick(result, 2).fileName, "新录音 4.m4a");
  assert.ok(result.slots.every((slot) => slot.basis === "speech" && !slot.needsReview));
});

test("同一句录了两遍需要确认", () => {
  const files: MatchFile[] = [
    { name: "1.wav", transcript: null },
    { name: "新录音 5.m4a", transcript: "我们专门为中小企业提供法律顾问服务一年只要几千块" },
    { name: "新录音 6.m4a", transcript: "我们专门为中小企业提供法律顾问服务一年只要几千" },
  ];
  const result = matchAudioFiles(slots, files);
  const slot = pick(result, 2);
  assert.equal(slot.needsReview, true);
  assert.match(slot.reason ?? "", /重录/);
  assert.deepEqual(slot.candidates.map((item) => item.fileName).sort(), ["新录音 5.m4a", "新录音 6.m4a"]);
  assert.equal(slot.candidates[0]?.fileName, slot.fileName);
});

test("同一编号有多个文件需要确认", () => {
  const result = matchAudioFiles(slots, noSpeech("18.wav", "18.m4a"));
  const slot = pick(result, 18);
  assert.equal(slot.needsReview, true);
  assert.match(slot.reason ?? "", /同一编号/);
  assert.equal(slot.candidates.length, 2);
});

test("漏字、错字、口头语照样自动匹配", () => {
  const files: MatchFile[] = [
    { name: "新录音 1.m4a", transcript: "嗯价格这个要看你们公司规模我们有几个套餐" },
    { name: "新录音 2.m4a", transcript: "喂你好我是法保网小李打扰一下" },
    { name: "新录音 3.m4a", transcript: "那加个微信吧资料我发你" },
    { name: "新录音 4.m4a", transcript: "我们是给中小企业做法律顾问的一年几千块钱" },
  ];
  const result = matchAudioFiles(slots, files);
  assert.equal(pick(result, 18).fileName, "新录音 1.m4a");
  assert.equal(pick(result, 1).fileName, "新录音 2.m4a");
  assert.equal(pick(result, 3).fileName, "新录音 3.m4a");
  assert.equal(pick(result, 2).fileName, "新录音 4.m4a");
  assert.ok(result.slots.every((slot) => !slot.needsReview), JSON.stringify(result.slots.map((slot) => [slot.audioNumber, slot.score, slot.reason])));
});

test("录音很短时需要确认", () => {
  const result = matchAudioFiles(slots, [{ name: "新录音 1.m4a", transcript: "您好" }]);
  const matched = result.slots.find((slot) => slot.fileName === "新录音 1.m4a");
  assert.ok(!matched || matched.needsReview);
});

test("两句话术几乎一样时需要确认", () => {
  const similar: MatchSlot[] = [
    { audioNumber: 8, label: "结束话语01", speech: "好的，那先不打扰您了，祝您生活愉快，再见。" },
    { audioNumber: 9, label: "结束话语02", speech: "好的，那先不打扰您了，祝您工作顺利，再见。" },
  ];
  const clear = matchAudioFiles(similar, [{ name: "新录音 1.m4a", transcript: "好的那先不打扰您了祝您生活愉快再见" }]);
  assert.equal(pick(clear, 8).fileName, "新录音 1.m4a");
  assert.equal(pick(clear, 8).needsReview, false);
  const vague = matchAudioFiles(similar, [{ name: "新录音 1.m4a", transcript: "好的那先不打扰您了祝您再见" }]);
  const slot = vague.slots.find((item) => item.fileName === "新录音 1.m4a");
  assert.ok(slot);
  assert.equal(slot.needsReview, true);
  assert.match(slot.reason ?? "", /号话术几乎一样/);
});

test("没有语音识别时按录音顺序给建议", () => {
  const result = matchAudioFiles(slots, noSpeech("1.wav", "新录音 2.m4a", "新录音 10.m4a", "新录音 3.m4a"));
  assert.equal(pick(result, 1).basis, "number");
  assert.equal(pick(result, 2).fileName, "新录音 2.m4a");
  assert.equal(pick(result, 3).fileName, "新录音 3.m4a");
  assert.equal(pick(result, 18).fileName, "新录音 10.m4a");
  for (const audioNumber of [2, 3, 18]) {
    assert.equal(pick(result, audioNumber).basis, "order");
    assert.equal(pick(result, audioNumber).needsReview, true);
  }
});

test("已确认的结果优先且不再询问", () => {
  const decisions = new Map<number, string | null>([[2, "新录音 6.m4a"], [18, null]]);
  const files: MatchFile[] = [
    { name: "新录音 5.m4a", transcript: "我们专门为中小企业提供法律顾问服务一年只要几千块" },
    { name: "新录音 6.m4a", transcript: "我们专门为中小企业提供法律顾问服务一年只要几千" },
    { name: "18.wav", transcript: null },
  ];
  const result = matchAudioFiles(slots, files, decisions);
  assert.equal(pick(result, 2).fileName, "新录音 6.m4a");
  assert.equal(pick(result, 2).basis, "confirmed");
  assert.equal(pick(result, 2).needsReview, false);
  assert.equal(pick(result, 18).fileName, null);
  assert.equal(pick(result, 18).needsReview, false);
});

test("有剩余文件时，没匹配上的话术进入确认", () => {
  const result = matchAudioFiles(slots, [
    { name: "1.wav", transcript: null },
    { name: "2.wav", transcript: null },
    { name: "3.wav", transcript: null },
    { name: "备用.m4a", transcript: "今天天气不错" },
  ]);
  const slot = pick(result, 18);
  assert.equal(slot.fileName, null);
  assert.equal(slot.needsReview, true);
  assert.match(slot.reason ?? "", /没有找到/);
  assert.deepEqual(slot.candidates.map((item) => item.fileName), ["备用.m4a"]);
  assert.deepEqual(result.unusedFiles, ["备用.m4a"]);
});

const hints = { numbersAreHints: true };
const heard = (...pairs: Array<[string, string]>): MatchFile[] => pairs.map(([name, transcript]) => ({ name, transcript }));
const OPENING = "您好我是法保网的顾问小李打扰您一分钟时间";
const PRODUCT = "我们专门为中小企业提供法律顾问服务一年只要几千块";
const INVITE = "方便加一下您的微信吗我把详细资料发给您看看";
const PRICE = "价格要看您企业的规模和需求我们有好几个套餐可以选";

test("新建：编号和内容一致时照旧按编号，不用确认", () => {
  const result = matchAudioFiles(slots, heard(["1.wav", OPENING], ["2.wav", PRODUCT], ["3.wav", INVITE], ["18.wav", PRICE]), new Map(), hints);
  for (const slot of result.slots) {
    assert.equal(slot.fileName, `${slot.audioNumber}.wav`);
    assert.equal(slot.basis, "number");
    assert.equal(slot.needsReview, false);
  }
});

test("新建：数字命名和文字命名混在一起也能全部配上", () => {
  const result = matchAudioFiles(slots, heard(["1.wav", OPENING], ["新录音 2.m4a", INVITE], ["产品.m4a", PRODUCT], ["18.wav", PRICE]), new Map(), hints);
  assert.equal(pick(result, 1).fileName, "1.wav");
  assert.equal(pick(result, 2).fileName, "产品.m4a");
  assert.equal(pick(result, 3).fileName, "新录音 2.m4a");
  assert.equal(pick(result, 18).fileName, "18.wav");
  assert.ok(result.slots.every((slot) => !slot.needsReview));
});

test("新建：按录音顺序编的号和模板编号不一致时，整批按内容配", () => {
  const result = matchAudioFiles(slots, heard(["1.wav", PRICE], ["2.wav", OPENING], ["3.wav", PRODUCT], ["4.wav", INVITE]), new Map(), hints);
  assert.equal(pick(result, 18).fileName, "1.wav");
  assert.equal(pick(result, 1).fileName, "2.wav");
  assert.equal(pick(result, 2).fileName, "3.wav");
  assert.equal(pick(result, 3).fileName, "4.wav");
  assert.ok(result.slots.every((slot) => slot.basis === "speech" && !slot.needsReview), JSON.stringify(result.slots));
});

test("新建：个别编号写错时按内容配，并请人确认", () => {
  const result = matchAudioFiles(slots, heard(["1.wav", OPENING], ["2.wav", INVITE], ["3.wav", PRODUCT], ["18.wav", PRICE]), new Map(), hints);
  assert.equal(pick(result, 2).fileName, "3.wav");
  assert.equal(pick(result, 3).fileName, "2.wav");
  assert.match(pick(result, 2).reason ?? "", /文件名是 3 号，但听起来像这句/);
  assert.equal(pick(result, 2).needsReview, true);
  assert.equal(pick(result, 1).needsReview, false);
  assert.equal(pick(result, 18).needsReview, false);
});

test("新建：文件编号在模板里不存在时按内容配", () => {
  const result = matchAudioFiles(slots, heard(["21.wav", OPENING], ["22.wav", PRODUCT], ["23.wav", INVITE], ["24.wav", PRICE]), new Map(), hints);
  assert.equal(pick(result, 1).fileName, "21.wav");
  assert.equal(pick(result, 18).fileName, "24.wav");
  assert.ok(result.slots.every((slot) => slot.basis === "speech" && !slot.needsReview));
});

test("新建：编号文件录错了、另一条更像这句时请人确认", () => {
  const result = matchAudioFiles(slots, heard(["1.wav", "今天天气不错我们下次再聊"], ["开场白重录.m4a", OPENING], ["2.wav", PRODUCT], ["3.wav", INVITE], ["18.wav", PRICE]), new Map(), hints);
  const one = pick(result, 1);
  assert.equal(one.needsReview, true);
  assert.match(one.reason ?? "", /开场白重录\.m4a 听起来更像这句/);
  assert.ok(one.candidates.some((item) => item.fileName === "开场白重录.m4a"));
});

test("新建：识别不了内容时仍按编号", () => {
  const result = matchAudioFiles(slots, noSpeech("1.wav", "2.wav", "3.wav", "18.wav"), new Map(), hints);
  assert.ok(result.slots.every((slot) => slot.basis === "number" && !slot.needsReview));
});

test("没有剩余文件时，缺录音不打扰", () => {
  const result = matchAudioFiles(slots, noSpeech("1.wav", "2.wav"));
  assert.equal(pick(result, 3).needsReview, false);
  assert.equal(pick(result, 18).fileName, null);
});
