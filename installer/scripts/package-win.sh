#!/bin/bash
# Builds release-win/Tungee-Uploader-<version>-Windows-x64.zip:
#   探迹话术上传助手-<version>-Windows/
#   ├─ 安装探迹话术上传助手.exe   (the installer)
#   └─ 安装文件/                  (the unpacked app, copied by the installer)
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION=$(node -p "require('./package.json').version")
NAME="探迹话术上传助手-$VERSION-Windows"
OUT=release-win
ZIP="$OUT/Tungee-Uploader-$VERSION-Windows-x64.zip"
SEVEN_ZIP=$(find "$HOME/Library/Caches/electron-builder" -path "*7zip*/bin/7za" | head -1)
[ -x "$SEVEN_ZIP" ] || { echo "7za not found in the electron-builder cache" >&2; exit 1; }

python3 installer/scripts/assets.py
installer/scripts/fetch-win-ffmpeg.sh
pnpm exec electron-vite build
pnpm exec electron-builder --config electron-builder.win.yml --win dir --x64
pnpm exec electron-builder --projectDir installer --config electron-builder.yml --win portable --x64 -c.extraMetadata.version="$VERSION"

STAGE="$OUT/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/$NAME"
cp "$OUT/installer-build/TungeeUploaderBoot.exe" "$STAGE/$NAME/安装探迹话术上传助手.exe"
ditto "$OUT/win-unpacked" "$STAGE/$NAME/安装文件"

[ -e "$ZIP" ] && /usr/bin/trash "$ZIP"
# -mcu=on marks names as UTF-8 so Windows' own unzip shows the Chinese names correctly.
(cd "$STAGE" && "$SEVEN_ZIP" a -tzip -mx=5 -mcu=on "../$(basename "$ZIP")" "$NAME" >/dev/null)

/usr/bin/trash "$STAGE" "$OUT/win-unpacked" "$OUT/installer-build"
[ -e "$OUT/builder-debug.yml" ] && /usr/bin/trash "$OUT/builder-debug.yml"
ls -lh "$ZIP"
