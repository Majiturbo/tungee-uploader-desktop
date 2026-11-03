import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, session, shell, type OpenDialogOptions } from "electron";
import { AudioConverter } from "./audio-converter";
import { CliAudioDecoder } from "./cli-audio-decoder";
import { isSupportedAudioFile } from "./audio-format";
import { DesktopService, STANDARD_TEMPLATE_NAME, type SaveOptions } from "./desktop-service";
import { isLite, WINDOW_TITLE } from "../shared/edition";
import { LLM_MODEL_FILE } from "./local-llm";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let service: DesktopService | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: "tungee-audio", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);
let quitting = false;
let startupLogPath = "";
let showingStartupError = false;

if (process.platform === "win32") {
  app.disableHardwareAcceleration();
  app.setAppUserModelId(isLite() ? "com.tungee.uploader.lite" : "com.tungee.uploader");
}

if (isLite()) {
  const appData = process.platform === "win32"
    ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    : path.join(os.homedir(), "Library", "Application Support");
  app.setPath("userData", path.join(appData, "tungee-uploader-desktop-lite"));
}

function resolveStartupLogPath(): string {
  if (startupLogPath) return startupLogPath;
  const winFolder = isLite() ? "TungeeUploaderLite" : "TungeeUploader";
  const logDir = process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? process.cwd(), winFolder, "logs")
    : app.isReady()
      ? app.getPath("logs")
      : path.join(process.cwd(), winFolder, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  startupLogPath = path.join(logDir, "startup.log");
  return startupLogPath;
}

function startupDetail(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function writeStartupLog(message: string, error?: unknown): string {
  const logPath = resolveStartupLogPath();
  const detail = error === undefined ? "" : `\n${startupDetail(error)}`;
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`, "utf8");
  return logPath;
}

function reportStartupError(code: string, message: string, error: unknown): void {
  let logPath = "日志写入失败";
  try {
    logPath = writeStartupLog(`${code} ${message}`, error);
  } catch {
    // The error dialog must still appear when the log directory is unavailable.
  }
  if (showingStartupError) return;
  showingStartupError = true;
  const body = `${code}｜${message}\n\n请重新启动软件。若仍无法打开，请把下面的日志文件发给维护人员：\n${logPath}`;
  const show = () => {
    dialog.showErrorBox(`${WINDOW_TITLE}启动失败`, body);
    showingStartupError = false;
  };
  if (app.isReady()) show();
  else void app.whenReady().then(show);
}

process.on("uncaughtException", (error) => reportStartupError("E-STARTUP-001", "桌面程序发生未处理错误。", error));
process.on("unhandledRejection", (error) => reportStartupError("E-STARTUP-002", "桌面程序启动过程异常。", error));

function resourcePath(...segments: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...segments)
    : path.join(currentDir, "../..", ...segments);
}

function ffmpegPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
  const local = path.join(currentDir, "../../resources/ffmpeg/win32-x64/ffmpeg.exe");
  return fs.existsSync(local) ? local : "ffmpeg";
}

async function pickSavePath(options: SaveOptions): Promise<string | null> {
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
}

function createService(): DesktopService {
  return new DesktopService({
    userDataPath: app.getPath("userData"),
    logDir: path.dirname(resolveStartupLogPath()),
    downloadsPath: app.getPath("downloads"),
    templatePath: templatePath(),
    asrModelDir: app.isPackaged ? resourcePath("models", "asr") : resourcePath(".models", "asr"),
    llmModelPath: app.isPackaged ? resourcePath("models", "llm", LLM_MODEL_FILE) : resourcePath(".models", "llm", LLM_MODEL_FILE),
    llmWorkerPath: path.join(currentDir, "llm-worker.js"),
    decoder: process.platform === "win32"
      ? new CliAudioDecoder(ffmpegPath())
      : new AudioConverter(path.join(currentDir, "../preload/audio-worker.js")),
    log: (message) => writeStartupLog(message),
    emit: (event, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
    },
    pickSavePath,
    clearAppCache: async () => {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearCodeCaches({});
    },
  });
}

function requireService(): DesktopService {
  if (!service) throw new Error("应用尚未初始化");
  return service;
}

function titleBarOverlay() {
  return { color: "#00000000", symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#1d1d1f", height: 52 };
}

function createWindow(): void {
  writeStartupLog(`创建主窗口，平台=${process.platform}，架构=${process.arch}`);
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: WINDOW_TITLE,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
    ...(process.platform === "win32" ? { titleBarStyle: "hidden" as const, titleBarOverlay: titleBarOverlay() } : {}),
    webPreferences: {
      preload: path.join(currentDir, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  let windowShown = false;
  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed() || windowShown) return;
    windowShown = true;
    mainWindow.show();
    mainWindow.focus();
    writeStartupLog("主窗口已显示");
  };
  const showFallback = setTimeout(() => {
    writeStartupLog("ready-to-show 超过 4 秒，启用兼容显示");
    showWindow();
  }, 4000);
  mainWindow.once("ready-to-show", () => {
    clearTimeout(showFallback);
    showWindow();
  });
  mainWindow.once("closed", () => {
    clearTimeout(showFallback);
    app.quit();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    if (errorCode === -3) return;
    reportStartupError(
      "E-STARTUP-003",
      "界面文件加载失败。",
      new Error(`${errorCode} ${errorDescription} ${validatedUrl}`),
    );
    showWindow();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    reportStartupError("E-STARTUP-004", "界面进程意外退出。", new Error(JSON.stringify(details)));
  });
  mainWindow.on("unresponsive", () => writeStartupLog("主窗口暂时无响应"));
  if (process.platform === "win32") {
    const syncOverlay = () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitleBarOverlay(titleBarOverlay());
    };
    nativeTheme.on("updated", syncOverlay);
    mainWindow.once("closed", () => nativeTheme.removeListener("updated", syncOverlay));
  }

  const query = { platform: process.platform };
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(`${rendererUrl}?${new URLSearchParams(query).toString()}`).catch((error: unknown) => {
      reportStartupError("E-STARTUP-003", "界面地址加载失败。", error);
      showWindow();
    });
  } else {
    void mainWindow.loadFile(path.join(currentDir, "../renderer/index.html"), { query }).catch((error: unknown) => {
      reportStartupError("E-STARTUP-003", "界面文件加载失败。", error);
      showWindow();
    });
  }

  service = createService();
}

function registerAudioProtocol(): void {
  protocol.handle("tungee-audio", async (request) => {
    const url = new URL(request.url);
    const dir = path.resolve(url.searchParams.get("dir") ?? "");
    const file = url.searchParams.get("file") ?? "";
    if (!service?.isPlayable(dir, file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(path.join(dir, file)).toString(), { headers: request.headers });
  });
}

async function openDialog(options: OpenDialogOptions): Promise<string | null> {
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
}

ipcMain.handle("dialog:workbook", () => openDialog({
  title: "选择话术 Excel",
  properties: ["openFile"],
  filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
}));

ipcMain.handle("dialog:audio-dir", () => openDialog({
  title: "选择录音文件夹",
  properties: ["openDirectory"],
}));

ipcMain.handle("logs:open", async () => shell.openPath(path.dirname(resolveStartupLogPath())));

ipcMain.handle("clipboard:write", (_event, text: unknown) => {
  if (typeof text === "string") clipboard.writeText(text);
});

function templatePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "templates", STANDARD_TEMPLATE_NAME)
    : path.join(app.getAppPath(), "resources", STANDARD_TEMPLATE_NAME);
}

function existing(target: unknown): string | null {
  return typeof target === "string" && target && fs.existsSync(target) ? target : null;
}

ipcMain.handle("path:icon", async (_event, target: unknown, kind: unknown) => {
  const file = existing(target) ?? (kind === "folder" ? app.getPath("documents") : templatePath());
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(file, { width: 256, height: 256 });
    if (!thumbnail.isEmpty()) return thumbnail.toDataURL();
  } catch {
    // Some shell handlers have no thumbnail; the plain file icon still works.
  }
  try {
    return (await app.getFileIcon(file, { size: "large" })).toDataURL();
  } catch {
    return null;
  }
});

ipcMain.handle("path:audio-count", async (_event, target: unknown) => {
  const dir = existing(target);
  if (!dir) return null;
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && isSupportedAudioFile(entry.name)).length;
  } catch {
    return null;
  }
});

ipcMain.handle("path:open", async (_event, target: unknown) => {
  const file = existing(target);
  if (file) await shell.openPath(file);
});

ipcMain.handle("feedback:mail", async (_event, email: unknown, subject: unknown, body: unknown) => {
  if (typeof email !== "string" || typeof subject !== "string" || typeof body !== "string") return;
  const query = new URLSearchParams({ subject, body: `${body}\n请把刚打开的运行日志拖进这封邮件。` }).toString().replaceAll("+", "%20");
  await shell.openExternal(`mailto:${email}?${query}`);
  await shell.openPath(path.dirname(resolveStartupLogPath()));
});

const SERVICE_CHANNELS = [
  "template:save", "path:inspect", "automation:preview", "report:validation", "checkup:save-fixed",
  "audio:confirm-matches", "intent:analyze", "checkup:ai", "checkup:expand", "checkup:invalid-ai", "ai:cancel", "intent:export",
  "automation:start", "automation:confirm-login", "automation:cancel", "automation:rename", "automation:use-existing", "automation:modify-existing",
  "automation:checkpoint", "automation:discard-checkpoint", "storage:usage", "storage:clear",
  "modify:compare", "modify:apply",
  "voice-agent:preview", "voice-agent:start", "voice-agent:pick-entry", "voice-agent:confirm-paste", "voice-agent:entries",
  "voice-agent:save-sample",
];
for (const channel of SERVICE_CHANNELS) {
  ipcMain.handle(channel, (_event, ...args: unknown[]) => {
    const handler = requireService().handlers[channel];
    if (!handler) throw new Error(`未知操作：${channel}`);
    return handler(...args);
  });
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void app.whenReady().then(() => {
    writeStartupLog(`应用启动，版本=${app.getVersion()}，edition=${isLite() ? "lite" : "standard"}`);
    registerAudioProtocol();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error: unknown) => reportStartupError("E-STARTUP-005", "Electron 初始化失败。", error));
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || !service) return;
  event.preventDefault();
  void service.dispose().finally(() => {
    quitting = true;
    app.quit();
  });
});
