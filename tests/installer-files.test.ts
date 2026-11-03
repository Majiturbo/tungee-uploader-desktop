import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createFiles, overlaps } = require("../installer/files.cjs");

const MARKER = "app.exe";
const UNINSTALLER = "uninstall.exe";
const files = createFiles(fs, MARKER, [UNINSTALLER]);

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "installer-files-"));
}

function makePayload(root: string, version: string): void {
  fs.mkdirSync(path.join(root, "resources", "models"), { recursive: true });
  fs.writeFileSync(path.join(root, MARKER), version);
  fs.writeFileSync(path.join(root, "resources", "models", "model.bin"), Buffer.alloc(256 * 1024, 7));
}

async function installInto(payload: string, target: string, signal = new AbortController().signal, using = files): Promise<number> {
  const jobs = await using.listFiles(payload);
  let bytes = 0;
  await using.installInto(jobs, target, signal, (_job: unknown, count: number) => {
    bytes += count;
  });
  return bytes;
}

/** Behaves like Windows, where mkdir on an existing drive root fails with EPERM even with `recursive`. */
function windowsLikeFs() {
  const mkdir = (dir: string, options: fs.MakeDirectoryOptions) =>
    fs.existsSync(dir) ? Promise.reject(Object.assign(new Error(`EPERM: mkdir '${dir}'`), { code: "EPERM", syscall: "mkdir", path: dir })) : fs.promises.mkdir(dir, options);
  return { ...fs, promises: { ...fs.promises, mkdir } };
}

test("a fresh install copies every file and reports every byte", async () => {
  const root = scratch();
  const payload = path.join(root, "payload");
  makePayload(payload, "v1");
  const target = path.join(root, "TungeeUploader");

  const bytes = await installInto(payload, target);

  assert.equal(fs.readFileSync(path.join(target, MARKER), "utf8"), "v1");
  assert.equal(fs.statSync(path.join(target, "resources", "models", "model.bin")).size, 256 * 1024);
  assert.equal(bytes, 2 + 256 * 1024);
  assert.deepEqual(fs.readdirSync(root).sort(), ["TungeeUploader", "payload"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("updating replaces the old install and leaves nothing behind", async () => {
  const root = scratch();
  const target = path.join(root, "TungeeUploader");
  makePayload(path.join(root, "v1"), "v1");
  makePayload(path.join(root, "v2"), "v2");
  await installInto(path.join(root, "v1"), target);
  fs.writeFileSync(path.join(target, "stale.txt"), "old");

  await installInto(path.join(root, "v2"), target);

  assert.equal(fs.readFileSync(path.join(target, MARKER), "utf8"), "v2");
  assert.equal(fs.existsSync(path.join(target, "stale.txt")), false);
  assert.deepEqual(fs.readdirSync(root).sort(), ["TungeeUploader", "v1", "v2"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("installing never creates folders that already exist, so a drive root works", async () => {
  const root = scratch();
  const payload = path.join(root, "payload");
  makePayload(payload, "v1");
  const target = path.join(root, "TungeeUploader");
  const windows = createFiles(windowsLikeFs(), MARKER);

  await installInto(payload, target, undefined, windows);
  await installInto(payload, target, undefined, windows);

  assert.equal(fs.readFileSync(path.join(target, MARKER), "utf8"), "v1");
  assert.deepEqual(fs.readdirSync(root).sort(), ["TungeeUploader", "payload"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("cancelling a fresh install leaves nothing behind", async () => {
  const root = scratch();
  const payload = path.join(root, "payload");
  makePayload(payload, "v1");
  const target = path.join(root, "TungeeUploader");
  const controller = new AbortController();
  const jobs = await files.listFiles(payload);

  await assert.rejects(
    files.installInto(jobs, target, controller.signal, () => controller.abort()),
    (error: Error) => error.name === "AbortError",
  );
  assert.deepEqual(fs.readdirSync(root), ["payload"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a failed update puts the old install back", async () => {
  const root = scratch();
  const target = path.join(root, "TungeeUploader");
  makePayload(path.join(root, "v1"), "v1");
  makePayload(path.join(root, "v2"), "v2");
  await installInto(path.join(root, "v1"), target);
  const jobs = [...(await files.listFiles(path.join(root, "v2"))), { src: path.join(root, "missing.bin"), rel: "missing.bin", size: 1 }];

  await assert.rejects(files.installInto(jobs, target, new AbortController().signal, () => {}), (error: NodeJS.ErrnoException) => error.code === "ENOENT");

  assert.equal(fs.readFileSync(path.join(target, MARKER), "utf8"), "v1");
  assert.deepEqual(fs.readdirSync(root).sort(), ["TungeeUploader", "v1", "v2"]);
  fs.rmSync(root, { recursive: true, force: true });
});

/** Behaves like Windows with an Explorer window open in the install folder, or a program running from it:
 * the folder can't be renamed, and neither can the files in `held`. */
function heldFs(folder: string, held: string[] = []) {
  const rename = (from: string, to: string) =>
    from === folder || held.includes(from)
      ? Promise.reject(Object.assign(new Error(`EPERM: rename '${from}'`), { code: "EPERM", syscall: "rename", path: from }))
      : fs.promises.rename(from, to);
  return { ...fs, promises: { ...fs.promises, rename } };
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(
    (fs.readdirSync(dir, { recursive: true }) as string[])
      .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
      .map((rel) => [rel, fs.readFileSync(path.join(dir, rel)).toString("hex").slice(0, 16)]),
  );
}

test("an install folder that can't be renamed is updated file by file", async () => {
  const root = scratch();
  const target = path.join(root, "TungeeUploader");
  makePayload(path.join(root, "v1"), "v1");
  makePayload(path.join(root, "v2"), "v2");
  await installInto(path.join(root, "v1"), target);
  fs.writeFileSync(path.join(target, "stale.txt"), "old");

  await installInto(path.join(root, "v2"), target, undefined, createFiles(heldFs(target), MARKER, [UNINSTALLER]));

  assert.equal(fs.readFileSync(path.join(target, MARKER), "utf8"), "v2");
  assert.equal(fs.existsSync(path.join(target, "stale.txt")), false);
  assert.deepEqual(fs.readdirSync(target).sort(), [MARKER, "resources"].sort());
  assert.deepEqual(fs.readdirSync(root).sort(), ["TungeeUploader", "v1", "v2"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a failed file-by-file update puts every old file back", async () => {
  const root = scratch();
  const target = path.join(root, "TungeeUploader");
  makePayload(path.join(root, "v1"), "v1");
  makePayload(path.join(root, "v2"), "v2");
  await installInto(path.join(root, "v1"), target);
  const before = snapshot(target);
  const jobs = [...(await files.listFiles(path.join(root, "v2"))), { src: path.join(root, "missing.bin"), rel: "missing.bin", size: 1 }];
  const held = createFiles(heldFs(target), MARKER, [UNINSTALLER]);

  await assert.rejects(held.installInto(jobs, target, new AbortController().signal, () => {}), (error: NodeJS.ErrnoException) => error.code === "ENOENT");

  assert.deepEqual(snapshot(target), before);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a file another program won't let go of stops the update and keeps the old version whole", async () => {
  const root = scratch();
  const target = path.join(root, "TungeeUploader");
  makePayload(path.join(root, "v1"), "v1");
  makePayload(path.join(root, "v2"), "v2");
  await installInto(path.join(root, "v1"), target);
  const before = snapshot(target);
  const held = createFiles(heldFs(target, [path.join(target, "resources", "models", "model.bin")]), MARKER, [UNINSTALLER]);

  await assert.rejects(installInto(path.join(root, "v2"), target, undefined, held), (error: NodeJS.ErrnoException) => error.code === "LOCKED");

  assert.deepEqual(snapshot(target), before);
  fs.rmSync(root, { recursive: true, force: true });
});

test("old files a previous update couldn't delete are cleared by the next one", async () => {
  const root = scratch();
  const target = path.join(root, "TungeeUploader");
  makePayload(path.join(root, "v2"), "v2");
  makePayload(target, "v1");
  folderWith(target, ".tungee-old-1", [MARKER, "ffmpeg.dll"]);

  assert.equal(files.isOurs(target), true);
  await installInto(path.join(root, "v2"), target);

  assert.deepEqual(fs.readdirSync(target).sort(), [MARKER, "resources"].sort());
  fs.rmSync(root, { recursive: true, force: true });
});

test("a folder holding someone else's files is never overwritten", async () => {
  const root = scratch();
  const payload = path.join(root, "payload");
  makePayload(payload, "v1");
  const target = path.join(root, "Documents");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "notes.txt"), "keep me");

  await assert.rejects(installInto(payload, target), (error: NodeJS.ErrnoException) => error.code === "OCCUPIED");
  assert.equal(fs.readFileSync(path.join(target, "notes.txt"), "utf8"), "keep me");
  fs.rmSync(root, { recursive: true, force: true });
});

function folderWith(root: string, name: string, entries: string[]): string {
  const dir = path.join(root, name);
  for (const entry of entries) {
    fs.mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
    fs.writeFileSync(path.join(dir, entry), "x");
  }
  return dir;
}

test("what an unfinished uninstall or install leaves behind still counts as ours and is replaced", async () => {
  const root = scratch();
  const payload = path.join(root, "payload");
  makePayload(payload, "v2");
  const afterUninstall = folderWith(root, "A", [UNINSTALLER]);
  const halfCopied = folderWith(root, "B", ["chrome_100_percent.pak", "ffmpeg.dll", "icudtl.dat", "locales/zh-CN.pak", "resources/app.asar"]);

  assert.equal(files.isOurs(afterUninstall), true);
  assert.equal(files.isOurs(halfCopied), true);
  for (const target of [afterUninstall, halfCopied]) {
    await installInto(payload, target);
    assert.equal(fs.readFileSync(path.join(target, MARKER), "utf8"), "v2");
  }
  assert.equal(fs.existsSync(path.join(halfCopied, "ffmpeg.dll")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("leftover-looking folders with anything else in them are not ours", () => {
  const root = scratch();
  assert.equal(files.isOurs(folderWith(root, "A", [UNINSTALLER, "notes.docx"])), false);
  assert.equal(files.isOurs(folderWith(root, "B", ["resources/app.asar", "other-app.exe", "ffmpeg.dll"])), false);
  assert.equal(files.isOurs(folderWith(root, "C", ["resources/data.json", "LICENSE.txt"])), false);
  assert.equal(files.isOurs(path.join(root, "missing")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a set-aside copy left by an interrupted update is cleaned up by the next install", async () => {
  const root = scratch();
  const payload = path.join(root, "payload");
  makePayload(payload, "v2");
  const target = path.join(root, "TungeeUploader");
  makePayload(`${target}~old`, "v1");

  await installInto(payload, target);

  assert.deepEqual(fs.readdirSync(root).sort(), ["TungeeUploader", "payload"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("an empty folder is used as the install folder", async () => {
  const root = scratch();
  const payload = path.join(root, "payload");
  makePayload(payload, "v1");
  const target = path.join(root, "Empty");
  fs.mkdirSync(target);

  await installInto(payload, target);
  assert.equal(files.isOurs(target), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("folder checks see through missing parents", () => {
  const root = scratch();
  assert.equal(files.nearestExisting(path.join(root, "a", "b", "c")), root);
  assert.equal(files.canWrite(root), true);
  assert.equal(files.isEmptyDir(path.join(root, "missing")), true);
  fs.rmSync(root, { recursive: true, force: true });
});

/** A minimal asar: a pickled JSON header followed by the file contents. */
function writeAsar(file: string, contents: Record<string, string>): void {
  const bodies = Object.values(contents).map((text) => Buffer.from(text));
  let offset = 0;
  const entries = Object.fromEntries(
    Object.keys(contents).map((name, index) => {
      const entry = { size: bodies[index].length, offset: String(offset) };
      offset += bodies[index].length;
      return [name, entry];
    }),
  );
  const json = Buffer.from(JSON.stringify({ files: entries }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4)]);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded.length, 4);
  head.writeUInt32LE(4 + padded.length, 8);
  head.writeUInt32LE(json.length, 12);
  fs.writeFileSync(file, Buffer.concat([head, padded, ...bodies]));
}

test("reads a JSON file out of an asar archive and lets go of it", () => {
  const root = scratch();
  const archive = path.join(root, "app.asar");
  writeAsar(archive, { "index.js": "console.log(1)", "package.json": JSON.stringify({ version: "2.0.0" }) });

  assert.equal(files.readAsarJson(archive, "package.json").version, "2.0.0");
  fs.renameSync(root, `${root}-moved`);
  fs.rmSync(`${root}-moved`, { recursive: true, force: true });
});

test("overlapping folders are detected in both directions", () => {
  assert.equal(overlaps("/data/TungeeUploader", "/data/TungeeUploader/resources/x"), true);
  assert.equal(overlaps("/data/TungeeUploader/sub", "/data/TungeeUploader"), true);
  assert.equal(overlaps("/data/TungeeUploader", "/data/TungeeUploader2"), false);
});
