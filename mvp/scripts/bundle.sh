#!/bin/bash
# 打两个 MVP 的 .app（ad-hoc 签名），用法: ./bundle.sh [A|B|all]
set -euo pipefail
cd "$(dirname "$0")/.."
swift build -c release >/dev/null
OUT=build
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
build_one() {
  local target="$1" name="$2" bundle="$3"
  local dir="$OUT/$bundle.app"
  rm -rf "$dir"
  mkdir -p "$dir/Contents/MacOS" "$dir/Contents/Resources"
  cp ".build/release/$target" "$dir/Contents/MacOS/$bundle"
  cat > "$dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleExecutable</key><string>$bundle</string>
  <key>CFBundleIdentifier</key><string>app.aihud.mvp.$(echo "$bundle" | tr 'A-Z' 'a-z')</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.$STAMP</string>
  <key>CFBundleVersion</key><string>$STAMP</string>
  <key>AIHUDBuildStamp</key><string>$STAMP</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
  printf 'APPL????' > "$dir/Contents/PkgInfo"
  codesign --force --deep --sign - "$dir" >/dev/null 2>&1
  echo "built $dir  (build $STAMP)"
}
case "${1:-all}" in
  A) build_one MVPA "AI HUD A" "AIHUDA" ;;
  B) build_one MVPB "AI HUD B" "AIHUDB" ;;
  AB) build_one MVPA "AI HUD A" "AIHUDA"; build_one MVPB "AI HUD B" "AIHUDB" ;;
  *) build_one MVPM "AI HUD" "AIHUD" ;;      # 合并版：模块/列表/圆环 + A 的详情
esac
