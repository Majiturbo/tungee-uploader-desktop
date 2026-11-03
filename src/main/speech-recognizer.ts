import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const ASR_SAMPLE_RATE = 16000;

const VAD_WINDOW = 512;
const MAX_SEGMENT_SECONDS = 10;

interface SherpaStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
}

interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(stream: SherpaStream): void;
  getResult(stream: SherpaStream): { text: string };
}

interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(enableExternalBuffer: boolean): { samples: Float32Array };
  pop(): void;
  flush(): void;
}

interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
  Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVad;
}

export class SpeechRecognizer {
  private recognizer: SherpaRecognizer | null = null;
  private sherpa: SherpaModule | null = null;
  private loadError: string | null = null;

  private readonly modelDir: string;

  constructor(modelDir: string) {
    this.modelDir = modelDir;
  }

  private load(): boolean {
    if (this.recognizer) return true;
    if (this.loadError) return false;
    try {
      const files = ["model.int8.onnx", "tokens.txt", "silero_vad.onnx"].map((name) => path.join(this.modelDir, name));
      const missing = files.filter((file) => !fs.existsSync(file));
      if (missing.length) throw new Error(`缺少语音模型文件：${missing.map((file) => path.basename(file)).join("、")}`);
      const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as SherpaModule;
      this.recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: ASR_SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          paraformer: { model: files[0] },
          tokens: files[1],
          numThreads: 2,
          provider: "cpu",
          debug: 0,
        },
      });
      this.sherpa = sherpa;
      return true;
    } catch (error: unknown) {
      this.loadError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  get unavailableReason(): string | null {
    return this.load() ? null : this.loadError;
  }

  private segments(samples: Float32Array): Float32Array[] {
    const sherpa = this.sherpa;
    if (!sherpa) return [samples];
    const vad = new sherpa.Vad({
      sileroVad: {
        model: path.join(this.modelDir, "silero_vad.onnx"),
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.3,
        maxSpeechDuration: MAX_SEGMENT_SECONDS,
        windowSize: VAD_WINDOW,
      },
      sampleRate: ASR_SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    }, 60);
    const segments: Float32Array[] = [];
    const take = () => {
      while (!vad.isEmpty()) {
        segments.push(vad.front(false).samples);
        vad.pop();
      }
    };
    for (let offset = 0; offset < samples.length; offset += VAD_WINDOW) {
      vad.acceptWaveform(samples.subarray(offset, offset + VAD_WINDOW));
      take();
    }
    vad.flush();
    take();
    return segments.length ? segments : [samples];
  }

  transcribe(samples: Float32Array): string {
    if (!this.load() || !this.recognizer) throw new Error(this.loadError ?? "语音识别不可用");
    const recognizer = this.recognizer;
    return this.segments(samples)
      .map((segment) => {
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: ASR_SAMPLE_RATE, samples: segment });
        recognizer.decode(stream);
        return recognizer.getResult(stream).text;
      })
      .join("");
  }
}
