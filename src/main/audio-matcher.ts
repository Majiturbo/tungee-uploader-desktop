import fs from "node:fs/promises";
import path from "node:path";
import { isSupportedAudioFile, TARGET_SAMPLE_RATE } from "./audio-format";
import { AudioMatchStore, matchScope, type FileStamp } from "./audio-match-store";
import { exactFileNumber, matchAudioFiles, namedFileNumber, type MatchResult, type MatchRules, type MatchSlot } from "./audio-matching";
import { analyzeTrim, type AudioTrim } from "./audio-trim";
import { ASR_SAMPLE_RATE } from "./speech-recognizer";

export interface AudioMatchOutcome {
  result: MatchResult;
  transcripts: Map<string, string>;
  speechUnavailable: string | null;
  failedFiles: string[];
}

export type MatchProgress = (current: number, total: number, fileName: string) => void;

export interface AudioMatchProvider {
  match(workbookPath: string, audioDir: string, slots: MatchSlot[], fileNames: string[], onProgress?: MatchProgress, rules?: MatchRules): Promise<AudioMatchOutcome>;
  /** Silence at either end of each file, by file name; files that can't be read are left out. */
  trims?(audioDir: string, fileNames: string[], onProgress?: MatchProgress): Promise<Map<string, AudioTrim>>;
}

export interface SpeechSource {
  readonly unavailableReason: string | null;
  transcribe(samples: Float32Array): string;
}

export interface AudioMatcherDeps {
  decode: (filePath: string, sampleRate: number) => Promise<Float32Array>;
  recognizer: SpeechSource;
  store: AudioMatchStore;
}

export async function listAudioFiles(audioDir: string): Promise<string[]> {
  const entries = await fs.readdir(audioDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && isSupportedAudioFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
}

async function fileStamps(audioDir: string, fileNames: string[]): Promise<Map<string, FileStamp>> {
  const stamps = new Map<string, FileStamp>();
  await Promise.all(fileNames.map(async (name) => {
    const stats = await fs.stat(path.join(audioDir, name)).catch(() => null);
    if (stats) stamps.set(name, { size: stats.size, mtimeMs: stats.mtimeMs });
  }));
  return stamps;
}

export function matchByFileName(slots: MatchSlot[], fileNames: string[], rules: MatchRules = {}): AudioMatchOutcome {
  return {
    result: matchAudioFiles(slots, fileNames.map((name) => ({ name, transcript: null })), new Map(), rules),
    transcripts: new Map(),
    speechUnavailable: null,
    failedFiles: [],
  };
}

export class AudioMatcher implements AudioMatchProvider {
  private readonly deps: AudioMatcherDeps;

  constructor(deps: AudioMatcherDeps) {
    this.deps = deps;
  }

  async match(workbookPath: string, audioDir: string, slots: MatchSlot[], fileNames: string[], onProgress?: MatchProgress, rules: MatchRules = {}): Promise<AudioMatchOutcome> {
    const stamps = await fileStamps(audioDir, fileNames);
    const decisions = await this.deps.store.decisions(matchScope(workbookPath, audioDir), stamps);
    const slotNumbers = new Set(slots.map((slot) => slot.audioNumber));
    const numberOf = (name: string) => {
      const value = exactFileNumber(name) ?? namedFileNumber(name);
      return value !== null && slotNumbers.has(value) ? value : null;
    };
    const covered = new Set<number>(decisions.keys());
    const confirmedFiles = new Set([...decisions.values()].filter((name): name is string => name !== null));
    for (const name of fileNames) {
      const value = numberOf(name);
      if (value !== null) covered.add(value);
    }
    const needSpeech = rules.numbersAreHints
      ? fileNames.filter((name) => !confirmedFiles.has(name))
      : slots.some((slot) => !covered.has(slot.audioNumber))
        ? fileNames.filter((name) => numberOf(name) === null && !confirmedFiles.has(name))
        : [];

    const transcripts = new Map<string, string>();
    const failedFiles: string[] = [];
    let speechUnavailable: string | null = null;
    if (needSpeech.length) {
      const pending: string[] = [];
      for (const name of needSpeech) {
        const stamp = stamps.get(name);
        const cached = stamp ? await this.deps.store.transcript(path.join(audioDir, name), stamp) : undefined;
        if (cached === undefined) pending.push(name);
        else transcripts.set(name, cached);
      }
      speechUnavailable = pending.length ? this.deps.recognizer.unavailableReason : null;
      if (!speechUnavailable) {
        const fresh: Array<{ filePath: string; stamp: FileStamp; text: string }> = [];
        const trims: Array<{ filePath: string; stamp: FileStamp; trim: AudioTrim }> = [];
        for (const [index, name] of pending.entries()) {
          onProgress?.(index + 1, pending.length, name);
          const filePath = path.join(audioDir, name);
          try {
            const samples = await this.deps.decode(filePath, ASR_SAMPLE_RATE);
            const text = this.deps.recognizer.transcribe(samples);
            transcripts.set(name, text);
            const stamp = stamps.get(name);
            if (stamp) {
              fresh.push({ filePath, stamp, text });
              trims.push({ filePath, stamp, trim: analyzeTrim(samples, ASR_SAMPLE_RATE) });
            }
          } catch (error: unknown) {
            failedFiles.push(`${name}：${error instanceof Error ? error.message : String(error)}`);
          }
          await new Promise((resolve) => setImmediate(resolve));
        }
        await this.deps.store.saveTranscripts(fresh).catch(() => undefined);
        await this.deps.store.saveTrims(trims).catch(() => undefined);
      }
    }

    const files = fileNames.map((name) => ({ name, transcript: transcripts.get(name) ?? null }));
    return { result: matchAudioFiles(slots, files, decisions, rules), transcripts, speechUnavailable, failedFiles };
  }

  async trims(audioDir: string, fileNames: string[], onProgress?: MatchProgress): Promise<Map<string, AudioTrim>> {
    const stamps = await fileStamps(audioDir, fileNames);
    const result = new Map<string, AudioTrim>();
    const pending: string[] = [];
    for (const name of fileNames) {
      const stamp = stamps.get(name);
      const cached = stamp ? await this.deps.store.trim(path.join(audioDir, name), stamp) : undefined;
      if (cached) result.set(name, cached);
      else if (stamp) pending.push(name);
    }
    const fresh: Array<{ filePath: string; stamp: FileStamp; trim: AudioTrim }> = [];
    for (const [index, name] of pending.entries()) {
      onProgress?.(index + 1, pending.length, name);
      const filePath = path.join(audioDir, name);
      try {
        const trim = analyzeTrim(await this.deps.decode(filePath, TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
        result.set(name, trim);
        fresh.push({ filePath, stamp: stamps.get(name)!, trim });
      } catch {
        // Unreadable files are already reported by matching and by conversion.
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    await this.deps.store.saveTrims(fresh).catch(() => undefined);
    return result;
  }

  async confirm(workbookPath: string, audioDir: string, decisions: Map<number, string | null>): Promise<void> {
    const fileNames = await listAudioFiles(audioDir);
    const known = new Set(fileNames);
    const valid = new Map([...decisions].filter(([, name]) => name === null || known.has(name)));
    await this.deps.store.saveDecisions(matchScope(workbookPath, audioDir), valid, await fileStamps(audioDir, fileNames));
  }

  /** A corrected copy keeps the recording numbers, so it keeps the matches confirmed for the original. */
  carryOver(source: string, target: string, audioDir: string): Promise<void> {
    return this.deps.store.copyDecisions(matchScope(source, audioDir), matchScope(target, audioDir));
  }
}
