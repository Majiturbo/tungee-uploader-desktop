import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  APP_EDITION,
  editionBlurb,
  isLite,
  LITE_BADGE,
  PRODUCT_NAME,
  versionLabel,
  WINDOW_TITLE,
} from "../src/shared/edition.ts";

const require = createRequire(import.meta.url);

test("default build is standard (no TUNGE_EDITION at typecheck/test time)", () => {
  assert.equal(APP_EDITION, "standard");
  assert.equal(isLite(), false);
  assert.equal(WINDOW_TITLE, PRODUCT_NAME);
  assert.equal(versionLabel("2.2.1"), "2.2.1");
  assert.match(editionBlurb(), /标准版/);
  assert.equal(LITE_BADGE, "Lite");
});

test("the Windows installer defaults to the standard product names and LLM payload", () => {
  const edition = require("../installer/edition.cjs");
  assert.equal(edition.lite, false);
  assert.equal(edition.APP_NAME, "探迹话术上传助手");
  assert.equal(edition.FOLDER, "TungeeUploader");
  assert.deepEqual(edition.MODEL_DIR, ["resources", "models", "llm"]);
  const yml = require("node:fs").readFileSync(new URL("../installer/electron-builder.yml", import.meta.url), "utf8");
  assert.match(yml, /^\s+- edition\.cjs$/m);
});

test("Windows builds ship ffmpeg.exe so m4a does not go through Chromium", () => {
  const fs = require("node:fs");
  for (const name of ["electron-builder.win.yml", "electron-builder.win.lite.yml"]) {
    const yml = fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    assert.match(yml, /ffmpeg\/win32-x64\/ffmpeg\.exe/);
    assert.match(yml, /to: ffmpeg\/ffmpeg\.exe/);
  }
});

test("Windows unpacks the local AI worker so it can be forked outside asar", () => {
  const fs = require("node:fs");
  const yml = fs.readFileSync(new URL("../electron-builder.win.yml", import.meta.url), "utf8");
  assert.match(yml, /out\/main\/llm-worker\.js/);
});
