import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { AfconvertDecoder } from "./afconvert-decoder";
import { DesktopService, type SaveOptions } from "./desktop-service";

// Protocol (one JSON object per line):
//   host → sidecar  { id, method, params }        sidecar → host  { id, result } | { id, error }
//   sidecar → host  { event, payload }
//   sidecar → host  { hostId, hostMethod, params } host → sidecar  { hostId, result }
// stdout carries protocol messages only; diagnostics go to stderr and the log file.

interface Request { id: number; method: string; params?: unknown[] }
interface HostReply { hostId: number; result?: unknown }

const { values: args } = parseArgs({
  options: {
    "user-data": { type: "string" },
    "log-dir": { type: "string" },
    downloads: { type: "string" },
    template: { type: "string" },
    asr: { type: "string" },
    llm: { type: "string" },
  },
});

function required(name: keyof typeof args): string {
  const value = args[name];
  if (!value) {
    process.stderr.write(`缺少参数 --${name}\n`);
    process.exit(64);
  }
  return value;
}

const userDataPath = required("user-data");
const logDir = args["log-dir"] ?? path.join(userDataPath, "logs");
fs.mkdirSync(userDataPath, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, "startup.log");

function log(message: string, error?: unknown): void {
  const detail = error === undefined ? "" : `\n${error instanceof Error ? error.stack || error.message : String(error)}`;
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`, "utf8");
}

const toStderr = (...items: unknown[]) => process.stderr.write(`${items.map(String).join(" ")}\n`);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let nextHostId = 1;
const hostCalls = new Map<number, (result: unknown) => void>();

function callHost(hostMethod: string, params: unknown): Promise<unknown> {
  const hostId = nextHostId;
  nextHostId += 1;
  return new Promise((resolve) => {
    hostCalls.set(hostId, resolve);
    send({ hostId, hostMethod, params });
  });
}

const service = new DesktopService({
  userDataPath,
  logDir,
  downloadsPath: args.downloads ?? path.join(os.homedir(), "Downloads"),
  templatePath: required("template"),
  asrModelDir: required("asr"),
  llmModelPath: required("llm"),
  llmWorkerPath: path.join(path.dirname(fileURLToPath(import.meta.url)), "llm-worker.js"),
  decoder: new AfconvertDecoder(),
  log: (message) => log(message),
  emit: (event, payload) => send({ event, payload }),
  pickSavePath: async (options: SaveOptions) => {
    const result = await callHost("pickSavePath", options);
    return typeof result === "string" && result ? result : null;
  },
});

async function handle(request: Request): Promise<void> {
  const handler = service.handlers[request.method];
  if (!handler) {
    send({ id: request.id, error: { message: `未知操作：${request.method}` } });
    return;
  }
  try {
    const result = await handler(...(request.params ?? []));
    send({ id: request.id, result: result ?? null });
  } catch (error: unknown) {
    log(`操作失败：${request.method}`, error);
    send({ id: request.id, error: { message: error instanceof Error ? error.message : String(error) } });
  }
}

let shuttingDown = false;
async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await service.dispose();
  process.exit(code);
}

process.on("uncaughtException", (error) => log("后台进程未处理错误", error));
process.on("unhandledRejection", (error) => log("后台进程异步错误", error));
process.on("SIGTERM", () => void shutdown(0));

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  let message: Partial<Request & HostReply>;
  try {
    message = JSON.parse(line) as Partial<Request & HostReply>;
  } catch {
    log(`无法解析的消息：${line.slice(0, 200)}`);
    return;
  }
  if (typeof message.hostId === "number") {
    const resolve = hostCalls.get(message.hostId);
    hostCalls.delete(message.hostId);
    resolve?.(message.result);
  } else if (typeof message.id === "number" && typeof message.method === "string") {
    void handle({ id: message.id, method: message.method, params: Array.isArray(message.params) ? message.params : [] });
  }
});
input.on("close", () => void shutdown(0));

log(`后台进程启动，Node ${process.version}，平台=${process.platform}，架构=${process.arch}`);
send({ event: "ready", payload: { pid: process.pid } });
