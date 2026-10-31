/**
 * Claude 刷新计划构建 (Claude Refresh Plan Creator)
 * 契约规范：docs/ARCHITECTURE.md（第 4.3 节刷新计划、第 6.5 节 token 刷新时机）
 *
 * 核心设计：
 * 纯函数声明刷新意图，真实写回由 Rust 在密文域执行，明文不出 Rust 堆。
 */

import type { RefreshContext, RefreshOutcome, RefreshPlan } from '../driver.js';

/**
 * 构建 Claude Token 刷新计划。
 *
 * 规则：
 * 1. 手工 token (manual_token) 无刷新能力，直接返回 unsupported: true；
 * 2. 其余鉴权流（oauth_pkce / cli_session_reuse）返回标准 RefreshPlan。
 */
export function createClaudeRefreshPlan(ctx: RefreshContext): RefreshOutcome {
  if (ctx.lease.flow === 'manual_token') {
    return { ok: false, unsupported: true };
  }

  const plan: RefreshPlan = {
    request: {
      method: 'POST',
      url: 'https://api.anthropic.com/api/oauth/token',
      headers: {
        'content-type': 'application/json',
      },
      auth: 'lease',
      body: JSON.stringify({ grant_type: 'refresh_token' }),
      timeout_ms: 10000,
      max_body_bytes: 262144,
    },
    patch: {
      fields: [
        {
          target: 'access_token',
          from: 'access_token',
          transform: 'identity',
        },
        {
          target: 'refresh_token',
          from: 'refresh_token',
          transform: 'identity',
        },
        {
          target: 'expires_at',
          from: 'expires_in',
          transform: 'epoch_ms_from_now',
        },
      ],
      store_mode: 'merge',
    },
  };

  return { ok: true, plan };
}
