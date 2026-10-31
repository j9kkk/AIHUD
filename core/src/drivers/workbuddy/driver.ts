/**
 * WorkBuddy 渠道驱动实现 (WorkBuddy Driver)
 * 契约规范：docs/ARCHITECTURE.md 第 4 章与第 5.4 节
 *
 * 核心要求：
 * 1. 站点错配拦截：检查 lease.region 与 account.region，若错配直接返回 auth (region_mismatch) 阻断请求；
 * 2. 401 HTML 网关页识别：上游返回 text/html 且状态为 401/403 时，映射为 auth + region_mismatch；
 * 3. 积分池归一化：产出 credits_pool 读数，未过期积分包计算，过期包排除；
 * 4. 刷新能力：不支持自动刷新（返回 unsupported: true）。
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
import { defaultRegionRouter, type RegionRouter } from './region.js';
import { normalizeWorkBuddy } from './normalize.js';

export const WORKBUDDY_CAPABILITIES: DriverCapabilities = {
  can_refresh: false,
  region_scoped: true,
  allowed_origins: [
    'https://workbuddy.cn',
    'https://workbuddy.ai',
    'https://codebuddy.cn',
  ],
  cli_commands: [],
  max_windows_for_card: 1,
};

export const WORKBUDDY_POLL_POLICY: PollPolicy = {
  base_interval_secs: 600,
  min_interval_secs: 120,
  max_interval_secs: 1800,
  jitter_ratio: 0.1,
  reset_watch_secs: 60,
  backoff: {
    base_secs: 60,
    factor: 2,
    max_secs: 1800,
    respect_retry_after: true,
    retry_after_clamp: [5, 7200],
  },
  idle_interval_secs: 1200,
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

function isHtmlResponse(contentType?: string, body?: string): boolean {
  if (contentType && contentType.toLowerCase().includes('text/html')) {
    return true;
  }
  if (body) {
    const trimmed = body.trim().toLowerCase();
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || trimmed.startsWith('<div')) {
      return true;
    }
  }
  return false;
}

export interface WorkBuddyDriverOptions {
  readonly regionRouter?: RegionRouter;
}

export class WorkBuddyDriver implements ChannelDriver {
  readonly provider = 'workbuddy' as const;
  readonly schema_version = 'workbuddy.v1';
  readonly default_visual = 'credits_pool' as const;
  readonly supported_auth_flows = ['device_code', 'manual_token'] as const;
  readonly poll_policy = WORKBUDDY_POLL_POLICY;
  readonly capabilities = WORKBUDDY_CAPABILITIES;

  private readonly regionRouter: RegionRouter;

  constructor(options?: WorkBuddyDriverOptions) {
    this.regionRouter = options?.regionRouter ?? defaultRegionRouter;
  }

  async fetch_snapshot(ctx: FetchContext): Promise<FetchOutcome> {
    // 1. 站点一致性预检：凭据站点与账号站点冲突时直接拒绝，防止把 CN token 发往国际站
    if (!this.regionRouter.isMatch(ctx.account.region, ctx.lease.region)) {
      return {
        ok: false,
        error: {
          class: 'auth',
          message: '该凭据属于另一站点，请重新授权',
          http_status: 401,
          upstream_code: 'region_mismatch',
          retry_after_secs: null,
          migration_hint: '账号配置站点与凭据绑定的站点不一致',
        },
      };
    }

    // 2. 构造请求
    let baseUrl: string;
    try {
      baseUrl = this.regionRouter.resolve(ctx.account.region);
    } catch {
      baseUrl = 'https://workbuddy.cn';
    }

    const requestSpec: HttpRequestSpec = {
      method: 'POST',
      url: `${baseUrl}/billing/meter/get-user-resource-summary`,
      auth: 'lease',
      headers: {
        'content-type': 'application/json',
        ...ctx.lease.extra_headers,
      },
      body: JSON.stringify({}),
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

    // 3. 处理鉴权与错域名 HTML 场景 (401 / 403)
    if (reply.status === 401 || reply.status === 403) {
      const isHtml = isHtmlResponse(reply.headers['content-type'], reply.body_text);
      if (isHtml) {
        return {
          ok: false,
          error: {
            class: 'auth',
            message: '该凭据属于另一站点，请重新授权',
            http_status: reply.status,
            upstream_code: 'region_mismatch',
            retry_after_secs: null,
            migration_hint: '上游网关返回 401 HTML，表明站点域名错配',
          },
        };
      }

      return {
        ok: false,
        error: {
          class: 'auth',
          message: '凭据已过期或无效，请重新登录',
          http_status: reply.status,
          upstream_code: 'invalid_token',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    // 4. 处理限流 (429)
    if (reply.status === 429) {
      return {
        ok: false,
        error: {
          class: 'rate_limit',
          message: '请求过于频繁，请稍候再试',
          http_status: 429,
          upstream_code: 'rate_limited',
          retry_after_secs: parseRetryAfter(reply.headers['retry-after']),
          migration_hint: null,
        },
      };
    }

    // 5. 处理服务端错误 (5xx)
    if (reply.status >= 500) {
      return {
        ok: false,
        error: {
          class: 'http',
          message: `WorkBuddy 服务端响应异常 (${reply.status})`,
          http_status: reply.status,
          upstream_code: 'http_5xx',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    // 6. 处理非 2xx
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

    // 7. 处理 HTML 网关页（200 但返回 HTML）
    if (isHtmlResponse(reply.headers['content-type'], reply.body_text)) {
      return {
        ok: false,
        error: {
          class: 'schema',
          message: '上游返回了网关 HTML 页面而非 JSON',
          http_status: 200,
          upstream_code: 'gateway_html',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    // 8. 解析与归一化
    let parsed: unknown;
    try {
      parsed = JSON.parse(reply.body_text);
    } catch {
      return {
        ok: false,
        error: {
          class: 'schema',
          message: '上游响应 JSON 格式解析失败',
          http_status: 200,
          upstream_code: 'schema_drift',
          retry_after_secs: null,
          migration_hint: null,
        },
      };
    }

    try {
      const outcome = normalizeWorkBuddy(parsed, ctx.clock.now());
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
          message: `数据结构解析异常: ${msg}`,
          http_status: 200,
          upstream_code: 'schema_drift',
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

export function createWorkBuddyDriver(options?: WorkBuddyDriverOptions): WorkBuddyDriver {
  return new WorkBuddyDriver(options);
}
