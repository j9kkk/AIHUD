/**
 * AI HUD 敏感信息脱敏模块 (Redaction Utilities)
 * 契约规范：docs/ARCHITECTURE.md（第 1 章硬规则 4 零明文日志、第 3.6 节 AccountIdentity）
 *
 * 硬性要求：保证输出绝不包含任何 token / 凭据明文子串。
 */

/**
 * 邮箱脱敏：保留首字母与完整域名，用户名其余部分替换为 '***'。
 * 格式严格对应契约定义：'a***@corp.com'。
 *
 * @param email 原始邮箱
 * @returns 脱敏后邮箱字符串或 null
 */
export function redactEmail(email: string | null | undefined): string | null {
  if (email === null || email === undefined) {
    return null;
  }
  const trimmed = email.trim();
  if (trimmed === '') {
    return '';
  }

  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    // 非标准邮箱，全量掩码
    return '***';
  }

  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex); // 包含 '@'

  const firstChar = localPart.charAt(0);
  return `${firstChar}***${domainPart}`;
}

/**
 * Token 凭据脱敏：
 * 保证输出绝不包含任何 token 明文子串，输出标准形式如 '<redacted>' 或 'Bearer <redacted>'。
 *
 * @param token 原始 token 或 Authorization 头
 * @returns 脱敏字符串或 null
 */
export function redactToken(token: string | null | undefined): string | null {
  if (token === null || token === undefined) {
    return null;
  }
  const trimmed = token.trim();
  if (trimmed === '') {
    return '';
  }

  // 若带 Bearer 前缀，保留 Bearer 前缀，其余密文彻底脱敏
  if (/^bearer\s+/i.test(trimmed)) {
    const rawVal = trimmed.replace(/^bearer\s+/i, '');
    return `Bearer <redacted:${rawVal.length}>`;
  }

  return `<redacted:${trimmed.length}>`;
}

/**
 * URL 脱敏：
 * 移除 user:pass 基础认证信息，清除或掩码所有 Query 查询参数与 Hash 片段，
 * 彻底消除潜在携带在 URL 中的 token、sessionKey、code、api_key 等敏感子串。
 *
 * @param rawUrl 原始 URL 字符串
 * @returns 脱敏后的安全 URL 字符串或 null
 */
export function redactUrl(rawUrl: string | null | undefined): string | null {
  if (rawUrl === null || rawUrl === undefined) {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (trimmed === '') {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    // 清除 HTTP Basic Auth 凭据
    parsed.username = '';
    parsed.password = '';

    // 查询参数全部掩码其值，保证无 token 子串留存
    const keys = Array.from(parsed.searchParams.keys());
    for (const key of keys) {
      parsed.searchParams.set(key, '<redacted>');
    }

    // 清除 hash 片段
    parsed.hash = '';

    // 路径中若含有常见密钥模式（如 sk-..., eyJ...），彻底抹除
    parsed.pathname = parsed.pathname.replace(
      /(sk-[a-zA-Z0-9_-]+|eyJ[a-zA-Z0-9_.-]+)/g,
      '<redacted>'
    );

    return parsed.toString();
  } catch {
    // 非标准绝对 URL，以正则移除 query 和 hash，并脱敏敏感特征
    let safe = trimmed.split('?')[0]?.split('#')[0] ?? '';
    safe = safe.replace(/\/\/([^@]+)@/, '//');
    safe = safe.replace(/(sk-[a-zA-Z0-9_-]+|eyJ[a-zA-Z0-9_.-]+)/g, '<redacted>');
    return safe;
  }
}
