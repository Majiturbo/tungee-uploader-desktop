import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { ValidationIssue } from "../shared/types";
import type {
  VoiceAgentConfig,
  VoiceAgentFields,
  VoiceAgentIntents,
  VoiceAgentPackSummary,
  VoiceAgentPreview,
} from "../shared/voice-agent";

const BUILTIN_NAMES = new Set([
  "预约回访", "预算未确定", "非决策人", "需要内部讨论", "询问价格", "联系负责人",
  "立即跟进", "正在评估", "有采购计划", "有明确需求", "暂无需求", "暂停跟进",
  "明确表达兴趣", "明确拒绝", "无需跟进", "提供联系方式", "接受资料", "希望稍后联系",
  "已有供应商", "安排演示", "在忙", "回应被动", "后续培育", "发送资料",
  "关注效果", "关注功能", "信息不足", "今日跟进", "主动了解产品",
]);
const MUST_UPDATE = new Set(["询问价格", "已有供应商", "接受资料", "有采购计划", "安排演示"]);
const FIXED_OBJECTIONS = ["price", "existing_supplier", "how_to_find_customers", "data_accuracy"] as const;
const CATEGORIES = new Set(["高意向（积极推进）", "中意向（有待评估）", "低意向（意愿较弱）", "无意向（明确拒绝）"]);
const BANNED_KB_HEADINGS = /^##\s*(开场白|钩子话术|异议处理|邀约动作|结束语)\s*$/m;
const RECORDING_HINT = /通话过程会有录音|本次通话已录音|录音告知/;
const DUMP_STYLE = /回答话术[：:]\s*(详尽|简洁)|问句为结尾[：:]\s*(是|否)|语气词[^\n]{0,20}[：:]\s*(是|否)|风格以确认卡为准/;
const PLACEHOLDER_TALK = /允许说出口的原句|能力要点一|价值点一|来自用户资料|按当次/;
const SKIP_DIR = new Set(["__MACOSX", "node_modules", ".git"]);

export interface PackLayout {
  root: string;
  confirm: string | null;
  agent: string | null;
  knowledgeDir: string | null;
  hotword: string | null;
  intentJson: string | null;
  intentMd: string | null;
  prompt: string | null;
}

function chars(value: string): number {
  return [...value].length;
}

function issue(code: string, message: string, suggestion: string): ValidationIssue {
  return { code, severity: "error", message, suggestion };
}

function field(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^[-*\\s]*${escaped}[：:]\\s*(.*)$`, "m").exec(text);
  const value = (match?.[1] ?? "").trim();
  if (!value || /^[-*]\s/.test(value)) return "";
  return value;
}

export function mergeAgentFields(base: VoiceAgentFields, patch?: Partial<VoiceAgentFields>): VoiceAgentFields {
  if (!patch) return base;
  const next = { ...base };
  for (const key of Object.keys(next) as (keyof VoiceAgentFields)[]) {
    const value = patch[key];
    if (typeof value === "string") next[key] = value;
  }
  return next;
}

function section(text: string, heading: string): string {
  const match = new RegExp(`##\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`).exec(text);
  return match?.[1]?.trim() ?? "";
}

export function parseAgentConfig(text: string): VoiceAgentFields {
  return {
    name: field(text, "智能体名称"),
    companyName: field(text, "企业对外名称"),
    selfName: field(text, "智能体对外自称"),
    role: field(text, "智能体角色"),
    customRole: field(text, "自定义角色（仅「其他」）") || field(text, "自定义角色"),
    scene: field(text, "业务场景"),
    goal: field(text, "目标"),
    greeting: field(text, "问候语"),
    opening: field(text, "开场白"),
    companyInfo: section(text, "公司信息"),
  };
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function validateConfirm(text: string, issues: ValidationIssue[]): void {
  if (!/详尽|简洁/.test(text)) issues.push(issue("E-VOICE-010", "确认卡缺少风格项 a（详尽/简洁）。", "在 skill 侧补全确认卡后再导入。"));
  if (!/问句为结尾[：:]\s*(是|否)/.test(text)) issues.push(issue("E-VOICE-011", "确认卡缺少风格项 b（问句为结尾）。", "在 skill 侧补全确认卡后再导入。"));
  if (!/语气词[^\n]{0,12}[：:]\s*(是|否)/.test(text)) issues.push(issue("E-VOICE-012", "确认卡缺少风格项 c（语气词）。", "在 skill 侧补全确认卡后再导入。"));
  if (!/钩子/.test(text)) issues.push(issue("E-VOICE-013", "确认卡未记录钩子有无。", "在确认卡写明钩子：有 / 无。"));
  if (!/新客开发|线索回访/.test(text)) issues.push(issue("E-VOICE-014", "确认卡未记录业务场景。", "场景只能是新客开发或线索回访。"));
  if (!/上门演示|线上演示|添加微信/.test(text)) issues.push(issue("E-VOICE-015", "确认卡未记录目标。", "目标只能是上门演示、线上演示或添加微信。"));
  if (!/其它要求/.test(text)) issues.push(issue("E-VOICE-085", "确认卡未询问提示词其它要求。", "在确认卡写明提示词其它要求：无 / 有。"));
}

function validateAgentConfig(text: string, issues: ValidationIssue[]): VoiceAgentFields {
  if (RECORDING_HINT.test(text)) {
    issues.push(issue("E-VOICE-016", "智能体配置含录音告知，探迹语音 Agent 不需要。", "删掉录音告知后再导入。"));
  }
  const agent = parseAgentConfig(text);
  if (!agent.name) issues.push(issue("E-VOICE-017", "缺少智能体名称。", "在 智能体配置.md 填写智能体名称。"));
  if (chars(agent.name) > 20) issues.push(issue("E-VOICE-018", `智能体名称超过 20 字：${agent.name}`, "把名称缩短到 20 字以内。"));
  if (!agent.companyName) issues.push(issue("E-VOICE-019", "缺少企业对外名称。", "在 智能体配置.md 填写企业对外名称。"));
  if (!agent.role) issues.push(issue("E-VOICE-020", "缺少智能体角色。", "填写业务顾问、语音助手、客户顾问或其他。"));
  if (!agent.scene) issues.push(issue("E-VOICE-021", "缺少业务场景。", "填写新客开发或线索回访。"));
  if (!agent.goal) issues.push(issue("E-VOICE-022", "缺少目标。", "填写上门演示、线上演示或添加微信。"));
  if (!agent.companyInfo) issues.push(issue("E-VOICE-023", "缺少公司信息。", "在 智能体配置.md 写上公司信息整段。"));
  if (agent.opening && !agent.opening.includes("前端已配置") && chars(agent.opening) > 150) {
    issues.push(issue("E-VOICE-024", `开场白超过 150 字（${chars(agent.opening)}）。`, "钩子开场白压到 150 字以内，或写「前端已配置」。"));
  }
  return agent;
}

async function validateKnowledge(dirPath: string, issues: ValidationIssue[]): Promise<Array<{ name: string; path: string }>> {
  const entries = (await fs.readdir(dirPath)).filter((name) => name.endsWith(".md") && !name.startsWith("."));
  if (!entries.length) {
    issues.push(issue("E-VOICE-030", "知识库下没有 md。", "按这家资料生成知识库 md。"));
    return [];
  }
  const files: Array<{ name: string; path: string }> = [];
  for (const name of entries.sort()) {
    const filePath = path.join(dirPath, name);
    files.push({ name, path: filePath });
    const text = await readText(filePath);
    if (BANNED_KB_HEADINGS.test(text)) {
      issues.push(issue("E-VOICE-031", `${name} 含口播章节（开场白/钩子/异议/邀约/结束语），知识库只留事实。`, "按资料写事实，不要写话术稿。"));
    }
    if (/^Q:\s*/m.test(text)) {
      issues.push(issue("E-VOICE-032", `${name} 使用了 Q:/A: 问答稿。`, "改成标题加段落。"));
    }
    if (RECORDING_HINT.test(text)) {
      issues.push(issue("E-VOICE-033", `${name} 含录音告知。`, "删掉录音相关句子。"));
    }
  }
  return files;
}

function validateHotwords(text: string, issues: ValidationIssue[]): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!lines.length) issues.push(issue("E-VOICE-040", "热词文件为空。", "一行一个热词，每个少于 10 个字。"));
  if (lines.length > 5000) issues.push(issue("E-VOICE-041", `热词超过 5000（${lines.length}）。`, "删到 5000 条以内。"));
  for (const [index, word] of lines.entries()) {
    if (word.startsWith("【") && word.endsWith("】")) {
      issues.push(issue("E-VOICE-042", `热词第 ${index + 1} 行是分类标题，不能上传：${word}`, "不要把【分类】当成一行热词。"));
    }
    if (chars(word) >= 10) issues.push(issue("E-VOICE-043", `热词第 ${index + 1} 行不少于 10 字：${word}`, "每个热词少于 10 个字。"));
    if (word.includes("{{")) issues.push(issue("E-VOICE-044", `热词第 ${index + 1} 行含变量：${word}`, "热词里不要写 {{变量}}。"));
    if (/[，,\s]/.test(word)) issues.push(issue("E-VOICE-045", `热词第 ${index + 1} 行含分隔符，应一行一个：${word}`, "一行只写一个词。"));
  }
  return lines;
}

function validateIntents(raw: string, issues: ValidationIssue[]): VoiceAgentIntents {
  let data: VoiceAgentIntents;
  try {
    data = JSON.parse(raw) as VoiceAgentIntents;
  } catch {
    issues.push(issue("E-VOICE-050", "意图.json 不是合法 JSON。", "用 skill 重新导出后再导入。"));
    return { updates: [], creates: [] };
  }
  const updates = Array.isArray(data.updates) ? data.updates : [];
  const creates = Array.isArray(data.creates) ? data.creates : [];
  const names = new Set(updates.map((item) => item.matchName || item.name || ""));
  if (!names.has("信息不足")) {
    issues.push(issue("E-VOICE-051", "意图.json 未处理内置「信息不足」。", "把信息不足改成低意向（意愿较弱）。"));
  } else {
    const info = updates.find((item) => (item.matchName || item.name) === "信息不足");
    if (info?.category !== "低意向（意愿较弱）") {
      issues.push(issue("E-VOICE-052", "「信息不足」分类必须是低意向（意愿较弱）。", "改分类后再导入。"));
    }
  }
  const missing = [...MUST_UPDATE].filter((name) => !names.has(name));
  if (missing.length) {
    issues.push(issue("E-VOICE-053", `意图.json 未改这些内置意图：${missing.join("、")}`, "五条必改都要有 updates。"));
  }
  for (const item of updates) {
    const name = item.matchName || item.name || "";
    if (MUST_UPDATE.has(name)) {
      if (!item.description) issues.push(issue("E-VOICE-054", `必改意图缺少描述：${name}`, "写成最终可粘贴的描述。"));
      if (!item.positiveExamples) issues.push(issue("E-VOICE-055", `必改意图缺少正例：${name}`, "补上正例。"));
      if (!item.negativeExamples) issues.push(issue("E-VOICE-056", `必改意图缺少反例：${name}`, "补上反例。"));
    }
    if (item.category && !CATEGORIES.has(item.category)) {
      issues.push(issue("E-VOICE-057", `非法意图分类：${item.category}`, "只能用高/中/低/无意向四档。"));
    }
  }
  for (const item of creates) {
    const name = item.name || "";
    if (BUILTIN_NAMES.has(name)) issues.push(issue("E-VOICE-058", `新建意图与内置重名：${name}`, "换一个不在 29 条名单里的名字。"));
    if (["高意向", "中意向", "低意向", "无意向"].includes(name)) {
      issues.push(issue("E-VOICE-059", `新建意图名称不能只写分类：${name}`, "用短行为名，例如愿意加微信。"));
    }
    if (!item.category || !CATEGORIES.has(item.category)) {
      issues.push(issue("E-VOICE-060", `新建意图分类非法：${item.category ?? ""}`, "新建也必须落在四档分类。"));
    }
  }
  return { updates, creates };
}

function extraBlob(company: Record<string, unknown>): string {
  const extra = company.extra_requirements;
  if (Array.isArray(extra)) return extra.map(String).join("\n");
  return extra == null ? "" : String(extra);
}

function validatePrompt(raw: string, issues: ValidationIssue[]): void {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    issues.push(issue("E-VOICE-070", "后台提示词.json 不是合法 JSON。", "用 skill 重新导出后再导入。"));
    return;
  }
  const defaults = (data.global_defaults ?? {}) as Record<string, unknown>;
  if (defaults.schema_version !== "user-agent-config/3.0") {
    issues.push(issue("E-VOICE-071", "schema_version 必须是 user-agent-config/3.0。", "不要改 schema 版本号。"));
  }
  const companies = Array.isArray(data.companies) ? data.companies as Record<string, unknown>[] : [];
  if (!companies.length) {
    issues.push(issue("E-VOICE-072", "companies 为空。", "至少写一家企业。"));
    return;
  }
  companies.forEach((company, index) => {
    const prefix = `companies[${index}]`;
    const fields = Array.isArray(company.qualification_fields) ? company.qualification_fields as Array<Record<string, unknown>> : [];
    if (fields.length < 2 || fields.length > 3) {
      issues.push(issue("E-VOICE-073", `${prefix}.qualification_fields 必须 2～3 条，当前 ${fields.length}。`, "每家造 2～3 个资格问题。"));
    }
    for (const item of fields) {
      const values = Array.isArray(item.allowed_values) ? item.allowed_values.map(String) : [];
      if (!values.includes("其他") || !values.includes("未知")) {
        issues.push(issue("E-VOICE-074", `${prefix} 资格问题「${String(item.label ?? "")}」缺少 其他/未知。`, "allowed_values 必须含其他和未知。"));
      }
    }
    const guidance = (company.objection_guidance ?? {}) as Record<string, unknown>;
    for (const key of FIXED_OBJECTIONS) {
      if (!(key in guidance)) issues.push(issue("E-VOICE-075", `${prefix}.objection_guidance 缺少固定 key：${key}`, "四套异议只增加不减少。"));
    }
    const extra = extraBlob(company);
    if (!extra.includes("qualification_fields") && !extra.includes("资格")) {
      issues.push(issue("E-VOICE-076", `${prefix}.extra_requirements 未写明问完资格问题才能邀约。`, "补一句问完资格问题才能执行 goals。"));
    }
    if (!extra.includes("开场白")) issues.push(issue("E-VOICE-080", `${prefix}.extra_requirements 未写入开场白来源。`, "写明钩子压缩版或前端已配置。"));
    if (DUMP_STYLE.test(extra)) {
      issues.push(issue("E-VOICE-077", `${prefix}.extra_requirements 把确认卡选项原样塞进提示词了。`, "按用户要求改口播字段，不要把选项抄进 JSON。"));
    }
    const spoken = [
      extra,
      JSON.stringify((company.product as Record<string, unknown> | undefined)?.approved_statements ?? []),
      JSON.stringify(company.objection_guidance ?? {}),
      JSON.stringify((company.business_boundaries as Record<string, unknown> | undefined)?.specialist_follow_up_response ?? ""),
      JSON.stringify((company.goals as Record<string, unknown> | undefined)?.primary_method_disclosure ?? ""),
    ].join("\n");
    if (PLACEHOLDER_TALK.test(spoken)) {
      issues.push(issue("E-VOICE-086", `${prefix} 还留着占位稿或「按当次生成」。`, "按这家企业写成能说的话。"));
    }
    const dump = JSON.stringify(company);
    if (RECORDING_HINT.test(dump)) issues.push(issue("E-VOICE-081", `${prefix} 含录音告知。`, "删掉录音相关句子。"));
    if ("greeting" in company || "opening" in company) {
      issues.push(issue("E-VOICE-082", `${prefix} 不要在 JSON 里另写开场白字段。`, "开场白只写在 extra_requirements。"));
    }
  });
}

async function isDir(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const filePath of paths) {
    if (await exists(filePath)) return filePath;
  }
  return null;
}

async function firstDir(paths: string[]): Promise<string | null> {
  for (const filePath of paths) {
    if (await isDir(filePath)) return filePath;
  }
  return null;
}

async function firstTxt(dirPath: string): Promise<string | null> {
  try {
    const names = (await fs.readdir(dirPath)).filter((name) => name.endsWith(".txt") && !name.startsWith(".")).sort();
    return names[0] ? path.join(dirPath, names[0]) : null;
  } catch {
    return null;
  }
}

async function hasAgentConfig(dir: string): Promise<boolean> {
  return Boolean(await firstExisting([
    path.join(dir, "智能体配置.md"),
    path.join(dir, "00-智能体配置.md"),
    path.join(dir, "智能体配置", "智能体配置.md"),
    path.join(dir, "智能体配置", "00-智能体配置.md"),
  ]));
}

export async function resolvePackLayout(root: string): Promise<PackLayout> {
  const hotDir = path.join(root, "热词");
  return {
    root,
    confirm: await firstExisting([path.join(root, "确认卡.md")]),
    agent: await firstExisting([
      path.join(root, "智能体配置.md"),
      path.join(root, "00-智能体配置.md"),
      path.join(root, "智能体配置", "智能体配置.md"),
      path.join(root, "智能体配置", "00-智能体配置.md"),
    ]),
    knowledgeDir: await firstDir([path.join(root, "知识库"), path.join(root, "01-知识库")]),
    hotword: await firstExisting([path.join(root, "02-热词.txt")]) ?? (await isDir(hotDir) ? await firstTxt(hotDir) : null),
    intentJson: await firstExisting([
      path.join(root, "意图", "意图.json"),
      path.join(root, "意图", "03-意图.json"),
      path.join(root, "意向", "意图.json"),
      path.join(root, "03-意图.json"),
    ]),
    intentMd: await firstExisting([
      path.join(root, "意图", "意图.md"),
      path.join(root, "意图", "03-意图.md"),
      path.join(root, "意向", "意图.md"),
      path.join(root, "03-意图.md"),
    ]),
    prompt: await firstExisting([
      path.join(root, "提示词", "后台提示词.json"),
      path.join(root, "提示词", "04-后台提示词.json"),
      path.join(root, "04-后台提示词.json"),
    ]),
  };
}

export async function findPackRoot(start: string): Promise<string | null> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];
  while (queue.length) {
    const next = queue.shift()!;
    if (await exists(path.join(next.dir, "确认卡.md")) && await hasAgentConfig(next.dir)) {
      return next.dir;
    }
    if (next.depth >= 3) continue;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(next.dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".") || SKIP_DIR.has(name)) continue;
      const child = path.join(next.dir, name);
      if (await isDir(child)) queue.push({ dir: child, depth: next.depth + 1 });
    }
  }
  return null;
}

async function extractZip(zipPath: string, unpackDir: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  await fs.rm(unpackDir, { recursive: true, force: true });
  await fs.mkdir(unpackDir, { recursive: true });
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    if (!name || name.includes("..") || name.startsWith("__MACOSX/") || /(^|\/)\._/.test(name) || name.endsWith(".DS_Store")) continue;
    const target = path.join(unpackDir, name);
    if (entry.dir || name.endsWith("/")) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(await entry.async("nodebuffer")));
  }
  return unpackDir;
}

export async function loadVoiceAgentPreview(config: VoiceAgentConfig, unpackDir?: string): Promise<VoiceAgentPreview> {
  const issues: ValidationIssue[] = [];
  const packPath = config.packPath?.trim();
  if (!packPath) {
    return { canUpload: false, errorCount: 1, warningCount: 0, issues: [issue("E-VOICE-001", "还没有导入交付包。", "选取 skill 产出的文件夹或 zip。")] };
  }
  let root = packPath;
  try {
    const stats = await fs.stat(packPath);
    if (stats.isFile() && path.extname(packPath).toLowerCase() === ".zip") {
      const dest = unpackDir ?? await fs.mkdtemp(path.join(os.tmpdir(), "voice-agent-"));
      await extractZip(packPath, dest);
      const found = await findPackRoot(dest);
      if (!found) {
        issues.push(issue("E-VOICE-002", "压缩包里找不到确认卡.md 和 智能体配置.md。", "导入 skill 打好的 zip，或确认卡所在那一层。"));
        return { canUpload: false, errorCount: issues.length, warningCount: 0, issues };
      }
      root = found;
    } else if (stats.isDirectory()) {
      const found = await findPackRoot(packPath);
      if (!found) {
        issues.push(issue("E-VOICE-002", "这个文件夹里找不到确认卡.md 和 智能体配置.md。", "导入 skill 打好的 zip，或确认卡所在那一层。"));
        return { canUpload: false, errorCount: issues.length, warningCount: 0, issues };
      }
      root = found;
    } else {
      issues.push(issue("E-VOICE-003", "只支持文件夹或 .zip。", "选取 skill 交付包。"));
      return { canUpload: false, errorCount: 1, warningCount: 0, issues };
    }
  } catch {
    issues.push(issue("E-VOICE-004", "选中的路径已经不存在。", "重新选取交付包。"));
    return { canUpload: false, errorCount: 1, warningCount: 0, issues };
  }

  const layout = await resolvePackLayout(root);
  const confirmPath = layout.confirm;
  const agentPath = layout.agent;
  const knowledgeDir = layout.knowledgeDir;
  const hotwordPath = layout.hotword;
  const intentPath = layout.intentJson;
  const intentMdPath = layout.intentMd;
  const promptPath = layout.prompt;

  if (!confirmPath) issues.push(issue("E-VOICE-005", "缺少 确认卡.md。", "skill 必须先完成确认卡。"));
  if (!agentPath) issues.push(issue("E-VOICE-006", "缺少 智能体配置.md。", "补齐智能体配置后再导入。"));
  if (!knowledgeDir) issues.push(issue("E-VOICE-007", "缺少 知识库/。", "至少放公司介绍和产品两篇 md。"));
  if (!hotwordPath) issues.push(issue("E-VOICE-008", "缺少 热词 txt。", "放在 热词/ 目录里。"));
  if (!intentPath) issues.push(issue("E-VOICE-009", "缺少 意图/意图.json。", "补齐意图 JSON。"));
  if (!intentMdPath) issues.push(issue("E-VOICE-083", "缺少 意图/意图.md。", "给人看的对照表也要在包里。"));
  if (!promptPath) issues.push(issue("E-VOICE-084", "缺少 提示词/后台提示词.json。", "补齐后台提示词。"));

  let agent: VoiceAgentFields = parseAgentConfig("");
  let knowledgeFiles: Array<{ name: string; path: string }> = [];
  let hotwords: string[] = [];
  let intents: VoiceAgentIntents = { updates: [], creates: [] };
  let promptJson = "";
  let confirmCard = "";

  if (confirmPath && await exists(confirmPath)) {
    confirmCard = await readText(confirmPath);
    validateConfirm(confirmCard, issues);
  }
  if (agentPath && await exists(agentPath)) {
    const text = await readText(agentPath);
    agent = validateAgentConfig(text, issues);
  }
  if (knowledgeDir && await isDir(knowledgeDir)) knowledgeFiles = await validateKnowledge(knowledgeDir, issues);
  if (hotwordPath && await exists(hotwordPath)) hotwords = validateHotwords(await readText(hotwordPath), issues);
  if (intentPath && await exists(intentPath)) intents = validateIntents(await readText(intentPath), issues);
  if (promptPath && await exists(promptPath)) {
    promptJson = await readText(promptPath);
    validatePrompt(promptJson, issues);
  }

  const pack: VoiceAgentPackSummary = {
    rootDir: root,
    companyName: agent.companyName || path.basename(root),
    agent,
    knowledgeFiles,
    hotwordCount: hotwords.length,
    hotwordsPreview: hotwords.slice(0, 12),
    intentUpdates: intents.updates.map((item) => item.matchName || item.name || "").filter(Boolean),
    intentCreates: intents.creates.map((item) => item.name || "").filter(Boolean),
    promptJson,
    confirmCard,
  };

  const errorCount = issues.filter((item) => item.severity === "error").length;
  return { canUpload: errorCount === 0, errorCount, warningCount: 0, issues, pack };
}

export async function readHotwords(rootDir: string): Promise<string> {
  const layout = await resolvePackLayout(rootDir);
  if (!layout.hotword) throw new Error("缺少热词 txt");
  return readText(layout.hotword);
}

export async function readIntents(rootDir: string): Promise<VoiceAgentIntents> {
  const layout = await resolvePackLayout(rootDir);
  if (!layout.intentJson) throw new Error("缺少意图.json");
  return JSON.parse(await readText(layout.intentJson)) as VoiceAgentIntents;
}
