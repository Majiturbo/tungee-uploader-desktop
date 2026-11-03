import type { AppErrorInfo, ProgressStage, ValidationIssue } from "./types";

export interface VoiceAgentConfig {
  /** Folder or .zip of a skill delivery pack. */
  packPath: string;
  /** Edits from the review page; overlay the parsed 00-智能体配置.md on upload. */
  agent?: Partial<VoiceAgentFields>;
}

export interface VoiceAgentFields {
  name: string;
  companyName: string;
  selfName: string;
  role: string;
  customRole: string;
  scene: string;
  goal: string;
  greeting: string;
  opening: string;
  companyInfo: string;
}

export interface VoiceAgentIntentItem {
  action?: string;
  matchName?: string;
  name?: string;
  category?: string;
  description?: string | null;
  positiveExamples?: string | null;
  negativeExamples?: string | null;
}

export interface VoiceAgentIntents {
  updates: VoiceAgentIntentItem[];
  creates: VoiceAgentIntentItem[];
}

export interface VoiceAgentPackSummary {
  rootDir: string;
  companyName: string;
  agent: VoiceAgentFields;
  knowledgeFiles: Array<{ name: string; path: string }>;
  hotwordCount: number;
  hotwordsPreview: string[];
  intentUpdates: string[];
  intentCreates: string[];
  promptJson: string;
  confirmCard: string;
}

export interface VoiceAgentPreview {
  canUpload: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  pack?: VoiceAgentPackSummary;
}

export type VoiceAgentPreviewResult =
  | { status: "ok"; preview: VoiceAgentPreview }
  | { status: "error"; error: AppErrorInfo };

export interface VoiceAgentEntryOption {
  index: number;
  label: string;
}

export interface VoiceAgentStartOptions {
  entryIndex?: number;
}

export const VOICE_AGENT_STAGES: ProgressStage[] = [
  "launching", "login", "entry", "quota", "creating", "generating",
  "personalize", "attach", "intent", "paste", "completed", "cancelled", "error",
];
