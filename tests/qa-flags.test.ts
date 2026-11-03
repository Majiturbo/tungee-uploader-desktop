import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { patchCells } from "../src/main/xlsx-patch.ts";
import { buildCheckup, endsWithQuestion, goodbyeEnding, invalidReason } from "../src/main/script-checkup.ts";

test("结束语结尾识别：看最后一句，括号备注也能认出", () => {
  assert.equal(goodbyeEnding("好的，那我这边就先不打扰您了，祝您生意兴隆，再见！"), "再见");
  assert.equal(goodbyeEnding("好的，那我就不打扰您了。"), "不打扰您了");
  assert.equal(goodbyeEnding("好的，祝您生意兴隆"), "祝您生意兴隆");
  assert.equal(goodbyeEnding("有的，我稍后就发给您，再见。（直接挂）"), "直接挂");
  assert.equal(goodbyeEnding("好的，拜拜~"), "拜拜");
  assert.equal(goodbyeEnding("再见之前想问下您方便加个微信吗？"), null);
  assert.equal(goodbyeEnding("我们主要做企业服务"), null);
});

test("问句识别：只看最后一句", () => {
  assert.equal(endsWithQuestion("要不我加您微信发您看看？"), true);
  assert.equal(endsWithQuestion("您看可以吗"), true);
  assert.equal(endsWithQuestion("您觉得怎么样。"), true);
  assert.equal(endsWithQuestion("请问您是负责人吗？好的，那不打扰您了，再见。"), false);
  assert.equal(endsWithQuestion("没什么，那先这样"), false);
  assert.equal(endsWithQuestion("那也没什么"), false);
  assert.equal(endsWithQuestion("好的，我稍后发您（直接挂）"), false);
});

test("无效QA规则只看问题名称", () => {
  assert.ok(invalidReason("是不是机器人"));
  assert.ok(invalidReason("你怎么知道我电话"));
  assert.ok(invalidReason("系统提示"));
  assert.ok(invalidReason("拜拜"));
  assert.equal(invalidReason("人工费多少"), null);
  assert.equal(invalidReason("价格多少"), null);
});

const qa = (sourceRow: number, question: string, phrases: number, extra: Partial<{ answer: string; invalidQa: boolean; specialQa: boolean }> = {}) => ({
  question,
  commonQuestions: Array.from({ length: phrases }, (_, index) => `${question}说法${index + 1}`).join("；"),
  answer: extra.answer ?? "我们主要做企业服务，您看方便加个微信吗？",
  invalidQa: extra.invalidQa ?? false,
  specialQa: extra.specialQa ?? false,
  sourceRow,
});

test("问法分两档，无效QA也提醒，系统提示不算", () => {
  const plan = buildCheckup({
    flowTasks: [],
    vagueTasks: [],
    knowledgeTasks: [
      qa(25, "价格", 3),
      qa(26, "位置远", 7),
      qa(27, "案例", 12),
      qa(28, "你知道我是谁吗", 3, { invalidQa: true }),
      qa(29, "系统提示", 2),
    ],
  });
  const kinds = new Map(plan.result.findings.filter((item) => item.id.startsWith("few:")).map((item) => [item.rowNumbers[0], item.kind]));
  assert.equal(kinds.get(25), "few-phrases");
  assert.equal(kinds.get(26), "some-phrases");
  assert.equal(kinds.get(27), undefined);
  assert.equal(kinds.get(28), "few-phrases");
  assert.equal(kinds.get(29), undefined);
});

test("特殊QA/无效QA建议和问句警告，采纳后写入标记", () => {
  const plan = buildCheckup({
    flowTasks: [],
    vagueTasks: [],
    knowledgeTasks: [
      qa(25, "给我发资料", 12, { answer: "好的，我稍后就发给您，再见" }),
      qa(26, "是不是机器人", 12),
      qa(27, "优势", 12, { specialQa: true }),
      qa(28, "拜拜", 12, { answer: "好的，再见", invalidQa: true, specialQa: true }),
    ],
    flagColumns: { invalid: 6, special: 7 },
  });
  const byId = new Map(plan.result.findings.map((item) => [item.id, item]));
  assert.equal(byId.get("special:25")?.defaultOption, "fix");
  assert.equal(byId.get("invalid:26")?.defaultOption, undefined);
  assert.equal(byId.get("special-question:27")?.kind, "special-question");
  assert.equal(byId.has("special:28"), false);
  assert.equal(byId.has("invalid:28"), false);

  const { flags, appliedCount } = plan.apply({ "special:25": "fix", "invalid:26": "fix", "invalid:27": "fix", "special:28": "fix" });
  assert.equal(appliedCount, 3);
  assert.deepEqual(flags.get(25), { special: true });
  assert.deepEqual(flags.get(26), { invalid: true });
  assert.deepEqual(flags.get(27), { invalid: true });
  assert.equal(flags.has(28), false);
});

test("模板没有无效QA/特殊QA列时不提供标记建议", () => {
  const plan = buildCheckup({
    flowTasks: [],
    vagueTasks: [],
    knowledgeTasks: [qa(25, "是不是机器人", 12, { answer: "好的，再见" })],
    flagColumns: { invalid: null, special: null },
  });
  assert.equal(plan.result.findings.some((item) => item.kind === "special-qa" || item.kind === "invalid-qa"), false);
});

test("写标记时单元格不存在也能补上，且保持列顺序", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flags-"));
  const file = path.join(dir, "in.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("话术内容");
  sheet.getCell("A1").value = "问题";
  sheet.getCell("C1").value = "回答";
  sheet.getCell("F1").value = "否";
  await workbook.xlsx.writeFile(file);

  const { buffer, changedCells } = await patchCells(file, "话术内容", [
    { row: 1, column: 2, rewrite: () => "是" },
    { row: 1, column: 6, rewrite: () => "是" },
    { row: 1, column: 7, rewrite: () => "是" },
  ]);
  assert.equal(changedCells, 3);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer);
  const row = out.getWorksheet("话术内容")!.getRow(1);
  assert.deepEqual([1, 2, 3, 6, 7].map((column) => String(row.getCell(column).value)), ["问题", "是", "回答", "是", "是"]);
});
