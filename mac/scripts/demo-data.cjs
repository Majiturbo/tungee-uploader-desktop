#!/usr/bin/env node
// Builds fictional demo data for screenshots and Xcode runs: a copy of a filled template with the real company
// name replaced, plus synthesized recordings of each script line. The source workbook is only read.
// Usage: node mac/scripts/demo-data.cjs <filled template.xlsx> <real company name> [out dir]
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require(path.resolve(__dirname, "../../node_modules/exceljs"));

const [source, company, out = "/tmp/tungee-demo"] = process.argv.slice(2);
if (!source || !company) {
  console.error("usage: demo-data.cjs <filled template.xlsx> <real company name> [out dir]");
  process.exit(1);
}
const MISSING = new Set([58]);

const rename = (text) => text.replaceAll(company, "示例公司");
const plain = (value) => {
  if (value == null) return "";
  if (typeof value === "object" && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("");
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value);
};

(async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(source);
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
    const value = cell.value;
    if (typeof value === "string") cell.value = rename(value);
    else if (value && typeof value === "object" && Array.isArray(value.richText)) {
      cell.value = { richText: value.richText.map((run) => ({ ...run, text: rename(run.text) })) };
    }
  })));

  const audioDir = path.join(out, "audio");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const workbookPath = path.join(out, "示例话术.xlsx");
  await workbook.xlsx.writeFile(workbookPath);

  const sheet = workbook.getWorksheet("话术内容");
  let count = 0;
  sheet.eachRow((row, index) => {
    if (index < 3) return;
    const number = Number.parseInt(plain(row.getCell(4).value), 10);
    const line = plain(row.getCell(5).value).trim() || plain(row.getCell(3).value).split("\n")[0].replace(/^回答\d+：/, "").trim();
    if (!Number.isFinite(number) || MISSING.has(number) || !line) return;
    execFileSync("say", ["-v", "Tingting", "-o", path.join(audioDir, `${number}.wav`), "--file-format=WAVE", "--data-format=LEI16@16000", line]);
    count += 1;
  });
  console.log(`${workbookPath}\n${audioDir} (${count} recordings)`);
})();
