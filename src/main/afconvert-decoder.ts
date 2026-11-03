import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AudioDecoder } from "./audio-decoder";
import { encodePcm16MonoWav, readFloatWavMono, TARGET_SAMPLE_RATE } from "./audio-format";
import { applyTrim } from "./audio-trim";

export { readFloatWavMono };

const AFCONVERT = "/usr/bin/afconvert";
const CONVERT_TIMEOUT_MS = 120_000;

function describeFailure(sourcePath: string, error: unknown): Error {
  if (path.extname(sourcePath).toLowerCase() === ".ogg") return new Error("macOS 不支持 OGG，请先转成 WAV 或 MP3");
  const stderr = (error as { stderr?: string }).stderr?.trim();
  return new Error(stderr ? `文件内容无法识别为音频：${stderr}` : "文件内容无法识别为音频，可能已损坏或格式不受支持");
}

export class AfconvertDecoder implements AudioDecoder {
  private readonly running = new Set<AbortController>();

  async decodeFile(sourcePath: string, sampleRate: number): Promise<Float32Array> {
    const stat = await fs.stat(sourcePath);
    if (!stat.size) throw new Error("文件内容为空");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tungee-audio-"));
    const target = path.join(dir, "decoded.wav");
    const controller = new AbortController();
    this.running.add(controller);
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(AFCONVERT, ["-f", "WAVE", "-d", `LEF32@${sampleRate}`, sourcePath, target],
          { signal: controller.signal, timeout: CONVERT_TIMEOUT_MS },
          (error, _stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve()));
      });
      return readFloatWavMono(await fs.readFile(target));
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new Error("转换已中止");
      throw error instanceof Error && error.message.startsWith("转换结果") ? error : describeFailure(sourcePath, error);
    } finally {
      this.running.delete(controller);
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async convertFile(sourcePath: string, targetPath: string, trim?: { head: number; tail: number }): Promise<void> {
    const samples = await this.decodeFile(sourcePath, TARGET_SAMPLE_RATE);
    await fs.writeFile(targetPath, encodePcm16MonoWav(trim ? applyTrim(samples, TARGET_SAMPLE_RATE, trim) : samples));
  }

  dispose(): void {
    for (const controller of this.running) controller.abort();
    this.running.clear();
  }
}
