#!/bin/bash
# 打包菜单栏 App（ad-hoc 签名）。
#
#   ./scripts/bundle.sh            生成 build/AIHUD.app（带 build 戳）
#   ./scripts/bundle.sh --debug    用 debug 产物，出问题时可 attach
#
# 交付前必须重跑本脚本：`swift build` 只更新 .build/，不会更新 build/AIHUD.app。
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG=release
[ "${1:-}" = "--debug" ] && CONFIG=debug

swift build -c "$CONFIG" >/dev/null

OUT=build
BUNDLE=AIHUD
APPDIR="$OUT/$BUNDLE.app"
STAMP=$(date +%Y%m%d-%H%M%S)

rm -rf "$APPDIR"
mkdir -p "$APPDIR/Contents/MacOS" "$APPDIR/Contents/Resources"
cp ".build/$CONFIG/$BUNDLE" "$APPDIR/Contents/MacOS/$BUNDLE"

cat > "$APPDIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>AI HUD</string>
  <key>CFBundleDisplayName</key><string>AI HUD</string>
  <key>CFBundleExecutable</key><string>$BUNDLE</string>
  <key>CFBundleIdentifier</key><string>app.aihud.desktop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.$STAMP</string>
  <key>CFBundleVersion</key><string>$STAMP</string>
  <key>AIHUDBuildStamp</key><string>$STAMP</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

printf 'APPL????' > "$APPDIR/Contents/PkgInfo"
codesign --force --deep --sign - "$APPDIR" >/dev/null 2>&1
echo "built $APPDIR  (build $STAMP)"
