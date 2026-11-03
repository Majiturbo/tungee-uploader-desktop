import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AudioMatchStore } from "../src/main/audio-match-store.ts";
import { AudioMatcher } from "../src/main/audio-matcher.ts";
import type { MatchSlot } from "../src/main/audio-matching.ts";

const slots: MatchSlot[] = [
  { audioNumber: 1, label: "开场白", speech: "您好，我是法保网的顾问小李，打扰您一分钟时间。" },
  { audioNumber: 2, label: "产品介绍", speech: "我们专门为中小企业提供法律顾问服务，一年只要几千块。" },
];
const SAID: Record<string, string> = {
  "1.wav": "我们专门为中小企业提供法律顾问服务一年只要几千块",
  "2.wav": "您好我是法保网的顾问小李打扰您一分钟时间",
};

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-matcher-"));
  const audioDir = path.join(root, "audio");
  fs.mkdirSync(audioDir);
  for (const name of Object.keys(SAID)) fs.writeFileSync(path.join(audioDir, name), name);
  const heard: string[] = [];
  const decoded: string[] = [];
  const names = Object.keys(SAID);
  const matcher = new AudioMatcher({
    decode: async (filePath) => {
      decoded.push(path.basename(filePath));
      return new Float32Array(names.indexOf(path.basename(filePath)) + 1);
    },
    recognizer: {
      unavailableReason: null,
      transcribe: (samples) => {
        const name = names[samples.length - 1]!;
        heard.push(name);
        return SAID[name]!;
      },
    },
    store: new AudioMatchStore(path.join(root, "store.json")),
  });
  return { root, audioDir, heard, decoded, matcher };
}

test("头尾空白在识别时顺带分析，之后直接用缓存，不再解码", async () => {
  const { root, audioDir, decoded, matcher } = setup();
  fs.writeFileSync(path.join(audioDir, "3.wav"), "3.wav");
  await matcher.match(path.join(root, "话术.xlsx"), audioDir, slots, Object.keys(SAID), undefined, { numbersAreHints: true });
  decoded.length = 0;

  const trims = await matcher.trims(audioDir, ["1.wav", "2.wav", "3.wav"]);
  assert.deepEqual(decoded, ["3.wav"]);
  assert.deepEqual([...trims.keys()].sort(), ["1.wav", "2.wav", "3.wav"]);
  decoded.length = 0;
  await matcher.trims(audioDir, ["1.wav", "2.wav", "3.wav"]);
  assert.deepEqual(decoded, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("新建上传也会听带编号的录音，编号和内容对不上时按内容配", async () => {
  const { root, audioDir, heard, matcher } = setup();
  const outcome = await matcher.match(path.join(root, "话术.xlsx"), audioDir, slots, Object.keys(SAID), undefined, { numbersAreHints: true });
  assert.deepEqual(heard.sort(), ["1.wav", "2.wav"]);
  const fileFor = (audioNumber: number) => outcome.result.slots.find((slot) => slot.audioNumber === audioNumber)?.fileName;
  assert.equal(fileFor(1), "2.wav");
  assert.equal(fileFor(2), "1.wav");
  fs.rmSync(root, { recursive: true, force: true });
});
