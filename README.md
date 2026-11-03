# 探迹话术上传助手

桌面端助手，用于批量导入、体检、意向整理，并把话术上传到探迹。当前版本 `3.0.0`。

- **Windows / 跨平台壳**：Electron + React（`src/`）
- **macOS 原生**：SwiftUI（`mac/Sources/`）
- **能力**：Excel 话术模板、本地 ASR、本地 Qwen3-4B、Chrome 自动化上传、语音 Agent 交付包导入

## 仓库里有什么 / 没有什么

| 会上传 | 不会上传（已进 `.gitignore`） |
| --- | --- |
| `src/`、`tests/`、`docs/`、`website/` | `node_modules/`（约 1GB） |
| `installer/` 安装器源码与资源 | `.models/`（ASR ≈79MB + LLM ≈2.3GB） |
| `mac/Sources`、`Package.swift`、打包脚本 | `out/`、`release/`、`release-win/` 构建与安装包 |
| `resources/` 图标、Excel 模板、示例交付包 | `mac/build/`、`mac/.build/`、截图 `mac/shots/` |
| 配置与锁文件（`package.json`、`pnpm-lock.yaml` 等） | `resources/ffmpeg/win32-x64/ffmpeg.exe`（约 79MB，可脚本拉取） |
| | `.DS_Store`、`.env`、密钥类文件 |

GitHub 单文件上限约 100MB，LLM 权重远超限制，因此模型与安装包一律本地准备，不进仓库。

## 环境要求

- Node.js 与 [pnpm](https://pnpm.io/)（仓库指定 `pnpm@11.16.0`）
- 打包 / 跑本地 AI：本机需准备 `.models/`（见下）
- Windows 打包：需要 `ffmpeg.exe`（见下）
- macOS 原生：Xcode / Swift toolchain

## 快速开始

```bash
pnpm install
pnpm dev          # Electron 开发
pnpm typecheck
pnpm test
pnpm build        # 产出 out/
```

### 本地模型（运行 / 打包前）

放到仓库根目录：

```text
.models/
  asr/
    model.int8.onnx
    silero_vad.onnx
    tokens.txt
  llm/
    Qwen3-4B-Instruct-2507-Q4_K_M.gguf
```

开发时主进程从 `.models/` 读；打包后会拷到应用 `Resources/models/`。

### Windows ffmpeg

```bash
bash installer/scripts/fetch-win-ffmpeg.sh
```

会下载到 `resources/ffmpeg/win32-x64/ffmpeg.exe`（该二进制已忽略，不提交）。

### 打包

```bash
pnpm package:mac          # Electron macOS
pnpm package:win          # Windows 标准版
pnpm package:win:lite     # Windows 轻量版
bash mac/scripts/package.sh   # macOS 原生包（需本地模型）
```

## 目录结构

```text
src/                 Electron 主进程 / preload / React UI / shared
mac/                 SwiftUI 原生版与打包脚本
installer/           Windows 安装器壳与打包脚本
resources/           图标、话术模板、语音 Agent 示例包
docs/                PRD 与流程说明
tests/               Node 测试
website/             介绍页静态资源
.models/             本地模型（不入库，需自备）
```

更多产品说明见 `docs/PRD-探迹话术上传助手-v2.0.md`、`docs/语音Agent配置-软件流程.md`。

## 许可与使用

内部工具。作者：马德槐。请勿将含真实客户资料的交付包或账号凭证提交到仓库。
