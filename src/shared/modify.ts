import type { AudioMatchBasis } from "./types";

export type SceneSection = "开场白" | "产品介绍" | "客户邀约" | "结束话语" | "含糊话术";

export const FLOW_SECTIONS = ["开场白", "产品介绍", "客户邀约", "结束话语"] as const;

/** One “话术01” card as it is online, by its position within the section. */
export interface OnlineScene {
  section: SceneSection;
  index: number;
  text: string;
  audioName: string | null;
}

export interface OnlineQuestion {
  category: string;
  question: string;
  answer: string;
  audioName: string | null;
  phrases: string[];
}

/** What the talk looked like online when it was read; also written to disk as the backup. */
export interface OnlineTalk {
  talkName: string;
  readAt: string;
  categories: string[];
  scenes: OnlineScene[];
  questions: OnlineQuestion[];
}

export type ModifyKind = "flow" | "vague" | "knowledge";

/** changed: differs from online; new: not online yet; online-only: online but not in the workbook (never touched); blocked: can't be changed here. */
export type ModifyStatus = "changed" | "new" | "online-only" | "same" | "blocked";

export interface ModifyItem {
  id: string;
  kind: ModifyKind;
  label: string;
  section: SceneSection | null;
  /** Position of the card within its section; -1 for knowledge questions. */
  index: number;
  audioNumber: number | null;
  status: ModifyStatus;
  textChanged: boolean;
  phrasesChanged: boolean;
  /** The recording that replaces the online one, as a file name in the audio folder. */
  audioFile: string | null;
  audioBasis?: AudioMatchBasis;
  onlineText: string | null;
  newText: string | null;
  onlineAudio: string | null;
  addedPhrases: string[];
  removedPhrases: string[];
  warnings: string[];
  /** Whether the item is ticked by default. */
  selected: boolean;
}

export interface ModifyPlan {
  talkName: string;
  readAt: string;
  backupPath: string;
  items: ModifyItem[];
  /** Recordings in the folder that matched no row. */
  unusedFiles: string[];
}

export type ModifyCompareResult =
  | { ok: true; plan: ModifyPlan }
  | { ok: false; message: string };
