/**
 * AI HUD 渠道驱动契约 (Channel Driver Contract)
 * 契约规范：docs/ARCHITECTURE.md（第 4 章驱动接口契约、第 5 章渠道差异矩阵）
 *
 * 核心原则：
 * 驱动不持有凭据、不发起真实网络、不读系统时钟，由调度器/运行时注入，驱动为可回放纯函数。
 */

import type {
  BuiltinProviderKind,
  EpochMillis,
  ProviderKind,
  QuotaReading,
  RegionScope,
  MetricVisualKind,
} from '../domain/types.js';

// ==========================================
// 1. 鉴权与能力
// ==========================================

export type AuthFlowType =
  | 'oauth_pkce' // 系统浏览器 + 本地回环回调
  | 'device_code' // 设备配对码 (workbuddy)
  | 'manual_token' // 粘贴 token / cookie
  | 'session_cookie' // 从已登录浏览器导入 cookie
  | 'cli_session_reuse' // 复用本机 CLI 已登录凭据 (Claude Code / Codex)
  | 'cli_command'; // 借 CLI 子进程取数 (gemini agy)

export interface DriverCapabilities {
  readonly can_refresh: boolean;
  readonly region_scoped: boolean; // workbuddy=true
  readonly allowed_origins: readonly string[]; // 域名白名单，SSRF 防护
  readonly cli_commands: readonly string[]; // 允许 spawn 的命令
  readonly max_windows_for_card: number; // 卡片展示窗口上限 (2)
}

// ==========================================
// 2. 上下文与网络
// ==========================================

export interface AccountRef {
  readonly account_id: string;
  readonly provider: ProviderKind;
  readonly region: RegionScope;
}

export interface CredentialLease {
  readonly lease_id: string; // 不透明句柄，JS 无法反推
  readonly revision: string; // 凭据指纹
  readonly expires_at: EpochMillis | null;
  readonly flow: AuthFlowType;
  readonly subject_hint: string | null;
  readonly region: RegionScope;
  readonly extra_headers: Readonly<Record<string, string>>;
}

export interface HttpRequestSpec {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth:
    | 'lease'
    | { readonly kind: 'bearer' | 'header' | 'cookie'; readonly header_name?: string };
  readonly body?: string;
  readonly timeout_ms: number; // <= 15000
  readonly max_body_bytes: number; // <= 262144
}

export interface HttpReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body_text: string;
  readonly truncated: boolean;
  readonly duration_ms: number;
}

export interface AuthBoundHttp {
  request(spec: HttpRequestSpec): Promise<HttpReply>;
}

export interface CliBridge {
  run(
    cmd: string,
    args: readonly string[],
    timeout_ms?: number
  ): Promise<{ stdout: string; stderr: string; exit_code: number }>;
}

export interface Clock {
  now(): EpochMillis;
}

export interface FetchContext {
  readonly account: AccountRef;
  readonly lease: CredentialLease;
  readonly http: AuthBoundHttp;
  readonly cli?: CliBridge;
  readonly clock: Clock;
  readonly signal?: AbortSignal;
}

// ==========================================
// 3. 错误与安全
// ==========================================

export type DriverErrorClass =
  | 'network'
  | 'timeout'
  | 'http'
  | 'auth'
  | 'rate_limit'
  | 'deprecated'
  | 'schema';

export interface DriverErrorData {
  readonly class: DriverErrorClass;
  readonly message: string;
  readonly http_status: number | null;
  readonly upstream_code: string | null;
  readonly retry_after_secs: number | null;
  readonly migration_hint: string | null;
}

export class CredentialLeakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialLeakError';
  }
}

export function assertSafeHeaders(headers?: Readonly<Record<string, string>>): void {
  if (!headers) return;
  const forbidden = ['authorization', 'cookie', 'x-api-key'];
  for (const key of Object.keys(headers)) {
    if (forbidden.includes(key.toLowerCase())) {
      throw new CredentialLeakError(
        `Forbidden sensitive header \"${key}\" detected in request specification`
      );
    }
  }
}

/**
 * 统一错误载荷（四个驱动共用同一形状）。
 * 采用「纯数据」而非 Error 子类：驱动是纯函数，业务失败通过返回值表达，
 * 不依赖异常栈；同时避免 WebView 与 Rust 之间跨序列化时丢失 name/stack。
 */
export type DriverError = DriverErrorData;

interface CodeDefaults {
  readonly cls: DriverErrorClass;
  readonly status: number | null;
  readonly msg: string;
}

const CODE_DEFAULTS: Readonly<Record<string, CodeDefaults>> = {
  auth_expired: { cls: 'auth', status: 401, msg: 'Authentication expired' },
  auth_failed: { cls: 'auth', status: 401, msg: 'Authentication failed' },
  unauthorized: { cls: 'auth', status: 401, msg: 'Unauthorized' },
  parse_error: { cls: 'schema', status: null, msg: 'Failed to parse upstream response' },
  schema_mismatch: { cls: 'schema', status: null, msg: 'Upstream schema mismatch' },
  rate_limited: { cls: 'rate_limit', status: 429, msg: 'Upstream rate limit exceeded' },
  rate_limit: { cls: 'rate_limit', status: 429, msg: 'Upstream rate limit exceeded' },
  network: { cls: 'network', status: null, msg: 'Network connectivity error' },
  network_error: { cls: 'network', status: null, msg: 'Network connectivity error' },
  timeout: { cls: 'timeout', status: null, msg: 'Request timed out' },
  unreachable: { cls: 'network', status: null, msg: 'Upstream unreachable' },
  parse_degraded: { cls: 'schema', status: null, msg: 'Upstream payload degraded' },
  out_of_range: { cls: 'schema', status: null, msg: 'Upstream value out of range' },
  not_configured: { cls: 'auth', status: null, msg: 'Channel not configured' },
  http: { cls: 'http', status: 500, msg: 'Upstream HTTP error' },
  http_error: { cls: 'http', status: 500, msg: 'Upstream HTTP error' },
  deprecated: { cls: 'deprecated', status: 403, msg: 'Upstream service deprecated' },
  service_deprecated: { cls: 'deprecated', status: 403, msg: 'Upstream service deprecated' },
};

/** 规范化错误构造：支持 driverError('auth_expired', {http_status: 401}) 与 driverError({...}) 两种写法。 */
export function driverError(
  codeOrData?: string | Partial<DriverErrorData>,
  details?: Partial<DriverErrorData>
): DriverError {
  const base: DriverErrorData = {
    class: 'schema',
    message: 'Driver error occurred',
    http_status: null,
    upstream_code: null,
    retry_after_secs: null,
    migration_hint: null,
  };

  let out: DriverErrorData = { ...base };

  if (typeof codeOrData === 'string') {
    const d = CODE_DEFAULTS[codeOrData];
    out = {
      ...out,
      class: d ? d.cls : 'schema',
      http_status: d ? d.status : null,
      upstream_code: codeOrData,
      message: d ? d.msg : `Driver error: ${codeOrData}`,
    };
  } else if (codeOrData && typeof codeOrData === 'object') {
    out = { ...out, ...codeOrData } as DriverErrorData;
  }

  if (details) out = { ...out, ...details } as DriverErrorData;
  return out;
}

// ==========================================
// 4. 探活结果与刷新计划
// ==========================================

export type FetchOutcome =
  | {
      readonly ok: true;
      readonly reading: QuotaReading;
      readonly observed_at: EpochMillis;
      readonly diagnostics: {
        readonly requests: number;
        readonly schema_warnings: readonly string[];
      };
    }
  | {
      readonly ok: false;
      readonly error: DriverError;
    };

export interface RefreshContext {
  readonly account: AccountRef;
  readonly lease: CredentialLease;
  readonly clock: Clock;
}

export interface CredentialPatchSpec {
  readonly fields: readonly {
    readonly target: 'access_token' | 'refresh_token' | 'expires_at' | 'scopes' | 'id_token';
    readonly from: string;
    readonly transform: 'identity' | 'epoch_ms_from_seconds' | 'epoch_ms_from_now';
  }[];
  readonly store_mode: 'replace' | 'merge';
}

export interface RefreshPlan {
  readonly request: HttpRequestSpec;
  readonly patch: CredentialPatchSpec;
}

export type RefreshOutcome =
  | { readonly ok: true; readonly plan: RefreshPlan }
  | { readonly ok: false; readonly unsupported: true }
  | { readonly ok: false; readonly error: DriverError };

// ==========================================
// 5. 轮询策略与 Retry-After
// ==========================================

export interface PollPolicy {
  readonly base_interval_secs: number;
  readonly min_interval_secs: number;
  readonly max_interval_secs: number;
  readonly jitter_ratio: number;
  readonly reset_watch_secs: number;
  readonly backoff: {
    readonly base_secs: number;
    readonly factor: number;
    readonly max_secs: number;
    readonly respect_retry_after: true;
    readonly retry_after_clamp: readonly [number, number];
  };
  readonly idle_interval_secs: number;
  next_delay_ms?(
    retry_after?: string | number | null,
    consecutive?: number,
    now?: number
  ): number;
}

/**
 * 解析 Retry-After 头，返回秒数（支持秒数与 HTTP-date 两种标准形态）。
 * 规则（ARCHITECTURE.md §6.3）：
 * - 纯数字 "45" -> 45 秒
 * - HTTP-date "Wed, 21 Oct 2026 07:28:00 GMT" -> date - now，负数 => 5 秒
 * - 缺失 / "" / 非数字 -> 60 秒
 * - 小于 5 -> 5 秒
 * - 大于 7200 -> 7200 秒
 */
export function parseRetryAfter(
  header: string | number | null | undefined,
  now: number = Date.now()
): number {
  if (header === null || header === undefined || header === '') {
    return 60;
  }
  if (typeof header === 'number') {
    if (isNaN(header)) return 60;
    return clampRetryAfter(header);
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    const secs = parseInt(trimmed, 10);
    return clampRetryAfter(secs);
  }
  const parsed = Date.parse(trimmed);
  if (isNaN(parsed)) {
    return 60;
  }
  const diffSecs = Math.ceil((parsed - now) / 1000);
  if (diffSecs <= 0) {
    return 5;
  }
  return clampRetryAfter(diffSecs);
}

function clampRetryAfter(secs: number, lo = 5, hi = 7200): number {
  if (secs < lo) return lo;
  if (secs > hi) return hi;
  return secs;
}

/**
 * 计算下次轮询退避延迟毫秒数。
 */
export function computeNextDelayMs(
  policy: PollPolicy,
  retryAfter?: string | number | null,
  consecutive: number = 1,
  now: number = Date.now()
): number {
  const [lo, hi] = policy.backoff?.retry_after_clamp ?? [5, 7200];
  let honoredSecs: number;

  const hasRetryAfter =
    retryAfter !== undefined && retryAfter !== null && retryAfter !== '';

  if (hasRetryAfter) {
    const rawSecs = parseRetryAfter(retryAfter, now);
    honoredSecs = Math.min(Math.max(rawSecs, lo), hi);
  } else {
    honoredSecs = policy.backoff.base_secs;
  }

  if (consecutive >= 3) {
    // 一分钟内第 3 次及以后 429：本地退避基数翻倍，取 max(服务端, 本地)
    const localSecs = Math.min(
      policy.backoff.base_secs * policy.backoff.factor ** (consecutive - 2),
      policy.backoff.max_secs
    );
    honoredSecs = Math.max(honoredSecs, localSecs);
  } else if (!hasRetryAfter) {
    if (consecutive > 1) {
      const localSecs = Math.min(
        policy.backoff.base_secs * policy.backoff.factor ** (consecutive - 1),
        policy.backoff.max_secs
      );
      honoredSecs = localSecs;
    }
  }

  return honoredSecs * 1000;
}

// ==========================================
// 6. ChannelDriver 统一接口
// ==========================================

export interface ChannelDriver {
  readonly provider: ProviderKind;
  /** 解析器版本；上游格式变化时自增，进入 snapshot.schema_version */
  readonly schema_version: string;
  /** 该渠道支持的鉴权方式 */
  readonly supported_auth_flows: readonly AuthFlowType[];
  /** 调度参数 */
  readonly poll_policy: PollPolicy;
  readonly capabilities: DriverCapabilities;
  /** 该渠道默认视觉形态（无读数时的兜底，决定画双环/单环/积分池） */
  readonly default_visual: MetricVisualKind;

  /** 一次只读探活 */
  fetch_snapshot(ctx: FetchContext): Promise<FetchOutcome>;

  /** 刷新 token 返回计划 */
  refresh_token(ctx: RefreshContext): Promise<RefreshOutcome>;

  /** 授权编排扩展钩子 */
  begin_auth?(ctx: unknown): Promise<unknown>;
  complete_auth?(ctx: unknown, answer: unknown): Promise<unknown>;
}

// ==========================================
// 合并自 workbuddy/gemini 契约分支
// ==========================================

export interface AuthAnswer {
  readonly code?: string;
  readonly token?: string;
}

export interface AuthChallenge {
  readonly verification_uri?: string;
  readonly user_code?: string;
  readonly expires_in?: number;
  readonly interval?: number;
}

export interface AuthContext {
  readonly region?: RegionScope;
  readonly flow: AuthFlowType;
}

export type AuthSpec =
  | 'lease'
  | { readonly kind: 'bearer' | 'header' | 'cookie'; readonly header_name?: string };

export interface BackoffPolicy {
  readonly base_secs: number;               // 60
  readonly factor: number;                  // 2
  readonly max_secs: number;                // 3600
  readonly respect_retry_after: true;
  readonly retry_after_clamp: readonly [number, number]; // [5, 7200]
}

export interface CliResult {
  readonly exit_code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CredentialDraft {
  readonly subject_hint?: string | null;
  readonly extra_headers?: Readonly<Record<string, string>>;
}

export interface CredentialPatchField {
  readonly target: 'access_token' | 'refresh_token' | 'expires_at' | 'scopes' | 'id_token';
  readonly from: string;                        // 'access_token' / 'refresh_token' / 'expires_in'
  readonly transform: 'identity' | 'epoch_ms_from_seconds' | 'epoch_ms_from_now';
}

/** 驱动违反契约（如抛出未捕获异常）时包装的缺陷错误 */
export class DriverContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverContractError';
  }
}

export interface FetchDiagnostics {
  readonly requests: number;
  readonly schema_warnings: readonly string[];
}
