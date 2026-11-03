import type { ChatHistoryItem, GbnfJsonSchema, Llama, LlamaChatSession, LlamaGrammar as BaseGrammar } from "node-llama-cpp";
import type { GpuMode, GpuProbe, WorkerReply, WorkerRequest } from "./local-llm";

// Runs the model in its own process: when llama.cpp runs out of memory it aborts the whole process,
// and that must not take the window down with it.
// argv: <model path> <context size> <GpuMode>. In "probe" mode it only reports the graphics card and exits.

type LlamaGrammar = BaseGrammar & { parse: (text: string) => unknown };
type GrammarFactory = (schema: GbnfJsonSchema) => Promise<LlamaGrammar>;

const [modelPath = "", contextArg, modeArg] = process.argv.slice(2);
const contextSize = Number(contextArg) || 4096;
const mode = modeArg as GpuMode;

let llama: Llama | undefined;
let loading: Promise<LlamaChatSession> | undefined;
const grammars = new Map<string, LlamaGrammar>();
const controllers = new Map<number, AbortController>();
let queue: Promise<unknown> = Promise.resolve();

function send(reply: WorkerReply): void {
  process.send?.(reply);
}

async function openLlama(gpu: false | "auto" | "vulkan"): Promise<Llama> {
  const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
  return getLlama({ gpu, build: "never", skipDownload: true, progressLogs: false, logLevel: LlamaLogLevel.error });
}

async function probe(): Promise<void> {
  let result: GpuProbe;
  try {
    const vulkan = await openLlama("vulkan");
    const [names, vram] = await Promise.all([vulkan.getGpuDeviceNames(), vulkan.getVramState()]);
    result = { names, free: vram.free, unified: vram.unifiedSize > 0 };
  } catch (error: unknown) {
    result = { names: [], free: 0, unified: false, error: error instanceof Error ? error.message : String(error) };
  }
  process.send?.({ probe: result } satisfies WorkerReply, () => process.exit(0));
}

async function load(): Promise<LlamaChatSession> {
  const { LlamaChatSession: ChatSession, QwenChatWrapper } = await import("node-llama-cpp");
  llama = await openLlama(mode === "cpu" ? false : mode === "gpu" ? "vulkan" : "auto");
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize });
  return new ChatSession({
    contextSequence: context.getSequence(),
    chatWrapper: new QwenChatWrapper({ thoughts: "discourage" }),
  });
}

async function grammarFor(schema: GbnfJsonSchema): Promise<LlamaGrammar> {
  const key = JSON.stringify(schema);
  const cached = grammars.get(key);
  if (cached) return cached;
  if (!llama) throw new Error("本地 AI 尚未加载");
  const createGrammar = llama.createGrammarForJsonSchema.bind(llama) as unknown as GrammarFactory;
  const grammar = await createGrammar(schema);
  grammars.set(key, grammar);
  return grammar;
}

function describeLoadError(error: unknown): { message: string; lasting: boolean } {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/InsufficientMemory|memory/i.test(text)) return { message: "电脑可用内存不足，本地 AI 无法加载，请关闭部分程序后重试", lasting: false };
  if (/NoBinaryFound|binary/i.test(text)) return { message: "本地 AI 运行库不支持这台电脑", lasting: true };
  return { message: `本地 AI 加载失败：${text.slice(0, 120)}`, lasting: true };
}

async function handle(request: Extract<WorkerRequest, { id: number }>, controller: AbortController): Promise<void> {
  try {
    let session: LlamaChatSession;
    try {
      session = await (loading ??= load());
    } catch (error: unknown) {
      const { message, lasting } = describeLoadError(error);
      process.send?.({ id: request.id, error: { message, unavailable: true, lasting } } satisfies WorkerReply, () => process.exit(1));
      return;
    }
    controller.signal.throwIfAborted();
    const { prompt, schema, options } = request;
    const grammar = await grammarFor(schema);
    const history: ChatHistoryItem[] = [{ type: "system", text: prompt.system }];
    for (const [user, answer] of prompt.examples ?? []) {
      history.push({ type: "user", text: user }, { type: "model", response: [JSON.stringify(answer)] });
    }
    session.setChatHistory(history);
    const answer = await session.prompt(prompt.user, {
      grammar,
      temperature: options.temperature ?? 0,
      maxTokens: options.maxTokens ?? 200,
      seed: options.seed,
      signal: controller.signal,
    });
    send({ id: request.id, result: grammar.parse(answer) });
  } catch (error: unknown) {
    const aborted = controller.signal.aborted;
    send({ id: request.id, error: { message: error instanceof Error ? error.message : String(error), aborted } });
  } finally {
    controllers.delete(request.id);
  }
}

if (mode === "probe") void probe();

process.on("message", (request: WorkerRequest) => {
  if ("cancel" in request) {
    controllers.get(request.cancel)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(request.id, controller);
  queue = queue.then(() => handle(request, controller));
});
process.on("disconnect", () => process.exit(0));
