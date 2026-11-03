import path from "node:path";
import ExcelJS from "exceljs";
import { isStandardWav, SUPPORTED_AUDIO_LABEL } from "./audio-format";
import { listAudioFiles, matchByFileName, type AudioMatchOutcome, type AudioMatchProvider, type MatchProgress } from "./audio-matcher";
import { exactFileNumber, type MatchSlot } from "./audio-matching";
import { needsTrim, type AudioTrim } from "./audio-trim";
import { buildCheckup } from "./script-checkup";
import type {
  AudioAction,
  AudioMatchBasis,
  AudioMatchItem,
  AudioMatchSummary,
  CheckupKind,
  PreviewRow,
  PreviewRowType,
  PreviewSummary,
  UploadConfig,
  ValidationIssue,
  ValidationSeverity,
} from "../shared/types";

type CellValue = string | number | boolean | null;
type HeaderField = "question" | "commonQuestions" | "audio" | "answer" | "invalid" | "special";
export type FlowSection = "开场白" | "产品介绍" | "客户邀约" | "结束话语";

export interface SpeechTask {
  moduleName: string;
  sectionName: FlowSection | null;
  audioNumber: number;
  speech: string;
  sheetName: string;
  sourceRow: number;
}

export interface KnowledgeTask {
  question: string;
  commonQuestions: string;
  answer: string;
  audioNumber: number;
  invalidQa: boolean;
  specialQa: boolean;
  sheetName: string;
  sourceRow: number;
}

export interface AudioFields {
  audioPath: string;
  audioExists: boolean;
  audioNeedsConversion: boolean;
  /** Seconds of silence to cut from each end before uploading; absent when there's nothing to cut. */
  audioTrim?: { head: number; tail: number };
}

export interface AudioSpeechTask extends SpeechTask, AudioFields {}

export interface AudioKnowledgeTask extends KnowledgeTask, AudioFields {}

interface WorkbookData {
  detectedSheetName: string;
  commonQuestionsColumn: number | null;
  /** 1-based columns of the 无效QA / 特殊QA flags, null when the template lacks them. */
  flagColumns: { invalid: number | null; special: number | null };
  flowRowCount: number;
  vagueRowCount: number;
  knowledgeRowCount: number;
  flowTasks: SpeechTask[];
  vagueTasks: SpeechTask[];
  knowledgeTasks: KnowledgeTask[];
  issues: ValidationIssue[];
  previewRows: PreviewRow[];
}

export interface LoadedData {
  detectedSheetName: string;
  commonQuestionsColumn: number | null;
  /** 1-based columns of the 无效QA / 特殊QA flags, null when the template lacks them. */
  flagColumns: { invalid: number | null; special: number | null };
  flowRowCount: number;
  vagueRowCount: number;
  knowledgeRowCount: number;
  flowTasks: AudioSpeechTask[];
  vagueTasks: AudioSpeechTask[];
  knowledgeTasks: AudioKnowledgeTask[];
  issues: ValidationIssue[];
  previewRows: PreviewRow[];
  audioMatch: AudioMatchSummary;
}

interface HeaderCandidate {
  rowNumber: number;
  columns: Partial<Record<HeaderField, number>>;
  labels: Partial<Record<HeaderField, string>>;
}

interface SheetCandidate {
  sheet: ExcelJS.Worksheet;
  rows: CellValue[][];
  flowHeaders: HeaderCandidate[];
  knowledgeHeaders: HeaderCandidate[];
  score: number;
}

interface AudioReference {
  audioNumber: number;
  sheetName: string;
  rowNumber: number;
  field: string;
}

const HEADER_ALIASES: Record<HeaderField, string[]> = {
  question: ["问题", "问题名称", "知识库问题", "问题标题"],
  commonQuestions: ["问法", "常用问法", "客户问法", "相似问法"],
  audio: ["录音编号", "音频编号", "录音序号", "编号"],
  answer: ["客户话术填写列", "客户话术填写", "客户话术", "回答文本", "回答话术", "客户回答", "答案", "回答"],
  invalid: ["无效qa", "是否无效qa", "无效问答"],
  special: ["特殊qa", "是否特殊qa", "特殊问答"],
};

const EXPECTED_FLOW_MODULES = [
  "开场白",
  "产品介绍",
  "客户邀约-意向邀约01",
  "客户邀约-意向邀约02",
  "客户邀约-挽回邀约01",
  "客户邀约-挽回邀约02",
  "客户邀约-挽回邀约03",
  "客户邀约-挽回邀约04",
  "客户邀约-挽回邀约05",
  "结束话语01",
  "结束话语02",
  "结束话语03",
  "结束话语04",
] as const;

const EXPECTED_VAGUE_MODULES = ["含糊话术01", "含糊话术02", "含糊话术03", "含糊话术04"] as const;

function issue(
  code: string,
  severity: ValidationSeverity,
  message: string,
  suggestion: string,
  location: Pick<ValidationIssue, "sheetName" | "rowNumber" | "field"> = {},
): ValidationIssue {
  return { code, severity, message, suggestion, ...location };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function plainCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (!isRecord(value)) return String(value);
  if (Array.isArray(value.richText)) {
    return value.richText
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  if (Object.hasOwn(value, "result")) return plainCellValue(value.result);
  if (Object.hasOwn(value, "text")) return plainCellValue(value.text);
  return String(value);
}

function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFKC").trim();
}

function normalizedLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s:：_\-—()（）【】\[\]]/g, "");
}

function headerPriority(field: HeaderField, value: CellValue | undefined): number | null {
  const text = cellText(value);
  if (!text) return null;
  const normalized = normalizedLabel(text);
  if (field === "answer" && (normalized === "回答" || normalized === "答案")) return 50;
  const compact = text.normalize("NFKC").toLowerCase().replace(/\s/g, "");
  if (field === "answer" && /^话术\d+(?::.*)?$/.test(compact)) return 20;
  const aliasIndex = HEADER_ALIASES[field].findIndex((alias) => normalized === normalizedLabel(alias));
  if (aliasIndex >= 0) return aliasIndex;
  return null;
}

function resolveHeader(row: CellValue[], required: HeaderField[]): HeaderCandidate | null {
  const columns: Partial<Record<HeaderField, number>> = {};
  const labels: Partial<Record<HeaderField, string>> = {};
  for (const field of Object.keys(HEADER_ALIASES) as HeaderField[]) {
    const matches = row
      .map((value, index) => ({ index, label: cellText(value), priority: headerPriority(field, value) }))
      .filter((match): match is { index: number; label: string; priority: number } => match.priority !== null);
    if (!matches.length) continue;
    const bestPriority = Math.min(...matches.map((match) => match.priority));
    const best = matches.filter((match) => match.priority === bestPriority);
    if (best.length !== 1) continue;
    const selected = best[0];
    if (!selected) continue;
    columns[field] = selected.index;
    labels[field] = selected.label;
  }
  if (required.some((field) => columns[field] === undefined)) return null;
  return { rowNumber: 0, columns, labels };
}

function worksheetRows(sheet: ExcelJS.Worksheet): CellValue[][] {
  const rows: CellValue[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const rowValues: CellValue[] = [];
    for (let columnNumber = 1; columnNumber <= sheet.columnCount; columnNumber += 1) {
      rowValues.push(plainCellValue(row.getCell(columnNumber).value));
    }
    rows.push(rowValues);
  }
  return rows;
}

function analyzeSheet(sheet: ExcelJS.Worksheet): SheetCandidate {
  const rows = worksheetRows(sheet);
  const flowHeaders: HeaderCandidate[] = [];
  const knowledgeHeaders: HeaderCandidate[] = [];
  rows.forEach((row, index) => {
    const knowledge = resolveHeader(row, ["question", "commonQuestions", "audio", "answer"]);
    if (knowledge) {
      knowledgeHeaders.push({ ...knowledge, rowNumber: index + 1 });
      return;
    }
    const flow = resolveHeader(row, ["audio", "answer"]);
    if (flow) flowHeaders.push({ ...flow, rowNumber: index + 1 });
  });
  const preferredName = normalizedLabel(sheet.name) === normalizedLabel("话术内容") ? 5 : 0;
  return {
    sheet,
    rows,
    flowHeaders,
    knowledgeHeaders,
    score: preferredName + flowHeaders.length * 10 + knowledgeHeaders.length * 100,
  };
}

function chooseSheet(workbook: ExcelJS.Workbook): SheetCandidate {
  const candidates = workbook.worksheets.map(analyzeSheet).filter((candidate) => candidate.score > 0);
  if (!candidates.length) {
    throw new Error("Excel 中未找到可识别的话术表头；至少需要“录音编号/编号”和回答话术列");
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected = candidates[0];
  if (!selected) throw new Error("Excel 中没有可读取的工作表");
  const tied = candidates.filter((candidate) => candidate.score === selected.score);
  if (tied.length > 1) {
    throw new Error(`Excel 中有多个结构相同的话术工作表：${tied.map((candidate) => candidate.sheet.name).join("、")}`);
  }
  return selected;
}

function parseAudioNumber(value: CellValue | undefined): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  const text = cellText(value).replace(/\.wav$/i, "");
  if (!/^\d+(?:\.0+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function flowSectionFor(moduleName: string): FlowSection | null {
  const normalized = normalizedLabel(moduleName);
  if (normalized.includes("开场白") || normalized === "开场") return "开场白";
  if (normalized.includes("产品介绍") || normalized.includes("业务介绍")) return "产品介绍";
  if (normalized.includes("客户邀约") || normalized.includes("意向邀约") || normalized.includes("挽回邀约")) return "客户邀约";
  if (normalized.includes("结束话语") || normalized.includes("结束话术") || normalized.includes("结束语")) return "结束话语";
  return null;
}

function isVagueModule(moduleName: string): boolean {
  const normalized = normalizedLabel(moduleName);
  return normalized.startsWith("含糊话术") || normalized.startsWith("模糊话术");
}

function parseQaFlag(value: CellValue | undefined): { valid: boolean; enabled: boolean } {
  if (value === null || value === undefined || cellText(value) === "") return { valid: true, enabled: false };
  if (typeof value === "boolean") return { valid: true, enabled: value };
  if (typeof value === "number") {
    if (value === 1) return { valid: true, enabled: true };
    if (value === 0) return { valid: true, enabled: false };
    return { valid: false, enabled: false };
  }
  const normalized = normalizedLabel(cellText(value));
  if (["是", "yes", "y", "true", "1", "√", "对"].includes(normalized)) return { valid: true, enabled: true };
  if (["否", "no", "n", "false", "0", "×", "不"].includes(normalized)) return { valid: true, enabled: false };
  return { valid: false, enabled: false };
}

function answerPreview(value: string): string {
  return value.length > 48 ? `${value.slice(0, 48)}…` : value;
}

function isInstructionRow(firstCell: string, row: CellValue[]): boolean {
  const normalized = normalizedLabel(firstCell);
  const populated = row.map((value) => cellText(value)).filter(Boolean);
  const isInstruction = normalized.startsWith("说明") || normalized.startsWith("注意");
  return isInstruction && (populated.length <= 1 || new Set(populated).size === 1);
}

function addDuplicateIssues(
  references: AudioReference[],
  issues: ValidationIssue[],
): void {
  const groups = new Map<number, AudioReference[]>();
  for (const reference of references) {
    groups.set(reference.audioNumber, [...(groups.get(reference.audioNumber) ?? []), reference]);
  }
  for (const [audioNumber, matches] of groups) {
    if (matches.length < 2) continue;
    const locations = matches.map((match) => `${match.sheetName}第 ${match.rowNumber} 行`).join("、");
    for (const match of matches) {
      issues.push(issue(
        "E-AUDIO-002",
        "error",
        `录音编号 ${audioNumber} 被重复使用。`,
        `请保留一个编号并修改其他编号。重复位置：${locations}`,
        { sheetName: match.sheetName, rowNumber: match.rowNumber, field: match.field },
      ));
    }
  }
}

function finalizePreviewRows(rows: PreviewRow[], issues: ValidationIssue[]): PreviewRow[] {
  return rows.map((row) => {
    const rowIssues = issues.filter((item) => item.sheetName === row.sheetName && item.rowNumber === row.rowNumber);
    const status = rowIssues.some((item) => item.severity === "error")
      ? "error"
      : rowIssues.some((item) => item.severity === "warning")
        ? "warning"
        : "ready";
    return { ...row, status, note: rowIssues[0]?.message };
  });
}

async function readWorkbook(workbookPath: string): Promise<WorkbookData> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const selected = chooseSheet(workbook);
  const sheetName = selected.sheet.name;
  const issues: ValidationIssue[] = [];
  const previewRows: PreviewRow[] = [];
  const flowTasks: SpeechTask[] = [];
  const vagueTasks: SpeechTask[] = [];
  const knowledgeTasks: KnowledgeTask[] = [];
  const audioReferences: AudioReference[] = [];
  const flowStructure: Array<{ moduleName: string; audioNumber: number | null; rowNumber: number }> = [];
  const vagueStructure: Array<{ moduleName: string; audioNumber: number | null; rowNumber: number }> = [];
  let knowledgeRowCount = 0;

  if (normalizedLabel(sheetName) !== normalizedLabel("话术内容")) {
    issues.push(issue(
      "W-SHEET-001",
      "warning",
      `已从工作表“${sheetName}”识别话术内容。`,
      "建议将话术工作表命名为“话术内容”，便于人工核对。",
      { sheetName },
    ));
  }
  if (selected.knowledgeHeaders.length > 1) {
    issues.push(issue(
      "E-COLUMN-004",
      "error",
      "检测到多个知识库表头，无法确定知识库数据边界。",
      `请只保留一个包含“问题、问法、编号、回答话术”的知识库表头。位置：${selected.knowledgeHeaders.map((header) => header.rowNumber).join("、")} 行。`,
      { sheetName, field: "知识库表头" },
    ));
  }
  if (selected.knowledgeHeaders.length === 0) {
    issues.push(issue(
      "E-COLUMN-003",
      "error",
      "未找到知识库表头。",
      "请保留包含“问题、问法、编号、客户话术填写列”的知识库表头。",
      { sheetName, field: "知识库表头" },
    ));
  }

  const knowledgeHeader = selected.knowledgeHeaders[0];
  const knowledgeHeaderRow = knowledgeHeader?.rowNumber ?? Number.POSITIVE_INFINITY;
  const flowHeaders = new Map(selected.flowHeaders.map((header) => [header.rowNumber, header]));
  let currentFlowHeader: HeaderCandidate | null = null;

  for (let rowNumber = 1; rowNumber < knowledgeHeaderRow; rowNumber += 1) {
    const header = flowHeaders.get(rowNumber);
    if (header) {
      currentFlowHeader = header;
      continue;
    }
    if (!currentFlowHeader) continue;
    const row = selected.rows[rowNumber - 1] ?? [];
    const moduleName = cellText(row[0]);
    const normalizedModule = normalizedLabel(moduleName);
    if (["含糊话术", "模糊话术"].includes(normalizedModule) || normalizedModule.startsWith("知识库")) continue;
    const audioRaw = row[currentFlowHeader.columns.audio ?? -1];
    const speech = cellText(row[currentFlowHeader.columns.answer ?? -1]);
    if (!moduleName && cellText(audioRaw) === "" && !speech) continue;
    if (isInstructionRow(moduleName, row)) continue;
    const vague = isVagueModule(moduleName);
    const sectionName = flowSectionFor(moduleName);
    const likelyData = vague || sectionName !== null || cellText(audioRaw) !== "" || speech !== "";
    if (!likelyData) continue;
    const rowIssueStart = issues.length;
    const audioNumber = parseAudioNumber(audioRaw);
    if (vague) vagueStructure.push({ moduleName, audioNumber, rowNumber });
    else if (sectionName) flowStructure.push({ moduleName, audioNumber, rowNumber });
    if (!moduleName) {
      issues.push(issue("E-ROW-001", "error", "流程话术缺少模块名称。", "请在第一列填写开场白、产品介绍、客户邀约、结束话语或含糊话术。", { sheetName, rowNumber, field: "流程模块" }));
    } else if (!vague && !sectionName) {
      issues.push(issue("E-SECTION-001", "error", `无法识别流程模块“${moduleName}”。`, "请使用开场白、产品介绍、客户邀约、结束话语或含糊话术作为模块前缀。", { sheetName, rowNumber, field: "流程模块" }));
    }
    if (audioNumber === null) {
      issues.push(issue("E-AUDIO-001", "error", "录音编号为空或不是正整数。", "请填写大于 0 的整数，例如 18。", { sheetName, rowNumber, field: "录音编号" }));
    }
    if (!speech) {
      issues.push(issue("E-TEXT-001", "error", "回答话术为空。", `请在“${currentFlowHeader.labels.answer ?? "回答话术"}”列填写要上传的文本。`, { sheetName, rowNumber, field: currentFlowHeader.labels.answer ?? "回答话术" }));
    }
    if (audioNumber !== null) audioReferences.push({ audioNumber, sheetName, rowNumber, field: "录音编号" });
    const type: PreviewRowType = vague ? "vague" : sectionName ? "flow" : "unrecognized";
    previewRows.push({
      sheetName,
      rowNumber,
      type,
      name: moduleName || "未填写模块",
      answerPreview: answerPreview(speech),
      audioNumber: audioNumber ?? undefined,
      qaTypes: [],
      status: issues.length > rowIssueStart ? "error" : "ready",
    });
    if (issues.length !== rowIssueStart || audioNumber === null) continue;
    const task: SpeechTask = { moduleName, sectionName, audioNumber, speech, sheetName, sourceRow: rowNumber };
    (vague ? vagueTasks : flowTasks).push(task);
  }

  if (flowStructure.length !== EXPECTED_FLOW_MODULES.length) {
    issues.push(issue(
      "E-FLOW-001",
      "error",
      `主流程必须固定为 13 条，当前识别到 ${flowStructure.length} 条。`,
      "请使用标准模板并保留全部 13 个主流程模块。",
      { sheetName, field: "主流程" },
    ));
  }
  if (vagueStructure.length !== EXPECTED_VAGUE_MODULES.length) {
    issues.push(issue(
      "E-VAGUE-001",
      "error",
      `含糊话术必须固定为 4 条，当前识别到 ${vagueStructure.length} 条。`,
      "请使用标准模板并保留含糊话术01至含糊话术04。",
      { sheetName, field: "含糊话术" },
    ));
  }
  for (const [index, reference] of flowStructure.entries()) {
    const expectedName = EXPECTED_FLOW_MODULES[index];
    if (expectedName && normalizedLabel(reference.moduleName) !== normalizedLabel(expectedName)) {
      issues.push(issue(
        "E-FLOW-002",
        "error",
        `主流程第 ${index + 1} 条应为“${expectedName}”，当前是“${reference.moduleName}”。`,
        "请恢复标准模板中的模块名称和顺序。",
        { sheetName, rowNumber: reference.rowNumber, field: "流程模块" },
      ));
    }
    if (reference.audioNumber !== null && reference.audioNumber !== index + 1) {
      issues.push(issue(
        "E-AUDIO-004",
        "error",
        `“${reference.moduleName}”的录音编号应为 ${index + 1}。`,
        `请将录音编号改为 ${index + 1}。`,
        { sheetName, rowNumber: reference.rowNumber, field: "录音编号" },
      ));
    }
  }
  for (const [index, reference] of vagueStructure.entries()) {
    const expectedName = EXPECTED_VAGUE_MODULES[index];
    const expectedAudioNumber = index + 14;
    if (expectedName && normalizedLabel(reference.moduleName) !== normalizedLabel(expectedName)) {
      issues.push(issue(
        "E-VAGUE-002",
        "error",
        `含糊话术第 ${index + 1} 条应为“${expectedName}”，当前是“${reference.moduleName}”。`,
        "请恢复标准模板中的模块名称和顺序。",
        { sheetName, rowNumber: reference.rowNumber, field: "流程模块" },
      ));
    }
    if (reference.audioNumber !== null && reference.audioNumber !== expectedAudioNumber) {
      issues.push(issue(
        "E-AUDIO-004",
        "error",
        `“${reference.moduleName}”的录音编号应为 ${expectedAudioNumber}。`,
        `请将录音编号改为 ${expectedAudioNumber}。`,
        { sheetName, rowNumber: reference.rowNumber, field: "录音编号" },
      ));
    }
  }

  if (knowledgeHeader) {
    if (knowledgeHeader.columns.invalid === undefined || knowledgeHeader.columns.special === undefined) {
      issues.push(issue(
        "W-QA-001",
        "warning",
        "知识库缺少“无效QA”或“特殊QA”标注列，缺失项将按“否”处理。",
        "建议在知识库表头后增加“无效QA”和“特殊QA”两列。",
        { sheetName, rowNumber: knowledgeHeader.rowNumber, field: "QA 类型" },
      ));
    }
    const questionReferences = new Map<string, number[]>();
    for (let rowNumber = knowledgeHeader.rowNumber + 1; rowNumber <= selected.rows.length; rowNumber += 1) {
      const row = selected.rows[rowNumber - 1] ?? [];
      if (selected.knowledgeHeaders.some((header) => header.rowNumber === rowNumber)) continue;
      const question = cellText(row[knowledgeHeader.columns.question ?? -1]);
      const commonQuestions = cellText(row[knowledgeHeader.columns.commonQuestions ?? -1]);
      const answer = cellText(row[knowledgeHeader.columns.answer ?? -1]);
      const audioRaw = row[knowledgeHeader.columns.audio ?? -1];
      const invalidRaw = knowledgeHeader.columns.invalid === undefined ? null : row[knowledgeHeader.columns.invalid];
      const specialRaw = knowledgeHeader.columns.special === undefined ? null : row[knowledgeHeader.columns.special];
      const qaMarked = Boolean(cellText(invalidRaw) || cellText(specialRaw));
      if (!answer && !qaMarked) continue;
      if (isInstructionRow(question, row)) continue;
      knowledgeRowCount += 1;
      const rowIssueStart = issues.length;
      const audioNumber = parseAudioNumber(audioRaw);
      const invalidQa = parseQaFlag(invalidRaw);
      const specialQa = parseQaFlag(specialRaw);
      if (!question) issues.push(issue("E-QA-002", "error", "知识库问题名称为空。", "请在“问题”列填写问题名称。", { sheetName, rowNumber, field: "问题" }));
      if (!commonQuestions) issues.push(issue("E-QA-003", "error", `知识库问题“${question || `第 ${rowNumber} 行`}”缺少常用问法。`, "请在“问法/常用问法”列填写客户可能说出的问法。", { sheetName, rowNumber, field: "问法" }));
      if (!answer) issues.push(issue("E-TEXT-001", "error", `知识库问题“${question || `第 ${rowNumber} 行`}”缺少回答话术。`, `请在“${knowledgeHeader.labels.answer ?? "回答话术"}”列填写回答。`, { sheetName, rowNumber, field: knowledgeHeader.labels.answer ?? "回答话术" }));
      if (audioNumber === null) issues.push(issue("E-AUDIO-001", "error", "知识库录音编号为空或不是正整数。", "请填写大于 0 的整数。", { sheetName, rowNumber, field: knowledgeHeader.labels.audio ?? "编号" }));
      if (!invalidQa.valid) issues.push(issue("E-QA-004", "error", `无效QA标注“${cellText(invalidRaw)}”无法识别。`, "请填写是、否、1、0或留空。", { sheetName, rowNumber, field: knowledgeHeader.labels.invalid ?? "无效QA" }));
      if (!specialQa.valid) issues.push(issue("E-QA-004", "error", `特殊QA标注“${cellText(specialRaw)}”无法识别。`, "请填写是、否、1、0或留空。", { sheetName, rowNumber, field: knowledgeHeader.labels.special ?? "特殊QA" }));
      if (audioNumber !== null) audioReferences.push({ audioNumber, sheetName, rowNumber, field: knowledgeHeader.labels.audio ?? "编号" });
      if (question) questionReferences.set(question, [...(questionReferences.get(question) ?? []), rowNumber]);
      const qaTypes = [invalidQa.enabled ? "无效QA" : "", specialQa.enabled ? "特殊QA" : ""].filter(Boolean);
      previewRows.push({
        sheetName,
        rowNumber,
        type: "knowledge",
        name: question || "未填写问题",
        answerPreview: answerPreview(answer),
        audioNumber: audioNumber ?? undefined,
        qaTypes,
        status: issues.length > rowIssueStart ? "error" : "ready",
      });
      if (issues.length !== rowIssueStart || audioNumber === null) continue;
      knowledgeTasks.push({
        question,
        commonQuestions,
        answer,
        audioNumber,
        invalidQa: invalidQa.enabled,
        specialQa: specialQa.enabled,
        sheetName,
        sourceRow: rowNumber,
      });
    }
    for (const [question, rowNumbers] of questionReferences) {
      if (rowNumbers.length < 2) continue;
      for (const rowNumber of rowNumbers) {
        issues.push(issue("E-QA-005", "error", `知识库问题“${question}”重复。`, `请合并或重命名重复问题。重复位置：${rowNumbers.join("、")} 行。`, { sheetName, rowNumber, field: "问题" }));
      }
    }
  }

  addDuplicateIssues(audioReferences, issues);
  const commonQuestionsIndex = knowledgeHeader?.columns.commonQuestions;
  return {
    detectedSheetName: sheetName,
    commonQuestionsColumn: commonQuestionsIndex === undefined ? null : commonQuestionsIndex + 1,
    flagColumns: {
      invalid: knowledgeHeader?.columns.invalid === undefined ? null : knowledgeHeader.columns.invalid + 1,
      special: knowledgeHeader?.columns.special === undefined ? null : knowledgeHeader.columns.special + 1,
    },
    flowRowCount: flowStructure.length,
    vagueRowCount: vagueStructure.length,
    knowledgeRowCount,
    flowTasks,
    vagueTasks,
    knowledgeTasks,
    issues,
    previewRows: finalizePreviewRows(previewRows, issues),
  };
}

async function attachAudio<T extends { audioNumber: number; sheetName: string; sourceRow: number }>(
  audioDir: string,
  assigned: Map<number, string | null>,
  trims: Map<string, AudioTrim>,
  rows: T[],
  issues: ValidationIssue[],
  partial = false,
): Promise<Array<T & AudioFields>> {
  return Promise.all(rows.map(async (row) => {
    const fileName = assigned.get(row.audioNumber) ?? null;
    const audioPath = path.join(audioDir, fileName ?? `${row.audioNumber}.wav`);
    const audioExists = fileName !== null;
    if (!audioExists && !partial) {
      issues.push(issue("W-AUDIO-001", "warning", `缺少编号为 ${row.audioNumber} 的录音文件。`, `文本仍可识别，但该条录音不会上传。支持 ${SUPPORTED_AUDIO_LABEL} 格式。`, { sheetName: row.sheetName, rowNumber: row.sourceRow, field: "录音文件" }));
    }
    const trim = fileName === null ? undefined : trims.get(fileName);
    if (trim?.empty) {
      issues.push(issue("W-AUDIO-003", "warning", `${row.audioNumber} 号录音「${fileName}」几乎没有声音。`, "请试听确认，空录音上传后客户只会听到一段静音。", { sheetName: row.sheetName, rowNumber: row.sourceRow, field: "录音文件" }));
    }
    const audioNeedsConversion = audioExists
      && (exactFileNumber(fileName) !== row.audioNumber || !(await isStandardWav(audioPath).catch(() => false)));
    return {
      ...row,
      audioPath,
      audioExists,
      audioNeedsConversion,
      ...(trim && needsTrim(trim) ? { audioTrim: { head: trim.head, tail: trim.tail } } : {}),
    };
  }));
}

function matchSlots(workbook: WorkbookData): Array<MatchSlot & { sheetName: string; rowNumber: number }> {
  return [
    ...[...workbook.flowTasks, ...workbook.vagueTasks].map((task) => ({
      audioNumber: task.audioNumber,
      label: task.moduleName,
      speech: task.speech,
      sheetName: task.sheetName,
      rowNumber: task.sourceRow,
    })),
    ...workbook.knowledgeTasks.map((task) => ({
      audioNumber: task.audioNumber,
      label: task.question,
      speech: task.answer,
      sheetName: task.sheetName,
      rowNumber: task.sourceRow,
    })),
  ];
}

function summarizeMatch(
  audioDir: string,
  slots: ReturnType<typeof matchSlots>,
  fileNames: string[],
  outcome: AudioMatchOutcome,
): AudioMatchSummary {
  const bySlot = new Map(outcome.result.slots.map((slot) => [slot.audioNumber, slot]));
  const items: AudioMatchItem[] = slots.map((slot) => {
    const match = bySlot.get(slot.audioNumber);
    return {
      ...slot,
      fileName: match?.fileName ?? null,
      basis: match?.basis ?? "none",
      score: match?.score ?? 0,
      needsReview: match?.needsReview ?? false,
      reason: match?.reason,
      candidates: match?.candidates ?? [],
    };
  });
  const reviewCount = items.filter((item) => item.needsReview).length;
  return {
    audioDir,
    items,
    files: fileNames.map((name) => ({ name, transcript: outcome.transcripts.get(name) })),
    unusedFiles: outcome.result.unusedFiles,
    smart: reviewCount > 0 || items.some((item) => item.basis !== "number" && item.basis !== "none"),
    autoCount: items.filter((item) => item.fileName && !item.needsReview).length,
    reviewCount,
    speechUnavailable: outcome.speechUnavailable ?? undefined,
    failedFiles: outcome.failedFiles,
  };
}

const BASIS_LABELS: Record<AudioMatchBasis, string> = {
  confirmed: "人工确认",
  number: "文件名编号",
  "name-number": "文件名含编号",
  name: "文件名",
  speech: "语音内容",
  order: "录音顺序",
  none: "",
};

export function basisLabel(basis: AudioMatchBasis): string {
  return BASIS_LABELS[basis];
}

function audioActionFor(task: AudioFields): AudioAction {
  if (!task.audioExists) return "missing";
  return task.audioNeedsConversion ? "convert" : "keep";
}

export function validateConfig(config: UploadConfig): void {
  if (!config.workbookPath) throw new Error("请选择 Excel 文件");
  if (!config.audioDir) throw new Error("请选择录音文件夹");
  if (!config.talkName || [...config.talkName].length >= 20) throw new Error("话术名称不能为空且必须少于20个字符");
  if (config.mode === "modify") return;
  if (!config.categoryName || [...config.categoryName].length >= 10) throw new Error("知识库分类名称不能为空且必须少于10个字符");
}

export interface LoadOptions {
  matcher?: AudioMatchProvider;
  onMatchProgress?: MatchProgress;
  onTrimProgress?: MatchProgress;
}

export async function loadData(config: UploadConfig, options: LoadOptions = {}): Promise<LoadedData> {
  validateConfig(config);
  const workbook = await readWorkbook(config.workbookPath);
  const issues = [...workbook.issues];
  const fileNames = await listAudioFiles(config.audioDir);
  const slots = matchSlots(workbook);
  const modify = config.mode === "modify";
  const rules = modify ? { numbersAreHints: true, partial: true } : { numbersAreHints: true };
  const outcome = options.matcher
    ? await options.matcher.match(config.workbookPath, config.audioDir, slots, fileNames, options.onMatchProgress, rules)
    : matchByFileName(slots, fileNames, rules);
  const audioMatch = summarizeMatch(config.audioDir, slots, fileNames, outcome);
  const assigned = new Map(audioMatch.items.map((item) => [item.audioNumber, item.fileName]));
  const usedFiles = [...new Set(audioMatch.items.flatMap((item) => (item.fileName ? [item.fileName] : [])))];
  const trims = options.matcher?.trims
    ? await options.matcher.trims(config.audioDir, usedFiles, options.onTrimProgress)
    : new Map<string, AudioTrim>();
  for (const item of audioMatch.items) {
    const trim = item.fileName ? trims.get(item.fileName) : undefined;
    if (trim) item.trim = { head: trim.head, tail: trim.tail, duration: trim.duration, wave: trim.wave };
  }
  const flowTasks = await attachAudio(config.audioDir, assigned, trims, workbook.flowTasks, issues, modify);
  const vagueTasks = await attachAudio(config.audioDir, assigned, trims, workbook.vagueTasks, issues, modify);
  const knowledgeTasks = await attachAudio(config.audioDir, assigned, trims, workbook.knowledgeTasks, issues, modify);
  if (audioMatch.failedFiles.length) {
    issues.push(issue(
      "W-AUDIO-002",
      "warning",
      `${audioMatch.failedFiles.length} 个录音无法识别内容，未参与自动匹配。`,
      `请确认这些文件能正常播放：${audioMatch.failedFiles.join("；")}`,
      { field: "录音文件夹" },
    ));
  }
  const audioActions = new Map<string, AudioAction>(
    [...flowTasks, ...vagueTasks, ...knowledgeTasks].map((task) => [`${task.sheetName}:${task.sourceRow}`, audioActionFor(task)]),
  );
  const matchedRows = new Map(audioMatch.items.map((item) => [`${item.sheetName}:${item.rowNumber}`, item]));
  return {
    detectedSheetName: workbook.detectedSheetName,
    commonQuestionsColumn: workbook.commonQuestionsColumn,
    flagColumns: workbook.flagColumns,
    flowRowCount: workbook.flowRowCount,
    vagueRowCount: workbook.vagueRowCount,
    knowledgeRowCount: workbook.knowledgeRowCount,
    flowTasks,
    vagueTasks,
    knowledgeTasks,
    issues,
    previewRows: finalizePreviewRows(workbook.previewRows, issues).map((row) => {
      const match = matchedRows.get(`${row.sheetName}:${row.rowNumber}`);
      return {
        ...row,
        audioAction: audioActions.get(`${row.sheetName}:${row.rowNumber}`),
        audioFile: match?.fileName ?? undefined,
        audioBasis: match?.fileName ? match.basis : undefined,
      };
    }),
    audioMatch,
  };
}

export function buildPreview(data: LoadedData): PreviewSummary {
  const missingFlowAudio = data.flowTasks.filter((task) => !task.audioExists).map((task) => task.audioNumber);
  const missingVagueAudio = data.vagueTasks.filter((task) => !task.audioExists).map((task) => task.audioNumber);
  const missingKnowledgeAudio = data.knowledgeTasks.filter((task) => !task.audioExists).map((task) => task.audioNumber);
  const flowAudioCount = data.flowTasks.length - missingFlowAudio.length;
  const vagueAudioCount = data.vagueTasks.length - missingVagueAudio.length;
  const knowledgeAudioCount = data.knowledgeTasks.length - missingKnowledgeAudio.length;
  const errorCount = data.issues.filter((item) => item.severity === "error").length;
  const warningCount = data.issues.filter((item) => item.severity === "warning").length;
  return {
    detectedSheetName: data.detectedSheetName,
    canUpload: errorCount === 0,
    errorCount,
    warningCount,
    flowCount: data.flowRowCount,
    vagueCount: data.vagueRowCount,
    knowledgeCount: data.knowledgeRowCount,
    flowAudioCount,
    vagueAudioCount,
    knowledgeAudioCount,
    plannedUploadCount: flowAudioCount + vagueAudioCount + knowledgeAudioCount,
    missingFlowAudio,
    missingVagueAudio,
    missingKnowledgeAudio,
    convertAudioNumbers: [...data.flowTasks, ...data.vagueTasks, ...data.knowledgeTasks]
      .filter((task) => task.audioExists && task.audioNeedsConversion)
      .map((task) => task.audioNumber),
    trimAudioNumbers: [...data.flowTasks, ...data.vagueTasks, ...data.knowledgeTasks]
      .filter((task) => task.audioExists && task.audioTrim)
      .map((task) => task.audioNumber),
    invalidQaCount: data.knowledgeTasks.filter((task) => task.invalidQa).length,
    specialQaCount: data.knowledgeTasks.filter((task) => task.specialQa).length,
    bothQaCount: data.knowledgeTasks.filter((task) => task.invalidQa && task.specialQa).length,
    warnings: data.issues.filter((item) => item.severity === "warning").map((item) => item.message),
    issues: data.issues,
    previewRows: data.previewRows,
    checkup: buildCheckup(data).result,
    audioMatch: data.audioMatch,
  };
}

const CHECKUP_KIND_LABELS: Record<CheckupKind, string> = {
  "system-prompt": "系统提示问法更新",
  "filler-phrase": "问法带语气词",
  "duplicate-phrase": "问法重复",
  "phrase-format": "问法符号异常",
  "shared-phrase": "两个问题抢同一句",
  "few-phrases": "问法太少",
  "some-phrases": "问法偏少",
  "special-qa": "建议设为特殊QA",
  "invalid-qa": "建议设为无效QA",
  "special-question": "特殊QA是问句",
  "long-speech": "话术偏长",
  typo: "AI 查错字漏字",
};

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F6DF6" } };
  row.alignment = { vertical: "middle" };
  row.height = 24;
}

export async function createValidationReport(config: UploadConfig, options: LoadOptions = {}): Promise<Buffer> {
  const summary = buildPreview(await loadData(config, options));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "马德槐";
  const overview = workbook.addWorksheet("概览");
  overview.addRows([
    ["探迹话术上传助手数据检查报告"],
    ["检测工作表", summary.detectedSheetName],
    ["是否允许上传", summary.canUpload ? "是" : "否"],
    ["阻断错误", summary.errorCount],
    ["提醒", summary.warningCount],
    ["主流程", summary.flowCount],
    ["含糊话术", summary.vagueCount],
    ["知识库", summary.knowledgeCount],
    ["计划上传录音", summary.plannedUploadCount],
    ["其中自动转换", summary.convertAudioNumbers.length],
    ["其中剪掉头尾空白", summary.trimAudioNumbers.length],
    ["录音待确认", summary.audioMatch.reviewCount],
    ["话术体检提醒", summary.checkup.findings.length],
  ]);
  overview.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF111827" } };
  overview.mergeCells("A1:B1");
  overview.getColumn(1).width = 22;
  overview.getColumn(2).width = 34;

  const issueSheet = workbook.addWorksheet("问题明细");
  issueSheet.addRow(["级别", "错误代码", "工作表", "行号", "字段", "问题", "修复建议"]);
  styleHeader(issueSheet.getRow(1));
  for (const item of summary.issues) {
    issueSheet.addRow([
      item.severity === "error" ? "错误" : item.severity === "warning" ? "提醒" : "信息",
      item.code,
      item.sheetName ?? "",
      item.rowNumber ?? "",
      item.field ?? "",
      item.message,
      item.suggestion,
    ]);
  }
  issueSheet.columns = [12, 17, 18, 10, 18, 52, 58].map((width) => ({ width }));
  issueSheet.views = [{ state: "frozen", ySplit: 1 }];
  issueSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    const severity = row.getCell(1).value;
    if (severity === "错误") row.getCell(1).font = { bold: true, color: { argb: "FFDC5345" } };
    if (severity === "提醒") row.getCell(1).font = { bold: true, color: { argb: "FFF59E0B" } };
  });

  const previewSheet = workbook.addWorksheet("识别预览");
  previewSheet.addRow(["状态", "工作表", "Excel行号", "类型", "模块或问题", "回答摘要", "录音编号", "匹配文件", "匹配依据", "录音处理", "QA类型", "说明"]);
  styleHeader(previewSheet.getRow(1));
  for (const row of summary.previewRows) {
    previewSheet.addRow([
      row.status === "error" ? "错误" : row.status === "warning" ? "提醒" : "正常",
      row.sheetName,
      row.rowNumber,
      row.type === "flow" ? "主流程" : row.type === "vague" ? "含糊话术" : row.type === "knowledge" ? "知识库" : "未识别",
      row.name,
      row.answerPreview,
      row.audioNumber ?? "",
      row.audioFile ?? "",
      row.audioBasis ? basisLabel(row.audioBasis) : "",
      row.audioAction === "convert" ? "自动转换" : row.audioAction === "keep" ? "原样上传" : row.audioAction === "missing" ? "缺失" : "",
      row.qaTypes.join("、"),
      row.note ?? "",
    ]);
  }
  previewSheet.columns = [11, 18, 11, 13, 30, 58, 12, 24, 14, 12, 18, 48].map((width) => ({ width }));
  previewSheet.views = [{ state: "frozen", ySplit: 1 }];
  previewSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });

  const checkupSheet = workbook.addWorksheet("话术体检");
  checkupSheet.addRow(["类型", "Excel行号", "问题或模块", "说明", "示例", "可自动修正"]);
  styleHeader(checkupSheet.getRow(1));
  for (const finding of summary.checkup.findings) {
    checkupSheet.addRow([
      CHECKUP_KIND_LABELS[finding.kind],
      finding.rowNumbers.join("、"),
      finding.title,
      finding.message,
      finding.examples.join("\n"),
      finding.options.length ? "是" : "否",
    ]);
  }
  checkupSheet.columns = [16, 12, 30, 60, 48, 12].map((width) => ({ width }));
  checkupSheet.views = [{ state: "frozen", ySplit: 1 }];
  checkupSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}
