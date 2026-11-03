#!/bin/bash
# Downloads a Windows ffmpeg.exe so Mac-hosted electron-builder can pack it.
# Chromium's decodeAudioData cannot read typical iPhone 语音备忘录 m4a files on Windows.
set -euo pipefail
cd "$(dirname "$0")/../.."
DEST="resources/ffmpeg/win32-x64/ffmpeg.exe"
if [ -s "$DEST" ] && [ "$(head -c 2 "$DEST")" = "MZ" ]; then
  echo "using $DEST"
  exit 0
fi

TAG="b6.1.1"
URL="https://github.com/eugeneware/ffmpeg-static/releases/download/${TAG}/ffmpeg-win32-x64.gz"
mkdir -p "$(dirname "$DEST")"
TMP=$(mktemp)
curl -fsSL "$URL" -o "$TMP"
gzip -dc "$TMP" > "$DEST"
rm -f "$TMP"
chmod +x "$DEST"
[ "$(head -c 2 "$DEST")" = "MZ" ] || { echo "downloaded ffmpeg.exe is not a Windows binary" >&2; rm -f "$DEST"; exit 1; }
echo "saved $DEST ($(du -h "$DEST" | awk '{print $1}'))"
