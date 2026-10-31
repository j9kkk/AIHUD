/**
 * AI HUD 退避与重试策略 (Exponential Backoff & Retry-After Parser)
 * 契约规范：docs/ARCHITECTURE.md 第 6.3 节、第 4.4 节
 *
 * 纯函数实现，无全局副作用。
 */

import type { EpochMillis } from '../domain/types.js';

export interface BackoffPolicy {
  readonly base_secs: number;               // 60
  readonly factor: number;                  // 2
  readonly max_secs: number;                // 3600
  readonly respect_retry_after: boolean;    // true
  readonly retry_after_clamp: readonly [number, number]; // [5, 7200]
}

export interface PollPolicy {
  readonly base_interval_secs: number;
  readonly min_interval_secs: number;
  readonly max_interval_secs: number;
  readonly jitter_ratio: number;              // 0.1 => ±10%
  readonly reset_watch_secs: number;
  readonly backoff: BackoffPolicy;
  readonly idle_interval_secs: number;
}

/**
 * 钳制 Retry-After 秒数至合法区间 [lo, hi]
 */
export function clampRetryAfter(
  secs: number,
  lo = 5,
  hi = 7200
): number {
  if (secs < lo) return lo;
  if (secs > hi) return hi;
  return secs;
}

/**
 * 解析 HTTP 响应头中的 Retry-After（支持秒数字符串与 HTTP-date），返回钳制后的秒数。
 *
 * 规则（ARCHITECTURE.md §6.3）：
 * - 纯数字 "45" => 45 秒
 * - HTTP-date "Wed, 21 Oct 2026 07:28:00 GMT" => date - now（秒），负数 => 5
 * - 缺失 / "" / 非数字 => 60 秒
 * - 小于 5 => 抬到 5
 * - 大于 7200 => 裁剪到 7200
 */
export function parseRetryAfter(
  header: string | number | null | undefined,
  now: EpochMillis = Date.now()
): number {
  if (header === null || header === undefined) {
    return 60;
  }

  if (typeof header === 'number') {
    if (isNaN(header)) return 60;
    return clampRetryAfter(header);
  }

  const trimmed = header.trim();
  if (trimmed === '') {
    return 60;
  }

  // 纯数字匹配（支持前导加号或整数字符串）
  if (/^\+?\d+$/.test(trimmed)) {
    const secs = parseInt(trimmed, 10);
    if (isNaN(secs)) return 60;
    return clampRetryAfter(secs);
  }

  // 尝试按 HTTP-date / RFC 2822 解析
  const parsedDateMs = Date.parse(trimmed);
  if (isNaN(parsedDateMs)) {
    return 60;
  }

  const diffSecs = Math.ceil((parsedDateMs - now) / 1000);
  if (diffSecs <= 0) {
    return 5;
  }

  return clampRetryAfter(diffSecs);
}

/**
 * 解析 Retry-After 为毫秒数（验收要求 3：Retry-After "50" 与 HTTP-date 均可解析为毫秒）
 */
export function parseRetryAfterMs(
  header: string | number | null | undefined,
  now: EpochMillis = Date.now()
): number {
  const secs = parseRetryAfter(header, now);
  return secs * 1000;
}

export interface NextDueFailureOptions {
  /** 一分钟内连续 429 计数器 */
  readonly recent429Count1m?: number;
}

/**
 * 计算探测失败后的下次执行绝对时刻 due_at（毫秒）
 *
 * 规则（ARCHITECTURE.md §6.3）：
 * 1. 本地指数退避：base * factor^(consecutive - 1)，封顶 max_secs
 * 2. 服务端 Retry-After 钳制在 [5, 7200]
 * 3. 服务端优先，但本地退避若更长则取 max(服务端, 本地)
 * 4. 一分钟内第 3 次及以后 429，本地退避基数翻倍（base * 2^(n - 2)）
 */
export function nextDueAfterFailure(
  policy: PollPolicy,
  consecutive: number,
  retryAfterSecs: number | null,
  now: EpochMillis,
  options?: NextDueFailureOptions
): EpochMillis {
  let baseSecs = policy.backoff.base_secs;

  // 一分钟内第 3 次及以后 429：本地退避基数翻倍
  if (options?.recent429Count1m !== undefined && options.recent429Count1m >= 3) {
    baseSecs = baseSecs * Math.pow(2, options.recent429Count1m - 2);
  }

  const exp = Math.max(0, consecutive - 1);
  const local = Math.min(
    baseSecs * Math.pow(policy.backoff.factor, exp),
    policy.backoff.max_secs
  );

  if (retryAfterSecs === null) {
    return now + local * 1000;
  }

  const [lo, hi] = policy.backoff.retry_after_clamp;
  const honored = Math.min(Math.max(retryAfterSecs, lo), hi);

  // 服务端优先，但本地退避可更长
  return now + Math.max(honored, local) * 1000;
}

/**
 * 施加抖动 jitter（防止多账号同秒撞车）
 */
export function applyJitter(
  intervalMs: number,
  jitterRatio: number = 0.1,
  randomFn: () => number = Math.random
): number {
  const clampedRatio = Math.max(0, Math.min(0.5, jitterRatio));
  const factor = 1 + (randomFn() * 2 - 1) * clampedRatio;
  return Math.round(intervalMs * factor);
}
