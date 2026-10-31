#!/usr/bin/env bash
# 一次性推送脚本：把本地 main 推到 https://github.com/j9kkk/AIHUD.git
#
# 凭据来源（二选一，都不会写进 git 配置）：
#   1. 交互输入：直接运行本脚本，按提示粘贴 PAT（不回显、不落盘）；
#   2. 文件：事先把 PAT 写入 /opt/data/.gh_token（chmod 600），再加 --from-file。
#
# 需要的 PAT 权限（Fine-grained）：仅选中 j9kkk/AIHUD 仓库，
#   Repository permissions → Contents: Read and write。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_URL="https://github.com/j9kkk/AIHUD.git"
TOKEN=""

cleanup() { TOKEN=""; }
trap cleanup EXIT

if [ "${1:-}" = "--from-file" ]; then
  TOKEN_FILE="/opt/data/.gh_token"
  [ -f "$TOKEN_FILE" ] || { echo "✗ 找不到 $TOKEN_FILE"; exit 1; }
  TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
else
  printf 'GitHub PAT（输入不回显，直接回车取消）: '
  read -rs TOKEN
  echo
fi

if [ -z "$TOKEN" ]; then
  echo "✗ 未提供 PAT，已取消"
  exit 1
fi

cd "$REPO_DIR"

echo "→ 远端：$REMOTE_URL"
echo "→ 分支：$(git branch --show-current)"
echo "→ 待推提交：$(git rev-list --count HEAD) 个"

# 用 askpass 临时喂凭据：不写 ~/.git-credentials，不出现在 ps 的参数里
ASKPASS="$(mktemp)"
cat > "$ASKPASS" <<'EOF'
#!/bin/sh
case "$1" in
  *Username*) echo "x-access-token" ;;
  *Password*) echo "$HERMES_GH_TOKEN" ;;
  *) echo "" ;;
esac
EOF
chmod 700 "$ASKPASS"

set +e
GIT_TERMINAL_PROMPT=0 \
GIT_ASKPASS="$ASKPASS" \
HERMES_GH_TOKEN="$TOKEN" \
  git push "$REMOTE_URL" "HEAD:main" 2>&1 | sed "s/${TOKEN}/***/g"
CODE=${PIPESTATUS[0]}
set -e

rm -f "$ASKPASS"

if [ "$CODE" -eq 0 ]; then
  git remote set-url origin "$REMOTE_URL" 2>/dev/null || git remote add origin "$REMOTE_URL"
  echo "✓ 推送成功。GitHub Actions 会在 push 到 main 后自动开始构建："
  echo "  https://github.com/j9kkk/AIHUD/actions"
else
  echo "✗ 推送失败（退出码 $CODE）。常见原因："
  echo "  · PAT 没勾 Contents: Read and write"
  echo "  · Fine-grained token 没选中 AIHUD 这个仓库"
  echo "  · 用了 classic token 但缺少 repo 权限"
  exit "$CODE"
fi
