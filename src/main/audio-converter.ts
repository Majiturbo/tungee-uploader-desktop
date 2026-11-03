import fs from "node:fs/promises";
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import type { AudioDecoder } from "./audio-decoder";
import { encodePcm16MonoWav, TARGET_SAMPLE_RATE } from "./audio-format";
import { applyTrim } from "./audio-trim";

const CONVERT_TIMEOUT_MS = 120_000;
const IDLE_CLOSE_MS = 30_000;

interface PendingJob {
  resolve: (samples: Float32Array) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface WorkerResult {
  id: number;
  samples?: Float32Array;
  error?: string;
}

export class AudioConverter implements AudioDecoder {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private abortReady: ((error: Error) => void) | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingJob>();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly preloadPath: string) {}

  /** The hidden decoding window is a whole renderer process; it only stays around while there's work. */
  private scheduleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.pending.size) this.dispose();
    }, IDLE_CLOSE_MS);
  }

  private readonly onResult = (event: IpcMainEvent, payload: WorkerResult) => {
    if (!this.window || event.sender !== this.window.webContents) return;
    const job = this.pending.get(payload.id);
    if (!job) return;
    this.pending.delete(payload.id);
    clearTimeout(job.timer);
    this.scheduleClose();
    if (payload.error || !(payload.samples instanceof Float32Array)) {
      job.reject(new Error(payload.error ?? "转换结果为空"));
    } else {
      job.resolve(payload.samples);
    }
  };

  private ensureWorker(): Promise<void> {
    if (this.ready && this.window && !this.window.isDestroyed()) return this.ready;
    const worker = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    worker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    worker.webContents.on("will-navigate", (event) => event.preventDefault());
    this.window = worker;
    ipcMain.removeListener("audio-worker:result", this.onResult);
    ipcMain.on("audio-worker:result", this.onResult);
    this.ready = new Promise<void>((resolve, reject) => {
      const onReady = (event: IpcMainEvent) => {
        if (event.sender !== worker.webContents) return;
        finish();
        resolve();
      };
      const finish = () => {
        ipcMain.removeListener("audio-worker:ready", onReady);
        this.abortReady = null;
      };
      this.abortReady = (error) => {
        finish();
        reject(error);
      };
      ipcMain.on("audio-worker:ready", onReady);
      worker.loadURL("about:blank").catch((error: unknown) => {
        this.abortReady?.(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return this.ready;
  }

  private async decode(bytes: Buffer, sampleRate = TARGET_SAMPLE_RATE): Promise<Float32Array> {
    await this.ensureWorker();
    const worker = this.window;
    if (!worker || worker.isDestroyed()) throw new Error("音频转换进程已关闭");
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<Float32Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.scheduleClose();
        reject(new Error("转换超时"));
      }, CONVERT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.webContents.send("audio-worker:decode", { id, bytes, sampleRate });
    });
  }

  async decodeFile(sourcePath: string, sampleRate: number): Promise<Float32Array> {
    const bytes = await fs.readFile(sourcePath);
    if (!bytes.length) throw new Error("文件内容为空");
    return this.decode(bytes, sampleRate);
  }

  async convertFile(sourcePath: string, targetPath: string, trim?: { head: number; tail: number }): Promise<void> {
    const bytes = await fs.readFile(sourcePath);
    if (!bytes.length) throw new Error("文件内容为空");
    const samples = await this.decode(bytes);
    await fs.writeFile(targetPath, encodePcm16MonoWav(trim ? applyTrim(samples, TARGET_SAMPLE_RATE, trim) : samples));
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    ipcMain.removeListener("audio-worker:result", this.onResult);
    this.abortReady?.(new Error("转换已中止"));
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error("转换已中止"));
    }
    this.pending.clear();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.ready = null;
  }
}
