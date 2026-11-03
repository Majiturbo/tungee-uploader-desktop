import type { Locator, Page } from "playwright";
import { cardTitle, MAIN_AFFIRM_INTENT, type IntentSetup } from "../shared/intent-plan";

const NAME_CONDITION = "命中特定问题名称";
const MAX_MOVES = 40;

interface IntentRow {
  order: string;
  level: string;
  description: string;
}

export interface IntentApplyHooks {
  onIntent?: (title: string, index: number, total: number) => void;
  assertActive?: () => void;
}

export interface IntentApplyReport {
  created: string[];
  existing: string[];
  problems: string[];
}

const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, "").trim();

async function readRows(page: Page): Promise<IntentRow[]> {
  return page.locator("tr.ant-table-row").evaluateAll((rows) => rows.map((row) => {
    const cells = [...row.querySelectorAll("td")].map((cell) => (cell.textContent ?? "").trim());
    return { order: cells[1] ?? "", level: cells[2] ?? "", description: cells[3] ?? "" };
  }));
}

function rowIndex(rows: IntentRow[], description: string): number {
  return rows.findIndex((row) => normalize(row.description) === normalize(description));
}

function rowLocator(page: Page, index: number): Locator {
  return page.locator("tr.ant-table-row").nth(index);
}

async function openIntentSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "话术设置", exact: true }).click();
  const tab = page.getByRole("tab", { name: "意向设置", exact: true });
  await tab.waitFor({ state: "visible", timeout: 30000 });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await page.getByRole("button", { name: /新建意向/ }).waitFor({ state: "visible", timeout: 30000 });
  await page.locator("tr.ant-table-row").first().waitFor({ state: "visible", timeout: 30000 });
}

async function pickOption(page: Page, text: string): Promise<boolean> {
  const options = page.locator(".ant-select-dropdown:visible li[role=option]");
  await options.first().waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
  const texts = await options.allInnerTexts();
  const index = texts.findIndex((item) => normalize(item) === normalize(text));
  if (index < 0) return false;
  await options.nth(index).click();
  return true;
}

async function createIntent(page: Page, intent: IntentSetup): Promise<{ selected: string[]; missing: string[] }> {
  await page.getByRole("button", { name: /新建意向/ }).click();
  const dialog = page.getByRole("dialog", { name: "新建意向" });
  await dialog.waitFor({ state: "visible", timeout: 15000 });

  await dialog.getByRole("combobox").first().click();
  const levelOption = page.locator(".ant-select-dropdown:visible li[role=option]").filter({ hasText: intent.level }).first();
  if (!(await levelOption.count())) throw new Error(`意向页面不匹配：等级下拉里没有“${intent.level}”`);
  await levelOption.click();
  await dialog.getByPlaceholder("请输入少于20个字符的意向描述", { exact: true }).fill(intent.description);

  const rate = dialog.getByRole("switch");
  if ((await rate.getAttribute("aria-checked")) !== "true") await rate.click();
  await dialog.locator("label.ant-radio-button-wrapper", { hasText: intent.match }).click();

  const typePlaceholder = dialog.getByText("请选择结果类型", { exact: true });
  if (!(await typePlaceholder.count())) throw new Error("意向页面不匹配：没有找到条件类型下拉框");
  await typePlaceholder.click();
  if (!(await pickOption(page, NAME_CONDITION))) throw new Error(`意向页面不匹配：条件类型里没有“${NAME_CONDITION}”`);

  const names = dialog.locator(".ant-select-selection--multiple").filter({ visible: true }).last();
  await names.waitFor({ state: "visible", timeout: 10000 });
  const selected: string[] = [];
  const missing: string[] = [];
  for (const name of intent.questions) {
    await names.click();
    await page.keyboard.type(name);
    await page.waitForTimeout(500);
    if (await pickOption(page, name)) {
      selected.push(name);
    } else {
      missing.push(name);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
    }
    await page.waitForTimeout(300);
  }
  await dialog.locator(".ant-modal-title").click();
  await page.waitForTimeout(300);

  if (!selected.length) {
    await dialog.getByRole("button", { name: "取 消", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 10000 });
    return { selected, missing };
  }
  await dialog.getByRole("button", { name: "确 定", exact: true }).click();
  try {
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
  } catch {
    const explain = (await dialog.locator(".ant-form-explain, .ant-message-notice").allInnerTexts()).join("；");
    throw new Error(`意向“${cardTitle(intent)}”保存失败${explain ? `：${explain}` : ""}`);
  }
  await page.waitForFunction(
    (description) => [...document.querySelectorAll("tr.ant-table-row")]
      .some((row) => (row.querySelectorAll("td")[3]?.textContent ?? "").trim() === description),
    intent.description,
    { timeout: 15000 },
  );
  return { selected, missing };
}

async function moveAbove(page: Page, description: string, anchor: string): Promise<boolean> {
  for (let step = 0; step < MAX_MOVES; step += 1) {
    const rows = await readRows(page);
    const own = rowIndex(rows, description);
    const target = rowIndex(rows, anchor);
    if (own < 0 || target < 0) return false;
    if (own < target) return true;
    const before = rows[own]?.order ?? "";
    await rowLocator(page, own).getByRole("button", { name: "上移", exact: true }).click();
    await page.waitForFunction(
      ({ text, order }) => {
        const row = [...document.querySelectorAll("tr.ant-table-row")]
          .find((item) => (item.querySelectorAll("td")[3]?.textContent ?? "").trim() === text);
        return row !== undefined && (row.querySelectorAll("td")[1]?.textContent ?? "").trim() !== order;
      },
      { text: description, order: before },
      { timeout: 10000 },
    );
  }
  return false;
}

async function savedQuestions(page: Page, index: number): Promise<string[]> {
  const row = rowLocator(page, index);
  const expand = row.getByRole("button", { name: "展开行" });
  if (await expand.count()) await expand.click();
  const detail = row.locator("xpath=following-sibling::tr[1]");
  await detail.locator(".ant-select-selection__choice").first().waitFor({ state: "visible", timeout: 10000 });
  return detail.locator(".ant-select-selection__choice").evaluateAll((items) => items.map((item) => item.getAttribute("title") ?? item.textContent ?? ""));
}

export async function applyIntents(page: Page, intents: IntentSetup[], hooks: IntentApplyHooks = {}): Promise<IntentApplyReport> {
  const report: IntentApplyReport = { created: [], existing: [], problems: [] };
  if (!intents.length) return report;
  await openIntentSettings(page);
  const expected = new Map<string, string[]>();

  for (const [index, intent] of intents.entries()) {
    hooks.assertActive?.();
    const title = cardTitle(intent);
    hooks.onIntent?.(title, index + 1, intents.length);
    if (rowIndex(await readRows(page), intent.description) >= 0) {
      report.existing.push(title);
      continue;
    }
    const { selected, missing } = await createIntent(page, intent);
    if (missing.length) report.problems.push(`「${title}」里的 ${missing.map((name) => `「${name}」`).join("")} 在网页知识库里找不到（可能没有录音、没上传），没有加进条件。`);
    if (!selected.length) {
      report.problems.push(`「${title}」的问题都不在网页知识库里，这条没有创建。`);
      continue;
    }
    report.created.push(title);
    expected.set(intent.description, selected);
    if (intent.placement === "before-main-affirm" && !(await moveAbove(page, intent.description, MAIN_AFFIRM_INTENT))) {
      report.problems.push(`「${title}」没能移到「B级｜${MAIN_AFFIRM_INTENT}」前面，请在网页里用“上移”手动调整顺序。`);
    }
  }

  if (!expected.size) return report;
  await page.reload({ waitUntil: "domcontentloaded" });
  await openIntentSettings(page);
  const rows = await readRows(page);
  for (const intent of intents) {
    const names = expected.get(intent.description);
    if (!names) continue;
    const title = cardTitle(intent);
    const index = rowIndex(rows, intent.description);
    if (index < 0) {
      report.problems.push(`「${title}」刷新后没有找到，可能没保存成功，请到网页检查。`);
      continue;
    }
    if (!rows[index]?.level.startsWith(intent.level)) report.problems.push(`「${title}」保存后的等级是“${rows[index]?.level}”，请到网页检查。`);
    const saved = new Set((await savedQuestions(page, index)).map(normalize));
    const lost = names.filter((name) => !saved.has(normalize(name)));
    if (lost.length) report.problems.push(`「${title}」保存后少了 ${lost.map((name) => `「${name}」`).join("")}，请到网页检查。`);
  }
  return report;
}
