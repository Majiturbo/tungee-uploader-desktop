import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { pickDefaultPath, resolveChosen, parseProbe, friendlyError, GB } = require("../installer/lib.cjs");

const always = () => true;
const base = { systemDrive: "C:", required: 3 * GB, localAppData: "C:\\Users\\User\\AppData\\Local", writable: always };

test("default install goes to the non-system drive with the most free space", () => {
  const drives = [
    { id: "C:", free: 500 * GB, total: 1000 * GB },
    { id: "D:", free: 80 * GB, total: 500 * GB },
    { id: "E:", free: 200 * GB, total: 500 * GB },
  ];
  assert.equal(pickDefaultPath({ ...base, drives }), "E:\\TungeeUploader");
});

test("default install falls back to the user programs folder when only the system drive fits", () => {
  const onlyC = [{ id: "C:", free: 500 * GB, total: 1000 * GB }];
  assert.equal(pickDefaultPath({ ...base, drives: onlyC }), "C:\\Users\\User\\AppData\\Local\\Programs\\TungeeUploader");
  const tightD = [...onlyC, { id: "D:", free: 3.5 * GB, total: 100 * GB }];
  assert.equal(pickDefaultPath({ ...base, drives: tightD }), "C:\\Users\\User\\AppData\\Local\\Programs\\TungeeUploader");
});

test("default install skips drives the user can't write to", () => {
  const drives = [
    { id: "D:", free: 300 * GB, total: 500 * GB },
    { id: "E:", free: 100 * GB, total: 500 * GB },
  ];
  assert.equal(pickDefaultPath({ ...base, drives, writable: (root: string) => root !== "D:\\" }), "E:\\TungeeUploader");
});

test("a picked folder gets its own subfolder unless it is empty or already ours", () => {
  const empty = new Set(["D:\\Tools", "D:\\TungeeUploader"]);
  const ours = new Set(["E:\\Apps\\Tungee"]);
  const options = { isOurs: (dir: string) => ours.has(dir), isEmpty: (dir: string) => empty.has(dir) };
  assert.equal(resolveChosen("D:\\", options), "D:\\TungeeUploader");
  assert.equal(resolveChosen("D:\\Software", options), "D:\\Software\\TungeeUploader");
  assert.equal(resolveChosen("D:\\Tools", options), "D:\\Tools");
  assert.equal(resolveChosen("D:\\TungeeUploader", options), "D:\\TungeeUploader");
  assert.equal(resolveChosen("E:\\Apps\\Tungee", options), "E:\\Apps\\Tungee");
});

test("an empty drive root still gets a subfolder", () => {
  assert.equal(resolveChosen("F:\\", { isOurs: () => false, isEmpty: () => true }), "F:\\TungeeUploader");
});

test("lite install uses a separate folder so it does not overwrite the standard copy", () => {
  const drives = [{ id: "D:", free: 200 * GB, total: 500 * GB }];
  assert.equal(pickDefaultPath({ ...base, drives, folder: "TungeeUploaderLite" }), "D:\\TungeeUploaderLite");
  assert.equal(
    resolveChosen("D:\\Software", { isOurs: () => false, isEmpty: () => false, folder: "TungeeUploaderLite" }),
    "D:\\Software\\TungeeUploaderLite",
  );
});

test("PowerShell output with one drive, several drives or none is read the same way", () => {
  assert.deepEqual(parseProbe('{"drives":{"id":"C:","free":10,"size":20},"existing":null}'), {
    drives: [{ id: "C:", free: 10, total: 20 }],
    existing: null,
  });
  assert.deepEqual(parseProbe('{"drives":[{"id":"c:","free":1,"size":2},{"id":"D:","free":3,"size":4}],"existing":"D:\\\\TungeeUploader"}'), {
    drives: [{ id: "C:", free: 1, total: 2 }, { id: "D:", free: 3, total: 4 }],
    existing: "D:\\TungeeUploader",
  });
  assert.deepEqual(parseProbe('{"existing":"  "}'), { drives: [], existing: null });
  assert.deepEqual(parseProbe(""), { drives: [], existing: null });
});

test("file errors become short instructions", () => {
  assert.equal(friendlyError({ code: "ENOSPC" }), "磁盘空间不够了，换个位置");
  assert.equal(friendlyError({ code: "EPERM" }), "没有权限写入这个位置，换一个位置");
  assert.equal(friendlyError({ code: "EXDEV" }), "复制文件时出错（EXDEV）");
  assert.equal(friendlyError(new Error("boom")), "复制文件时出错");
});
