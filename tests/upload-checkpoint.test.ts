import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { UploadCheckpointStore, checkpointKey } from "../src/main/upload-checkpoint.ts";
import type { UploadConfig } from "../src/shared/types.ts";

const config = (overrides: Partial<UploadConfig> = {}): UploadConfig => ({
  workbookPath: "/tmp/话术.xlsx",
  audioDir: "/tmp/录音",
  talkName: "示例话术",
  categoryName: "客户问答",
  submitReview: false,
  ...overrides,
});

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-"));

test("checkpoint survives a rename but not a different file set", async () => {
  const store = new UploadCheckpointStore(tempDir());
  await store.save({ key: checkpointKey(config()), talkName: "示例话术-2", scenes: [1, 2], questions: [{ question: "多少钱", audioNumber: 12 }], updatedAt: "" });

  const info = await store.info(config({ talkName: "别的名字" }));
  assert.equal(info?.talkName, "示例话术-2");
  assert.deepEqual(info?.doneAudioNumbers, [1, 2, 12]);
  assert.ok(info?.updatedAt);

  assert.equal(await store.info(config({ audioDir: "/tmp/另一批录音" })), null);
  assert.equal(await store.info(config({ categoryName: "其他分类" })), null);
});

test("clear removes the checkpoint and a broken file reads as none", async () => {
  const dir = tempDir();
  const store = new UploadCheckpointStore(dir);
  await store.save({ key: checkpointKey(config()), talkName: "示例话术", scenes: [], questions: [], updatedAt: "" });
  await store.clear();
  assert.equal(await store.load(config()), null);

  fs.writeFileSync(path.join(dir, "upload-checkpoint.json"), "{broken");
  assert.equal(await store.load(config()), null);
});

test("a corrected copy continues the upload started from the original", async () => {
  const store = new UploadCheckpointStore(tempDir());
  await store.save({ key: checkpointKey(config()), talkName: "示例话术", scenes: [1], questions: [], updatedAt: "" });

  assert.equal(await store.info(config({ workbookPath: "/tmp/话术-修正版.xlsx" })), null);
  await store.link("/tmp/话术.xlsx", "/tmp/话术-修正版.xlsx");
  assert.deepEqual((await store.info(config({ workbookPath: "/tmp/话术-修正版.xlsx" })))?.doneAudioNumbers, [1]);
  assert.ok(await store.info(config()));

  await store.link("/tmp/话术-修正版.xlsx", "/tmp/话术-修正版2.xlsx");
  assert.ok(await store.info(config({ workbookPath: "/tmp/话术-修正版2.xlsx" })));
  assert.equal(await store.info(config({ workbookPath: "/tmp/话术-修正版2.xlsx", audioDir: "/tmp/另一批录音" })), null);

  await store.link("/tmp/别的话术.xlsx", "/tmp/别的话术-修正版.xlsx");
  assert.equal(await store.info(config({ workbookPath: "/tmp/别的话术-修正版.xlsx" })), null);
});
