/** Finds overly long silence at the start and end of a recording, and cuts it. */

/** Silence kept before the first sound and after the last, so breaths and decaying endings survive. */
export const KEEP_HEAD = 0.2;
export const KEEP_TAIL = 0.3;
/** Shorter silence than this at either end is left alone. */
export const MIN_SILENCE = 0.5;
/** Less sound than this in total means the recording is probably empty; a one-word "嗯" or "喂" is about 0.25 s. */
const MIN_SOUND = 0.12;
const FRAME_SECONDS = 0.02;
/** Consecutive loud frames needed to count as sound, so a lone click doesn't. */
const RUN_FRAMES = 3;
/** Quieter than this at its loudest, a recording is treated as silent. */
const SILENT_DB = -55;
/** Below this gap between the quietest and loudest parts there's no telling silence from sound. */
const MIN_RANGE_DB = 15;
const FADE_SECONDS = 0.01;
const WAVE_BARS = 48;

export interface AudioTrim {
  /** Seconds to cut from the start and the end; 0 leaves that end alone. */
  head: number;
  tail: number;
  duration: number;
  /** No sound found: probably an empty recording, left untouched. */
  empty?: boolean;
  /** Peak level of each slice across the whole recording, 0–1, for drawing. */
  wave: number[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function waveform(samples: Float32Array): number[] {
  const bars = new Array<number>(WAVE_BARS).fill(0);
  if (!samples.length) return bars;
  for (let index = 0; index < samples.length; index += 1) {
    const bar = Math.min(WAVE_BARS - 1, Math.floor((index / samples.length) * WAVE_BARS));
    const value = Math.abs(samples[index] ?? 0);
    if (value > bars[bar]!) bars[bar] = value;
  }
  const loudest = Math.max(...bars);
  return bars.map((value) => (loudest > 0 ? round2(value / loudest) : 0));
}

function percentile(sorted: Float64Array, fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)))]!;
}

export function analyzeTrim(samples: Float32Array, sampleRate: number): AudioTrim {
  const duration = samples.length / sampleRate;
  const untouched: AudioTrim = { head: 0, tail: 0, duration: round2(duration), wave: waveform(samples) };
  const frameSize = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const count = Math.floor(samples.length / frameSize);
  if (count < RUN_FRAMES) return untouched;

  const levels = new Float64Array(count);
  for (let frame = 0; frame < count; frame += 1) {
    let sum = 0;
    for (let index = frame * frameSize; index < (frame + 1) * frameSize; index += 1) sum += (samples[index] ?? 0) ** 2;
    levels[frame] = 10 * Math.log10(sum / frameSize + 1e-12);
  }
  const sorted = Float64Array.from(levels).sort();
  const floor = percentile(sorted, 0.05);
  const peak = percentile(sorted, 0.99);
  if (peak < SILENT_DB) return { ...untouched, empty: true };
  if (peak - floor < MIN_RANGE_DB) return untouched;
  // Close above the noise floor so quiet first syllables count, but never so close that background noise does.
  const threshold = Math.max(floor + 6, peak - 50, Math.min(floor + 12, peak - 30));

  let first = -1;
  let last = -1;
  let run = 0;
  for (let frame = 0; frame < count; frame += 1) {
    run = levels[frame]! >= threshold ? run + 1 : 0;
    if (run < RUN_FRAMES) continue;
    if (first < 0) first = frame - RUN_FRAMES + 1;
    last = frame;
  }
  if (first < 0) return { ...untouched, empty: true };
  const start = (first * frameSize) / sampleRate;
  const end = Math.min(duration, ((last + 1) * frameSize) / sampleRate);
  if (end - start < MIN_SOUND) return { ...untouched, empty: true };

  const lead = start;
  const trail = duration - end;
  return {
    ...untouched,
    head: lead > MIN_SILENCE ? round2(lead - KEEP_HEAD) : 0,
    tail: trail > MIN_SILENCE ? round2(trail - KEEP_TAIL) : 0,
  };
}

export function needsTrim(trim: Pick<AudioTrim, "head" | "tail"> | null | undefined): boolean {
  return Boolean(trim && (trim.head > 0 || trim.tail > 0));
}

/** The recording without the trimmed ends, faded in and out over a few milliseconds so the cuts don't click. */
export function applyTrim(samples: Float32Array, sampleRate: number, trim: Pick<AudioTrim, "head" | "tail">): Float32Array {
  const start = Math.min(samples.length, Math.max(0, Math.round(trim.head * sampleRate)));
  const end = Math.max(start, samples.length - Math.max(0, Math.round(trim.tail * sampleRate)));
  const cut = samples.slice(start, end);
  const fade = Math.min(Math.round(FADE_SECONDS * sampleRate), Math.floor(cut.length / 2));
  for (let index = 0; index < fade; index += 1) {
    const gain = index / fade;
    const tail = cut.length - 1 - index;
    if (trim.head > 0) cut[index] = (cut[index] ?? 0) * gain;
    if (trim.tail > 0) cut[tail] = (cut[tail] ?? 0) * gain;
  }
  return cut;
}
