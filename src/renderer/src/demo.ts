import type { IntentAnalysis, IntentCard, IntentQuestion, IntentSignal } from "../../shared/intent-plan";
import type { AudioMatchItem, PreviewSummary, ProgressEvent, UploadConfig } from "../../shared/types";
import { get, set, type IntentPlanResult, type Step } from "./model";

// Fictional data shown during the guided tour. Contains no real company or person names.

export type TourScene = "idle" | "scheduled" | "login" | "running";

const config: UploadConfig = { talkName: "示例话术", workbookPath: "C:\\示例\\示例话术.xlsx", audioDir: "C:\\示例\\示例录音", categoryName: "客户问答", submitReview: false };

const flowLabels = ["开场白1", "开场白2", "产品介绍1", "产品介绍2", "产品介绍3", "客户邀约1", "客户邀约2", "结束话语1"];
const vagueLabels = ["含糊话术1", "含糊话术2", "含糊话术3"];
const knowledgeLabels = ["加个微信", "发份资料", "价格多少", "公司在哪", "做什么业务", "有什么优势", "太贵了", "已经有合作的了", "你是谁", "怎么称呼", "在忙", "不需要"];
const missingNumber = 17;
/** Recordings in the demo with long silence at the ends: [head, tail] seconds cut. */
const demoTrims: Record<number, [number, number]> = { 5: [1.2, 3], 12: [0, 2.4] };

function demoWave(duration: number, head: number, tail: number): number[] {
  return Array.from({ length: 48 }, (_, index) => {
    const at = ((index + 0.5) / 48) * duration;
    if (at < head + 0.2 || at > duration - tail - 0.3) return 0.03;
    return Math.round((0.45 + 0.55 * Math.abs(Math.sin(index * 1.7))) * 100) / 100;
  });
}

export const demoItems: AudioMatchItem[] = [...flowLabels, ...vagueLabels, ...knowledgeLabels].map((label, index) => {
  const number = index + 1;
  const cut = demoTrims[number];
  return {
    audioNumber: number, label, speech: "", sheetName: "话术内容", rowNumber: number + 2,
    fileName: number === missingNumber ? null : `${number}.wav`, basis: "number", score: 1, needsReview: false, candidates: [],
    ...(cut ? { trim: { head: cut[0], tail: cut[1], duration: 9, wave: demoWave(9, cut[0], cut[1]) } } : {}),
  };
});

export const demoSummary: PreviewSummary = {
  detectedSheetName: "话术内容",
  canUpload: true,
  errorCount: 0,
  warningCount: 1,
  flowCount: flowLabels.length,
  vagueCount: vagueLabels.length,
  knowledgeCount: knowledgeLabels.length,
  flowAudioCount: flowLabels.length,
  vagueAudioCount: vagueLabels.length,
  knowledgeAudioCount: knowledgeLabels.length - 1,
  plannedUploadCount: demoItems.length - 1,
  missingFlowAudio: [],
  missingVagueAudio: [],
  missingKnowledgeAudio: [missingNumber],
  convertAudioNumbers: [3, 7],
  trimAudioNumbers: Object.keys(demoTrims).map(Number),
  invalidQaCount: 0,
  specialQaCount: 2,
  bothQaCount: 0,
  warnings: [],
  issues: [{ code: "W-AUDIO-001", severity: "warning", message: `缺少编号为 ${missingNumber} 的录音文件。`, suggestion: "补上录音后重新检查。" }],
  previewRows: [],
  checkup: {
    findings: [
      { id: "demo-filler", kind: "filler-phrase", title: "加个微信", message: "1 条问法带语气词。",
        examples: ["「嗯，加个微信吧」 → 「加个微信吧」"], rowNumbers: [12], options: [{ id: "fix", label: "去掉语气词" }], defaultOption: "fix" },
      { id: "demo-duplicate", kind: "duplicate-phrase", title: "价格多少", message: "2 条问法重复出现，删除后不影响识别。",
        examples: ["「多少钱」", "「怎么收费」"], rowNumbers: [14], options: [{ id: "fix", label: "删除重复项" }], defaultOption: "fix" },
      { id: "demo-few", kind: "few-phrases", title: "公司在哪", message: "只有 3 条问法，建议补充到 6 条以上。",
        examples: ["「公司在哪」", "「地址在哪」", "「在哪个城市」"], rowNumbers: [16], options: [] },
    ],
  },
  audioMatch: {
    audioDir: config.audioDir,
    items: demoItems,
    files: demoItems.flatMap((item) => (item.fileName ? [{ name: item.fileName }] : [])),
    unusedFiles: [],
    smart: true,
    autoCount: demoItems.length - 1,
    reviewCount: 0,
    failedFiles: [],
  },
};

const signals: Record<string, IntentSignal> = {
  加个微信: "action", 发份资料: "action", 价格多少: "price", 公司在哪: "consult", 做什么业务: "consult",
  有什么优势: "consult", 太贵了: "objection", 已经有合作的了: "objection", 你是谁: "other", 怎么称呼: "other",
  在忙: "reject", 不需要: "reject",
};

const questions: IntentQuestion[] = knowledgeLabels.map((name) => ({
  name, phrases: [name], signal: signals[name] ?? "other", source: "model", alternative: name === "有什么优势" ? "action" : undefined,
}));

const analysis: IntentAnalysis = {
  flowCount: flowLabels.length, vagueCount: vagueLabels.length, knowledgeCount: knowledgeLabels.length, questions, modelUsed: true,
};

const card = (id: IntentCard["id"], level: IntentCard["level"], description: string, when: string, cardQuestions: string[], confirms: string[] = []): IntentCard => ({
  id, level, description, when, match: "任意", conditions: [], directTrigger: false, order: "", confirms, questions: cardQuestions,
});

const cards: IntentCard[] = [
  card("action", "A级", "要微信/资料", "客户想加微信或要资料，愿意进一步了解。", ["加个微信", "发份资料"]),
  card("price", "A级", "主动询价", "客户主动问价格。", ["价格多少"]),
  card("consult", "B级", "业务咨询", "客户在了解公司和业务。", ["公司在哪", "做什么业务", "有什么优势"], ["「有什么优势」也可能是明确行动，确认一下放在哪里。"]),
  card("objection", "C级", "嫌贵/已有合作", "客户有顾虑，暂时不需要。", ["太贵了", "已经有合作的了"]),
];

const plan: IntentPlanResult = {
  plan: {
    cards,
    skipped: [
      { name: "你是谁", reason: "身份确认，不代表意向" },
      { name: "怎么称呼", reason: "身份确认，不代表意向" },
      { name: "在忙", reason: "明确拒绝，交给默认意向" },
      { name: "不需要", reason: "明确拒绝，交给默认意向" },
    ],
    confirms: [],
  },
  setups: cards.map((item) => ({ level: item.level, description: item.description, match: item.match, questions: item.questions,
    placement: item.level === "C级" ? "end" : "before-main-affirm" })),
  markdown: "# 示例话术 · 意向设置建议\n",
  flagged: ["有什么优势"],
};

function logs(messages: string[], stage: ProgressEvent["stage"]): ProgressEvent[] {
  const now = Date.now();
  return messages.map((message, index) => ({ stage, message, timestamp: new Date(now + (index - messages.length) * 3000).toISOString() }));
}

export function enterDemo(): void {
  const s = get();
  set({
    saved: {
      config: s.config, summary: s.summary, step: s.step, stage: s.stage, progress: s.progress, logs: s.logs, error: s.error,
      showInspector: s.showInspector, intentAnalysis: s.intentAnalysis, intentQuestions: s.intentQuestions, intentResult: s.intentResult,
      scheduledIntents: s.scheduledIntents, uploadDone: s.uploadDone, uploadActive: s.uploadActive, uploadMessage: s.uploadMessage,
      checkpoint: s.checkpoint,
    },
    checkpoint: null,
    config,
    summary: demoSummary,
    error: null,
    notice: null,
    showInspector: true,
    intentAnalysis: analysis,
    intentQuestions: questions,
    intentResult: plan,
    scheduledIntents: null,
  });
}

export function exitDemo(): void {
  const saved = get().saved;
  if (!saved) return;
  set({ ...saved, notice: null, saved: null });
}

const sorted = () => [...demoItems].sort((a, b) => a.audioNumber - b.audioNumber);

/** Moves the fake upload one recording forward, looping so the tour always has something lighting up. */
export function advanceDemoUpload(): void {
  const items = sorted();
  const { uploadActive, uploadDone, logs: current } = get();
  const position = items.findIndex((item) => item.audioNumber === uploadActive);
  if (uploadActive === null || position < 0) return;
  const done = new Set(uploadDone).add(uploadActive);
  const next = items[position + 1];
  if (next) {
    set({
      uploadDone: done,
      uploadActive: next.audioNumber,
      progress: { current: Math.max(1, position + 2 - demoSummary.flowCount - demoSummary.vagueCount), total: demoSummary.knowledgeCount - 1 },
      logs: [...current, ...logs([`正在新增知识库：${next.label}`], "knowledge")].slice(-8),
    });
  } else {
    set({ uploadDone: new Set(items.slice(0, 8).map((item) => item.audioNumber)), uploadActive: items[8]!.audioNumber });
  }
}

/** Puts the demo session into the state a tour step talks about. */
export function showDemo(scene: TourScene, page: Step): void {
  set({ step: page, uploadMessage: null });
  switch (scene) {
    case "idle":
      set({ stage: "idle", progress: {}, logs: [], uploadDone: new Set(), uploadActive: null, scheduledIntents: null });
      break;
    case "scheduled":
      set({ stage: "idle", logs: [], uploadDone: new Set(), uploadActive: null, scheduledIntents: plan.setups });
      break;
    case "login":
      set({ stage: "login", progress: {}, uploadDone: new Set(), uploadActive: null, scheduledIntents: plan.setups,
        logs: logs(["2 个录音已转成 8k 单声道 WAV", "正在打开 Chrome", "等待登录探迹"], "login") });
      break;
    case "running": {
      const items = sorted();
      set({
        stage: "knowledge",
        progress: { current: 5, total: demoSummary.knowledgeCount - 1 },
        scheduledIntents: plan.setups,
        uploadDone: new Set(items.slice(0, 15).map((item) => item.audioNumber)),
        uploadActive: items[15]!.audioNumber,
        logs: logs(["已登录探迹", "主流程 8 条已确认上传", "含糊话术 3 条已确认上传", "正在新增知识库：做什么业务"], "knowledge"),
      });
      break;
    }
  }
}
