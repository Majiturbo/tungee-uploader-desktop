import { isSystemPromptQuestion, SYSTEM_PROMPT_PHRASES } from "./system-prompt-phrases";
import type { CheckupDecisions, CheckupFinding, CheckupResult, PhraseAdditions } from "../shared/types";

export const MIN_PHRASES = 6;
export const GOOD_PHRASES = 10;
export const LONG_SPEECH_CHARS = 90;
const CHARS_PER_SECOND = 4;
const SEPARATOR = /\r\n|\r|\n|;|；/;
const TRAILING_SEPARATOR = /(?:\r\n|\r|\n|;|；)\s*$/;
const EDGE_START = /^[\s,，、.。;；:：]+/;
const EDGE_END = /[\s,，、;；:：]+$/;
const INNER_COLON = /[:：]/;
const FILLER_CHARS = new Set("嗯啊哦噢呃额唉哎诶欸喔嗷哈呀嘛呢哼");
const LEADING_FILLER = /^[嗯啊哦噢呃唉哎诶欸喔嗷]+[\s,，、.。!！?？~～]*/;
const TRAILING_FILLER = /[\s,，、.。!！?？~～]*[嗯呃]+$/;
const PIECE_SEPARATOR = /[,，]/;

interface CheckupSpeech {
  moduleName: string;
  speech: string;
  sourceRow: number;
}

interface CheckupQa {
  question: string;
  commonQuestions: string;
  answer: string;
  invalidQa: boolean;
  specialQa?: boolean;
  sourceRow: number;
}

export interface CheckupInput {
  flowTasks: CheckupSpeech[];
  vagueTasks: CheckupSpeech[];
  knowledgeTasks: CheckupQa[];
  /** Flag suggestions are only offered for columns the workbook actually has. */
  flagColumns?: { invalid: number | null; special: number | null };
}

export interface QaFlagEdit {
  invalid?: boolean;
  special?: boolean;
}

export interface PhraseCellEdit {
  clean: boolean;
  dedupe: boolean;
  removeKeys: Set<string>;
  stripFillers?: boolean;
  replaceWith?: readonly string[];
  append?: readonly string[];
}

export interface CheckupPlan {
  result: CheckupResult;
  apply: (decisions: CheckupDecisions, additions?: PhraseAdditions) => {
    edits: Map<number, PhraseCellEdit>;
    flags: Map<number, QaFlagEdit>;
    appliedCount: number;
  };
  phraseOwner: (phrase: string) => number[];
}

const MAX_ADDITION_CHARS = 40;
const MAX_ADDITIONS_PER_ROW = 20;

export function cleanAddition(phrase: string): string {
  return phrase.replace(/[\r\n;；]+/g, "，").replace(EDGE_START, "").replace(EDGE_END, "").trim();
}

export function phraseKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function splitPhrases(cell: string): string[] {
  return cell.split(SEPARATOR).map((item) => item.trim()).filter((item) => phraseKey(item) !== "");
}

function stripEdges(text: string): string {
  return text.replace(EDGE_START, "").replace(EDGE_END, "");
}

export function cleanPhrase(text: string): string[] {
  const stripped = stripEdges(text);
  const parts = stripped.split(INNER_COLON).map(stripEdges);
  if (parts.length > 1 && parts.every((part) => phraseKey(part) !== "")) return parts;
  return [stripped];
}

function isClean(text: string): boolean {
  const cleaned = cleanPhrase(text);
  return cleaned.length === 1 && cleaned[0] === text;
}

function dedupePhrases(items: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = phraseKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((variants) => variants.find(isClean) ?? variants[0] ?? "");
}

function dominantSeparator(cell: string): string {
  const counts: Array<[string, number]> = [
    [";", (cell.match(/;/g) ?? []).length],
    ["；", (cell.match(/；/g) ?? []).length],
    ["\n", (cell.match(/\n/g) ?? []).length],
  ];
  counts.sort((left, right) => right[1] - left[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ";";
}

function isFillerOnly(text: string): boolean {
  const key = phraseKey(text);
  return key !== "" && [...key].every((char) => FILLER_CHARS.has(char));
}

export function stripFillers(phrase: string): string | null {
  const pieces = phrase.split(PIECE_SEPARATOR).map((piece) => piece.trim()).filter((piece) => phraseKey(piece) !== "");
  const kept = pieces
    .filter((piece) => !isFillerOnly(piece))
    .map((piece) => piece.replace(LEADING_FILLER, "").replace(TRAILING_FILLER, "").trim())
    .filter((piece) => phraseKey(piece) !== "");
  if (!kept.length) return null;
  if (kept.length === pieces.length && kept.every((piece, index) => piece === pieces[index])) return phrase;
  return kept.join("，");
}

export function rewritePhraseCell(cell: string, edit: PhraseCellEdit): string {
  let items = splitPhrases(cell);
  if (edit.replaceWith) {
    const standard = new Set(edit.replaceWith.map(phraseKey));
    items = [...edit.replaceWith, ...items.filter((item) => !standard.has(phraseKey(item)))];
  }
  if (edit.clean) items = items.flatMap(cleanPhrase);
  if (edit.stripFillers) {
    items = [...new Set(items.map(stripFillers).filter((item): item is string => item !== null))];
  }
  if (edit.dedupe) items = dedupePhrases(items);
  if (edit.removeKeys.size) items = items.filter((item) => !edit.removeKeys.has(phraseKey(item)));
  if (edit.append) {
    const keys = new Set(items.map(phraseKey));
    for (const phrase of edit.append) {
      const key = phraseKey(phrase);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      items.push(phrase);
    }
  }
  if (!items.length) return cell;
  const separator = dominantSeparator(cell);
  return items.join(separator) + (TRAILING_SEPARATOR.test(cell) ? separator : "");
}

export function normalizeCommonQuestions(question: string, cell: string): string {
  const systemPrompt = isSystemPromptQuestion(question);
  const hasFiller = splitPhrases(cell).some((phrase) => stripFillers(phrase) !== phrase);
  if (!systemPrompt && !hasFiller) return cell;
  return rewritePhraseCell(cell, {
    clean: false,
    dedupe: false,
    removeKeys: new Set(),
    stripFillers: true,
    replaceWith: systemPrompt ? SYSTEM_PROMPT_PHRASES : undefined,
  });
}

const quote = (text: string) => `「${text}」`;

const TRAILING_NOTE = /(?:[（(][^（）()]*[）)]|【[^【】]*】)\s*$/;
const TRAILING_CLOSERS = /[\s"'“”‘’」』》）)\]】]+$/;
const TRAILING_STOPS = /[\s。.！!～~…,，、;；]+$/;
const GOODBYE_END = /(再见|拜拜|再会|不打扰(?:您|你)了?|祝(?:您|你)?(?:生意兴隆|生活愉快|工作顺利|一切顺利|身体健康)|挂断|直接挂|挂了)$/;
const QUESTION_END = /(吗|(?<![那什怎这多])么|呢|是不是|要不要|对不对|好不好|行不行|可不可以|怎么样)$/;

function withoutNotes(text: string): string {
  let tail = text.trim();
  for (let index = 0; index < 3; index += 1) {
    const next = tail.replace(TRAILING_NOTE, "").trim();
    if (next === tail) break;
    tail = next;
  }
  return tail;
}

/** The goodbye a speech ends with, looking past a trailing note such as “（直接挂）”. */
export function goodbyeEnding(text: string): string | null {
  for (const tail of [text.trim(), withoutNotes(text)]) {
    const bare = tail.replace(TRAILING_CLOSERS, "").replace(TRAILING_STOPS, "");
    const match = GOODBYE_END.exec(bare);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Whether the last sentence of a speech asks the customer something. */
export function endsWithQuestion(text: string): boolean {
  const tail = withoutNotes(text).replace(TRAILING_CLOSERS, "");
  if (/[?？]$/.test(tail)) return true;
  return QUESTION_END.test(tail.replace(TRAILING_STOPS, ""));
}

const INVALID_TOPICS: Array<[RegExp, string]> = [
  [/机器人|真人|转人工|人工客服|是不是录音|系统录音/, "问是不是机器人，和购买意向无关"],
  [/(怎么|哪|从哪|为什么|谁).{0,4}(知道|拿到|得到|有|给).{0,4}(电话|号码|手机|联系方式)/, "问号码是哪来的，和购买意向无关"],
  [/打错|不是本人|不认识|找错/, "打错电话或不是本人，不代表意向"],
  [/听不清|听不到|没声音|信号|大点声|说慢/, "没听清是沟通问题，不代表意向"],
  [/骚扰|投诉|举报|骂人|神经病/, "骚扰投诉类回应，计入意向没有意义"],
  [/你是谁|哪位/, "身份确认，和购买意向无关"],
  [/^(拜拜|再见)|(拜拜|再见)$/, "客户道别，不代表意向"],
];

export function invalidReason(question: string): string | null {
  if (isSystemPromptQuestion(question)) return "系统提示、语音助手不是客户本人在说话，计入意向没有意义";
  const name = question.trim();
  return INVALID_TOPICS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function buildCheckup(input: CheckupInput): CheckupPlan {
  const findings: CheckupFinding[] = [];
  const actions = new Map<string, (optionId: string, edits: Map<number, PhraseCellEdit>) => boolean>();
  const editFor = (edits: Map<number, PhraseCellEdit>, rowNumber: number) => {
    const existing = edits.get(rowNumber);
    if (existing) return existing;
    const created: PhraseCellEdit = { clean: false, dedupe: false, removeKeys: new Set() };
    edits.set(rowNumber, created);
    return created;
  };

  const allQas = input.knowledgeTasks.map((task) => ({ ...task, phrases: splitPhrases(task.commonQuestions) }));
  const qas = allQas.filter((task) => !task.invalidQa);

  for (const qa of allQas) {
    if (!isSystemPromptQuestion(qa.question)) continue;
    const current = new Set(qa.phrases.map((phrase) => phrase.normalize("NFKC")));
    const missing = SYSTEM_PROMPT_PHRASES.filter((phrase) => !current.has(phrase.normalize("NFKC")));
    if (!missing.length) continue;
    const id = `sys:${qa.sourceRow}`;
    findings.push({
      id,
      kind: "system-prompt",
      title: qa.question,
      message: `问法不是最新完整版，缺少 ${missing.length} 条。上传时会自动换成最新版，原有的其他问法保留在后面；也可以另存修正版。`,
      examples: missing.slice(0, 3).map(quote),
      rowNumbers: [qa.sourceRow],
      options: [{ id: "fix", label: "换成最新完整版" }],
      defaultOption: "fix",
    });
    actions.set(id, (_optionId, edits) => {
      editFor(edits, qa.sourceRow).replaceWith = SYSTEM_PROMPT_PHRASES;
      return true;
    });
  }

  for (const qa of allQas) {
    const changes = qa.phrases
      .map((phrase) => ({ before: phrase, after: stripFillers(phrase) }))
      .filter((change) => change.after !== change.before);
    if (!changes.length) continue;
    const id = `filler:${qa.sourceRow}`;
    findings.push({
      id,
      kind: "filler-phrase",
      title: qa.question,
      message: `${changes.length} 条问法带“嗯”这类语气词，探迹会把它单独当成一条问法。上传时会自动去掉；也可以另存修正版。`,
      examples: changes.slice(0, 3).map((change) => `${quote(change.before)} → ${change.after === null ? "删除" : quote(change.after)}`),
      rowNumbers: [qa.sourceRow],
      options: [{ id: "fix", label: "去掉语气词" }],
      defaultOption: "fix",
    });
    actions.set(id, (_optionId, edits) => {
      editFor(edits, qa.sourceRow).stripFillers = true;
      return true;
    });
  }

  for (const qa of qas) {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const phrase of qa.phrases) {
      const key = phraseKey(phrase);
      if (seen.has(key)) duplicates.push(phrase);
      seen.add(key);
    }
    if (!duplicates.length) continue;
    const id = `dup:${qa.sourceRow}`;
    findings.push({
      id,
      kind: "duplicate-phrase",
      title: qa.question,
      message: `${duplicates.length} 条问法重复出现，删除后不影响识别。`,
      examples: [...new Set(duplicates)].slice(0, 3).map(quote),
      rowNumbers: [qa.sourceRow],
      options: [{ id: "fix", label: "删除重复项" }],
      defaultOption: "fix",
    });
    actions.set(id, (_optionId, edits) => {
      editFor(edits, qa.sourceRow).dedupe = true;
      return true;
    });
  }

  for (const qa of qas) {
    const changes = qa.phrases
      .map((phrase) => ({ before: phrase, after: cleanPhrase(phrase) }))
      .filter((change) => change.after.length !== 1 || change.after[0] !== change.before);
    if (!changes.length) continue;
    const id = `fmt:${qa.sourceRow}`;
    findings.push({
      id,
      kind: "phrase-format",
      title: qa.question,
      message: `${changes.length} 条问法有多余符号，或疑似把两句粘成了一句。`,
      examples: changes.slice(0, 3).map((change) => `${quote(change.before)} → ${change.after.map(quote).join(" ")}`),
      rowNumbers: [qa.sourceRow],
      options: [{ id: "fix", label: "清理符号并拆分" }],
      defaultOption: "fix",
    });
    actions.set(id, (_optionId, edits) => {
      editFor(edits, qa.sourceRow).clean = true;
      return true;
    });
  }

  const owners = new Map<string, Map<number, string>>();
  for (const qa of qas) {
    for (const phrase of qa.phrases) {
      const key = phraseKey(phrase);
      const rows = owners.get(key) ?? new Map<number, string>();
      if (!rows.has(qa.sourceRow)) rows.set(qa.sourceRow, phrase);
      owners.set(key, rows);
    }
  }
  const sharedGroups = new Map<string, { rows: number[]; keys: string[]; phrases: string[] }>();
  for (const [key, rows] of owners) {
    if (rows.size < 2) continue;
    const rowNumbers = [...rows.keys()].sort((left, right) => left - right);
    const groupId = rowNumbers.join("-");
    const group = sharedGroups.get(groupId) ?? { rows: rowNumbers, keys: [], phrases: [] };
    group.keys.push(key);
    group.phrases.push(rows.get(rowNumbers[0] ?? 0) ?? key);
    sharedGroups.set(groupId, group);
  }
  const questionByRow = new Map(qas.map((qa) => [qa.sourceRow, qa.question]));
  const knowledgeRows = new Set(allQas.map((qa) => qa.sourceRow));
  for (const [groupId, group] of sharedGroups) {
    const id = `shared:${groupId}`;
    const names = group.rows.map((row) => quote(questionByRow.get(row) ?? `第 ${row} 行`));
    findings.push({
      id,
      kind: "shared-phrase",
      title: group.rows.map((row) => questionByRow.get(row) ?? `第 ${row} 行`).join(" / "),
      message: `${group.phrases.length} 条问法同时写在 ${names.join("、")} 里，客户这样说时机器人命中哪个问题不确定。`,
      examples: group.phrases.slice(0, 4).map(quote),
      rowNumbers: group.rows,
      options: group.rows.map((row) => ({ id: `keep:${row}`, label: `只保留在${quote(questionByRow.get(row) ?? `第 ${row} 行`)}` })),
    });
    actions.set(id, (optionId, edits) => {
      const keepRow = Number(optionId.replace(/^keep:/, ""));
      if (!group.rows.includes(keepRow)) return false;
      for (const row of group.rows) {
        if (row === keepRow) continue;
        const edit = editFor(edits, row);
        for (const key of group.keys) edit.removeKeys.add(key);
      }
      return true;
    });
  }

  for (const qa of allQas) {
    if (isSystemPromptQuestion(qa.question)) continue;
    const unique = dedupePhrases(qa.phrases);
    if (unique.length >= GOOD_PHRASES) continue;
    const few = unique.length < MIN_PHRASES;
    findings.push({
      id: `few:${qa.sourceRow}`,
      kind: few ? "few-phrases" : "some-phrases",
      title: qa.question,
      message: few
        ? `只有 ${unique.length} 条问法，客户换个说法可能识别不到，建议补充到 ${GOOD_PHRASES} 条左右。`
        : `有 ${unique.length} 条问法，补到 ${GOOD_PHRASES} 条左右识别更稳。`,
      examples: unique.map(quote),
      rowNumbers: [qa.sourceRow],
      options: [],
    });
  }

  const canFlag = {
    invalid: input.flagColumns ? input.flagColumns.invalid !== null : true,
    special: input.flagColumns ? input.flagColumns.special !== null : true,
  };
  const flagActions = new Map<string, (flags: Map<number, QaFlagEdit>) => boolean>();
  for (const qa of allQas) {
    const row = qa.sourceRow;
    if (canFlag.special && !qa.specialQa) {
      flagActions.set(`special:${row}`, (flags) => {
        flags.set(row, { ...flags.get(row), special: true });
        return true;
      });
      const ending = goodbyeEnding(qa.answer);
      if (ending) {
        findings.push({
          id: `special:${row}`,
          kind: "special-qa",
          title: qa.question,
          message: `回答以${quote(ending)}结尾，说完就该挂断，建议标为特殊QA。`,
          examples: [quote([...qa.answer.trim()].slice(-24).join(""))],
          rowNumbers: [row],
          options: [{ id: "fix", label: "标为特殊QA" }],
          defaultOption: "fix",
        });
      }
    }
    if (canFlag.invalid && !qa.invalidQa) {
      flagActions.set(`invalid:${row}`, (flags) => {
        flags.set(row, { ...flags.get(row), invalid: true });
        return true;
      });
      const reason = invalidReason(qa.question);
      if (reason) {
        findings.push({
          id: `invalid:${row}`,
          kind: "invalid-qa",
          title: qa.question,
          message: `${reason}，可以考虑标为无效QA（不计入意向）。`,
          examples: [],
          rowNumbers: [row],
          options: [{ id: "fix", label: "标为无效QA" }],
        });
      }
    }
    if (qa.specialQa && endsWithQuestion(qa.answer)) {
      findings.push({
        id: `special-question:${row}`,
        kind: "special-question",
        title: qa.question,
        message: "这条设了特殊QA，命中后会立即挂断，但话术是问句，客户来不及回答。建议去掉特殊QA，或把结尾改成结束语。",
        examples: [quote([...qa.answer.trim()].slice(-24).join(""))],
        rowNumbers: [row],
        options: [],
      });
    }
  }

  const speeches = [
    ...input.flowTasks.map((task) => ({ title: task.moduleName, text: task.speech, row: task.sourceRow })),
    ...input.vagueTasks.map((task) => ({ title: task.moduleName, text: task.speech, row: task.sourceRow })),
    ...qas.map((qa) => ({ title: qa.question, text: qa.answer, row: qa.sourceRow })),
  ];
  for (const speech of speeches) {
    const length = [...speech.text].length;
    if (length <= LONG_SPEECH_CHARS) continue;
    findings.push({
      id: `long:${speech.row}`,
      kind: "long-speech",
      title: speech.title,
      message: `共 ${length} 字，按每秒约 ${CHARS_PER_SECOND} 字估算要念 ${Math.round(length / CHARS_PER_SECOND)} 秒左右，客户容易打断或挂断，建议精简到 ${LONG_SPEECH_CHARS} 字以内。`,
      examples: [],
      rowNumbers: [speech.row],
      options: [],
    });
  }

  return {
    result: { findings },
    apply: (decisions, additions = {}) => {
      const edits = new Map<number, PhraseCellEdit>();
      const flags = new Map<number, QaFlagEdit>();
      let appliedCount = 0;
      for (const [findingId, optionId] of Object.entries(decisions)) {
        const action = actions.get(findingId);
        const flagAction = flagActions.get(findingId);
        if (action?.(optionId, edits) || flagAction?.(flags)) appliedCount += 1;
      }
      for (const [rowText, phrases] of Object.entries(additions)) {
        const row = Number(rowText);
        if (!knowledgeRows.has(row)) continue;
        const seen = new Set<string>();
        const append = phrases
          .map(cleanAddition)
          .filter((phrase) => {
            const key = phraseKey(phrase);
            const owned = [...(owners.get(key)?.keys() ?? [])].some((owner) => owner !== row);
            const ok = key !== "" && [...phrase].length <= MAX_ADDITION_CHARS && !owned && !seen.has(key);
            seen.add(key);
            return ok;
          })
          .slice(0, MAX_ADDITIONS_PER_ROW);
        if (!append.length) continue;
        editFor(edits, row).append = append;
        appliedCount += 1;
      }
      return { edits, flags, appliedCount };
    },
    phraseOwner: (phrase) => [...(owners.get(phraseKey(phrase))?.keys() ?? [])],
  };
}
