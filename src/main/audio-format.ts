import fs from "node:fs/promises";
import path from "node:path";

export const TARGET_SAMPLE_RATE = 8000;
export const CONVERTED_AUDIO_DIR = "已转换-8k";
export const SUPPORTED_AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"];
export const SUPPORTED_AUDIO_LABEL = "WAV、MP3、M4A、AAC、FLAC、OGG";

const HEADER_SCAN_BYTES = 64 * 1024;

export function isSupportedAudioFile(fileName: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

export async function isStandardWav(filePath: string): Promise<boolean> {
  if (path.extname(filePath).toLowerCase() !== ".wav") return false;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEADER_SCAN_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (header.length < 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
      return false;
    }
    let offset = 12;
    while (offset + 8 <= header.length) {
      const chunkId = header.toString("ascii", offset, offset + 4);
      const chunkSize = header.readUInt32LE(offset + 4);
      if (chunkId === "fmt ") {
        if (chunkSize < 16 || offset + 24 > header.length) return false;
        const audioFormat = header.readUInt16LE(offset + 8);
        const channels = header.readUInt16LE(offset + 10);
        const sampleRate = header.readUInt32LE(offset + 12);
        const bitsPerSample = header.readUInt16LE(offset + 22);
        return audioFormat === 1 && channels === 1 && sampleRate === TARGET_SAMPLE_RATE && bitsPerSample === 16;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    return false;
  } finally {
    await handle.close();
  }
}

const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

export function readFloatWavMono(buffer: Buffer): Float32Array {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("转换结果不是 WAV 文件");
  }
  let channels = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunkId === "fmt ") {
      const format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      const bits = buffer.readUInt16LE(body + 14);
      if ((format !== WAVE_FORMAT_IEEE_FLOAT && format !== WAVE_FORMAT_EXTENSIBLE) || bits !== 32 || channels < 1) {
        throw new Error("转换结果格式不正确");
      }
    } else if (chunkId === "data") {
      if (!channels) throw new Error("转换结果缺少格式信息");
      const frames = Math.floor(Math.min(chunkSize, buffer.length - body) / (4 * channels));
      if (!frames) throw new Error("音频时长为 0");
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel += 1) sum += buffer.readFloatLE(body + (frame * channels + channel) * 4);
        samples[frame] = sum / channels;
      }
      return samples;
    }
    offset = body + chunkSize + (chunkSize % 2);
  }
  throw new Error("转换结果缺少音频数据");
}

export function encodePcm16MonoWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const raw = samples[index] ?? 0;
    const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
    buffer.writeInt16LE(Math.round(sample < 0 ? sample * 32768 : sample * 32767), 44 + index * 2);
  }
  return buffer;
}
