import { similarity, textKey } from "./audio-matching";
import type { AudioKnowledgeTask, AudioSpeechTask } from "./data-validation";
import { normalizeCommonQuestions, phraseKey, splitPhrases, stripFillers } from "./script-checkup";
import type { AudioMatchSummary } from "../shared/types";
import type { ModifyItem, OnlineScene, OnlineTalk, SceneSection } from "../shared/modify";

export interface DiffInput {
  flowTasks: AudioSpeechTask[];
  vagueTasks: AudioSpeechTask[];
  knowledgeTasks: AudioKnowledgeTask[];
  audioMatch: AudioMatchSummary;
}

const RENAME_MIN_SCORE = 0.6;
/** How much closer a recording must sound to the old text than to the new one before it is flagged as the old take. */
const OLD_TAKE_MARGIN = 0.15;

/** Online text drops or converts punctuation, so only the words decide whether a text changed. */
function sameText(left: string, right: string): boolean {
  return textKey(left) === textKey(right);
}

function expectedPhrases(task: AudioKnowledgeTask): string[] {
  return splitPhrases(normalizeCommonQuestions(task.question, task.commonQuestions));
}

/** Tungee splits a saved phrase at commas and older uploads kept filler words, so phrases compare as their filler-free pieces. */
const PIECE = /[,，。.？?！!、;；:：\s]+/;

function pieces(phrase: string): string[] {
  return phrase.split(PIECE).map((piece) => phraseKey(stripFillers(piece) ?? "")).filter(Boolean);
}

function uniqueByKey(phrases: string[]): string[] {
  const seen = new Set<string>();
  return phrases.filter((phrase) => {
    const key = phraseKey(phrase);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function phraseDiff(expected: string[], online: string[]): { added: string[]; removed: string[] } {
  const onlineKeys = new Set(online.flatMap(pieces));
  const expectedKeys = new Set(expected.flatMap(pieces));
  return {
    added: uniqueByKey(expected.filter((phrase) => pieces(phrase).some((key) => !onlineKeys.has(key)))),
    removed: uniqueByKey(online.filter((phrase) => pieces(phrase).some((key) => !expectedKeys.has(key)))),
  };
}

const sceneId = (kind: "flow" | "vague", section: SceneSection, index: number) => `${kind}:${section}:${index}`;
const questionId = (question: string) => `knowledge:${question}`;

/** Workbook rows keyed like the items built from them, so a ticked item finds the row to apply. */
export function tasksById(input: DiffInput): Map<string, AudioSpeechTask | AudioKnowledgeTask> {
  const tasks = new Map<string, AudioSpeechTask | AudioKnowledgeTask>();
  const positions = new Map<SceneSection, number>();
  for (const task of input.flowTasks) {
    if (!task.sectionName) continue;
    const index = positions.get(task.sectionName) ?? 0;
    positions.set(task.sectionName, index + 1);
    tasks.set(sceneId("flow", task.sectionName, index), task);
  }
  input.vagueTasks.forEach((task, index) => tasks.set(sceneId("vague", "含糊话术", index), task));
  for (const task of input.knowledgeTasks) tasks.set(questionId(task.question), task);
  return tasks;
}

export function buildModifyItems(input: DiffInput, online: OnlineTalk): ModifyItem[] {
  const matchByNumber = new Map(input.audioMatch.items.map((item) => [item.audioNumber, item]));
  const transcripts = new Map(input.audioMatch.files.map((file) => [file.name, file.transcript ?? ""]));
  const recordingFor = (audioNumber: number) => {
    const match = matchByNumber.get(audioNumber);
    return match?.fileName ? { file: match.fileName, basis: match.basis } : null;
  };

  const soundsOld = (file: string, oldText: string, newText: string) => {
    const heard = textKey(transcripts.get(file) ?? "");
    if (!heard) return false;
    return similarity(heard, textKey(oldText)) > similarity(heard, textKey(newText)) + OLD_TAKE_MARGIN;
  };

  const sceneItem = (task: AudioSpeechTask, kind: "flow" | "vague", section: SceneSection, index: number, card: OnlineScene | undefined): ModifyItem => {
    const recording = recordingFor(task.audioNumber);
    const base = {
      id: sceneId(kind, section, index),
      kind,
      label: task.moduleName,
      section,
      index,
      audioNumber: task.audioNumber,
      audioFile: recording?.file ?? null,
      audioBasis: recording?.basis,
      newText: task.speech,
      addedPhrases: [],
      removedPhrases: [],
      phrasesChanged: false,
    };
    if (!card) {
      return {
        ...base,
        status: "blocked",
        textChanged: false,
        onlineText: null,
        onlineAudio: null,
        warnings: [`探迹里的${section}没有第 ${index + 1} 张卡片，这条改不了`],
        selected: false,
      };
    }
    const textChanged = !sameText(card.text, task.speech);
    const warnings: string[] = [];
    if (textChanged && !recording && card.audioName) warnings.push("文字改了，但没有新录音，线上还是旧录音");
    if (textChanged && recording && soundsOld(recording.file, card.text, task.speech)) warnings.push("这条录音念的像修改前的文字");
    const changed = textChanged || recording !== null;
    return {
      ...base,
      status: changed ? "changed" : "same",
      textChanged,
      onlineText: card.text,
      onlineAudio: card.audioName,
      warnings,
      selected: changed,
    };
  };

  const items: ModifyItem[] = [];
  const cards = (section: SceneSection) => online.scenes.filter((scene) => scene.section === section);
  const positions = new Map<SceneSection, number>();
  for (const task of input.flowTasks) {
    if (!task.sectionName) continue;
    const index = positions.get(task.sectionName) ?? 0;
    positions.set(task.sectionName, index + 1);
    items.push(sceneItem(task, "flow", task.sectionName, index, cards(task.sectionName)[index]));
  }
  input.vagueTasks.forEach((task, index) => items.push(sceneItem(task, "vague", "含糊话术", index, cards("含糊话术")[index])));

  const onlineByKey = new Map(online.questions.map((question) => [textKey(question.question), question]));
  const workbookKeys = new Set(input.knowledgeTasks.map((task) => textKey(task.question)));
  const matchedOnline = new Set<string>();
  for (const task of input.knowledgeTasks) {
    const key = textKey(task.question);
    const current = onlineByKey.get(key);
    const recording = recordingFor(task.audioNumber);
    const phrases = expectedPhrases(task);
    const base = {
      id: questionId(task.question),
      kind: "knowledge" as const,
      label: task.question,
      section: null,
      index: -1,
      audioNumber: task.audioNumber,
      audioFile: recording?.file ?? null,
      audioBasis: recording?.basis,
      newText: task.answer,
    };
    if (current) {
      matchedOnline.add(key);
      const textChanged = !sameText(current.answer, task.answer);
      const { added, removed } = phraseDiff(phrases, current.phrases);
      const phrasesChanged = added.length > 0 || removed.length > 0;
      const warnings: string[] = [];
      if (textChanged && !recording && current.audioName) warnings.push("回答改了，但没有新录音，线上还是旧录音");
      if (textChanged && recording && soundsOld(recording.file, current.answer, task.answer)) warnings.push("这条录音念的像修改前的回答");
      const changed = textChanged || phrasesChanged || recording !== null;
      items.push({
        ...base,
        status: changed ? "changed" : "same",
        textChanged,
        phrasesChanged,
        onlineText: current.answer,
        onlineAudio: current.audioName,
        addedPhrases: added,
        removedPhrases: removed,
        warnings,
        selected: changed,
      });
      continue;
    }
    const warnings: string[] = [];
    const renamed = online.questions.find((question) => !workbookKeys.has(textKey(question.question))
      && (similarity(textKey(question.question), key) >= RENAME_MIN_SCORE
        || similarity(textKey(question.answer), textKey(task.answer)) >= RENAME_MIN_SCORE));
    if (renamed) warnings.push(`可能是「${renamed.question}」改了名字；加上后旧问题不会删`);
    if (!recording) warnings.push("新问题要有录音才能加，这次没有配到录音");
    items.push({
      ...base,
      status: recording ? "new" : "blocked",
      textChanged: false,
      phrasesChanged: false,
      onlineText: null,
      onlineAudio: null,
      addedPhrases: phrases,
      removedPhrases: [],
      warnings,
      selected: recording !== null,
    });
  }

  for (const question of online.questions) {
    if (matchedOnline.has(textKey(question.question))) continue;
    items.push({
      id: `online:${question.question}`,
      kind: "knowledge",
      label: question.question,
      section: null,
      index: -1,
      audioNumber: null,
      status: "online-only",
      textChanged: false,
      phrasesChanged: false,
      audioFile: null,
      onlineText: question.answer,
      newText: null,
      onlineAudio: question.audioName,
      addedPhrases: [],
      removedPhrases: [],
      warnings: [],
      selected: false,
    });
  }
  return items;
}
