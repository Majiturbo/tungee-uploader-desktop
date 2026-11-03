import fs from "node:fs/promises";
import path from "node:path";
import type { UploadCheckpointInfo, UploadConfig } from "../shared/types";

export const UPLOAD_CHECKPOINT_STORE = "upload-checkpoint.json";

export interface UploadCheckpoint {
  key: string;
  talkName: string;
  /** Audio numbers of main-flow and vague scenes that were saved. */
  scenes: number[];
  /** Knowledge questions that were saved, with their audio numbers. */
  questions: Array<{ question: string; audioNumber: number }>;
  updatedAt: string;
  /** Corrected copies saved from this workbook; they continue the same upload. */
  workbooks?: string[];
  /** Set when continuing into a talk uploaded without a record, so saved questions must be looked up on the page. */
  unknownProgress?: boolean;
}

/** Identifies one set of files; the talk name is excluded because it can change after a duplicate-name rename. */
export function checkpointKey(config: UploadConfig): string {
  return JSON.stringify([path.resolve(config.workbookPath), path.resolve(config.audioDir), config.categoryName.trim()]);
}

function keyWorkbook(key: string): string {
  try {
    const parts = JSON.parse(key) as unknown;
    return Array.isArray(parts) && typeof parts[0] === "string" ? parts[0] : "";
  } catch {
    return "";
  }
}

export class UploadCheckpointStore {
  private readonly file: string;

  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, UPLOAD_CHECKPOINT_STORE);
  }

  private async read(): Promise<UploadCheckpoint | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as UploadCheckpoint;
      return Array.isArray(parsed.scenes) && Array.isArray(parsed.questions) ? parsed : null;
    } catch {
      return null;
    }
  }

  async load(config: UploadConfig): Promise<UploadCheckpoint | null> {
    const checkpoint = await this.read();
    if (!checkpoint) return null;
    if (checkpoint.key === checkpointKey(config)) return checkpoint;
    const workbook = path.resolve(config.workbookPath);
    const linked = checkpoint.workbooks?.includes(workbook)
      && checkpoint.key === checkpointKey({ ...config, workbookPath: keyWorkbook(checkpoint.key) });
    return linked ? checkpoint : null;
  }

  /** Lets a corrected copy of the workbook continue the upload started from the original. */
  async link(source: string, target: string): Promise<void> {
    const checkpoint = await this.read();
    if (!checkpoint) return;
    const from = path.resolve(source);
    if (keyWorkbook(checkpoint.key) !== from && !checkpoint.workbooks?.includes(from)) return;
    const to = path.resolve(target);
    checkpoint.workbooks = [...new Set([...(checkpoint.workbooks ?? []), to])];
    await this.write(checkpoint);
  }

  async info(config: UploadConfig): Promise<UploadCheckpointInfo | null> {
    const checkpoint = await this.load(config);
    if (!checkpoint) return null;
    return {
      talkName: checkpoint.talkName,
      doneAudioNumbers: [...checkpoint.scenes, ...checkpoint.questions.map((item) => item.audioNumber)],
      updatedAt: checkpoint.updatedAt,
    };
  }

  async save(checkpoint: UploadCheckpoint): Promise<void> {
    checkpoint.updatedAt = new Date().toISOString();
    await this.write(checkpoint);
  }

  private async write(checkpoint: UploadCheckpoint): Promise<void> {
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(checkpoint), "utf8");
    await fs.rename(temp, this.file);
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}
