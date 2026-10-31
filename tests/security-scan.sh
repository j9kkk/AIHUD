#!/usr/bin/env bash
# 凭据零明文扫描：fixtures / core / ui / src-tauri / docs 不得出现形如真实 token 的串。
# 用法：bash tests/security-scan.sh   退出码 0 = 干净；1 = 命中
set -uo pipefail
cd "$(dirname "$0")/.."

PATTERNS=(
  'sk-[A-Za-z0-9]{20,}'                       # OpenAI 风格
  'sk-ant-[A-Za-z0-9_-]{20,}'                 # Anthropic 风格
  'ghp_[A-Za-z0-9]{30,}'                      # GitHub PAT
  'Bearer [A-Za-z0-9._-]{25,}'                # 裸 Bearer 串
  '"access_token"[[:space:]]*:[[:space:]]*"[A-Za-z0-9._-]{20,}"'
  '"refresh_token"[[:space:]]*:[[:space:]]*"[A-Za-z0-9._-]{20,}"'
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'  # JWT
)

TARGETS=(fixtures core ui src-tauri docs prototype tests scripts)
FAIL=0
for pat in "${PATTERNS[@]}"; do
  hits=$(grep -rInE --include='*.json' --include='*.ts' --include='*.rs' --include='*.md' \
         --include='*.html' --include='*.css' --include='*.sh' --include='*.py' --include='*.mjs' \
         "$pat" "${TARGETS[@]}" 2>/dev/null \
         | grep -vE 'REDACTED|<redacted>|REDACT|sk-xxxxxxxx|your-|示例|placeholder' || true)
  if [ -n "$hits" ]; then
    echo "✗ 命中规则 $pat"
    echo "$hits" | head -5
    FAIL=1
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "✓ security-scan: 0 处 token 明文（7 条规则 × $(echo ${#TARGETS[@]}) 个目录）"
fi
exit "$FAIL"
