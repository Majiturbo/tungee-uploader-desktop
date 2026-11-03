import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AudioMatchStore, matchScope } from "../src/main/audio-match-store.ts";

test("confirmed matches carry over to a corrected copy without overriding its own", async () => {
  const store = new AudioMatchStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "match-")), "audio-match.json"));
  const stamps = new Map([["a.wav", { size: 10, mtimeMs: 1 }], ["b.wav", { size: 20, mtimeMs: 2 }]]);
  const original = matchScope("/tmp/话术.xlsx", "/tmp/录音");
  const fixed = matchScope("/tmp/话术-修正版.xlsx", "/tmp/录音");
  await store.saveDecisions(original, new Map<number, string | null>([[1, "a.wav"], [2, null]]), stamps);
  await store.saveDecisions(fixed, new Map([[1, "b.wav"]]), stamps);

  await store.copyDecisions(original, fixed);
  assert.deepEqual([...await store.decisions(fixed, stamps)].sort(), [[1, "b.wav"], [2, null]]);
  await store.copyDecisions(matchScope("/tmp/没有的.xlsx", "/tmp/录音"), fixed);
  assert.equal((await store.decisions(fixed, stamps)).size, 2);
});
