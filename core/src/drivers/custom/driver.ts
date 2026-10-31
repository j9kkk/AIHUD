/**
 * 自定义渠道驱动 (Custom Channel Driver)
 * 契约规范：docs/ARCHITECTURE.md §4.6 + docs/SPEC.md S04
 *
 * 这是「渠道抽象适配」的实证：四个内置渠道（claude / codex / workbuddy / gemini）
 * 与一个完全由配置驱动的自定义渠道，共用同一个 ChannelDriver 契约、
 * 同一套错误分类、同一套轮询策略校验、同一套 UI 投影规则。
 *
 * 与内置渠道的差异仅在两处，正是用户指出的两处：
 *   1. 数据格式不同 → 由 json.* 字段路径描述；
 *   2. 展示方式不同 → 由 visual 描述（积分池 / 单周期窗口）。
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
import { driverError } from '../driver.js';
import {
  originOf,
  providerOfCustom,
  validateCustomConfig,
  type CustomChannelConfig,
} from './config.js';
import { normalizeCustom } from './normalize.js';
import type { CreditsReading, WindowsReading, ProviderKind } from '../../domain/types.js';

export class CustomConfigError extends Error {
  readonly issues: readonly { field: string; message: string }[];

  constructor(issues: readonly { field: string; message: string }[]) {
    super(`自定义渠道配置不合法：${issues.map((i) => `${i.field} ${i.message}`).join('；')}`);
    this.name = 'CustomConfigError';
    this.issues = issues;
  }
}

/** 保守的轮询策略：自定义网关通常没有官方限流文档，取内置渠道里最慢的一档 */
export const CUSTOM_POLL_POLICY: PollPolicy = {
  base_interval_secs: 600,
  min_interval_secs: 120,
  max_interval_secs: 3600,
  jitter_ratio: 0.15,
  reset_watch_secs: 120,
  backoff: {
    base_secs: 60,
    factor: 2,
    max_secs: 1800,
    respect_retry_after: true,
    retry_after_clamp: [5, 7200],
  },
  idle_interval_secs: 1800,
};

function retryAfterSecs(header?: string): number | null {
  if (!header) return null;
  const n = Number.parseInt(header, 10);
  if (!Number.isNaN(n) && n > 0) return n;
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return Math.max(0, Math.floor((at - Date.now()) / 1000));
  return null;
}

export class CustomChannelDriver implements ChannelDriver {
  readonly provider: ProviderKind;
  readonly schema_version = 'custom.v1';
  readonly supported_auth_flows = ['manual_token'] as const;
  readonly poll_policy = CUSTOM_POLL_POLICY;
  readonly capabilities: DriverCapabilities;
  readonly default_visual;

  constructor(readonly config: CustomChannelConfig) {
    const issues = validateCustomConfig(config);
    if (issues.length > 0) {
      throw new CustomConfigError(issues);
    }

    this.provider = providerOfCustom(config);
    this.default_visual = config.visual ?? 'credits_pool';

    const origin = originOf(config.base_url) as string;
    this.capabilities = {
      can_refresh: false,
      region_scoped: false,
      // 白名单只含用户自己填的那一个 origin：配置改不了别人的域名
      allowed_origins: [origin],
      cli_commands: [],
      max_windows_for_card: 1,
    };
  }

  private buildUrl(): string {
    const base = this.config.base_url.replace(/\/+$/, '');
    return `${base}${this.config.endpoint_path}`;
  }

  async fetch_snapshot(ctx: FetchContext): Promise<FetchOutcome> {
    const method = this.config.method ?? 'GET';
    const auth: HttpRequestSpec['auth'] =
      this.config.auth.kind === 'bearer'
        ? { kind: 'bearer' }
        : { kind: 'header', header_name: this.config.auth.header_name as string };

    const spec: HttpRequestSpec = {
      method,
      url: this.buildUrl(),
      headers: { accept: 'application/json' },
      auth,
      timeout_ms: 8000,
      max_body_bytes: 131072,
    };

    let reply;
    try {
      reply = await ctx.http.request(spec);
    } catch (e) {
      return {
        ok: false,
        error: driverError('unreachable', {
          message: `无法连接自定义网关：${(e as Error).message}`,
        }),
      };
    }

    if (reply.status === 429) {
      return {
        ok: false,
        error: driverError('rate_limited', {
          http_status: 429,
          retry_after_secs: retryAfterSecs(reply.headers['retry-after']),
          message: '自定义网关返回限流',
        }),
      };
    }

    if (reply.status === 401) {
      return {
        ok: false,
        error: driverError('auth_expired', {
          http_status: 401,
          message: '自定义网关鉴权失败，请重新填写 Key',
        }),
      };
    }

    if (reply.status === 403) {
      return {
        ok: false,
        error: driverError('auth_expired', {
          http_status: 403,
          message: '自定义网关拒绝访问（403），请检查 Key 权限或网关策略',
        }),
      };
    }

    if (reply.status === 404 || reply.status === 410) {
      return {
        ok: false,
        error: driverError('service_deprecated', {
          http_status: reply.status,
          message: `自定义网关端点已不存在（${reply.status}），请检查 endpoint_path`,
        }),
      };
    }

    if (reply.status < 200 || reply.status >= 300) {
      return {
        ok: false,
        error: driverError('http_error', {
          http_status: reply.status,
          message: `自定义网关返回 HTTP ${reply.status}`,
        }),
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(reply.body_text);
    } catch {
      return {
        ok: false,
        error: driverError('parse_degraded', {
          message: '响应不是合法 JSON（可能是登录页或网关错误页）',
          http_status: reply.status,
        }),
      };
    }

    const normalized = normalizeCustom(this.config, payload);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error };
    }

    const reading: CreditsReading | WindowsReading =
      'kind' in normalized.reading
        ? normalized.reading
        : { kind: 'credits', pool: normalized.reading };

    return {
      ok: true,
      reading,
      observed_at: ctx.clock.now(),
      diagnostics: { requests: 1, schema_warnings: [] },
    };
  }

  /** 自定义网关没有统一的刷新协议 ⇒ 明确返回 unsupported，由 UI 引导用户重填 Key */
  async refresh_token(_ctx: RefreshContext): Promise<RefreshOutcome> {
    return { ok: false, unsupported: true };
  }
}

export function createCustomDriver(config: CustomChannelConfig): CustomChannelDriver {
  return new CustomChannelDriver(config);
}
