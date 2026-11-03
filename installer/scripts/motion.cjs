// Records the setup → installing → done flow with a fake bridge into installer/preview/motion.gif (needs ffmpeg).
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const GB = 1024 ** 3;
const page = pathToFileURL(path.join(__dirname, "../app/index.html")).href;
const out = path.join(__dirname, "../preview/motion.gif");
const size = { width: 700, height: 460 };

function fakeBridge() {
  const GB = 1024 ** 3;
  let listener = () => {};
  window.installer = {
    info: async () => ({ mode: "install", version: "2.0.0", payload: true, required: 2.9 * GB, modelSize: 2.3 * GB, existing: null, defaultPath: "D:\\TungeeUploader" }),
    check: async () => ({ drive: "D", free: 812 * GB, total: 931 * GB, writable: true, running: false }),
    choose: async () => null,
    onProgress: (fn) => (listener = fn),
    install: () =>
      new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const done = Math.min((Date.now() - started) / 9000, 1);
          listener({ phase: done < 0.2 ? "files" : done < 0.95 ? "model" : "shortcuts", done, total: 1 });
          if (done >= 1) {
            clearInterval(timer);
            setTimeout(() => resolve({ ok: true }), 400);
          }
        }, 100);
      }),
    uninstall: async () => ({ ok: true }),
    cancel: () => {},
    launch: () => {},
    quit: () => {},
  };
}

(async () => {
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), "installer-motion-"));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: videoDir, size } });
  const tab = await context.newPage();
  await tab.addInitScript(fakeBridge);
  await tab.goto(page);
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForSelector('[data-action="install"]:not([disabled])');
  await tab.waitForTimeout(1500);
  await tab.click('[data-action="install"]');
  await tab.waitForSelector('[data-action="launch"]', { timeout: 20000 });
  await tab.waitForTimeout(2500);
  const video = await tab.video().path();
  await context.close();
  await browser.close();

  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", video,
    "-vf", "fps=15,scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=sierra2_4a",
    out,
  ]);
  fs.rmSync(videoDir, { recursive: true, force: true });
  console.log(out);
})();
