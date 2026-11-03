// Renders every installer screen with a fake bridge into installer/preview/*.png.
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const GB = 1024 ** 3;
const page = pathToFileURL(path.join(__dirname, "../app/index.html")).href;
const out = path.join(__dirname, "../preview");

const base = {
  info: { mode: "install", version: "2.2.1", payload: true, required: 2.9 * GB, existing: null, modelSize: 2.3 * GB, defaultPath: "D:\\TungeeUploader" },
  check: { drive: "D", free: 812 * GB, total: 931 * GB, writable: true, running: false },
};
const installed = { ...base.info, existing: "D:\\TungeeUploader", installedVersion: "2.1.0", desktopShortcut: true };

const scenes = [
  { name: "01-安装位置", ...base },
  { name: "02-只有C盘", info: { ...base.info, defaultPath: "C:\\Users\\User\\AppData\\Local\\Programs\\TungeeUploader" }, check: { ...base.check, drive: "C", free: 96 * GB, total: 237 * GB } },
  { name: "03-升级", info: installed, check: base.check },
  { name: "04-空间不够", info: base.info, check: { ...base.check, free: 1.7 * GB } },
  { name: "05-需要管理员", info: { ...base.info, defaultPath: "C:\\Program Files\\TungeeUploader" }, check: { ...base.check, drive: "C", free: 96 * GB, total: 237 * GB, writable: false } },
  { name: "06-程序在运行", info: installed, check: { ...base.check, running: true } },
  { name: "14-正在升级", info: installed, check: base.check, click: "install", progress: { phase: "files", done: 0.2, total: 1 }, hold: true },
  { name: "15-升级好了", info: installed, check: base.check, click: "install" },
  { name: "16-升级失败", info: installed, check: base.check, click: "install", result: { error: "旧版本有文件被别的程序打开着，关掉那个程序后再试" } },
  { name: "17-重新安装", info: { ...installed, installedVersion: "2.2.1" }, check: base.check },
  { name: "07-路径有中文", info: { ...base.info, defaultPath: "D:\\软件\\TungeeUploader" }, check: base.check },
  { name: "08-正在安装", ...base, click: "install", progress: { phase: "model", done: 0.46, total: 1 }, hold: true },
  { name: "09-装好了", ...base, click: "install" },
  { name: "10-没解压", info: { ...base.info, payload: false }, check: base.check },
  { name: "11-卸载确认", info: { ...base.info, mode: "uninstall", existing: "D:\\TungeeUploader" }, check: base.check },
  { name: "12-已卸载", info: { ...base.info, mode: "uninstall", existing: "D:\\TungeeUploader" }, check: base.check, click: "uninstall" },
  { name: "13-深色模式", ...base, dark: true },
];

function fakeBridge(scene) {
  let listener = () => {};
  window.installer = {
    info: async () => scene.info,
    check: async () => scene.check,
    choose: async () => null,
    onProgress: (fn) => (listener = fn),
    install: () =>
      new Promise((resolve) => {
        if (scene.progress) setTimeout(() => listener(scene.progress), 50);
        if (!scene.hold) setTimeout(() => resolve(scene.result || { ok: true }), 100);
      }),
    uninstall: async () => ({ ok: true }),
    cancel: () => {},
    launch: () => {},
    quit: () => {},
  };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const scene of scenes) {
    const context = await browser.newContext({
      viewport: { width: 700, height: 460 },
      deviceScaleFactor: 2,
      colorScheme: scene.dark ? "dark" : "light",
    });
    const tab = await context.newPage();
    await tab.addInitScript(fakeBridge, scene);
    await tab.goto(page);
    await tab.evaluate(() => document.fonts.ready);
    if (scene.click) {
      await tab.waitForSelector(`[data-action="${scene.click}"]:not([disabled])`);
      await tab.click(`[data-action="${scene.click}"]`);
    }
    await tab.waitForTimeout(1200);
    await tab.screenshot({ path: path.join(out, `${scene.name}.png`) });
    await context.close();
  }
  await browser.close();
  console.log(out);
})();
