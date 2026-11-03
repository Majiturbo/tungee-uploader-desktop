#!/bin/zsh
# Renders development screenshots into mac/shots. Usage: mac/scripts/shots.sh [name ...]
set -uo pipefail
cd "$(dirname "$0")/../.."
export TUNGEE_DEV_ROOT=$PWD
export TUNGEE_NODE=${TUNGEE_NODE:-/Users/mazekun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}
APP="mac/${BUNDLE:-build/探迹话术上传助手.app}/Contents/MacOS/TungeeUploader"
W="${WORKBOOK:-/Users/mazekun/Desktop/有佳财税标准模板_v1.0 (1).xlsx}"
A="${AUDIO:-/tmp/mac-shot-audio}"
mkdir -p mac/shots
data=(--workbook "$W" --audio "$A" --name 有佳财税 --step checkup)
all=(empty-light empty-dark checkup-light checkup-dark sheet-choice sheet-few sheet-auto sheet-hint-dark sheet-match sheet-review)

for name in ${@:-$all}; do
  case $name in
    empty-light) args=(--light) ;;
    empty-dark) args=(--dark) ;;
    checkup-light) args=(--light $data) ;;
    checkup-dark) args=(--dark $data) ;;
    sheet-choice) args=(--light $data --sheet checkup --tab choice) ;;
    sheet-few) args=(--light $data --sheet checkup --tab few --delay 12) ;;
    sheet-auto) args=(--light $data --sheet checkup --tab auto) ;;
    sheet-hint-dark) args=(--dark $data --sheet checkup --tab hint) ;;
    sheet-match) args=(--light $data --sheet match) ;;
    sheet-review) args=(--light $data --sheet review) ;;
    concept-light) args=(--light $data --concept --delay 4) ;;
    concept-dark) args=(--dark $data --concept --delay 4) ;;
    concept-bare) args=(--light $data --concept --no-inspector --delay 4) ;;
    concept-bare-dark) args=(--dark $data --concept --no-inspector --delay 4) ;;
    *) echo "unknown scene: $name"; continue ;;
  esac
  perl -e "alarm 60; exec @ARGV" "$APP" "${args[@]}" --shot "$PWD/mac/shots/$name.png" 2>&1 | grep '^shot'
  echo "$name: $?"
done
