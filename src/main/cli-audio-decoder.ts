import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AudioDecoder } from "./audio-decoder";
import { encodePcm16MonoWav, readFloatWavMono, TARGET_SAMPLE_RATE } from "./audio-format";
import { applyTrim } from "./audio-trim";

const CONVERT_TIMEOUT_MS = 120_000;

function describeFailure(error: unknown): Error {
  const raw = (error as { stderr?: string | Buffer }).stderr;
  const stderr = (typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "").trim();
  return new Error(stderr ? `文件内容无法识别为音频：${stderr}` : "文件内容无法识别为音频，可能已损坏或格式不受支持");
}

export class CliAudioDecoder implements AudioDecoder {
  private readonly running = new Set<AbortController>();
  private readonly ffmpegPath: string;

  constructor(ffmpegPath: string) {
    this.ffmpegPath = ffmpegPath;
  }

  async decodeFile(sourcePath: string, sampleRate: number): Promise<Float32Array> {
    const stat = await fs.stat(sourcePath);
    if (!stat.size) throw new Error("文件内容为空");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tungee-audio-"));
    const inputName = `source${path.extname(sourcePath) || ".bin"}`;
    const target = path.join(dir, "decoded.wav");
    const controller = new AbortController();
    this.running.add(controller);
    try {
      await fs.copyFile(sourcePath, path.join(dir, inputName));
      await new Promise<void>((resolve, reject) => {
        execFile(
          this.ffmpegPath,
          ["-hide_banner", "-nostdin", "-y", "-i", inputName, "-vn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_f32le", "decoded.wav"],
          { cwd: dir, signal: controller.signal, timeout: CONVERT_TIMEOUT_MS, windowsHide: true },
          (error, _stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve()),
        );
      });
      return readFloatWavMono(await fs.readFile(target));
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new Error("转换已中止");
      throw error instanceof Error && error.message.startsWith("转换结果") ? error : describeFailure(error);
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
