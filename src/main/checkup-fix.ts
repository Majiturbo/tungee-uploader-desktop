import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadData, type LoadedData } from "./data-validation";
import { buildCheckup, rewritePhraseCell } from "./script-checkup";
import { CheckupFixError, patchCells, type CellChange } from "./xlsx-patch";
import type { CheckupDecisions, PhraseAdditions, UploadConfig } from "../shared/types";

export { CheckupFixError };

function errorCount(data: LoadedData): number {
  return data.issues.filter((item) => item.severity === "error").length;
}

export async function createFixedWorkbook(
  config: UploadConfig,
  decisions: CheckupDecisions,
  additions: PhraseAdditions = {},
): Promise<{ buffer: Buffer; appliedCount: number }> {
  const original = await loadData(config);
  if (original.commonQuestionsColumn === null) {
    throw new CheckupFixError("E-CHECKUP-001", "没有找到知识库“问法”列");
  }
  const { edits, flags, appliedCount } = buildCheckup(original).apply(decisions, additions);
  if (!appliedCount) throw new CheckupFixError("E-CHECKUP-003", "没有选择任何修正项");

  const phraseColumn = original.commonQuestionsColumn;
  const changes: CellChange[] = [...edits].map(([row, edit]) => ({
    row,
    column: phraseColumn,
    rewrite: (text) => rewritePhraseCell(text, edit),
  }));
  const { invalid, special } = original.flagColumns;
  for (const [row, flag] of flags) {
    if (flag.invalid && invalid !== null) changes.push({ row, column: invalid, rewrite: () => "是" });
    if (flag.special && special !== null) changes.push({ row, column: special, rewrite: () => "是" });
  }
  const { buffer, changedCells } = await patchCells(config.workbookPath, original.detectedSheetName, changes);
  if (!changedCells) throw new CheckupFixError("E-CHECKUP-003", "所选修正项没有改变任何内容");

  const tempPath = path.join(os.tmpdir(), `tungee-checkup-${process.pid}-${Date.now()}.xlsx`);
  try {
    await fs.writeFile(tempPath, buffer);
    const fixed = await loadData({ ...config, workbookPath: tempPath });
    const sameStructure = fixed.detectedSheetName === original.detectedSheetName
      && fixed.flowRowCount === original.flowRowCount
      && fixed.vagueRowCount === original.vagueRowCount
      && fixed.knowledgeRowCount === original.knowledgeRowCount
      && fixed.knowledgeTasks.length === original.knowledgeTasks.length;
    if (!sameStructure || errorCount(fixed) > errorCount(original)) {
      throw new CheckupFixError("E-CHECKUP-002", "修正版重新检查时与原文件结构不一致");
    }
  } finally {
    await fs.rm(tempPath, { force: true });
  }
  return { buffer, appliedCount };
}
