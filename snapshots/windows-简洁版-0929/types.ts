import type { IntentAnalysis, IntentSetup } from "./intent-plan";

export interface UploadConfig {
  talkName: string;
  workbookPath: string;
  audioDir: string;
  categoryName: string;
  submitReview: boolean;
}

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  suggestion: string;
  sheetName?: string;
  rowNumber?: number;
  field?: string;
}

export type PreviewRowType = "flow" | "vague" | "knowledge" | "unrecognized";
export type PreviewRowStatus = "ready" | "warning" | "error";
export type AudioAction = "keep" | "convert" | "missing";

export interface PreviewRow {
  sheetName: string;
  rowNumber: number;
  type: PreviewRowType;
  name: string;
  answerPreview: string;
  audioNumber?: number;
  audioAction?: AudioAction;
  audioFile?: string;
  audioBasis?: AudioMatchBasis;
  qaTypes: string[];
  status: PreviewRowStatus;
  note?: string;
}

export interface PreviewSummary {
  detectedSheetName: string;
  canUpload: boolean;
  errorCount: number;
  warningCount: number;
  flowCount: number;
  vagueCount: number;
  knowledgeCount: number;
  flowAudioCount: number;
  vagueAudioCount: number;
  knowledgeAudioCount: number;
  plannedUploadCount: number;
  missingFlowAudio: number[];
  missingVagueAudio: number[];
  missingKnowledgeAudio: number[];
  convertAudioNumbers: number[];
  invalidQaCount: number;
  specialQaCount: number;
  bothQaCount: number;
  warnings: string[];
  issues: ValidationIssue[];
  previewRows: PreviewRow[];
  checkup: CheckupResult;
  audioMatch: AudioMatchSummary;
}

export type AudioMatchBasis = "confirmed" | "number" | "name-number" | "name" | "speech" | "order" | "none";

export interface AudioMatchCandidate {
  fileName: string;
  score: number;
  basis: AudioMatchBasis;
}

export interface AudioMatchItem {
  audioNumber: number;
  label: string;
  speech: string;
  sheetName: string;
  rowNumber: number;
  fileName: string | null;
  basis: AudioMatchBasis;
  score: number;
  needsReview: boolean;
  reason?: string;
  candidates: AudioMatchCandidate[];
}

export interface AudioMatchFile {
  name: string;
  transcript?: string;
}

export interface AudioMatchSummary {
  audioDir: string;
  items: AudioMatchItem[];
  files: AudioMatchFile[];
  unusedFiles: string[];
  smart: boolean;
  autoCount: number;
  reviewCount: number;
  speechUnavailable?: string;
  failedFiles: string[];
}

export type AudioMatchDecisions = Record<string, string | null>;

export type AudioConfirmResult =
  | { status: "saved" }
  | { status: "error"; error: AppErrorInfo };

export type CheckupKind =
  | "system-prompt"
  | "filler-phrase"
  | "duplicate-phrase"
  | "phrase-format"
  | "shared-phrase"
  | "few-phrases"
  | "some-phrases"
  | "special-qa"
  | "invalid-qa"
  | "special-question"
  | "long-speech"
  | "typo";

export interface CheckupOption {
  id: string;
  label: string;
}

export interface CheckupFinding {
  id: string;
  kind: CheckupKind;
  title: string;
  message: string;
  examples: string[];
  rowNumbers: number[];
  options: CheckupOption[];
  defaultOption?: string;
}

export interface CheckupResult {
  findings: CheckupFinding[];
}

export type CheckupDecisions = Record<string, string>;

export type PhraseAdditions = Record<string, string[]>;

export type CheckupSaveResult =
  | { status: "saved"; path: string; appliedCount: number }
  | { status: "cancelled" }
  | { status: "error"; error: AppErrorInfo };

export interface AppErrorInfo {
  code: string;
  message: string;
  suggestion: string;
  detail?: string;
}

export type PreviewResult =
  | { status: "ok"; summary: PreviewSummary }
  | { status: "error"; error: AppErrorInfo };

export type ProgressStage =
  | "idle"
  | "reading"
  | "matching"
  | "ready"
  | "blocked"
  | "converting"
  | "launching"
  | "login"
  | "rename"
  | "flow"
  | "vague"
  | "knowledge"
  | "intent"
  | "review"
  | "completed"
  | "cancelled"
  | "error";

export interface ProgressEvent {
  stage: ProgressStage;
  message: string;
  current?: number;
  total?: number;
  timestamp: string;
  error?: AppErrorInfo;
}

export interface UploadCheckpointInfo {
  talkName: string;
  doneAudioNumbers: number[];
  updatedAt: string;
}

export interface StartOptions {
  resume?: boolean;
}

export interface RunResult {
  status: "completed" | "cancelled" | "error";
  message: string;
  error?: AppErrorInfo;
}

export type LocalPathKind = "file" | "directory" | "missing";

export type ValidationReportResult =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "error"; error: AppErrorInfo };

export type StorageCategory = "browser-cache" | "converted-audio" | "logs" | "app-cache" | "login-data";

export interface StorageItem {
  id: StorageCategory;
  label: string;
  description: string;
  bytes: number;
}

export interface StorageUsage {
  items: StorageItem[];
  totalBytes: number;
}

export type StorageUsageResult =
  | { status: "ok"; usage: StorageUsage }
  | { status: "error"; error: AppErrorInfo };

export type StorageClearResult =
  | { status: "ok"; freedBytes: number; usage: StorageUsage }
  | { status: "error"; error: AppErrorInfo };

export interface AiProgress {
  current: number;
  total: number;
}

export type IntentAnalyzeResult =
  | { status: "ok"; analysis: IntentAnalysis }
  | { status: "cancelled" }
  | { status: "error"; error: AppErrorInfo };

export type AiCheckupResult =
  | { status: "ok"; findings: CheckupFinding[] }
  | { status: "cancelled" }
  | { status: "error"; error: AppErrorInfo };

export type ExpandPhrasesResult =
  | { status: "ok"; phrases: string[] }
  | { status: "cancelled" }
  | { status: "error"; error: AppErrorInfo };

export interface DesktopApi {
  selectWorkbook: () => Promise<string | null>;
  selectAudioDir: () => Promise<string | null>;
  saveStandardTemplate: () => Promise<ValidationReportResult>;
  getPathForFile: (file: File) => string;
  inspectLocalPath: (targetPath: string) => Promise<LocalPathKind>;
  openLogFolder: () => Promise<string>;
  preview: (config: UploadConfig) => Promise<PreviewResult>;
  saveValidationReport: (config: UploadConfig) => Promise<ValidationReportResult>;
  saveCheckupFix: (config: UploadConfig, decisions: CheckupDecisions, additions?: PhraseAdditions) => Promise<CheckupSaveResult>;
  aiCheckup: (config: UploadConfig) => Promise<AiCheckupResult>;
  aiInvalidQa: (config: UploadConfig) => Promise<AiCheckupResult>;
  expandPhrases: (config: UploadConfig, rowNumber: number, fresh?: boolean) => Promise<ExpandPhrasesResult>;
  confirmAudioMatches: (config: UploadConfig, decisions: AudioMatchDecisions) => Promise<AudioConfirmResult>;
  audioUrl: (audioDir: string, fileName: string) => string;
  start: (config: UploadConfig, intents?: IntentSetup[], options?: StartOptions) => Promise<RunResult>;
  confirmLogin: () => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
  checkpoint: (config: UploadConfig) => Promise<UploadCheckpointInfo | null>;
  discardCheckpoint: (config: UploadConfig) => Promise<boolean>;
  cancel: () => Promise<boolean>;
  getStorageUsage: () => Promise<StorageUsageResult>;
  clearStorage: (categories: StorageCategory[]) => Promise<StorageClearResult>;
  onProgress: (callback: (event: ProgressEvent) => void) => () => void;
  analyzeIntent: (config: UploadConfig) => Promise<IntentAnalyzeResult>;
  cancelAi: () => Promise<void>;
  onAiProgress: (callback: (progress: AiProgress) => void) => () => void;
  copyText: (text: string) => Promise<void>;
  exportIntent: (config: UploadConfig, markdown: string) => Promise<ValidationReportResult>;
}
