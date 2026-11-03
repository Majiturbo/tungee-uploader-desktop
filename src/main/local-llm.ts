import { type ChildProcess, fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GbnfJsonSchema } from "node-llama-cpp";
import { isLite, LITE_LLM_UNAVAILABLE } from "../shared/edition";

export const LLM_MODEL_FILE = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const GB = 1024 ** 3;
const MIN_TOTAL_MEMORY = 6 * GB;
/** Weights (read from disk as needed) plus the context and scratch buffers, with some room to spare. */
const MIN_FREE_MEMORY = 3.2 * GB;
/** On a graphics card the weights live in its own memory; the process itself still needs some. */
const MIN_FREE_MEMORY_GPU = 1.5 * GB;
/** The whole model plus its context has to fit, or llama.cpp splits it and keeps the rest in system memory. */
const MIN_FREE_VRAM = 3.5 * GB;
/** At 8GB the model has to leave again quickly: it holds a third of the machine's memory. */
const LOW_MEMORY = os.totalmem() <= 12 * GB;
const CONTEXT_SIZE = LOW_MEMORY ? 2048 : 4096;
const IDLE_RELEASE_MS = LOW_MEMORY ? 15_000 : 3 * 60_000;
const PROBE_TIMEOUT_MS = 20_000;
const MAX_CRASHES = 2;
/** Graphics that share system memory: offloading there doubles the footprint without being faster, and their
 * drivers are where llama.cpp crashes most. */
const MODE_LABEL: Record<GpuMode, string> = { gpu: "显卡", cpu: "CPU", auto: "自动选择", probe: "显卡检测" };
const INTEGRATED = /Intel.*(UHD|HD Graphics|Iris|Arc\(TM\) Graphics)|Radeon\(TM\) Graphics|Radeon Graphics|Radeon Vega|Radeon \d{3,4}M\b|Microsoft Basic|llvmpipe|SwiftShader/i;

export interface JsonPrompt {
  system: string;
  examples?: Array<[string, unknown]>;
  user: string;
}

export interface PromptOptions {
  temperature?: number;
  maxTokens?: number;
  seed?: number;
  signal?: AbortSignal;
}

/** "auto" lets llama.cpp choose (Metal on a Mac); "gpu" means a dedicated card through Vulkan. */
export type GpuMode = "auto" | "gpu" | "cpu" | "probe";

export interface GpuProbe {
  names: string[];
  free: number;
  unified: boolean;
  error?: string;
}

export type WorkerRequest =
  | { id: number; prompt: JsonPrompt; schema: GbnfJsonSchema; options: Omit<PromptOptions, "signal"> }
  | { cancel: number };

export type WorkerReply =
  | { id: number; result: unknown }
  | { id: number; error: { message: string; aborted?: boolean; unavailable?: boolean; lasting?: boolean } }
  | { probe: GpuProbe };

export class LlmUnavailableError extends Error {}
class GpuFailedError extends Error {}

const WORKER_NAME = "llm-worker.js";

/** electron-vite emits shared main code under `out/main/chunks/`, while the worker stays at `out/main/`. */
export function resolveLlmWorkerPath(fromUrl = import.meta.url): string {
  const here = path.dirname(fileURLToPath(fromUrl));
  const candidates = [path.join(here, WORKER_NAME), path.join(here, "..", WORKER_NAME)];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function describeWorkerExit(stderr: string): { message: string; lasting: boolean } {
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(stderr)) {
    return { message: "没有找到本地 AI 运行文件", lasting: true };
  }
  return { message: "本地 AI 意外退出，多半是电脑内存不够，关掉部分程序后再试", lasting: false };
}

/** Uses the graphics card only when it's a dedicated one with room for the whole model. */
export function choosesGpu(probe: GpuProbe): boolean {
  return !probe.error
    && probe.names.length > 0
    && !probe.unified
    && !probe.names.some((name) => INTEGRATED.test(name))
    && probe.free >= MIN_FREE_VRAM;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface LocalLlmOptions {
  log?: (message: string) => void;
  workerPath?: string;
  /** Remembers across launches that the graphics card failed here. */
  statePath?: string;
  /** "pick" chooses between a dedicated card and the CPU; "auto" leaves it to llama.cpp. */
  gpuPolicy?: "pick" | "auto";
}

export class LocalLlm {
  private worker?: ChildProcess;
  private chosenMode?: Promise<GpuMode>;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer?: NodeJS.Timeout;
  private loadError?: string;
  private crashes = 0;
  private readonly modelPath: string;
  private readonly log: (message: string) => void;
  private readonly workerPath: string;
  private readonly statePath?: string;
  private readonly gpuPolicy: "pick" | "auto";

  constructor(modelPath: string, options: LocalLlmOptions = {}) {
    this.modelPath = modelPath;
    this.log = options.log ?? (() => undefined);
    this.workerPath = options.workerPath ?? resolveLlmWorkerPath();
    this.statePath = options.statePath;
    this.gpuPolicy = options.gpuPolicy ?? (process.platform === "win32" ? "pick" : "auto");
  }

  get unavailableReason(): string | undefined {
    if (isLite()) return LITE_LLM_UNAVAILABLE;
    if (this.loadError) return this.loadError;
    if (!fs.existsSync(this.workerPath)) return "没有找到本地 AI 运行文件";
    if (!fs.existsSync(this.modelPath)) return "没有找到本地 AI 模型文件";
    if (os.totalmem() < MIN_TOTAL_MEMORY) return "电脑内存不足 8GB，本地 AI 无法运行";
    return undefined;
  }

  promptJson<T>(prompt: JsonPrompt, schema: GbnfJsonSchema, options: PromptOptions = {}): Promise<T> {
    return this.enqueue(async () => {
      const { signal, ...rest } = options;
      const message = { prompt, schema, options: rest };
      signal?.throwIfAborted();
      try {
        return (await this.request(this.worker ?? (await this.start()), message, signal)) as T;
      } catch (error: unknown) {
        if (!(error instanceof GpuFailedError)) throw error;
        signal?.throwIfAborted();
        return (await this.request(await this.start(), message, signal)) as T;
      }
    });
  }

  /** Frees the model's memory now unless it's in the middle of answering. */
  async releaseIfIdle(): Promise<void> {
    if (!this.pending.size) await this.release();
  }

  async dispose(): Promise<void> {
    clearTimeout(this.idleTimer);
    await this.release();
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    clearTimeout(this.idleTimer);
    const run = this.queue.then(task);
    this.queue = run
      .finally(() => {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => void this.releaseIfIdle(), IDLE_RELEASE_MS).unref();
      })
      .catch(() => undefined);
    return run;
  }

  private spawn(mode: GpuMode): ChildProcess {
    return fork(this.workerPath, [this.modelPath, String(CONTEXT_SIZE), mode], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "advanced",
    });
  }

  private gpuTurnedOff(): boolean {
    if (!this.statePath) return false;
    try {
      return (JSON.parse(fs.readFileSync(this.statePath, "utf8")) as { gpu?: string }).gpu === "off";
    } catch {
      return false;
    }
  }

  private turnGpuOff(reason: string): void {
    this.chosenMode = Promise.resolve("cpu");
    this.log(`本地 AI 改用 CPU：${reason}`);
    if (!this.statePath) return;
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({ gpu: "off", reason, at: new Date().toISOString() }));
    } catch {}
  }

  private mode(): Promise<GpuMode> {
    if (this.gpuPolicy === "auto") return Promise.resolve("auto");
    this.chosenMode ??= this.gpuTurnedOff() ? Promise.resolve("cpu") : this.probe();
    return this.chosenMode;
  }

  /** Asks a short-lived process about the graphics card, so a broken driver can only take that process down. */
  private probe(): Promise<GpuMode> {
    return new Promise((resolve) => {
      const probe = this.spawn("probe");
      let result: GpuProbe | undefined;
      const timer = setTimeout(() => probe.kill(), PROBE_TIMEOUT_MS);
      probe.stderr?.resume();
      probe.on("message", (reply: WorkerReply) => {
        if ("probe" in reply) result = reply.probe;
      });
      probe.on("error", () => undefined);
      probe.on("close", (code, signal) => {
        clearTimeout(timer);
        const mode = result && choosesGpu(result) ? "gpu" : "cpu";
        this.log(result
          ? `显卡：${result.names.join("、") || "无"}，空闲显存 ${(result.free / GB).toFixed(1)}GB${result.unified ? "（与内存共用）" : ""}${result.error ? `，${result.error}` : ""} → 本地 AI 用 ${mode === "gpu" ? "显卡" : "CPU"}`
          : `显卡检测没有结果（code=${String(code)} signal=${String(signal)}）→ 本地 AI 用 CPU`);
        resolve(mode);
      });
    });
  }

  private async start(): Promise<ChildProcess> {
    const reason = this.unavailableReason;
    if (reason) throw new LlmUnavailableError(reason);
    const mode = await this.mode();
    const free = os.freemem();
    // Only Windows reports memory the system could hand out; macOS counts its file cache as used.
    if (process.platform === "win32" && free < (mode === "gpu" ? MIN_FREE_MEMORY_GPU : MIN_FREE_MEMORY)) {
      this.log(`本地 AI 未启动：可用内存 ${(free / GB).toFixed(1)}GB`);
      throw new LlmUnavailableError(`电脑可用内存只剩 ${(free / GB).toFixed(1)}GB，不够本地 AI 运行，关掉部分程序后再试`);
    }

    const worker = this.spawn(mode);
    let stderr = "";
    worker.stderr?.setEncoding("utf8");
    worker.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    worker.on("message", (reply: WorkerReply) => this.settle(worker, mode, reply));
    worker.on("error", (error) => this.log(`本地 AI 进程出错：${error.message}`));
    // "close" rather than "exit": it waits for the last messages, so an answer sent just before exiting isn't lost.
    worker.on("close", (code, signal) => {
      if (this.worker === worker) this.worker = undefined;
      if (!this.pending.size) return;
      this.log(`本地 AI 进程意外退出（${MODE_LABEL[mode]}）：code=${String(code)} signal=${String(signal)} 可用内存=${(os.freemem() / GB).toFixed(1)}GB${stderr ? `\n${stderr.trim()}` : ""}`);
      if (mode === "gpu") {
        this.turnGpuOff(`用显卡时进程退出 code=${String(code)}`);
        this.failAll(new GpuFailedError("gpu failed"));
        return;
      }
      const described = describeWorkerExit(stderr);
      if (described.lasting) this.loadError = described.message;
      else {
        this.crashes += 1;
        if (this.crashes >= MAX_CRASHES) this.loadError = "本地 AI 在这台电脑上多次意外退出，重启软件前先不用了";
      }
      this.failAll(new LlmUnavailableError(described.message));
    });
    this.worker = worker;
    this.log(`本地 AI 进程启动：上下文 ${CONTEXT_SIZE}，${MODE_LABEL[mode]}，可用内存 ${(free / GB).toFixed(1)}GB`);
    return worker;
  }

  private request(worker: ChildProcess, message: Omit<Extract<WorkerRequest, { id: number }>, "id">, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const onAbort = () => worker.connected && worker.send({ cancel: id } satisfies WorkerRequest);
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = () => signal?.removeEventListener("abort", onAbort);
      this.pending.set(id, {
        resolve: (value) => {
          done();
          resolve(value);
        },
        reject: (error) => {
          done();
          reject(error);
        },
      });
      worker.send({ id, ...message } satisfies WorkerRequest);
    });
  }

  private settle(worker: ChildProcess, mode: GpuMode, reply: WorkerReply): void {
    if (!("id" in reply)) return;
    const job = this.pending.get(reply.id);
    if (!job) return;
    this.pending.delete(reply.id);
    if ("result" in reply) {
      job.resolve(reply.result);
      return;
    }
    const { message, aborted, unavailable, lasting } = reply.error;
    if (aborted) {
      job.reject(Object.assign(new Error(message), { name: "AbortError" }));
    } else if (unavailable) {
      this.log(`本地 AI 加载失败（${MODE_LABEL[mode]}）：${message}`);
      if (this.worker === worker) this.worker = undefined;
      if (mode === "gpu") {
        this.turnGpuOff(`用显卡加载失败：${message}`);
        job.reject(new GpuFailedError(message));
        return;
      }
      if (lasting) this.loadError = message;
      job.reject(new LlmUnavailableError(message));
    } else {
      job.reject(new Error(message));
    }
  }

  private failAll(error: Error): void {
    const jobs = [...this.pending.values()];
    this.pending.clear();
    for (const job of jobs) job.reject(error);
  }

  private async release(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
    this.failAll(Object.assign(new Error("本地 AI 已停止"), { name: "AbortError" }));
    await new Promise<void>((resolve) => {
      worker.once("exit", () => resolve());
      worker.kill();
    });
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
}
