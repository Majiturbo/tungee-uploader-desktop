import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { textKey } from "./audio-matching";
import type { AudioKnowledgeTask, AudioSpeechTask } from "./data-validation";
import { ANSWER_PLACEHOLDER } from "./talk-reader";
import type { ModifyItem } from "../shared/modify";

const TAG_CHIP = ".ant-select-selection__choice, .ant-select-selection-item";
const TAG_REMOVE = ".ant-select-selection__choice__remove, .ant-select-selection-item-remove";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const MODIFY_PROGRESS_FILE = "modify-progress.json";
export const MODIFY_SENT_AUDIO_FILE = "modify-sent-audio.json";

/** Uploads through a file input and waits for the page's voice upload request to succeed; the shown file name can't tell, since the old and new recording share it. */
export async function uploadVoice(page: Page, input: Locator, filePath: string): Promise<void> {
  const response = page.waitForResponse(
    (item) => item.request().method() === "POST" && /\/voice$/.test(new URL(item.url()).pathname),
    { timeout: 90000 },
  );
  await input.setInputFiles(filePath);
  const result = await response;
  if (!result.ok()) throw new Error(`录音上传失败（探迹返回 ${result.status()}）：${path.basename(filePath)}`);
  await page.waitForTimeout(1200);
}

export async function modifyScene(page: Page, item: ModifyItem, task: AudioSpeechTask): Promise<void> {
  if (item.kind === "vague") {
    await page.getByRole("button", { name: "含糊话术", exact: true }).first().click();
  } else {
    await page.getByRole("button", { name: "主流程", exact: true }).first().click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: item.section ?? "", exact: true }).first().click();
  }
  await page.waitForTimeout(900);
  const headings = page.getByText("话术01：", { exact: true }).filter({ visible: true });
  await headings.first().waitFor({ state: "visible", timeout: 60000 });
  if ((await headings.count()) <= item.index) throw new Error(`${item.section}未找到对应编辑框（第 ${item.index + 1} 张卡片）`);
  const heading = headings.nth(item.index);
  await heading.scrollIntoViewIfNeeded();
  const block = heading.locator("xpath=../..");
  if (item.textChanged) {
    await block.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = block.getByPlaceholder("请输入文本", { exact: true });
    await editor.waitFor({ state: "visible", timeout: 30000 });
    await editor.fill(task.speech);
    await block.getByRole("button", { name: "保 存", exact: true }).click();
    await editor.waitFor({ state: "hidden", timeout: 60000 });
    await page.waitForTimeout(900);
    const saved = await block.locator("p").first().innerText().catch(() => "");
    if (textKey(saved) !== textKey(task.speech)) throw new Error(`${item.label}保存后文字没有变，请在探迹里看一下这张卡片`);
  }
  if (item.audioFile) await uploadVoice(page, block.locator('input[type="file"]').first(), task.audioPath);
}

async function openKnowledge(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "知识库", exact: true }).first().click();
  const search = page.getByPlaceholder("搜索问题名称", { exact: true });
  await search.waitFor({ state: "visible", timeout: 60000 });
  return search;
}

async function clearSearch(search: Locator): Promise<void> {
  await search.fill("");
  await search.press("Enter");
}

export async function modifyQuestion(page: Page, item: ModifyItem, task: AudioKnowledgeTask): Promise<void> {
  const search = await openKnowledge(page);
  await search.fill(task.question);
  await search.press("Enter");
  await page.waitForTimeout(1200);
  const row = page.locator("tr").filter({ has: page.getByText(task.question, { exact: true }) }).filter({ visible: true }).first();
  if (!(await row.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false))) {
    await clearSearch(search);
    throw new Error(`知识库里未找到对应问题“${task.question}”`);
  }
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const heading = page.getByRole("heading", { name: "编辑问题", exact: true });
  await heading.waitFor({ state: "visible", timeout: 30000 });
  const form = heading.locator("xpath=..");
  const answer = form.getByPlaceholder(ANSWER_PLACEHOLDER, { exact: true });
  // The saved answer and 问法 tags arrive a moment after the dialog; clearing before that would keep the old tags.
  for (let waited = 0; waited < 15000 && !(await answer.inputValue()); waited += 250) await page.waitForTimeout(250);
  if (item.textChanged) await answer.fill(task.answer);
  if (item.phrasesChanged) {
    const phraseRow = form.locator("label").filter({ hasText: "常用问法" }).first().locator("xpath=../..");
    const chips = phraseRow.locator(TAG_CHIP);
    for (const phrase of item.removedPhrases) {
      const chip = chips.filter({ hasText: new RegExp(`^\\s*${escapeRegExp(phrase)}\\s*$`) }).first();
      if (!(await chip.count())) continue;
      await chip.locator(TAG_REMOVE).click();
      await chip.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
    }
    if (item.addedPhrases.length) {
      const before = await chips.count();
      const input = phraseRow.locator("input").first();
      await input.fill(item.addedPhrases.join("；"));
      await input.press("Enter");
      await page.waitForTimeout(300);
      if ((await chips.count()) <= before) throw new Error(`“${task.question}”的新问法没有加上`);
    }
  }
  if (item.audioFile) await uploadVoice(page, form.locator('input[type="file"]').first(), task.audioPath);
  await form.getByRole("button", { name: "保 存", exact: true }).click();
  await heading.waitFor({ state: "hidden", timeout: 60000 });
  await page.waitForTimeout(900);
  await clearSearch(await openKnowledge(page));
}

export async function audioFingerprint(filePath: string): Promise<string | null> {
  try {
    return createHash("sha1").update(await fs.readFile(filePath)).digest("hex");
  } catch {
    return null;
  }
}

/** Recordings already uploaded per talk item. The online file keeps its old name, so this is the only way to tell a rerun from a new take. */
export class SentAudio {
  private readonly file: string;

  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, MODIFY_SENT_AUDIO_FILE);
  }

  private async read(): Promise<Record<string, Record<string, string>>> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, Record<string, string>>;
    } catch {
      return {};
    }
  }

  async get(talkName: string): Promise<Record<string, string>> {
    return (await this.read())[talkName] ?? {};
  }

  async add(talkName: string, id: string, fingerprint: string): Promise<void> {
    const all = await this.read();
    all[talkName] = { ...all[talkName], [id]: fingerprint };
    await fs.writeFile(this.file, JSON.stringify(all), "utf8");
  }
}

/** Items finished in an earlier, interrupted run of the same change set, so a rerun skips them. */
export class ModifyProgress {
  private readonly file: string;

  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, MODIFY_PROGRESS_FILE);
  }

  async done(key: string): Promise<Set<string>> {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, "utf8")) as { key: string; done: string[] };
      return new Set(saved.key === key ? saved.done : []);
    } catch {
      return new Set();
    }
  }

  async add(key: string, id: string): Promise<void> {
    const done = await this.done(key);
    done.add(id);
    await fs.writeFile(this.file, JSON.stringify({ key, done: [...done] }), "utf8");
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}
