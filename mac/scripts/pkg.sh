#!/bin/zsh
# Wraps the app that package.sh staged in build/package into an installer:
# release/Tungee-Uploader-<version>-macOS-arm64.pkg. It installs into /Applications, then opens the app.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"
NODE="${TUNGEE_NODE:-/Users/mazekun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"
VERSION="$("$NODE" -p 'require("../package.json").version')"
STAGE="build/package"
APP_NAME="探迹话术上传助手.app"
WORK="build/pkg"
PKG="$ROOT/release/Tungee-Uploader-$VERSION-macOS-arm64.pkg"

[[ -d "$STAGE/$APP_NAME" ]] || { echo "先运行 scripts/package.sh"; exit 1; }
[[ "$(ls -A "$STAGE")" == "$APP_NAME" ]] || { echo "$STAGE 里除了 App 还有别的文件"; exit 1; }

rm -rf "$WORK"
mkdir -p "$WORK/resources"

# Always install into /Applications, even when another copy with the same bundle id sits elsewhere.
pkgbuild --analyze --root "$STAGE" "$WORK/components.plist" >/dev/null
plutil -replace 0.BundleIsRelocatable -bool NO "$WORK/components.plist"

echo "== 打安装包（压缩要几分钟）"
# Leave extended attributes out of the payload: a quarantine flag on any file would follow it onto the user's Mac.
xattr -cr "$STAGE/$APP_NAME" Installer 2>/dev/null || true
COPYFILE_DISABLE=1 pkgbuild --root "$STAGE" --component-plist "$WORK/components.plist" --install-location /Applications \
  --identifier com.tungee.uploader --version "$VERSION" --scripts Installer/scripts --ownership recommended \
  "$WORK/app.pkg" >/dev/null

cp Installer/welcome.html "$WORK/resources/"
cat > "$WORK/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>探迹话术上传助手</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64"/>
  <domains enable_localSystem="true"/>
  <allowed-os-versions><os-version min="14.0"/></allowed-os-versions>
  <choices-outline><line choice="app"/></choices-outline>
  <choice id="app" visible="false"><pkg-ref id="com.tungee.uploader"/></choice>
  <pkg-ref id="com.tungee.uploader" version="$VERSION" onConclusion="none">app.pkg</pkg-ref>
</installer-gui-script>
XML

mkdir -p "$ROOT/release"
rm -f "$PKG.partial"
productbuild --distribution "$WORK/distribution.xml" --resources "$WORK/resources" --package-path "$WORK" "$PKG.partial" >/dev/null
[[ -e "$PKG" ]] && /usr/bin/trash "$PKG"
mv "$PKG.partial" "$PKG"
rm -rf "$WORK"
du -sh "$PKG"
