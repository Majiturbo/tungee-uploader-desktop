import fs from "node:fs/promises";
import path from "node:path";
import type { AudioTrim } from "./audio-trim";

export const AUDIO_MATCH_STORE = "audio-match.json";
const MAX_TRANSCRIPTS = 3000;

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

interface StoredDecision {
  file: string | null;
  size?: number;
  mtimeMs?: number;
}

interface StoreData {
  version: 1;
  transcripts: Record<string, { text: string; usedAt: number }>;
  trims: Record<string, { trim: AudioTrim; usedAt: number }>;
  decisions: Record<string, Record<string, StoredDecision>>;
}

function emptyData(): StoreData {
  return { version: 1, transcripts: {}, trims: {}, decisions: {} };
}

function keepRecent<T extends { usedAt: number }>(entries: Record<string, T>): Record<string, T> {
  const list = Object.entries(entries);
  if (list.length <= MAX_TRANSCRIPTS) return entries;
  list.sort((a, b) => b[1].usedAt - a[1].usedAt);
  return Object.fromEntries(list.slice(0, MAX_TRANSCRIPTS));
}

function transcriptKey(filePath: string, stamp: FileStamp): string {
  return `${path.resolve(filePath)}|${stamp.size}|${Math.round(stamp.mtimeMs)}`;
}

export function matchScope(workbookPath: string, audioDir: string): string {
  return `${path.resolve(workbookPath)}|${path.resolve(audioDir)}`;
}

export class AudioMatchStore {
  private data: StoreData | null = null;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async read(): Promise<StoreData> {
    if (this.data) return this.data;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as Partial<StoreData>;
      this.data = parsed.version === 1
        ? { version: 1, transcripts: parsed.transcripts ?? {}, trims: parsed.trims ?? {}, decisions: parsed.decisions ?? {} }
        : emptyData();
    } catch {
      this.data = emptyData();
    }
    return this.data;
  }

  private async write(): Promise<void> {
    const data = await this.read();
    data.transcripts = keepRecent(data.transcripts);
    data.trims = keepRecent(data.trims);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data), "utf8");
  }

  forget(): void {
    this.data = null;
  }

  async transcript(filePath: string, stamp: FileStamp): Promise<string | undefined> {
    const entry = (await this.read()).transcripts[transcriptKey(filePath, stamp)];
    if (entry) entry.usedAt = Date.now();
    return entry?.text;
  }

  async saveTranscripts(entries: Array<{ filePath: string; stamp: FileStamp; text: string }>): Promise<void> {
    if (!entries.length) return;
    const data = await this.read();
    for (const entry of entries) {
      data.transcripts[transcriptKey(entry.filePath, entry.stamp)] = { text: entry.text, usedAt: Date.now() };
    }
    await this.write();
  }

  async trim(filePath: string, stamp: FileStamp): Promise<AudioTrim | undefined> {
    const entry = (await this.read()).trims[transcriptKey(filePath, stamp)];
    if (entry) entry.usedAt = Date.now();
    return entry?.trim;
  }

  async saveTrims(entries: Array<{ filePath: string; stamp: FileStamp; trim: AudioTrim }>): Promise<void> {
    if (!entries.length) return;
    const data = await this.read();
    for (const entry of entries) {
      data.trims[transcriptKey(entry.filePath, entry.stamp)] = { trim: entry.trim, usedAt: Date.now() };
    }
    await this.write();
  }

  async decisions(scope: string, stamps: Map<string, FileStamp>): Promise<Map<number, string | null>> {
    const stored = (await this.read()).decisions[scope] ?? {};
    const result = new Map<number, string | null>();
    for (const [key, decision] of Object.entries(stored)) {
      const audioNumber = Number(key);
      if (decision.file === null) {
        result.set(audioNumber, null);
        continue;
      }
      const stamp = stamps.get(decision.file);
      if (stamp && stamp.size === decision.size && Math.round(stamp.mtimeMs) === decision.mtimeMs) {
        result.set(audioNumber, decision.file);
      }
    }
    return result;
  }

  async saveDecisions(scope: string, decisions: Map<number, string | null>, stamps: Map<string, FileStamp>): Promise<void> {
    const data = await this.read();
    const stored = { ...(data.decisions[scope] ?? {}) };
    for (const [audioNumber, file] of decisions) {
      const stamp = file === null ? undefined : stamps.get(file);
      if (file !== null && !stamp) continue;
      stored[String(audioNumber)] = stamp
        ? { file, size: stamp.size, mtimeMs: Math.round(stamp.mtimeMs) }
        : { file: null };
    }
    data.decisions[scope] = stored;
    await this.write();
  }

  /** Carries confirmed matches over to another scope, keeping any the target already has. */
  async copyDecisions(from: string, to: string): Promise<void> {
    const data = await this.read();
    const source = data.decisions[from];
    if (!source) return;
    data.decisions[to] = { ...source, ...(data.decisions[to] ?? {}) };
    await this.write();
  }
}
