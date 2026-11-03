import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

export class CheckupFixError extends Error {
  readonly code: "E-CHECKUP-001" | "E-CHECKUP-002" | "E-CHECKUP-003";

  constructor(code: CheckupFixError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function unescapeXml(text: string): string {
  return text
    .replace(/_x([0-9a-fA-F]{4})_/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match?.[1] === undefined ? null : unescapeXml(match[1]);
}

function textRuns(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => unescapeXml(match[1] ?? "")).join("");
}

function columnLetters(column: number): string {
  let value = column;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

async function readZipText(zip: JSZip, entry: string): Promise<string> {
  const file = zip.file(entry);
  if (!file) throw new CheckupFixError("E-CHECKUP-001", `Excel 文件缺少 ${entry}`);
  return file.async("string");
}

async function worksheetEntry(zip: JSZip, sheetName: string): Promise<string> {
  const workbookXml = await readZipText(zip, "xl/workbook.xml");
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/?>/g)]
    .map((match) => match[0])
    .find((tag) => attribute(tag, "name") === sheetName);
  const relationId = sheetTag ? /\s[\w]+:id="([^"]+)"/.exec(sheetTag)?.[1] : undefined;
  if (!relationId) throw new CheckupFixError("E-CHECKUP-001", `找不到工作表“${sheetName}”`);
  const relsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels");
  const relation = [...relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)]
    .map((match) => match[0])
    .find((tag) => attribute(tag, "Id") === relationId);
  const target = relation ? attribute(relation, "Target") : null;
  if (!target) throw new CheckupFixError("E-CHECKUP-001", `找不到工作表“${sheetName}”的数据文件`);
  return target.startsWith("/") ? target.slice(1) : path.posix.normalize(`xl/${target}`);
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await file.async("string");
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((match) => textRuns(match[1] ?? ""));
}

export interface CellChange {
  row: number;
  column: number;
  rewrite: (original: string) => string;
}

function columnNumber(letters: string): number {
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

/** Adds an empty cell to its row, keeping cells in column order, for flag cells the file never stored. */
function insertCell(sheetXml: string, row: number, column: number): string {
  const reference = `${columnLetters(column)}${row}`;
  const rowPattern = new RegExp(`<row\\b[^>]*?\\sr="${row}"[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/row>)`);
  const match = rowPattern.exec(sheetXml);
  if (!match) throw new CheckupFixError("E-CHECKUP-001", `找不到第 ${row} 行`);
  const rowXml = match[0];
  const empty = `<c r="${reference}"/>`;
  let updated: string;
  if (rowXml.endsWith("/>") && !rowXml.includes("</row>")) {
    updated = `${rowXml.slice(0, -2)}>${empty}</row>`;
  } else {
    const cells = [...rowXml.matchAll(/<c\b[^>]*?\sr="([A-Z]+)\d+"/g)];
    const next = cells.find((cell) => columnNumber(cell[1] ?? "") > column);
    const at = next?.index ?? rowXml.lastIndexOf("</row>");
    updated = rowXml.slice(0, at) + empty + rowXml.slice(at);
  }
  return sheetXml.slice(0, match.index) + updated + sheetXml.slice(match.index + rowXml.length);
}

export async function patchCells(
  workbookPath: string,
  sheetName: string,
  changes: CellChange[],
): Promise<{ buffer: Buffer; changedCells: number }> {
  const zip = await JSZip.loadAsync(await fs.readFile(workbookPath), { createFolders: false });
  const entry = await worksheetEntry(zip, sheetName);
  const strings = await sharedStrings(zip);
  let sheetXml = await readZipText(zip, entry);
  let changedCells = 0;

  for (const { row, column, rewrite } of changes) {
    const reference = `${columnLetters(column)}${row}`;
    const cellPattern = new RegExp(`<c\\b[^>]*?\\sr="${reference}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    let match = cellPattern.exec(sheetXml);
    if (!match) {
      sheetXml = insertCell(sheetXml, row, column);
      match = cellPattern.exec(sheetXml);
    }
    if (!match) throw new CheckupFixError("E-CHECKUP-001", `找不到单元格 ${reference}`);
    const cellXml = match[0];
    const openEnd = cellXml.indexOf(">");
    const openTag = cellXml.slice(0, openEnd + 1);
    const selfClosing = openTag.endsWith("/>");
    const inner = selfClosing ? "" : cellXml.slice(openEnd + 1, -"</c>".length);
    if (/<f\b/.test(inner)) throw new CheckupFixError("E-CHECKUP-001", `单元格 ${reference} 是公式，不能自动修改`);
    const type = attribute(openTag, "t");
    const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    let original: string;
    if (type === "s") original = strings[Number(value)] ?? "";
    else if (type === "inlineStr") original = textRuns(inner);
    else original = value === undefined ? "" : unescapeXml(value);

    const updated = rewrite(original);
    if (updated === original) continue;
    const attributes = openTag
      .slice(2, selfClosing ? -2 : -1)
      .replace(/\st="[^"]*"/, "")
      .trimEnd();
    const replacement = `<c${attributes} t="inlineStr"><is><t xml:space="preserve">${escapeXml(updated)}</t></is></c>`;
    sheetXml = sheetXml.slice(0, match.index) + replacement + sheetXml.slice(match.index + cellXml.length);
    changedCells += 1;
  }

  zip.file(entry, sheetXml);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { buffer, changedCells };
}
