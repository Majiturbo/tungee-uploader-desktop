import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AfconvertDecoder, readFloatWavMono } from "../src/main/afconvert-decoder.ts";

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

test("readFloatWavMono averages channels", () => {
  const samples = readFloatWavMono(floatWav(2, [[0.5, -0.5], [1, 0], [0.25, 0.75]]));
  assert.deepEqual(Array.from(samples), [0, 0.5, 0.5]);
});

test("readFloatWavMono rejects non-float data", () => {
  const buffer = floatWav(1, [[0]]);
  buffer.writeUInt16LE(1, 20);
  assert.throws(() => readFloatWavMono(buffer), /格式不正确/);
});

test("AfconvertDecoder decodes wav and m4a at the requested rate", { skip: process.platform !== "darwin" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afconvert-test-"));
  const source = path.join(dir, "tone.wav");
  fs.writeFileSync(source, floatWav(1, Array.from({ length: 8000 }, (_, i) => [0.3 * Math.sin((2 * Math.PI * 440 * i) / 8000)])));
  try {
    const m4a = path.join(dir, "clip.m4a");
    execFileSync("/usr/bin/afconvert", ["-f", "m4af", "-d", "aac", source, m4a]);
    const decoder = new AfconvertDecoder();
    const wav = await decoder.decodeFile(source, 16000);
    const aac = await decoder.decodeFile(m4a, 16000);
    assert.ok(wav.length > 16000 * 0.5);
    assert.ok(Math.abs(aac.length - wav.length) < 16000 * 0.1);
    const target = path.join(dir, "out.wav");
    await decoder.convertFile(m4a, target);
    assert.equal(fs.readFileSync(target).readUInt32LE(24), 8000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
