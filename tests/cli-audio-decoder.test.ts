import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CliAudioDecoder } from "../src/main/cli-audio-decoder.ts";

function floatWav(channels: number, frames: number[][]): Buffer {
  const dataSize = frames.length * channels * 4;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(8000 * channels * 4, 28);
  buffer.writeUInt16LE(channels * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  frames.flat().forEach((sample, index) => buffer.writeFloatLE(sample, 44 + index * 4));
  return buffer;
}

function ffmpegPath(): string | null {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    return null;
  }
}

test("CliAudioDecoder decodes wav and m4a at the requested rate", { skip: !ffmpegPath() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-decoder-"));
  const source = path.join(dir, "tone.wav");
  fs.writeFileSync(source, floatWav(1, Array.from({ length: 8000 }, (_, i) => [0.3 * Math.sin((2 * Math.PI * 440 * i) / 8000)])));
  const m4a = path.join(dir, "clip.m4a");
  execFileSync("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", source, "-c:a", "aac", m4a], { stdio: "ignore" });
  const decoder = new CliAudioDecoder("ffmpeg");
  try {
    const wav = await decoder.decodeFile(source, 16000);
    const aac = await decoder.decodeFile(m4a, 16000);
    assert.ok(wav.length > 16000 * 0.5);
    assert.ok(Math.abs(aac.length - wav.length) < 16000 * 0.1);
    const target = path.join(dir, "out.wav");
    await decoder.convertFile(m4a, target);
    assert.equal(fs.readFileSync(target).readUInt32LE(24), 8000);
  } finally {
    decoder.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CliAudioDecoder rejects bytes that are not audio", { skip: !ffmpegPath() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-decoder-"));
  const fake = path.join(dir, "新录音 1.m4a");
  fs.writeFileSync(fake, "not an audio file");
  const decoder = new CliAudioDecoder("ffmpeg");
  try {
    await assert.rejects(() => decoder.decodeFile(fake, 8000), /无法识别为音频/);
  } finally {
    decoder.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
