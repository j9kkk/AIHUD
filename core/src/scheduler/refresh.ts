/**
 * AI HUD 刷新闸门与单飞锁 (Refresh Gate & Single-Flight Coordinator)
 * 契约规范：docs/ARCHITECTURE.md 第 6.5 节、docs/FLOWS.md 第 14 章
 *
 * 核心设计约束：
 * 1. 严格遵守硬规则 5：绝不提前刷新仍可用的 token（0 < expires_at - now 时均 skip）
 * 2. 仅在 expires_at <= now 或 401 发生时允许刷新
 * 3. 429 与 service_deprecated 状态下严格禁止刷新 (forbidden)
 * 4. 同账号并发刷新单飞互斥，并持有 90s lease 防止击穿与多实例冲突
 */

import type { AccountHealthState, EpochMillis } from '../domain/types.js';

export type RefreshGate =
  | 'skip'                  // 凭据仍有效，不刷新直接 fetch
  | 'refresh_before_fetch'  // 凭据已过期 (expires_at <= now)，先刷新再 fetch
  | 'refresh_after_401'     // 遇到 401 鉴权失效，单飞刷新后重试 1 次
  | 'forbidden';            // 无能力 / 状态禁止 / 本轮已刷新过

export interface EvaluateRefreshGateInput {
  /** 凭据过期绝对毫秒戳；null 表示无明确过期时间 */
  readonly expires_at: EpochMillis | null;
  /** 当前毫秒戳 */
  readonly now: EpochMillis;
  /** 渠道驱动是否具备刷新能力 */
  readonly can_refresh: boolean;
  /** 当前账号健康状态 */
  readonly state: AccountHealthState;
  /** 本轮请求是否已经刷新过（防止 401 死循环） */
  readonly already_refreshed_this_tick?: boolean;
  /** 触发时的 HTTP 状态码（可选，401 判定） */
  readonly http_status?: number | null;
  /** 是否为 401 触发（可选快捷参数） */
  readonly is_401?: boolean;
}

/**
 * 评估刷新闸门决策 (evaluateRefreshGate)
 *
 * 5 个区间评估规则（ARCHITECTURE.md §6.5 & 硬规则 5）：
 * 1. expires_at - now == -1s (< 0): 已过期不可用 => refresh_before_fetch
 * 2. expires_at - now == 0 (== 0): 已到期不可用 => refresh_before_fetch
 * 3. expires_at - now == 30s (0 < diff <= 60s): 仍可用，绝不提前刷新 => skip
 * 4. expires_at - now == 1h (> 60s): 充裕可用 => skip
 * 5. expires_at - now == 24h (> 60s): 充裕可用 => skip
 */
export function evaluateRefreshGate(input: EvaluateRefreshGateInput): RefreshGate {
  // 1. 无刷新能力直接禁止
  if (!input.can_refresh) {
    return 'forbidden';
  }

  // 2. 限流熔断或停服态禁止刷新（刷新无法解决且浪费额度/加重风控）
  if (input.state === 'rate_limited' || input.state === 'service_deprecated') {
    return 'forbidden';
  }

  // 3. 401 被动刷新检查
  const is401 = input.is_401 === true || input.http_status === 401;
  if (is401) {
    if (input.already_refreshed_this_tick) {
      // 本轮已刷新过一次仍 401，禁止二次刷新，防止加重风控
      return 'forbidden';
    }
    return 'refresh_after_401';
  }

  // 4. 过期时间评估：仅 expires_at <= now 时允许预先刷新
  if (input.expires_at !== null) {
    if (input.expires_at <= input.now) {
      return 'refresh_before_fetch';
    }
    // 0 < expires_at - now: 无论是 30s 还是 1h/24h，仍可用一律不提前刷新（硬规则 5）
    return 'skip';
  }

  // 5. 无 expires_at 信息的长期 token，直接跳过
  return 'skip';
}

// ==========================================
// 单飞锁与 90s 租约实现 (Single-Flight & 90s Lease)
// ==========================================

export interface RefreshLease {
  readonly lease_id: string;
  readonly key: string;
  readonly acquired_at: EpochMillis;
  readonly expires_at: EpochMillis;
}

/** 默认 90s 刷新租约时长（FLOWS.md §14 / ARCHITECTURE.md §6.5） */
export const REFRESH_LEASE_DURATION_MS = 90_000;

/**
 * 刷新租约管理器 (90s Lease Lock)
 * 保证对同一 key（如 `provider:account_id`）在租约有效期内互斥。
 */
export class RefreshLeaseLock {
  private readonly leases = new Map<string, RefreshLease>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = REFRESH_LEASE_DURATION_MS) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * 尝试获取租约；若已有活跃租约且未超时则返回 null
   */
  acquire(key: string, now: EpochMillis, ttlMs?: number): RefreshLease | null {
    const existing = this.leases.get(key);
    if (existing && existing.expires_at > now) {
      return null;
    }

    const duration = ttlMs ?? this.defaultTtlMs;
    const lease: RefreshLease = {
      lease_id: `lease_${Math.random().toString(36).slice(2, 10)}_${now}`,
      key,
      acquired_at: now,
      expires_at: now + duration,
    };
    this.leases.set(key, lease);
    return lease;
  }

  /**
   * 释放指定租约
   */
  release(key: string, leaseId?: string): boolean {
    const existing = this.leases.get(key);
    if (!existing) {
      return false;
    }
    if (leaseId !== undefined && existing.lease_id !== leaseId) {
      return false;
    }
    this.leases.delete(key);
    return true;
  }

  /**
   * 查询当前活跃租约
   */
  getLease(key: string, now: EpochMillis): RefreshLease | null {
    const existing = this.leases.get(key);
    if (!existing) {
      return null;
    }
    if (existing.expires_at <= now) {
      this.leases.delete(key);
      return null;
    }
    return existing;
  }

  /**
   * 清除全部租约
   */
  clear(): void {
    this.leases.clear();
  }
}

/**
 * 泛型单飞锁 (Single-Flight Lock)
 * 同一 key 在途的异步调用合并为一个 Promise，后到者 await 前者结果，不重复执行。
 */
export class SingleFlight<T = unknown> {
  private readonly inFlight = new Map<string, Promise<T>>();

  async do(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  get activeCount(): number {
    return this.inFlight.size;
  }

  clear(): void {
    this.inFlight.clear();
  }
}

/**
 * 组装单飞与 90s 租约的刷新协同器
 */
export class RefreshCoordinator {
  readonly leaseLock: RefreshLeaseLock;
  readonly singleFlight: SingleFlight<unknown>;

  constructor(defaultTtlMs = REFRESH_LEASE_DURATION_MS) {
    this.leaseLock = new RefreshLeaseLock(defaultTtlMs);
    this.singleFlight = new SingleFlight();
  }

  /**
   * 结合单飞与租约保护执行刷新过程
   */
  async executeRefresh<T>(
    key: string,
    now: EpochMillis,
    fn: (lease: RefreshLease) => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; reason: 'lease_busy' }> {
    return this.singleFlight.do(key, async () => {
      const lease = this.leaseLock.acquire(key, now);
      if (!lease) {
        return { ok: false as const, reason: 'lease_busy' as const };
      }
      try {
        const value = await fn(lease);
        return { ok: true as const, value };
      } finally {
        this.leaseLock.release(key, lease.lease_id);
      }
    }) as Promise<{ ok: true; value: T } | { ok: false; reason: 'lease_busy' }>;
  }
}
