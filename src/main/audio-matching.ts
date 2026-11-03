import type { AudioMatchBasis, AudioMatchCandidate } from "../shared/types";

export const AUTO_MIN_SCORE = 0.25;
export const AUTO_MIN_MARGIN = 0.1;
/** How much better another row has to sound before a file's own number is overruled. */
const DISTRUST_MARGIN = 0.15;
/** When this many numbered files sound like other rows, the numbers follow some other order (usually recording order). */
const IGNORE_NUMBERS_MIN = 3;
const NAME_MIN_SCORE = 0.6;
const WEAK_SCORE = 0.15;
const SHORT_TRANSCRIPT_CHARS = 4;
const CANDIDATE_LIMIT = 3;

export interface MatchSlot {
  audioNumber: number;
  label: string;
  speech: string;
}

export interface MatchFile {
  name: string;
  transcript: string | null;
}

export interface SlotMatch {
  audioNumber: number;
  fileName: string | null;
  basis: AudioMatchBasis;
  score: number;
  needsReview: boolean;
  reason?: string;
  candidates: AudioMatchCandidate[];
}

export interface MatchResult {
  slots: SlotMatch[];
  unusedFiles: string[];
}

export type MatchDecisions = Map<number, string | null>;

export interface MatchRules {
  /** File-name numbers only count when the recording doesn't clearly sound like another row: people number recordings
   * by the order they read them, mix numbered and named files, and mistype numbers. */
  numbersAreHints?: boolean;
  /** The folder holds only some rows' recordings, so rows without one are expected and nothing is guessed from file order. */
  partial?: boolean;
}

const AUTO_NAMED = /^(新录音|新錄音|new recording|录音|錄音|recording)\s*[_-]?\s*\d*$/i;
const PREFIXED_NUMBER = /^(?:编号|编码|序号|音频|no\.?|第)\s*[_-]?\s*(\d{1,4})\s*(?:号|条)?$/i;
const LEADING_NUMBER = /^(\d{1,4})(?:[\s_\-—.、．。]+|(?=[^\d\s]))/;

export function textKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function fileStem(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).normalize("NFKC").trim();
}

const UNIGRAM_WEIGHT = 0.7;

function grams(value: string, size: number): Map<string, number> {
  const result = new Map<string, number>();
  if (value.length < size) {
    if (value) result.set(value, 1);
    return result;
  }
  for (let index = 0; index <= value.length - size; index += 1) {
    const gram = value.slice(index, index + size);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

function dice(left: string, right: string, size: number): number {
  const a = grams(left, size);
  const b = grams(right, size);
  let shared = 0;
  let total = 0;
  for (const [gram, count] of a) {
    shared += Math.min(count, b.get(gram) ?? 0);
    total += count;
  }
  for (const count of b.values()) total += count;
  return total ? (2 * shared) / total : 0;
}

export function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  return Math.max(dice(left, right, 2), UNIGRAM_WEIGHT * dice(left, right, 1));
}

export function exactFileNumber(fileName: string): number | null {
  const stem = fileStem(fileName);
  if (!/^\d+$/.test(stem)) return null;
  const value = Number(stem);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function namedFileNumber(fileName: string): number | null {
  const stem = fileStem(fileName);
  if (exactFileNumber(fileName) !== null || AUTO_NAMED.test(stem)) return null;
  const match = PREFIXED_NUMBER.exec(stem) ?? LEADING_NUMBER.exec(stem);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
}

export function autoSequence(fileName: string): number | null {
  const match = /(\d+)\s*$/.exec(fileStem(fileName));
  if (AUTO_NAMED.test(fileStem(fileName))) return match?.[1] ? Number(match[1]) : 1;
  return null;
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN", { numeric: true });
}

function bestAssignment(scores: number[][]): number[] {
  const rows = scores.length;
  const cols = scores[0]?.length ?? 0;
  const size = Math.max(rows, cols);
  if (!size) return [];
  const cost = (row: number, col: number) => -(scores[row]?.[col] ?? 0);
  const u = new Array<number>(size + 1).fill(0);
  const v = new Array<number>(size + 1).fill(0);
  const owner = new Array<number>(size + 1).fill(0);
  const way = new Array<number>(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    owner[0] = row;
    let col0 = 0;
    const minv = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(size + 1).fill(false);
    do {
      used[col0] = true;
      const row0 = owner[col0]!;
      let delta = Number.POSITIVE_INFINITY;
      let col1 = 0;
      for (let col = 1; col <= size; col += 1) {
        if (used[col]) continue;
        const current = cost(row0 - 1, col - 1) - u[row0]! - v[col]!;
        if (current < minv[col]!) {
          minv[col] = current;
          way[col] = col0;
        }
        if (minv[col]! < delta) {
          delta = minv[col]!;
          col1 = col;
        }
      }
      for (let col = 0; col <= size; col += 1) {
        if (used[col]) {
          u[owner[col]!]! += delta;
          v[col]! -= delta;
        } else {
          minv[col]! -= delta;
        }
      }
      col0 = col1;
    } while (owner[col0] !== 0);
    do {
      const col1 = way[col0]!;
      owner[col0] = owner[col1]!;
      col0 = col1;
    } while (col0);
  }
  const result = new Array<number>(rows).fill(-1);
  for (let col = 1; col <= size; col += 1) {
    const row = owner[col]! - 1;
    if (row >= 0 && row < rows && col - 1 < cols) result[row] = col - 1;
  }
  return result;
}

interface Pair {
  file: string;
  slot: number;
  score: number;
  basis: AudioMatchBasis;
}

export function matchAudioFiles(slots: MatchSlot[], files: MatchFile[], decisions: MatchDecisions = new Map(), rules: MatchRules = {}): MatchResult {
  const slotByNumber = new Map(slots.map((slot) => [slot.audioNumber, slot]));
  const speechKeys = new Map(slots.map((slot) => [slot.audioNumber, textKey(slot.speech)]));
  const labelKeys = new Map(slots.map((slot) => [slot.audioNumber, textKey(slot.label)]));
  const fileByName = new Map(files.map((file) => [file.name, file]));
  const transcriptKeys = new Map(files.map((file) => [file.name, file.transcript === null ? null : textKey(file.transcript)]));
  const hasSpeech = files.some((file) => file.transcript !== null);
  const speechScore = (fileName: string, audioNumber: number) => {
    const transcript = transcriptKeys.get(fileName);
    return transcript ? similarity(transcript, speechKeys.get(audioNumber) ?? "") : null;
  };

  /** File name → the number its name claims, for recordings that sound like a different row. */
  const distrusted = new Map<string, number>();
  let ignoreNumbers = false;
  if (rules.numbersAreHints) {
    let heard = 0;
    for (const file of files) {
      const claimed = exactFileNumber(file.name) ?? namedFileNumber(file.name);
      if (claimed === null || !slotByNumber.has(claimed)) continue;
      const own = speechScore(file.name, claimed);
      if (own === null) continue;
      heard += 1;
      const rival = slots
        .filter((slot) => slot.audioNumber !== claimed && speechKeys.get(slot.audioNumber) !== speechKeys.get(claimed))
        .map((slot) => speechScore(file.name, slot.audioNumber) ?? 0)
        .reduce((best, score) => Math.max(best, score), 0);
      if (rival >= AUTO_MIN_SCORE && rival >= own + DISTRUST_MARGIN) distrusted.set(file.name, claimed);
    }
    ignoreNumbers = distrusted.size >= IGNORE_NUMBERS_MIN && distrusted.size * 2 >= heard;
    if (ignoreNumbers) distrusted.clear();
  }

  const pairScore = (fileName: string, audioNumber: number): Pair => {
    const trusted = !ignoreNumbers && !distrusted.has(fileName);
    const bareNumber = exactFileNumber(fileName);
    const exact = trusted ? bareNumber : null;
    if (exact === audioNumber) return { file: fileName, slot: audioNumber, score: 1, basis: "number" };
    const named = trusted ? namedFileNumber(fileName) : null;
    if (named === audioNumber) return { file: fileName, slot: audioNumber, score: 0.97, basis: "name-number" };
    let best: Pair = { file: fileName, slot: audioNumber, score: 0, basis: "none" };
    const stemKey = textKey(fileStem(fileName));
    const labelKey = labelKeys.get(audioNumber) ?? "";
    if (stemKey && bareNumber === null && named === null && !AUTO_NAMED.test(fileStem(fileName))) {
      const nameScore = stemKey === labelKey ? 0.98 : similarity(stemKey, labelKey);
      if (nameScore > best.score) best = { ...best, score: nameScore, basis: "name" };
    }
    const transcript = transcriptKeys.get(fileName);
    if (transcript) {
      const speechScore = similarity(transcript, speechKeys.get(audioNumber) ?? "");
      if (speechScore > best.score) best = { ...best, score: speechScore, basis: "speech" };
    }
    return best;
  };

  const scores = new Map<string, Pair[]>();
  for (const file of files) {
    scores.set(file.name, slots.map((slot) => pairScore(file.name, slot.audioNumber)).sort((a, b) => b.score - a.score));
  }
  const candidatesFor = (audioNumber: number): AudioMatchCandidate[] => files
    .map((file) => scores.get(file.name)?.find((pair) => pair.slot === audioNumber))
    .filter((pair): pair is Pair => Boolean(pair && pair.score >= WEAK_SCORE))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_LIMIT)
    .map((pair) => ({ fileName: pair.file, score: Math.round(pair.score * 100) / 100, basis: pair.basis }));

  const results = new Map<number, SlotMatch>();
  const usedFiles = new Set<string>();
  const assign = (audioNumber: number, pair: Pair | null, needsReview: boolean, reason?: string) => {
    if (pair) usedFiles.add(pair.file);
    results.set(audioNumber, {
      audioNumber,
      fileName: pair?.file ?? null,
      basis: pair?.basis ?? "none",
      score: pair ? Math.round(pair.score * 100) / 100 : 0,
      needsReview,
      reason,
      candidates: [],
    });
  };

  for (const [audioNumber, fileName] of decisions) {
    if (!slotByNumber.has(audioNumber) || results.has(audioNumber)) continue;
    if (fileName === null) {
      assign(audioNumber, null, false);
      results.get(audioNumber)!.basis = "confirmed";
      continue;
    }
    if (!fileByName.has(fileName) || usedFiles.has(fileName)) continue;
    const pair = pairScore(fileName, audioNumber);
    assign(audioNumber, { ...pair, basis: "confirmed" }, false);
  }

  const byNumber = (read: (name: string) => number | null, basis: AudioMatchBasis, score: number) => {
    if (ignoreNumbers) return;
    const groups = new Map<number, string[]>();
    for (const file of files) {
      if (usedFiles.has(file.name) || distrusted.has(file.name)) continue;
      const value = read(file.name);
      if (value === null || !slotByNumber.has(value) || results.has(value)) continue;
      groups.set(value, [...(groups.get(value) ?? []), file.name]);
    }
    for (const [audioNumber, names] of groups) {
      const sorted = [...names].sort(naturalCompare);
      const first = sorted[0]!;
      if (sorted.length === 1) {
        assign(audioNumber, { file: first, slot: audioNumber, score, basis }, false);
      } else {
        assign(audioNumber, { file: first, slot: audioNumber, score, basis }, true, `同一编号有 ${sorted.length} 个文件，可能是重录`);
        sorted.slice(1).forEach((name) => usedFiles.add(name));
      }
    }
  };
  byNumber(exactFileNumber, "number", 1);
  byNumber(namedFileNumber, "name-number", 0.97);

  const openSlots = () => slots.filter((slot) => !results.has(slot.audioNumber));
  const scoreOf = (fileName: string, audioNumber: number) => scores.get(fileName)?.find((pair) => pair.slot === audioNumber);
  const usable = (pair: Pair | undefined): pair is Pair => Boolean(pair && pair.score >= WEAK_SCORE && pair.basis !== "none");
  const poolFiles = files.filter((file) => !usedFiles.has(file.name)).map((file) => file.name);
  const poolSlots = openSlots().map((slot) => slot.audioNumber);
  const matrix = poolFiles.map((name) => poolSlots.map((audioNumber) => {
    const pair = scoreOf(name, audioNumber);
    return usable(pair) ? pair.score : 0;
  }));
  const chosen = bestAssignment(matrix)
    .map((col, row) => (col >= 0 ? scoreOf(poolFiles[row]!, poolSlots[col]!) : undefined))
    .filter(usable)
    .sort((a, b) => b.score - a.score);
  const assignedScore = new Map(chosen.map((pair) => [pair.file, pair.score]));
  for (const pair of chosen) {
    const own = scores.get(pair.file) ?? [];
    const ownSpeech = speechKeys.get(pair.slot);
    const rival = own.find((other) => other.slot !== pair.slot && speechKeys.get(other.slot) !== ownSpeech);
    const margin = pair.score - (rival?.score ?? 0);
    const transcript = transcriptKeys.get(pair.file) ?? "";
    const competingFile = poolFiles.find((name) => {
      if (name === pair.file) return false;
      const here = scoreOf(name, pair.slot)?.score ?? 0;
      return here >= Math.max(AUTO_MIN_SCORE, pair.score - AUTO_MIN_MARGIN)
        && (assignedScore.get(name) ?? 0) < here + AUTO_MIN_MARGIN;
    });
    let reason: string | undefined;
    if (pair.basis === "name" && pair.score >= 0.98) reason = undefined;
    else if (pair.basis === "speech" && transcript.length < SHORT_TRANSCRIPT_CHARS) reason = "录音很短，无法可靠判断";
    else if (competingFile) reason = "两条录音都像这句，可能是重录";
    else if (pair.basis === "name" && pair.score < NAME_MIN_SCORE) reason = "文件名和话术接近，但不够确定";
    else if (pair.score < AUTO_MIN_SCORE) reason = "和话术差别较大，可能没照稿念";
    else if (margin < AUTO_MIN_MARGIN) {
      reason = rival ? `和第 ${rival.slot} 号话术几乎一样` : "无法区分相近的话术";
    }
    const claimed = distrusted.get(pair.file);
    if (claimed !== undefined) reason = `文件名是 ${claimed} 号，但听起来像这句`;
    assign(pair.slot, pair, reason !== undefined, reason);
  }

  const leftoverFiles = files.filter((file) => !usedFiles.has(file.name)).map((file) => file.name);
  if (!hasSpeech && !rules.partial && leftoverFiles.length) {
    const ordered = leftoverFiles
      .filter((name) => autoSequence(name) !== null)
      .sort((a, b) => (autoSequence(a) ?? 0) - (autoSequence(b) ?? 0) || naturalCompare(a, b));
    const remaining = openSlots().sort((a, b) => a.audioNumber - b.audioNumber);
    ordered.slice(0, remaining.length).forEach((name, index) => {
      const slot = remaining[index]!;
      assign(slot.audioNumber, { file: name, slot: slot.audioNumber, score: 0, basis: "order" }, true, "只能按录音顺序推断");
    });
  }

  const unusedFiles = files.filter((file) => !usedFiles.has(file.name)).map((file) => file.name).sort(naturalCompare);
  if (rules.numbersAreHints) {
    for (const result of results.values()) {
      if (!result.fileName || (result.basis !== "number" && result.basis !== "name-number")) continue;
      const own = speechScore(result.fileName, result.audioNumber) ?? 0;
      const better = unusedFiles
        .map((name) => ({ name, score: speechScore(name, result.audioNumber) ?? 0 }))
        .filter((item) => item.score >= AUTO_MIN_SCORE && item.score >= own + DISTRUST_MARGIN)
        .sort((a, b) => b.score - a.score)[0];
      if (!better) continue;
      result.needsReview = true;
      result.reason = `${better.name} 听起来更像这句`;
    }
  }
  const claimedBy = new Map([...distrusted].map(([name, claimed]) => [claimed, name]));
  for (const slot of openSlots()) {
    const claimant = claimedBy.get(slot.audioNumber);
    if (claimant) assign(slot.audioNumber, null, true, `${claimant} 的文件名是这个编号，但内容不像这句`);
    else if (rules.partial) assign(slot.audioNumber, null, false);
    else assign(slot.audioNumber, null, unusedFiles.length > 0, unusedFiles.length > 0 ? "没有找到对应录音" : undefined);
  }
  const ordered = slots.map((slot) => {
    const result = results.get(slot.audioNumber)!;
    if (result.needsReview) {
      const candidates = candidatesFor(slot.audioNumber).filter((item) => item.fileName !== result.fileName);
      if (result.fileName) candidates.unshift({ fileName: result.fileName, score: result.score, basis: result.basis });
      const claimant = claimedBy.get(slot.audioNumber);
      if (claimant && !candidates.some((item) => item.fileName === claimant)) {
        candidates.unshift({ fileName: claimant, score: Math.round((speechScore(claimant, slot.audioNumber) ?? 0) * 100) / 100, basis: "number" });
      }
      for (const name of unusedFiles) {
        if (candidates.length >= CANDIDATE_LIMIT) break;
        if (!candidates.some((item) => item.fileName === name)) candidates.push({ fileName: name, score: 0, basis: "none" });
      }
      result.candidates = candidates.slice(0, CANDIDATE_LIMIT);
    }
    return result;
  });
  return { slots: ordered, unusedFiles };
}
