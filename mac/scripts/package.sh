#!/bin/zsh
# Packages the SwiftUI app with Node, the sidecar, its production modules, the template and the local models,
# then zips it into release/Tungee-Uploader-<version>-macOS-arm64.zip.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"
NODE="${TUNGEE_NODE:-/Users/mazekun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
export PATH="$(dirname "$NODE"):$PATH"
VERSION="$(node -p 'require("../package.json").version')"
LLM_FILE="Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
STAGE="build/package"
APP="$STAGE/探迹话术上传助手.app"
RES="$APP/Contents/Resources"
ZIP="$ROOT/release/Tungee-Uploader-$VERSION-macOS-arm64.zip"

echo "== 构建 sidecar"
(cd "$ROOT" && pnpm -s build >/dev/null)

echo "== 构建 App"
rm -rf "$STAGE"
mkdir -p "$STAGE"
CONFIG=release BUNDLE="$APP" scripts/dev-bundle.sh >/dev/null
/usr/libexec/PlistBuddy -c "Delete :TungeeDevRoot" -c "Delete :TungeeDevNode" \
  -c "Add :LSApplicationCategoryType string public.app-category.business" \
  -c "Add :NSHumanReadableCopyright string Copyright © 2026 马德槐" "$APP/Contents/Info.plist"

echo "== 安装运行依赖"
DEPS="$STAGE/deps"
mkdir -p "$DEPS"
node -e '
  const pkg = require(process.argv[1]);
  const keep = ["exceljs", "jszip", "node-llama-cpp", "playwright", "sherpa-onnx-node"];
  const dependencies = Object.fromEntries(keep.map((name) => [name, pkg.dependencies[name]]));
  process.stdout.write(JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", dependencies }, null, 2));
' "$ROOT/package.json" > "$DEPS/package.json"
cp "$ROOT/pnpm-lock.yaml" "$DEPS/"
printf 'allowBuilds:\n  node-llama-cpp: false\nminimumReleaseAge: 0\n' > "$DEPS/pnpm-workspace.yaml"
(cd "$DEPS" && pnpm install --prod --prefer-offline --ignore-scripts --config.node-linker=hoisted --reporter=silent)
LLAMA="$DEPS/node_modules/node-llama-cpp/llama"
rm -rf "$LLAMA/llama.cpp" "$LLAMA/xpack" "$LLAMA/localBuilds" "$LLAMA/gitRelease.bundle"
[[ -d "$DEPS/node_modules/@node-llama-cpp/mac-arm64-metal" ]] || { echo "缺少 @node-llama-cpp/mac-arm64-metal"; exit 1; }
[[ -d "$DEPS/node_modules/sherpa-onnx-darwin-arm64" ]] || { echo "缺少 sherpa-onnx-darwin-arm64"; exit 1; }

echo "== 放入资源"
mkdir -p "$RES/app/out" "$RES/node/bin" "$RES/models/llm"
cp -R "$ROOT/out/main" "$RES/app/out/main"
rm -f "$RES/app/out/main/index.js"
cp "$DEPS/package.json" "$RES/app/package.json"
mv "$DEPS/node_modules" "$RES/app/node_modules"
cp "$NODE" "$RES/node/bin/node"
cp "$ROOT/resources/探迹话术标准模板_v1.0.xlsx" "$RES/"
cp "$ROOT/resources/语音Agent示例交付包.zip" "$RES/"
cp -R "$ROOT/.models/asr" "$RES/models/asr"
cp "$ROOT/.models/llm/$LLM_FILE" "$RES/models/llm/"
rm -rf "$DEPS"

xattr -cr "$APP" 2>/dev/null || true

echo "== 签名"
find "$RES/app/node_modules" -type f \( -name "*.node" -o -name "*.dylib" \) -exec codesign --force --sign - {} \; 2>/dev/null
codesign --force --sign - "$APP"
codesign --verify --strict "$APP"

echo "== 压缩"
mkdir -p "$ROOT/release"
rm -f "$ZIP.partial"
ditto -c -k --norsrc --noextattr --keepParent "$APP" "$ZIP.partial"
[[ -e "$ZIP" ]] && /usr/bin/trash "$ZIP"
mv "$ZIP.partial" "$ZIP"
du -sh "$APP" "$ZIP"

scripts/pkg.sh
