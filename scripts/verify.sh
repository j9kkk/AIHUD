#!/usr/bin/env bash
# AI HUD 统一验证入口。
# 用法：bash scripts/verify.sh          全部检查
#       bash scripts/verify.sh --quick  跳过 UI 编译与文档检查
# 退出码 0 = 全绿；非 0 = 有失败项（逐项打印）
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

BIN="$ROOT/node_modules/.bin"
PASS=0
FAIL=0
declare -a RESULTS

run() {
  local name="$1"; shift
  local out
  out=$("$@" 2>&1)
  local code=$?
  if [ $code -eq 0 ]; then
    PASS=$((PASS + 1))
    RESULTS+=("✓ $name")
    printf '✓ %s\n' "$name"
  else
    FAIL=$((FAIL + 1))
    RESULTS+=("✗ $name")
    printf '✗ %s\n' "$name"
    printf '%s\n' "$out" | tail -12 | sed 's/^/    /'
  fi
}

echo "== AI HUD 验证 =="
echo "root: $ROOT"
echo

# 1. 类型检查
run "core 类型检查 (tsc -p core)" "$BIN/tsc" -p core --noEmit
if [ $QUICK -eq 0 ]; then
  run "ui 类型检查 (tsc -p ui)" "$BIN/tsc" -p ui --noEmit
fi

# 2. 领域内核测试
echo
TEST_OUT=$("$BIN/vitest" run --root core 2>&1)
TEST_CODE=$?
if [ $TEST_CODE -eq 0 ]; then
  PASS=$((PASS + 1)); RESULTS+=("✓ core 测试")
  echo "✓ core 测试：$(printf '%s' "$TEST_OUT" | grep -E 'Tests +[0-9]+ passed' | tail -1 | sed 's/^ *//')"
else
  FAIL=$((FAIL + 1)); RESULTS+=("✗ core 测试")
  echo "✗ core 测试"
  printf '%s\n' "$TEST_OUT" | grep -E "FAIL|✕|Error" | head -10 | sed 's/^/    /'
fi

# 3. 安全扫描
echo
run "凭据零明文 (tests/security-scan.sh)" bash tests/security-scan.sh

# 4. 对比度令牌
if [ $QUICK -eq 0 ]; then
  run "对比度与字号 (tests/contrast-sweep.mjs)" node tests/contrast-sweep.mjs
fi

# 5. Rust 壳层静态自检
echo
run "Rust 壳层结构 (scripts/check-rust-shell.py)" python3 scripts/check-rust-shell.py

# 6. 文档一致性
if [ $QUICK -eq 0 ]; then
  run "文档一致性 (scripts/check-doc.py)" python3 scripts/check-doc.py
fi

echo
echo "== 汇总 =="
printf '%s\n' "${RESULTS[@]}"
echo
echo "通过 $PASS / 失败 $FAIL"
echo
echo "未验证项（本环境无法执行，不计入失败）："
echo "  · src-tauri 的 cargo build / 签名 / 公证（容器无 rustc、非 macOS）"
echo "  · 真实端点联调（本机无任何渠道登录态，fixtures 为脱敏构造样本）"
echo "  · 材质在浅色壁纸下的对比度（需 macOS 实机截图取样）"
[ $FAIL -eq 0 ] && exit 0 || exit 1
