import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { FLOW_SECTIONS, type OnlineQuestion, type OnlineScene, type OnlineTalk, type SceneSection } from "../shared/modify";

export const ANSWER_PLACEHOLDER = "控制在100个字以内用户最愿意听下去哦～最多不能超过200个字～";

export const MODIFY_BACKUP_DIR = "modify-backups";

export interface ReadProgress {
  (message: string, current?: number, total?: number): void;
}

/** Card text and recording name of every visible “话术01” card on the current tab. */
async function readCards(page: Page, section: SceneSection): Promise<OnlineScene[]> {
  const headings = page.getByText("话术01：", { exact: true }).filter({ visible: true });
  await headings.first().waitFor({ state: "visible", timeout: 60000 });
  const cards: OnlineScene[] = [];
  const count = await headings.count();
  for (let index = 0; index < count; index += 1) {
    const read = await headings.nth(index).locator("xpath=../..").evaluate((block) => {
      const text = (block.querySelector("p") as HTMLElement | null)?.innerText.trim() ?? "";
      const audio = [...block.querySelectorAll<HTMLElement>("button, a, span")]
        .map((element) => element.innerText.trim())
        .find((value) => /\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(value));
      return { text, audio: audio ?? null };
    });
    cards.push({ section, index, text: read.text, audioName: read.audio });
  }
  return cards;
}

export async function readScenes(page: Page, progress: ReadProgress): Promise<OnlineScene[]> {
  const scenes: OnlineScene[] = [];
  await page.getByRole("button", { name: "主流程", exact: true }).first().click();
  await page.waitForTimeout(900);
  for (const section of FLOW_SECTIONS) {
    progress(`正在读取线上的${section}…`);
    await page.getByRole("button", { name: section, exact: true }).first().click();
    await page.waitForTimeout(900);
    scenes.push(...await readCards(page, section));
  }
  progress("正在读取线上的含糊话术…");
  await page.getByRole("button", { name: "含糊话术", exact: true }).first().click();
  await page.waitForTimeout(900);
  scenes.push(...await readCards(page, "含糊话术"));
  return scenes;
}

interface KnowledgeRow {
  category: string;
  question: string;
  phraseCount: number;
  answer: string;
  audioName: string | null;
}

/** Every question row of every category on the current knowledge page, without the fixed-column copies antd renders. */
function knowledgeRows(page: Page): Promise<KnowledgeRow[]> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const rows: KnowledgeRow[] = [];
    for (const tr of document.querySelectorAll<HTMLTableRowElement>("tr")) {
      const cells = [...tr.querySelectorAll<HTMLTableCellElement>(":scope > td")];
      if (cells.length < 6 || !tr.offsetParent) continue;
      const question = cells[0]!.innerText.trim();
      if (!question || seen.has(question)) continue;
      seen.add(question);
      const panel = tr.closest(".ant-collapse-item");
      const header = panel?.querySelector<HTMLElement>(".ant-collapse-header")?.innerText ?? "";
      const category = header.replace(/新建问题|删除|\|/g, " ").trim().split(/\s+/).pop() ?? "";
      const firstAnswer = cells[3]!.querySelector<HTMLElement>("li") ?? cells[3]!;
      const audio = cells[4]!.innerText.trim();
      rows.push({
        category,
        question,
        phraseCount: Number(cells[2]!.innerText.trim()) || 0,
        answer: firstAnswer.innerText.replace(/^[•·]\s*/, "").trim(),
        audioName: /\.\w{2,4}$/.test(audio) ? audio : null,
      });
    }
    return rows;
  });
}

/** Answer cells open popovers too; only the 问法 list has this header. */
function phrasePopover(page: Page): Locator {
  return page.locator(".ant-popover").filter({ visible: true }).filter({ hasText: "常用问法" });
}

/** A spot with nothing hoverable under it (the side menu flies out on hover), so resting the mouse there closes popovers quietly. */
async function restingPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const candidates = [[0.35, 30], [0.5, 30], [0.25, 30]].map(([fx, y]) => ({ x: Math.round(innerWidth * fx!), y: y! }));
    const quiet = candidates.find(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el && !el.closest("a, button, input, li, [role], [class*=menu], [class*=Menu], .ant-popover, .ant-dropdown, [class*=sider], [class*=Sider]");
    });
    return quiet ?? { x: Math.round(innerWidth / 2), y: innerHeight - 4 };
  });
}

export async function restMouse(page: Page): Promise<void> {
  const { x, y } = await restingPoint(page);
  await page.mouse.move(x, y);
}

async function closePhrasePopover(page: Page): Promise<void> {
  await restMouse(page);
  await phrasePopover(page).first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => undefined);
}

/** The 问法 list opens on hover, so a mouse that never left the link shows nothing; move away and hover again. */
async function openPhrasePopover(page: Page, link: Locator): Promise<Locator | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await closePhrasePopover(page);
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    const popover = phrasePopover(page).last();
    if (await popover.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false)) return popover;
  }
  return null;
}

/** Reads the tags in the 编辑问题 dialog and cancels it without saving. */
async function readPhrasesFromEditor(page: Page, row: Locator): Promise<string[]> {
  await closePhrasePopover(page);
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const heading = page.getByRole("heading", { name: "编辑问题", exact: true });
  await heading.waitFor({ state: "visible", timeout: 30000 });
  const form = heading.locator("xpath=..");
  const answer = form.getByPlaceholder(ANSWER_PLACEHOLDER, { exact: true });
  for (let waited = 0; waited < 15000 && !(await answer.inputValue()); waited += 250) await page.waitForTimeout(250);
  const phrases = await form.locator("label").filter({ hasText: "常用问法" }).first().locator("xpath=../..")
    .locator(".ant-select-selection__choice, .ant-select-selection-item")
    .evaluateAll((chips) => chips.map((chip) => (chip.getAttribute("title") ?? (chip as HTMLElement).innerText).trim()).filter(Boolean));
  await form.getByRole("button", { name: /^取\s*消$/ }).click();
  await heading.waitFor({ state: "hidden", timeout: 10000 });
  return phrases;
}

async function readPhrases(page: Page, question: string): Promise<string[]> {
  const row = page.locator("tr").filter({ has: page.getByText(question, { exact: true }) }).filter({ visible: true }).first();
  const link = row.locator("td").nth(2).locator("a").first();
  const popover = await openPhrasePopover(page, link);
  if (!popover) return readPhrasesFromEditor(page, row);
  const phrases: string[] = [];
  for (let pageIndex = 0; pageIndex < 50; pageIndex += 1) {
    await popover.locator("tbody tr").first().waitFor({ state: "visible", timeout: 10000 });
    const texts = await popover.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => {
      const cells = tr.querySelectorAll<HTMLElement>("td");
      return (cells[1] ?? cells[0])?.innerText.trim() ?? "";
    }));
    phrases.push(...texts.filter(Boolean));
    const next = popover.locator(".ant-pagination-next:not(.ant-pagination-disabled)");
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(300);
  }
  await closePhrasePopover(page);
  return phrases;
}

export async function readQuestions(page: Page, progress: ReadProgress): Promise<{ questions: OnlineQuestion[]; categories: string[] }> {
  progress("正在读取线上的知识库…");
  await page.getByRole("button", { name: "知识库", exact: true }).first().click();
  const search = page.getByPlaceholder("搜索问题名称", { exact: true });
  await search.waitFor({ state: "visible", timeout: 60000 });
  if (await search.inputValue()) {
    await search.fill("");
    await search.press("Enter");
  }
  await page.waitForTimeout(1200);
  const rows: KnowledgeRow[] = [];
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const found = await knowledgeRows(page);
    rows.push(...found.filter((row) => !rows.some((item) => item.question === row.question)));
    const next = page.locator(".ant-table-pagination .ant-pagination-next:not(.ant-pagination-disabled)").filter({ visible: true }).first();
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(900);
  }
  const categories = await page.locator(".ant-collapse-header").filter({ visible: true }).evaluateAll((headers) => headers
    .map((header) => (header as HTMLElement).innerText.replace(/新建问题|删除|\|/g, " ").trim().split(/\s+/).pop() ?? "")
    .filter(Boolean));
  const questions: OnlineQuestion[] = [];
  for (const [index, row] of rows.entries()) {
    progress(`正在读取问法：${row.question}`, index + 1, rows.length);
    const phrases = row.phraseCount ? await readPhrases(page, row.question) : [];
    questions.push({ category: row.category, question: row.question, answer: row.answer, audioName: row.audioName, phrases });
  }
  return { questions, categories: [...new Set(categories.length ? categories : rows.map((row) => row.category).filter(Boolean))] };
}

/** Reads the open talk editor end to end. Only clicks tabs and the read-only 问法 popovers. */
export async function readTalk(page: Page, talkName: string, progress: ReadProgress): Promise<OnlineTalk> {
  const scenes = await readScenes(page, progress);
  const { questions, categories } = await readQuestions(page, progress);
  return { talkName, readAt: new Date().toISOString(), categories, scenes, questions };
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Keeps what the talk looked like before any change, so it can be compared or restored by hand. */
export async function saveBackup(userDataPath: string, talk: OnlineTalk): Promise<string> {
  const dir = path.join(userDataPath, MODIFY_BACKUP_DIR);
  await fs.mkdir(dir, { recursive: true });
  const safeName = talk.talkName.replace(/[\\/:*?"<>|]/g, "_");
  const file = path.join(dir, `${safeName}-${stamp(new Date(talk.readAt))}.json`);
  await fs.writeFile(file, JSON.stringify(talk, null, 2), "utf8");
  return file;
}
