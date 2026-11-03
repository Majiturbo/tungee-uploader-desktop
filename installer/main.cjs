// The installer's main process: a per-user copy install with shortcuts, an uninstall entry and a matching uninstaller.
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require("electron");
// Plain fs: Electron's patched fs would treat app.asar as a folder and keep it open.
const fs = require("original-fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { pickDefaultPath, resolveChosen, parseProbe, friendlyError } = require("./lib.cjs");
const { createFiles, overlaps } = require("./files.cjs");
const edition = require("./edition.cjs");

const APP_NAME = edition.APP_NAME;
const APP_EXE = `${APP_NAME}.exe`;
const APP_ID = edition.APP_ID;
const FOLDER = edition.FOLDER;
// Kept free of "setup"/"install", which make Windows treat the exe as a legacy installer.
const UNINSTALLER = `卸载${APP_NAME}.exe`;
const PAYLOAD = "安装文件";
const MODEL_DIR = path.join(...edition.MODEL_DIR);
const REG_KEY = edition.REG_KEY;

const uninstallMode = process.argv.includes("--uninstall");
const selfExe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const selfDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(selfExe);
const payloadDir = path.join(selfDir, PAYLOAD);

let win = null;
let job = null;
let payload = null;
let pendingRemoval = null;
/** Where the app was registered when the installer opened; removed after moving the install elsewhere. */
let previousInstall = null;
let lastInstalled = null;

app.setAppUserModelId(`${APP_ID}.setup`);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(createWindow);
}

app.on("window-all-closed", () => app.quit());

app.on("will-quit", () => {
  if (!pendingRemoval) return;
  // The uninstaller runs from inside the folder, so the folder itself can only go once this process has exited.
  const dir = pendingRemoval;
  const script = `for /l %i in (1,1,30) do @(rmdir /s /q "${dir}" 2>nul & if not exist "${dir}" exit /b & ping -n 2 127.0.0.1 >nul)`;
  spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", script], {
    cwd: os.tmpdir(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
});

function createWindow() {
  win = new BrowserWindow({
    width: 700,
    height: 460,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: uninstallMode ? `卸载${APP_NAME}` : `安装${APP_NAME}`,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, "app", "index.html"));
}

// MARK: Helpers

const files = createFiles(fs, APP_EXE, [UNINSTALLER]);
const { exists, isOurs, isEmptyDir, nearestExisting, canWrite, isLocked, listFiles } = files;

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 20000, encoding: "utf8" }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** Fixed drives and the current install location in one PowerShell round trip, as UTF-8 JSON. */
async function probeSystem() {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ id = $_.DeviceID; free = [double]$_.FreeSpace; size = [double]$_.Size } })",
    `$key = Get-ItemProperty -Path 'Registry::${REG_KEY.replace("HKCU", "HKEY_CURRENT_USER")}'`,
    "@{ drives = $drives; existing = $key.InstallLocation } | ConvertTo-Json -Compress -Depth 3",
  ].join("\n");
  try {
    const stdout = await powershell(script);
    return parseProbe(stdout.trim());
  } catch {
    return { drives: [], existing: null };
  }
}

function powershell(script) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
}

/** Ends every process started from the install at `dir`: the app and its helper processes. */
async function closeApp(dir) {
  const prefix = path.resolve(dir).replace(/\\?$/, "\\").toLowerCase();
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$prefix = '${prefix.replace(/'/g, "''")}'`,
    `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith($prefix) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ].join("\n");
  await powershell(script).catch((error) => log("closing the app failed", error));
  const exe = path.join(dir, APP_EXE);
  for (let attempt = 0; attempt < 20 && isLocked(exe); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
}

function appVersion(dir) {
  try {
    return files.readAsarJson(path.join(dir, "resources", "app.asar"), "package.json").version || null;
  } catch {
    return null;
  }
}

function payloadVersion() {
  return appVersion(payloadDir) || app.getVersion();
}

// MARK: IPC

ipcMain.handle("info", async () => {
  const probe = await probeSystem();
  log(`started from ${selfExe}${uninstallMode ? " (uninstall)" : ""}; drives ${JSON.stringify(probe.drives)}; registered ${probe.existing}`);
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  if (uninstallMode) {
    const registered = probe.existing && isOurs(probe.existing) ? probe.existing : null;
    return {
      mode: "uninstall", version: app.getVersion(), payload: false, required: 0, modelSize: 0,
      existing: registered || selfDir, defaultPath: selfDir, lite: edition.lite, appName: APP_NAME,
    };
  }
  // Without an uninstall entry (it failed to write, or was removed by an unfinished uninstall), the usual places still find it.
  const candidates = [probe.existing, ...probe.drives.map((drive) => `${drive.id}\\${FOLDER}`), path.join(localAppData, "Programs", FOLDER)];
  const registered = candidates.find((dir) => dir && exists(path.join(dir, APP_EXE))) || null;
  const leftover = registered ? null : candidates.find((dir) => dir && isOurs(dir)) || null;
  previousInstall = registered;
  log(`existing install: ${registered}; leftover: ${leftover}`);
  const ready = isOurs(payloadDir) && exists(path.join(payloadDir, MODEL_DIR));
  if (!ready) {
    return {
      mode: "install", version: app.getVersion(), payload: false, required: 0, modelSize: 0,
      existing: registered, defaultPath: "", lite: edition.lite, appName: APP_NAME,
    };
  }

  const found = await listFiles(payloadDir);
  const modelPrefix = MODEL_DIR + path.sep;
  const isModel = (file) => file.rel.startsWith(modelPrefix);
  const uninstaller = { src: selfExe, rel: UNINSTALLER, size: fs.statSync(selfExe).size };
  payload = [
    ...[...found.filter((file) => !isModel(file)), uninstaller].map((file) => ({ ...file, phase: "files" })),
    ...found.filter(isModel).map((file) => ({ ...file, phase: "model" })),
  ];
  const required = payload.reduce((sum, file) => sum + file.size, 0);
  const modelSize = found.filter(isModel).reduce((sum, file) => sum + file.size, 0);
  const defaultPath = leftover || pickDefaultPath({
    drives: probe.drives,
    systemDrive: process.env.SystemDrive || "C:",
    required,
    localAppData,
    writable: canWrite,
    folder: FOLDER,
  });
  return {
    mode: "install",
    version: payloadVersion(),
    payload: true,
    required,
    modelSize,
    existing: registered,
    installedVersion: registered ? appVersion(registered) : null,
    // An upgrade keeps whatever the person chose last time.
    desktopShortcut: registered ? exists(shortcutPaths().desktop) : true,
    defaultPath,
    lite: edition.lite,
    appName: APP_NAME,
  };
});

ipcMain.handle("check", async (_event, target) => {
  const resolved = path.resolve(String(target));
  const network = resolved.startsWith("\\\\");
  const drive = path.parse(resolved).root.replace(/[:\\]/g, "").toUpperCase() || "?";
  const anchor = nearestExisting(path.dirname(resolved));
  let free = 0;
  let total = 0;
  try {
    const stats = await fs.promises.statfs(anchor);
    free = stats.bavail * stats.bsize;
    total = stats.blocks * stats.bsize;
  } catch {}
  const ours = isOurs(resolved);
  return {
    drive,
    free,
    total,
    network,
    writable: !network && canWrite(anchor),
    running: ours && isLocked(path.join(resolved, APP_EXE)),
    occupied: !ours && exists(resolved) && !isEmptyDir(resolved),
  };
});

ipcMain.handle("choose", async (_event, current) => {
  const result = await dialog.showOpenDialog(win, {
    title: "选择安装位置",
    defaultPath: nearestExisting(String(current || os.homedir())),
    properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return resolveChosen(result.filePaths[0], { isOurs, isEmpty: isEmptyDir, folder: FOLDER });
});

ipcMain.handle("install", async (_event, options) => {
  job = { controller: new AbortController(), committed: false };
  job.done = install(String(options.path), Boolean(options.desktop), job);
  const result = await job.done;
  job = null;
  return result;
});

ipcMain.handle("uninstall", async (_event, options) => uninstall(Boolean(options.removeData)));

ipcMain.on("cancel", () => {
  if (job && !job.committed) job.controller.abort();
});

ipcMain.on("launch", () => {
  const dir = lastInstalled;
  if (dir) spawn(path.join(dir, APP_EXE), [], { cwd: dir, detached: true, stdio: "ignore" }).unref();
  app.quit();
});

ipcMain.on("quit", async () => {
  if (job) {
    if (!job.committed) job.controller.abort();
    await job.done.catch(() => undefined);
  }
  app.quit();
});

// MARK: Install

function reporter() {
  let last = 0;
  return (progress, force = false) => {
    const now = Date.now();
    if (!force && now - last < 100) return;
    last = now;
    win?.webContents.send("progress", progress);
  };
}

function log(message, error) {
  const detail = error ? ` ${error.code || ""} ${error.syscall || ""} ${error.path || ""}\n${error.stack || error}` : "";
  try {
    fs.appendFileSync(path.join(os.tmpdir(), "TungeeUploaderSetup.log"), `[${new Date().toISOString()}] ${message}${detail}\n`);
  } catch {}
}

/** What went wrong in terms someone can pass on: the failing operation and the file it was working on. */
function errorDetail(error) {
  if (!error.syscall) return undefined;
  return [typeof error.cause === "string" ? error.cause : error.code, error.syscall, error.path].filter(Boolean).join(" ");
}

async function install(target, desktop, current) {
  const signal = current.controller.signal;
  const report = reporter();
  log(`install to ${target} (desktop shortcut: ${desktop})`);
  try {
    if (!payload) throw Object.assign(new Error("payload missing"), { code: "ENOENT" });

    for (const dir of new Set([target, previousInstall])) {
      if (dir && isOurs(dir)) await closeApp(dir);
    }
    const total = payload.reduce((sum, file) => sum + file.size, 0);
    let done = 0;
    await files.installInto(payload, target, signal, (item, bytes) => {
      done += bytes;
      report({ phase: item.phase, done, total });
    });

    current.committed = true;
    report({ phase: "shortcuts", done: total, total }, true);
    // The app is in place from here on; a missing shortcut or uninstall entry shouldn't undo that.
    await createShortcuts(target, desktop).catch((error) => log("shortcuts failed", error));
    await register(target, total).catch((error) => log("registry failed", error));

    const previous = previousInstall;
    if (previous && !overlaps(previous, target) && isOurs(previous)) {
      await fs.promises.rm(previous, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
    }
    lastInstalled = target;
    log("installed");
    return { ok: true };
  } catch (error) {
    if (signal.aborted) {
      log("cancelled");
      return { cancelled: true };
    }
    log("install failed", error);
    const detail = errorDetail(error);
    return detail ? { error: friendlyError(error), detail } : { error: friendlyError(error) };
  }
}

function shortcutPaths() {
  return {
    desktop: path.join(app.getPath("desktop"), `${APP_NAME}.lnk`),
    startMenu: path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", `${APP_NAME}.lnk`),
  };
}

async function createShortcuts(target, desktop) {
  const exe = path.join(target, APP_EXE);
  const link = { target: exe, cwd: target, description: APP_NAME, icon: exe, iconIndex: 0, appUserModelId: APP_ID };
  const places = shortcutPaths();
  await files.ensureDir(path.dirname(places.startMenu));
  shell.writeShortcutLink(places.startMenu, "create", link);
  if (desktop) shell.writeShortcutLink(places.desktop, "create", link);
  else await fs.promises.rm(places.desktop, { force: true });
}

async function register(target, totalBytes) {
  const today = new Date();
  const values = [
    ["DisplayName", "REG_SZ", APP_NAME],
    ["DisplayVersion", "REG_SZ", payloadVersion()],
    ["Publisher", "REG_SZ", APP_NAME],
    ["DisplayIcon", "REG_SZ", `${path.join(target, APP_EXE)},0`],
    ["InstallLocation", "REG_SZ", target],
    ["UninstallString", "REG_SZ", `"${path.join(target, UNINSTALLER)}" --uninstall`],
    ["InstallDate", "REG_SZ", `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`],
    ["EstimatedSize", "REG_DWORD", String(Math.round(totalBytes / 1024))],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
  ];
  for (const [name, type, data] of values) {
    await run("reg.exe", ["add", REG_KEY, "/v", name, "/t", type, "/d", data, "/f"]);
  }
}

// MARK: Uninstall

function dataDirs() {
  const appData = app.getPath("appData");
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return [path.join(appData, edition.USER_DATA), path.join(appData, APP_NAME), path.join(localAppData, edition.LOG_FOLDER)];
}

async function uninstall(removeData) {
  const dir = (await probeSystem()).existing || selfDir;
  const report = reporter();
  const places = shortcutPaths();
  report({ phase: "shortcuts", done: 0, total: 1 }, true);
  await fs.promises.rm(places.desktop, { force: true }).catch(() => undefined);
  await fs.promises.rm(places.startMenu, { force: true }).catch(() => undefined);
  await run("reg.exe", ["delete", REG_KEY, "/f"]).catch(() => undefined);

  if (isOurs(dir)) {
    const self = path.resolve(selfExe).toLowerCase();
    const entries = fs.readdirSync(dir).filter((name) => path.resolve(dir, name).toLowerCase() !== self);
    for (const [index, name] of entries.entries()) {
      await fs.promises.rm(path.join(dir, name), { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
      report({ phase: "files", done: 0.05 + (0.85 * (index + 1)) / entries.length, total: 1 });
    }
    pendingRemoval = dir;
  }

  if (removeData) {
    report({ phase: "data", done: 0.92, total: 1 }, true);
    for (const folder of dataDirs()) await fs.promises.rm(folder, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }
  report({ phase: removeData ? "data" : "files", done: 1, total: 1 }, true);
  return { ok: true };
}
