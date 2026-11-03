#!/bin/zsh
# Builds the SwiftUI app into mac/build/探迹话术上传助手.app for local runs.
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c "${CONFIG:-debug}" 2>&1 | grep -E "error|warning: unre|Compiling|Build complete" || true
BIN="$(swift build -c "${CONFIG:-debug}" --show-bin-path)/TungeeUploader"
[[ -x "$BIN" ]] || { echo "build failed"; exit 1; }

APP="${BUNDLE:-build/探迹话术上传助手.app}"
mkdir -p "$(dirname "$APP")"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# SwiftPM records the deployment target as the SDK version, which makes macOS 26+ run the app
# in compatibility mode without Liquid Glass. Stamp the real SDK version.
xcrun vtool -set-build-version macos 14.0 "$(xcrun --show-sdk-version)" -replace \
  -output "$APP/Contents/MacOS/TungeeUploader" "$BIN"

if [[ ! -f build/AppIcon.icns ]]; then
  iconutil -c icns ../resources/icon.iconset -o build/AppIcon.icns
fi
cp build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

xcrun metal -target air64-apple-macos14.0 -c Shaders/Genie.metal -o build/Genie.air
xcrun metallib build/Genie.air -o "$APP/Contents/Resources/Genie.metallib"

VERSION="$(node -p 'require("../package.json").version' 2>/dev/null || echo 2.0.0)"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>探迹话术上传助手</string>
  <key>CFBundleDisplayName</key><string>探迹话术上传助手</string>
  <key>CFBundleIdentifier</key><string>com.tungee.uploader</string>
  <key>CFBundleExecutable</key><string>TungeeUploader</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>TungeeDevRoot</key><string>$(cd .. && pwd)</string>
  <key>TungeeDevNode</key><string>${TUNGEE_NODE:-/Users/mazekun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "$APP"
