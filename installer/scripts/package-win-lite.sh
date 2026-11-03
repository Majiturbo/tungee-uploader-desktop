#!/bin/bash
# Builds release-win/Tungee-Uploader-<version>-Windows-x64-Lite.zip:
#   探迹话术上传助手轻量版-<version>-Windows/
#   ├─ 安装探迹话术上传助手轻量版.exe
#   └─ 安装文件/
set -euo pipefail
cd "$(dirname "$0")/../.."

export TUNGE_EDITION=lite
export PATH="$PWD/node_modules/.bin:$PATH"
VERSION=$(node -p "require('./package.json').version")
NAME="探迹话术上传助手轻量版-$VERSION-Windows"
OUT=release-win
ZIP="$OUT/Tungee-Uploader-$VERSION-Windows-x64-Lite.zip"
SEVEN_ZIP=$(find "$HOME/Library/Caches/electron-builder" -path "*7zip*/bin/7za" | head -1)
[ -x "$SEVEN_ZIP" ] || { echo "7za not found in the electron-builder cache" >&2; exit 1; }

python3 installer/scripts/assets.py
installer/scripts/fetch-win-ffmpeg.sh
electron-vite build
electron-builder --config electron-builder.win.lite.yml --win dir --x64
electron-builder --projectDir installer --config electron-builder.yml --win portable --x64 \
  -c.extraMetadata.version="$VERSION" \
  -c.extraMetadata.edition=lite \
  -c.productName="安装探迹话术上传助手轻量版" \
  -c.win.legalTrademarks="探迹话术上传助手轻量版" \
  -c.portable.splashImage=build/splash-lite.bmp

STAGE="$OUT/stage-lite"
rm -rf "$STAGE"
mkdir -p "$STAGE/$NAME"
cp "$OUT/installer-build/TungeeUploaderBoot.exe" "$STAGE/$NAME/安装探迹话术上传助手轻量版.exe"
ditto "$OUT/win-unpacked" "$STAGE/$NAME/安装文件"

[ -e "$ZIP" ] && /usr/bin/trash "$ZIP"
(cd "$STAGE" && "$SEVEN_ZIP" a -tzip -mx=5 -mcu=on "../$(basename "$ZIP")" "$NAME" >/dev/null)

/usr/bin/trash "$STAGE" "$OUT/win-unpacked" "$OUT/installer-build"
[ -e "$OUT/builder-debug.yml" ] && /usr/bin/trash "$OUT/builder-debug.yml"
ls -lh "$ZIP"
