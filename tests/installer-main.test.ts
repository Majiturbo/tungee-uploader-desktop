import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const APP_EXE = "探迹话术上传助手.exe";
const UNINSTALLER = "卸载探迹话术上传助手.exe";

// Runs the installer's main process against a fake Electron and a fake unzipped package in a temp folder.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "installer-main-"));
const unzipped = path.join(root, "unzipped");
const payload = path.join(unzipped, "安装文件");
fs.mkdirSync(path.join(payload, "resources", "models", "llm"), { recursive: true });
fs.writeFileSync(path.join(payload, APP_EXE), "app");
fs.writeFileSync(path.join(payload, "resources", "models", "llm", "model.gguf"), Buffer.alloc(64 * 1024, 1));
fs.writeFileSync(path.join(unzipped, "setup.exe"), "installer");
process.env.PORTABLE_EXECUTABLE_DIR = unzipped;
process.env.PORTABLE_EXECUTABLE_FILE = path.join(unzipped, "setup.exe");
process.env.LOCALAPPDATA = path.join(root, "local");

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const shortcuts: string[] = [];
const electron = {
  app: {
    setAppUserModelId() {},
    requestSingleInstanceLock: () => true,
    on() {},
    whenReady: () => new Promise(() => {}),
    getVersion: () => "2.0.0",
    getPath: (name: string) => path.join(root, "home", name),
    quit() {},
  },
  BrowserWindow: class {},
  dialog: {},
  nativeTheme: {},
  shell: {
    writeShortcutLink: (file: string) => {
      shortcuts.push(path.basename(path.dirname(file)));
      return true;
    },
  },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
    on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler),
  },
};

const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  if (request === "electron") return electron;
  if (request === "original-fs") return fs;
  return originalLoad.call(this, request, ...rest);
};
require("../installer/main.cjs");
loader._load = originalLoad;

const call = (name: string, ...args: unknown[]) => handlers.get(name)!(undefined, ...args) as Promise<Record<string, unknown>>;

test("the installer finds the unzipped files and sizes them", async () => {
  const info = await call("info");
  assert.equal(info.mode, "install");
  assert.equal(info.payload, true);
  assert.equal(info.required, 3 + 64 * 1024 + "installer".length);
  assert.equal(info.modelSize, 64 * 1024);
});

test("installing copies the app with its uninstaller and creates both shortcuts", async () => {
  const target = path.join(root, "disk", "TungeeUploader");
  const before = await call("check", target);
  assert.equal(before.writable, true);
  assert.equal(before.occupied, false);
  assert.equal(before.running, false);

  const result = await call("install", { path: target, desktop: true });

  assert.deepEqual(result, { ok: true });
  assert.equal(fs.readFileSync(path.join(target, APP_EXE), "utf8"), "app");
  assert.equal(fs.readFileSync(path.join(target, UNINSTALLER), "utf8"), "installer");
  assert.equal(fs.statSync(path.join(target, "resources", "models", "llm", "model.gguf")).size, 64 * 1024);
  assert.deepEqual(shortcuts.sort(), ["Programs", "desktop"]);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ["TungeeUploader"]);
});

test("installing again over the same folder updates it in place", async () => {
  const target = path.join(root, "disk", "TungeeUploader");
  fs.writeFileSync(path.join(payload, APP_EXE), "app v2");

  const result = await call("install", { path: target, desktop: false });

  assert.deepEqual(result, { ok: true });
  assert.equal(fs.readFileSync(path.join(target, APP_EXE), "utf8"), "app v2");
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ["TungeeUploader"]);
});

test("a folder with other files in it is refused with a clear message", async () => {
  const target = path.join(root, "disk", "Notes");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "notes.txt"), "keep");

  assert.equal((await call("check", target)).occupied, true);
  assert.deepEqual(await call("install", { path: target, desktop: false }), { error: "这个文件夹里有其他文件，换一个位置" });
  assert.equal(fs.readFileSync(path.join(target, "notes.txt"), "utf8"), "keep");
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));
