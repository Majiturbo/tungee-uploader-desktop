#!/bin/zsh
# Renders development screenshots into mac/shots. Usage: mac/scripts/shots.sh [name ...]
set -uo pipefail
cd "$(dirname "$0")/../.."
export TUNGEE_DEV_ROOT=$PWD
export TUNGEE_NODE=${TUNGEE_NODE:-/Users/mazekun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}
APP="mac/${BUNDLE:-build/探迹话术上传助手.app}/Contents/MacOS/TungeeUploader"
# Fictional demo data only, never a real customer: build it with mac/scripts/demo-data.cjs.
W="${WORKBOOK:-/tmp/tungee-demo/示例话术.xlsx}"
A="${AUDIO:-/tmp/tungee-demo/audio}"
[[ -f "$W" && -d "$A" ]] || { echo "missing demo data: node mac/scripts/demo-data.cjs <filled template.xlsx> <real company name>"; exit 1; }
mkdir -p mac/shots
files=(--workbook "$W" --audio "$A" --name 示例话术)
data=($files --step checkup)
all=(empty-light empty-dark import-ready checkup-light checkup-dark checkup-bare intent-light intent-dark intent-scheduled upload-ready upload-running upload-running-dark sheet-choice sheet-few sheet-auto sheet-hint-dark sheet-match sheet-review)

for name in ${@:-$all}; do
  case $name in
    empty-light) args=(--light) ;;
    empty-dark) args=(--dark) ;;
    checkup-light) args=(--light $data) ;;
    checkup-dark) args=(--dark $data) ;;
    sheet-choice) args=(--light $data --sheet checkup --tab choice) ;;
    sheet-few) args=(--light $data --sheet checkup --tab few --delay 60) ;;
    sheet-qa) args=(--light $data --sheet checkup --tab qa --delay 120) ;;
    sheet-qa-dark) args=(--dark $data --sheet checkup --tab qa --delay 120) ;;
    sheet-auto) args=(--light $data --sheet checkup --tab auto) ;;
    sheet-hint-dark) args=(--dark $data --sheet checkup --tab hint) ;;
    sheet-match) args=(--light $data --sheet match) ;;
    sheet-match-all) args=(--light $data --sheet match --tab all) ;;
    sheet-match-dark) args=(--dark $data --sheet match --tab all) ;;
    sheet-review) args=(--light $data --sheet review) ;;
    import-ready) args=(--light $files) ;;
    checkup-bare) args=(--light $data --no-inspector) ;;
    intent-light) args=(--light $files --step intent) ;;
    intent-dark) args=(--dark $files --step intent) ;;
    intent-scheduled) args=(--light $files --step intent --schedule) ;;
    upload-ready) args=(--light $files --step upload) ;;
    upload-running) args=(--light $files --step upload --simulate) ;;
    upload-running-dark) args=(--dark $files --step upload --simulate --no-inspector) ;;
    upload-resume) args=(--light $files --step upload --resume) ;;
    upload-rename-dark) args=(--dark $files --step upload --rename) ;;
    guide-resume) args=(--light $files --step upload --resume --guide) ;;
    fill-[1-4]) args=(--light --sheet guide --page "${name#fill-}" --delay 3) ;;
    fill-3-dark) args=(--dark --sheet guide --page 3 --delay 3) ;;
    settings) args=(--light --sheet settings --delay 4) ;;
    settings-dark) args=(--dark --sheet settings --delay 4) ;;
    guide-empty) args=(--light --guide) ;;
    guide-name) args=(--light --workbook "$W" --audio "$A" --guide) ;;
    guide-checkup) args=(--light $data --guide --delay 4) ;;
    guide-intent) args=(--light $files --step intent --guide --delay 4) ;;
    guide-upload-dark) args=(--dark $files --step upload --guide --delay 4) ;;
    modify-import) args=(--light --mode modify $files) ;;
    modify-checkup) args=(--light --mode modify $data) ;;
    compare-running) args=(--light --mode modify $files --step comparing) ;;
    compare-ready) args=(--light --mode modify $files --step compare) ;;
    compare-ready-dark) args=(--dark --mode modify $files --step compare) ;;
    modify-ready) args=(--light --mode modify $files --step modify) ;;
    modify-running) args=(--light --mode modify $files --step modify --simulate) ;;
    modify-done-dark) args=(--dark --mode modify $files --step modify --done) ;;
    dot-frame) args=(--light $data --dot 3 --detail --delay ${DELAY:-1.3}) ;;
    dot-close-frame) args=(--light $data --dot 3 --detail --close --delay ${DELAY:-2.3}) ;;
    dot-peek) args=(--light $data --dot 3 --delay 3) ;;
    dot-detail) args=(--light $data --dot 3 --detail --delay 3) ;;
    dot-detail-dark) args=(--dark $data --dot 14 --detail --delay 3) ;;
    dot-missing) args=(--light $data --dot 58 --detail --delay 3) ;;
    dot-modify) args=(--light --mode modify $data --dot 3 --detail --delay 3) ;;
    guide-modify) args=(--light --mode modify $files --step compare --guide --delay 4) ;;
    tour-dark-*) args=(--dark --tour ${name#tour-dark-}) ;;
    tour-*) args=(--light --tour ${name#tour-}) ;;
    *) echo "unknown scene: $name"; continue ;;
  esac
  perl -e "alarm 150; exec @ARGV" "$APP" "${args[@]}" --shot "$PWD/mac/shots/$name.png" 2>&1 | grep '^shot'
  echo "$name: $?"
done
