import type { AudioMatchItem, CheckupFinding, PreviewSummary, ProgressEvent, UploadConfig } from "../../shared/types";
import type { IntentSetup } from "../../shared/intent-plan";

export const demoConfig: UploadConfig = {
  talkName: "示例话术",
  workbookPath: "示例话术.xlsx",
  audioDir: "示例录音",
  categoryName: "客户问答",
  submitReview: false,
};

const audioItems: AudioMatchItem[] = Array.from({ length: 23 }, (_, index) => ({
  audioNumber: index + 1,
  label: `录音 ${index + 1}`,
  speech: "",
  sheetName: "话术",
  rowNumber: index + 2,
  fileName: `${index + 1}.wav`,
  basis: "number",
  score: 1,
  needsReview: false,
  candidates: [],
}));

const findings: CheckupFinding[] = [
  {
    id: "demo-filler",
    kind: "filler-phrase",
    title: "加个微信",
    message: "1 条问法带语气词。",
    examples: ["「嗯，加个微信吧」 → 「加个微信吧」"],
    rowNumbers: [12],
    options: [{ id: "fix", label: "去掉语气词" }],
    defaultOption: "fix",
  },
  {
    id: "demo-duplicate",
    kind: "duplicate-phrase",
    title: "价格多少",
    message: "2 条问法重复出现，删除后不影响识别。",
    examples: ["「多少钱」", "「怎么收费」"],
    rowNumbers: [14],
    options: [{ id: "fix", label: "删除重复项" }],
    defaultOption: "fix",
  },
  {
    id: "demo-few",
    kind: "few-phrases",
    title: "公司在哪",
    message: "只有 3 条问法，建议补充到 6 条以上。",
    examples: ["「公司在哪」", "「地址在哪」", "「在哪个城市」"],
    rowNumbers: [16],
    options: [],
  },
];

export const demoSummary: PreviewSummary = {
  detectedSheetName: "话术",
  canUpload: true,
  errorCount: 0,
  warningCount: 1,
  flowCount: 8,
  vagueCount: 3,
  knowledgeCount: 12,
  flowAudioCount: 8,
  vagueAudioCount: 3,
  knowledgeAudioCount: 12,
  plannedUploadCount: 23,
  missingFlowAudio: [],
  missingVagueAudio: [],
  missingKnowledgeAudio: [],
  convertAudioNumbers: [3, 7],
  invalidQaCount: 0,
  specialQaCount: 2,
  bothQaCount: 0,
  warnings: [],
  issues: [
    { code: "W-DEMO-001", severity: "warning", message: "「公司在哪」问法偏少", suggestion: "建议补充到 6 条以上。", sheetName: "话术", rowNumber: 16 },
  ],
  previewRows: [],
  checkup: { findings },
  audioMatch: {
    audioDir: demoConfig.audioDir,
    items: audioItems,
    files: audioItems.map((item) => ({ name: item.fileName ?? "" })),
    unusedFiles: [],
    smart: true,
    autoCount: audioItems.length,
    reviewCount: 0,
    failedFiles: [],
  },
};

export const demoIntents: IntentSetup[] = [
  { level: "A级", description: "要微信/资料", match: "所有", questions: ["加个微信", "发份资料"], placement: "before-main-affirm" },
  { level: "A级", description: "主动询价", match: "所有", questions: ["价格多少"], placement: "before-main-affirm" },
  { level: "B级", description: "业务咨询/合作评估", match: "所有", questions: ["公司在哪", "做什么业务", "有什么优势"], placement: "before-main-affirm" },
  { level: "C级", description: "嫌贵/已有合作", match: "所有", questions: ["太贵了", "已经有合作的了"], placement: "end" },
];

export function demoLogs(): ProgressEvent[] {
  const now = Date.now();
  const at = (offset: number) => new Date(now - offset * 1000).toISOString();
  return [
    { stage: "converting", message: "2 个录音已转换为 8k 单声道 WAV", timestamp: at(6) },
    { stage: "launching", message: "正在打开 Chrome", timestamp: at(4) },
    { stage: "login", message: "等待登录探迹", timestamp: at(2) },
  ];
}
