import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { loadVoiceAgentPreview, parseAgentConfig } from "../src/main/voice-agent-pack.ts";

const fixture = fileURLToPath(new URL("./fixtures/voice-agent/示例品牌", import.meta.url));

test("虚构交付包结构校验通过", async () => {
  const preview = await loadVoiceAgentPreview({ packPath: fixture });
  assert.equal(preview.canUpload, true, preview.issues.map((item) => item.message).join("；"));
  assert.equal(preview.pack?.agent.name, "示例品牌助手");
  assert.equal(preview.pack?.agent.companyName, "示例品牌");
  assert.equal(preview.pack?.knowledgeFiles.length, 1);
  assert.equal(preview.pack?.hotwordCount, 6);
  assert.ok(preview.pack?.intentUpdates.includes("询问价格"));
  assert.ok(preview.pack?.promptJson.includes("user-agent-config/3.0"));
});

test("缺文件时指出缺什么", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-agent-empty-"));
  const preview = await loadVoiceAgentPreview({ packPath: dir });
  assert.equal(preview.canUpload, false);
  assert.ok(preview.issues.some((item) => item.message.includes("确认卡.md")));
});

test("热词超过字数不能上传", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-agent-hot-"));
  for (const name of ["确认卡.md", "00-智能体配置.md", "03-意图.md"]) {
    fs.copyFileSync(path.join(fixture, name), path.join(dir, name));
  }
  fs.cpSync(path.join(fixture, "01-知识库"), path.join(dir, "01-知识库"), { recursive: true });
  fs.copyFileSync(path.join(fixture, "03-意图.json"), path.join(dir, "03-意图.json"));
  fs.copyFileSync(path.join(fixture, "04-后台提示词.json"), path.join(dir, "04-后台提示词.json"));
  fs.writeFileSync(path.join(dir, "02-热词.txt"), "这是一个超过十个字的热词\n");
  const preview = await loadVoiceAgentPreview({ packPath: dir });
  assert.equal(preview.canUpload, false);
  assert.ok(preview.issues.some((item) => item.code === "E-VOICE-043"));
});

test("自称空着时不会把下一行当成自称", () => {
  const agent = parseAgentConfig(`
- 智能体名称：示例品牌助手
- 企业对外名称：示例品牌
- 智能体对外自称：
- 智能体角色：业务顾问
- 业务场景：新客开发
- 目标：添加微信
`);
  assert.equal(agent.selfName, "");
  assert.equal(agent.role, "业务顾问");
});

test("zip 包也能找到内层企业目录", async () => {
  const zip = new JSZip();
  const add = (relative: string) => {
    const filePath = path.join(fixture, relative);
    if (fs.statSync(filePath).isDirectory()) {
      for (const name of fs.readdirSync(filePath)) add(path.join(relative, name));
      return;
    }
    zip.file(`voice-agent/示例品牌/${relative.replaceAll(path.sep, "/")}`, fs.readFileSync(filePath));
  };
  for (const name of fs.readdirSync(fixture)) add(name);
  const zipPath = path.join(os.tmpdir(), `voice-agent-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
  const preview = await loadVoiceAgentPreview({ packPath: zipPath });
  assert.equal(preview.canUpload, true, preview.issues.map((item) => item.message).join("；"));
  assert.equal(preview.pack?.companyName, "示例品牌");
});
