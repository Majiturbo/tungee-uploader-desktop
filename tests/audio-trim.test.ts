import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTrim, applyTrim, needsTrim } from "../src/main/audio-trim";

const RATE = 8000;

function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648 - 0.5;
  };
}

/** Parts of [seconds, amplitude]: amplitude 0 is room noise, anything else a voice-like tone at that level. */
function recording(parts: Array<[number, number]>, noiseLevel = 0.0005): Float32Array {
  const random = noise(7);
  const samples: number[] = [];
  for (const [seconds, amplitude] of parts) {
    for (let index = 0; index < Math.round(seconds * RATE); index += 1) {
      const t = index / RATE;
      samples.push(random() * noiseLevel * 2 + amplitude * Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)));
    }
  }
  return Float32Array.from(samples);
}

const near = (actual: number, expected: number, tolerance = 0.06) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected about ${expected}, got ${actual}`);

test("long silence at both ends is cut, keeping a little before and after the sound", () => {
  const trim = analyzeTrim(recording([[1.5, 0], [2, 0.3], [3, 0]]), RATE);
  near(trim.head, 1.3);
  near(trim.tail, 2.7);
  near(trim.duration, 6.5, 0.01);
  assert.equal(trim.empty, undefined);
  assert.equal(trim.wave.length, 48);
  assert.equal(Math.max(...trim.wave), 1);
});

test("silence of half a second or less is left alone", () => {
  const trim = analyzeTrim(recording([[0.4, 0], [2, 0.3], [0.45, 0]]), RATE);
  assert.equal(trim.head, 0);
  assert.equal(trim.tail, 0);
  assert.equal(needsTrim(trim), false);
});

test("a quiet first syllable counts as sound", () => {
  const trim = analyzeTrim(recording([[2, 0], [0.4, 0.01], [2, 0.3], [1, 0]]), RATE);
  near(trim.head, 1.8);
});

test("a lone click in the silence doesn't count as sound", () => {
  const samples = recording([[2, 0], [2, 0.3], [1, 0]]);
  samples[Math.round(0.5 * RATE)] = 0.9;
  near(analyzeTrim(samples, RATE).head, 1.8);
});

test("noisy recordings are only trimmed where it's clearly silence", () => {
  const trim = analyzeTrim(recording([[1.5, 0], [2, 0.3], [1.5, 0]], 0.02), RATE);
  near(trim.head, 1.3, 0.1);
  near(trim.tail, 1.2, 0.1);
});

test("silent or sound-free recordings are flagged and left untouched", () => {
  const silent = analyzeTrim(recording([[3, 0]]), RATE);
  assert.equal(silent.empty, true);
  assert.equal(needsTrim(silent), false);
  const blip = analyzeTrim(recording([[2, 0], [0.08, 0.3], [2, 0]]), RATE);
  assert.equal(blip.empty, true);
  assert.equal(needsTrim(blip), false);
});

test("a one-word recording of a quarter second is trimmed like any other, not taken for empty", () => {
  const trim = analyzeTrim(recording([[1, 0], [0.25, 0.3], [1.5, 0]]), RATE);
  assert.equal(trim.empty, undefined);
  near(trim.head, 0.8);
  near(trim.tail, 1.2);
});

test("sound all the way through is left alone", () => {
  const trim = analyzeTrim(recording([[3, 0.3]]), RATE);
  assert.equal(needsTrim(trim), false);
  assert.equal(trim.empty, undefined);
});

test("cutting keeps the middle and fades the new edges", () => {
  const samples = new Float32Array(RATE * 4).fill(0.5);
  const cut = applyTrim(samples, RATE, { head: 1, tail: 0.5 });
  assert.equal(cut.length, RATE * 2.5);
  assert.equal(cut[0], 0);
  assert.ok(Math.abs(cut[cut.length - 1]!) < 0.01);
  assert.equal(cut[Math.round(cut.length / 2)], 0.5);
  assert.equal(samples[0], 0.5);
  const headOnly = applyTrim(samples, RATE, { head: 1, tail: 0 });
  assert.equal(headOnly[headOnly.length - 1], 0.5);
});
