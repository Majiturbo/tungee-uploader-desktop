import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { choosesGpu, isAbortError, LlmUnavailableError, LocalLlm, resolveLlmWorkerPath, type LocalLlmOptions } from "../src/main/local-llm.ts";

const FAKE_WORKER = `
const mode = process.argv[4];
if (mode === "probe") {
  const gpu = process.env.FAKE_GPU;
  if (gpu === "crash") process.exit(139);
  process.send({ probe: JSON.parse(gpu) }, () => process.exit(0));
}
process.on("message", (request) => {
  if ("cancel" in request) {
    if (globalThis.waiting === request.cancel) process.send({ id: request.cancel, error: { message: "aborted", aborted: true } });
    return;
  }
  const said = request.prompt.user;
  if (said === "crash" || (said === "gpu-crash" && mode === "gpu")) process.exit(134);
  if (said === "hang") return void (globalThis.waiting = request.id);
  if (said === "no-binary") {
    process.send({ id: request.id, error: { message: "本地 AI 运行库不支持这台电脑", unavailable: true, lasting: true } }, () => process.exit(1));
    return;
  }
  process.send({ id: request.id, result: { said, pid: process.pid, mode } });
});
process.on("disconnect", () => process.exit(0));
`;

const GB = 1024 ** 3;
const DEDICATED = { names: ["NVIDIA GeForce RTX 3060"], free: 11 * GB, unified: false };

function setup(options: Omit<LocalLlmOptions, "workerPath" | "log"> = {}, root = fs.mkdtempSync(path.join(os.tmpdir(), "local-llm-"))) {
  const model = path.join(root, "model.gguf");
  const workerPath = path.join(root, "worker.mjs");
  fs.writeFileSync(model, "");
  fs.writeFileSync(workerPath, FAKE_WORKER);
  const logs: string[] = [];
  return { llm: new LocalLlm(model, { workerPath, log: (message) => logs.push(message), ...options }), root, logs };
}

const ask = (llm: LocalLlm, user: string, signal?: AbortSignal) =>
  llm.promptJson<{ said: string; pid: number; mode: string }>({ system: "", user }, { type: "object" }, { signal });

test("only a dedicated card with room for the whole model is used", () => {
  assert.equal(choosesGpu(DEDICATED), true);
  assert.equal(choosesGpu({ names: ["AMD Radeon RX 6600"], free: 7 * GB, unified: false }), true);
  assert.equal(choosesGpu({ names: ["NVIDIA GeForce GTX 1050"], free: 1.8 * GB, unified: false }), false);
  assert.equal(choosesGpu({ names: ["Intel(R) UHD Graphics 620"], free: 8 * GB, unified: false }), false);
  assert.equal(choosesGpu({ names: ["Intel(R) Arc(TM) Graphics"], free: 8 * GB, unified: false }), false);
  assert.equal(choosesGpu({ names: ["AMD Radeon(TM) Graphics"], free: 8 * GB, unified: false }), false);
  assert.equal(choosesGpu({ names: ["AMD Radeon 780M"], free: 8 * GB, unified: false }), false);
  assert.equal(choosesGpu({ names: ["Some GPU"], free: 8 * GB, unified: true }), false);
  assert.equal(choosesGpu({ names: [], free: 0, unified: false, error: "no vulkan" }), false);
});

test("a dedicated card is used, and when it fails the answer comes from the CPU and that sticks", async () => {
  process.env.FAKE_GPU = JSON.stringify(DEDICATED);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-llm-"));
  const statePath = path.join(root, "local-ai.json");
  const { llm, logs } = setup({ gpuPolicy: "pick", statePath }, root);

  assert.equal((await ask(llm, "你好")).mode, "gpu");
  const retried = await ask(llm, "gpu-crash");
  assert.equal(retried.mode, "cpu");
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).gpu, "off");
  assert.match(logs.join("\n"), /改用 CPU/);
  await llm.dispose();

  const later = setup({ gpuPolicy: "pick", statePath }, root);
  assert.equal((await ask(later.llm, "再来")).mode, "cpu");
  assert.doesNotMatch(later.logs.join("\n"), /显卡：/);
  await later.llm.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("integrated graphics or a probe that crashes means the CPU", async () => {
  process.env.FAKE_GPU = JSON.stringify({ names: ["Intel(R) Iris(R) Xe Graphics"], free: 8 * GB, unified: false });
  const integrated = setup({ gpuPolicy: "pick" });
  assert.equal((await ask(integrated.llm, "一")).mode, "cpu");
  await integrated.llm.dispose();

  process.env.FAKE_GPU = "crash";
  const crashing = setup({ gpuPolicy: "pick" }, integrated.root);
  assert.equal((await ask(crashing.llm, "二")).mode, "cpu");
  assert.match(crashing.logs.join("\n"), /显卡检测没有结果/);
  await crashing.llm.dispose();
  fs.rmSync(integrated.root, { recursive: true, force: true });
});

test("answers come from a separate process that goes away on dispose", async () => {
  const { llm, root } = setup();
  const first = await ask(llm, "你好");
  const second = await ask(llm, "再来");
  assert.equal(first.said, "你好");
  assert.notEqual(first.pid, process.pid);
  assert.equal(second.pid, first.pid);
  await llm.dispose();
  assert.throws(() => process.kill(first.pid, 0));
  fs.rmSync(root, { recursive: true, force: true });
});

test("the worker is found next to the bundle or one folder up", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "llm-worker-path-"));
  const chunks = path.join(root, "chunks");
  fs.mkdirSync(chunks);
  const worker = path.join(root, "llm-worker.js");
  fs.writeFileSync(worker, "");
  assert.equal(resolveLlmWorkerPath(pathToFileURL(path.join(chunks, "desktop-service.js")).href), worker);
  assert.equal(resolveLlmWorkerPath(pathToFileURL(path.join(root, "sidecar.js")).href), worker);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a missing worker is a lasting install error, not a memory crash", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-llm-"));
  const model = path.join(root, "model.gguf");
  fs.writeFileSync(model, "");
  const llm = new LocalLlm(model, { workerPath: path.join(root, "missing.js") });
  assert.equal(llm.unavailableReason, "没有找到本地 AI 运行文件");
  await assert.rejects(ask(llm, "你好"), (error: Error) => error instanceof LlmUnavailableError && error.message === "没有找到本地 AI 运行文件");
  await llm.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a crash only makes the AI unavailable, and it stops retrying after the second one", async () => {
  const { llm, root, logs } = setup();
  await assert.rejects(ask(llm, "crash"), (error: Error) => error instanceof LlmUnavailableError && /内存/.test(error.message));
  assert.match(logs.join("\n"), /意外退出（自动选择）：code=134/);
  assert.equal((await ask(llm, "还在吗")).said, "还在吗");
  await assert.rejects(ask(llm, "crash"), LlmUnavailableError);
  await assert.rejects(ask(llm, "还在吗"), (error: Error) => error instanceof LlmUnavailableError && /多次意外退出/.test(error.message));
  await llm.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("a machine the runtime can't support is remembered", async () => {
  const { llm, root } = setup();
  await assert.rejects(ask(llm, "no-binary"), (error: Error) => error instanceof LlmUnavailableError && /不支持/.test(error.message));
  assert.equal(llm.unavailableReason, "本地 AI 运行库不支持这台电脑");
  await llm.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("cancelling reaches the running answer", async () => {
  const { llm, root } = setup();
  const controller = new AbortController();
  const pending = ask(llm, "hang", controller.signal);
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, (error: Error) => isAbortError(error));
  assert.equal((await ask(llm, "接着")).said, "接着");
  await llm.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

test("releasing when idle ends the process and the next question starts a fresh one", async () => {
  const { llm, root } = setup();
  const before = await ask(llm, "一");
  await llm.releaseIfIdle();
  assert.throws(() => process.kill(before.pid, 0));
  const after = await ask(llm, "二");
  assert.notEqual(after.pid, before.pid);
  await llm.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});
