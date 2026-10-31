/**
 * Gemini 渠道驱动实现 (Gemini Driver)
 * 契约规范：docs/ARCHITECTURE.md 第 4 章与第 5.5 节
 *
 * 核心要求：
 * 1. 优先使用 agy CLI 桥（Antigravity CLI 子进程，8s 超时）；
 * 2. CLI 失败或特定凭据模式回退至 Cookie / Web 接口；
 * 3. 停服判定（service_deprecated）：
 *    - 403 + SUBSCRIPTION_REQUIRED / retired
 *    - 端点 404
 *    - HTML 退役页特征
 * 4. 空响应判定：CLI 或 HTTP 返回空 body 必须识别为 schema 类 parse_error；
 * 5. 单周期配额：产出单个 QuotaWindow (id='weekly' 或 'daily')。
 */

import type {
  ChannelDriver,
  DriverCapabilities,
  PollPolicy,
  FetchContext,
  FetchOutcome,
  RefreshContext,
  RefreshOutcome,
  HttpRequestSpec,
} from '../driver.js';
import { normalizeGeminiCli } from './cli-normalize.js';
import { normalizeGeminiCookie } from './cookie-normalize.js';

export const GEMINI_CAPABILITIES: DriverCapabilities = {
  can_refresh: false,
  region_scoped: false,
  allowed_origins: [
    'https://cloudcode-pa.googleapis.com',
    'https://gemini.google.com',
  ],
  cli_commands: ['agy'],
  max_windows_for_card: 1,
};

export const GEMINI_POLL_POLICY: PollPolicy = {
  base_interval_secs: 900,
  min_interval_secs: 120,
  max_interval_secs: 3600,
  jitter_ratio: 0.1,
  reset_watch_secs: 120,
  backoff: {
    base_secs: 60,
    factor: 2,
    max_secs: 3600,
    respect_retry_after: true,
    retry_after_clamp: [5, 7200],
  },
  idle_interval_secs: 1800,
};

function parseRetryAfter(header?: string): number | null {
  if (!header) return null;
  const num = parseInt(header, 10);
  if (!Number.isNaN(num) && num > 0) return num;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const diff = Math.max(0, Math.floor((date - Date.now()) / 1000));
    return diff;
  }
  return null;
}

export class GeminiDriver implements ChannelDriver {
  readonly provider = 'gemini' as const;
  readonly schema_version = 'gemini.v1';
  readonly default_visual = 'single_periodic_window' as const;
  readonly supported_auth_flows = ['cli_command', 'session_cookie'] as const;
  readonly poll_policy = GEMINI_POLL_POLICY;
  readonly capabilities = GEMINI_CAPABILITIES;

  async fetch_snapshot(ctx: FetchContext): Promise<FetchOutcome> {
    // 1. 优先尝试 agy CLI 桥取数（若租约非显式强制 session_cookie，或 ctx.cli 具备支持）
    if (ctx.lease.flow !== 'session_cookie' && ctx.cli) {
      try {
        const cliResult = await ctx.cli.run('agy', ['-p', '/usage', '--output-format', 'json'], 8000);
        if (cliResult.exit_code === 0) {
          if (!cliResult.stdout || cliResult.stdout.trim() === '') {
            return {
              ok: false,
              error: {
                class: 'schema',
                message: 'Gemini CLI 响应内容为空 (empty_response)',
                http_status: null,
                upstream_code: 'empty_response',
                retry_after_secs: null,
                migration_hint: null,
              },
            };
          }

          try {
            const outcome = normalizeGeminiCli(cliResult.stdout);
            return {
              ok: true,
              reading: outcome.reading,
              observed_at: ctx.clock.now(),
              diagnostics: {
                requests: 0,
                schema_warnings: outcome.warnings,
              },
            };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              ok: false,
              error: {
                class: 'schema',
                message: `Gemini CLI 响应解析失败: ${msg}`,
                http_status: null,
                upstream_code: 'parse_error',
                retry_after_secs: null,
                migration_hint: null,
              },
            };
          }
        }
      } catch {
        // CLI 桥不可用或执行异常，顺延尝试 HTTP 通道
      }
    }

    // 2. 回退至 HTTP Cookie / Web 端点
    const requestSpec: HttpRequestSpec = {
      method: 'GET',
      url: 'https://gemini.google.com/usage',
      auth: 'lease',
      timeout_ms: 10000,
      max_body_bytes: 262144,
    };

    let reply;
    try {
      reply = await ctx.http.request(requestSpec);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: {
          class: 'network',
          message: `网络连接失败: ${msg}`,
          http_status: null,
          upstream_code: 'network_error',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    // 3. 停服识别（service_deprecated）
    // 规则 1: 403 包含 SUBSCRIPTION_REQUIRED / retired
    if (reply.status === 403) {
      const text = reply.body_text.toLowerCase();
      if (text.includes('subscription_required') || text.includes('retired') || text.includes('deprecated')) {
        return {
          ok: false,
          error: {
            class: 'deprecated',
            message: 'Gemini 旧版配额接口已停服，请改用 agy CLI 登录或升级套餐',
            http_status: 403,
            upstream_code: 'SUBSCRIPTION_REQUIRED',
            retry_after_secs: null,
            migration_hint: 'Google 消费级接口已停服，请安装 Antigravity CLI 1.1.11+ 并通过 agy 授权',
          },
        };
      }
    }

    // 规则 2: 端点 404 退役
    if (reply.status === 404) {
      return {
        ok: false,
        error: {
          class: 'deprecated',
          message: 'Gemini 配额端点已退役 (404)',
          http_status: 404,
          upstream_code: 'endpoint_retired',
          retry_after_secs: null,
          migration_hint: '请切换至 Antigravity CLI 授权模式',
        },
      };
    }

    // 规则 3: HTML 退役页特征
    const contentType = reply.headers['content-type'] ?? '';
    if (
      contentType.toLowerCase().includes('text/html') &&
      (reply.body_text.toLowerCase().includes('deprecated') || reply.body_text.toLowerCase().includes('no longer available'))
    ) {
      return {
        ok: false,
        error: {
          class: 'deprecated',
          message: 'Gemini 接口已下线停服',
          http_status: reply.status,
          upstream_code: 'html_deprecated',
          retry_after_secs: null,
          migration_hint: '请使用 agy CLI 替代已下线的网页接口',
        },
      };
    }

    // 4. 空响应检测（empty 响应 -> parse_error）
    if (!reply.body_text || reply.body_text.trim() === '') {
      return {
        ok: false,
        error: {
          class: 'schema',
          message: 'Gemini 响应内容为空 (empty_response)',
          http_status: reply.status,
          upstream_code: 'empty_response',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    // 5. 其他 HTTP 异常状态码
    if (reply.status === 401) {
      return {
        ok: false,
        error: {
          class: 'auth',
          message: 'Gemini 凭据已过期或无效，请重新登录',
          http_status: 401,
          upstream_code: 'auth_expired',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    if (reply.status === 429) {
      return {
        ok: false,
        error: {
          class: 'rate_limit',
          message: '请求过于频繁，触发限流',
          http_status: 429,
          upstream_code: 'rate_limited',
          retry_after_secs: parseRetryAfter(reply.headers['retry-after']),
          migration_hint: null,
        },
      };
    }

    if (reply.status >= 500) {
      return {
        ok: false,
        error: {
          class: 'http',
          message: `Gemini 服务端异常 (${reply.status})`,
          http_status: reply.status,
          upstream_code: 'http_5xx',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    if (reply.status < 200 || reply.status >= 300) {
      return {
        ok: false,
        error: {
          class: 'http',
          message: `请求返回非预期状态码: ${reply.status}`,
          http_status: reply.status,
          upstream_code: `http_${reply.status}`,
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    // 6. 正常解析 Cookie / Web 响应
    try {
      const outcome = normalizeGeminiCookie(reply.body_text);
      return {
        ok: true,
        reading: outcome.reading,
        observed_at: ctx.clock.now(),
        diagnostics: {
          requests: 1,
          schema_warnings: outcome.warnings,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: {
          class: 'schema',
          message: `Gemini 响应解析失败: ${msg}`,
          http_status: reply.status,
          upstream_code: 'parse_error',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }
  }

  async refresh_token(_ctx: RefreshContext): Promise<RefreshOutcome> {
    return { ok: false, unsupported: true };
  }
}

export function createGeminiDriver(): GeminiDriver {
  return new GeminiDriver();
}
