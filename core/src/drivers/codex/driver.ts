/**
 * Codex 渠道驱动实现 (Codex Channel Driver)
 * 契约规范：docs/ARCHITECTURE.md（第 4 章驱动接口契约、第 5.3 节 codex 模型级窗口）
 */

import type {
  ChannelDriver,
  DriverCapabilities,
  FetchContext,
  FetchOutcome,
  HttpRequestSpec,
  PollPolicy,
  RefreshContext,
  RefreshOutcome,
} from '../driver.js';
import {
  assertSafeHeaders,
  computeNextDelayMs,
  CredentialLeakError,
  DriverError,
  driverError,
  parseRetryAfter,
} from '../driver.js';
import { normalizeCodexResponse } from './normalize.js';

export const CODEX_POLL_POLICY: PollPolicy = {
  base_interval_secs: 300,
  min_interval_secs: 120,
  max_interval_secs: 900,
  idle_interval_secs: 900,
  jitter_ratio: 0.1,
  reset_watch_secs: 900,
  backoff: {
    base_secs: 60,
    factor: 2,
    max_secs: 3600,
    respect_retry_after: true,
    retry_after_clamp: [5, 7200],
  },
  next_delay_ms(retryAfter, consecutive, now) {
    return computeNextDelayMs(CODEX_POLL_POLICY, retryAfter, consecutive, now);
  },
};

export const CODEX_CAPABILITIES: DriverCapabilities = {
  can_refresh: false,
  region_scoped: false,
  allowed_origins: ['https://chatgpt.com'],
  cli_commands: [],
  max_windows_for_card: 2,
};

export class CodexDriver implements ChannelDriver {
  readonly provider = 'codex' as const;
  readonly schema_version = 'codex.v1';
  readonly supported_auth_flows = [
    'cli_session_reuse',
    'oauth_pkce',
    'manual_token',
  ] as const;
  readonly poll_policy = CODEX_POLL_POLICY;
  readonly capabilities = CODEX_CAPABILITIES;
  readonly default_visual = 'dual_sliding_window' as const;

  async fetch_snapshot(ctx: FetchContext): Promise<FetchOutcome> {
    try {
      assertSafeHeaders(ctx.lease.extra_headers);

      // ARCHITECTURE.md §4.5: 额外要求 lease.extra_headers['ChatGPT-Account-Id']，缺失时直接返回 auth 错误
      const accountId = ctx.lease.extra_headers?.['ChatGPT-Account-Id'];
      if (!accountId || accountId.trim() === '') {
        return {
          ok: false,
          error: driverError('auth_expired', {
            http_status: 401,
            upstream_code: 'missing_chatgpt_account_id',
            message: '请用 Codex CLI 重新登录',
          }),
        };
      }

      const reqSpec: HttpRequestSpec = {
        method: 'GET',
        url: 'https://chatgpt.com/backend-api/wham/usage',
        headers: {
          'ChatGPT-Account-Id': accountId,
        },
        auth: 'lease',
        timeout_ms: 10000,
        max_body_bytes: 262144,
      };

      assertSafeHeaders(reqSpec.headers);

      const reply = await ctx.http.request(reqSpec);

      // 401 凭据失效
      if (reply.status === 401) {
        return {
          ok: false,
          error: driverError('auth_expired', {
            http_status: 401,
            upstream_code: 'auth_expired',
            message: 'Codex authentication expired or invalid session',
          }),
        };
      }

      // 429 限流
      if (reply.status === 429) {
        const retryHeader = reply.headers['retry-after'];
        const retrySecs = parseRetryAfter(retryHeader, ctx.clock.now());
        return {
          ok: false,
          error: driverError('rate_limited', {
            http_status: 429,
            upstream_code: 'rate_limited',
            retry_after_secs: retrySecs,
            message: 'Codex API rate limit exceeded',
          }),
        };
      }

      // HTML 网关页检测（如 502/504 网关页）
      const contentType = (reply.headers['content-type'] ?? '').toLowerCase();
      const trimmedBody = (reply.body_text ?? '').trim();
      if (
        contentType.includes('text/html') ||
        trimmedBody.startsWith('<html') ||
        trimmedBody.startsWith('<!doctype')
      ) {
        return {
          ok: false,
          error: driverError('parse_error', {
            http_status: reply.status,
            upstream_code: 'parse_error',
            message: 'HTML gateway response received instead of JSON',
          }),
        };
      }

      // 5xx 服务端异常
      if (reply.status >= 500) {
        return {
          ok: false,
          error: driverError('http', {
            http_status: reply.status,
            upstream_code: `HTTP_${reply.status}`,
            message: `Codex server returned status ${reply.status}`,
          }),
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(reply.body_text);
      } catch {
        return {
          ok: false,
          error: driverError('parse_error', {
            http_status: reply.status,
            upstream_code: 'parse_error',
            message: 'Failed to parse JSON body from Codex API',
          }),
        };
      }

      if (typeof parsed !== 'object' || parsed === null) {
        return {
          ok: false,
          error: driverError('parse_error', {
            http_status: reply.status,
            upstream_code: 'parse_error',
            message: 'JSON response body is not an object',
          }),
        };
      }

      if (reply.status !== 200) {
        return {
          ok: false,
          error: driverError('http', {
            http_status: reply.status,
            upstream_code: `HTTP_${reply.status}`,
            message: `Unexpected HTTP status ${reply.status}`,
          }),
        };
      }

      const outcome = normalizeCodexResponse(parsed);
      if (!outcome || outcome.reading.windows.length === 0) {
        return {
          ok: false,
          error: driverError('parse_error', {
            http_status: reply.status,
            upstream_code: 'parse_error',
            message: 'No valid quota windows could be extracted from response',
          }),
        };
      }

      return {
        ok: true,
        reading: outcome.reading,
        observed_at: ctx.clock.now(),
        diagnostics: {
          requests: 1,
          schema_warnings: outcome.warnings,
        },
      };
    } catch (err) {
      if (err instanceof CredentialLeakError) {
        throw err;
      }
      return {
        ok: false,
        error: driverError('network', {
          message: err instanceof Error ? err.message : 'Network failure',
        }),
      };
    }
  }

  async refresh_token(_ctx: RefreshContext): Promise<RefreshOutcome> {
    // Codex 凭据由 CLI 维护或手工录入，无驱动侧刷新通道
    return { ok: false, unsupported: true };
  }
}
