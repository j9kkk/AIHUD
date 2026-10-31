/**
 * AI HUD 轮询调度器 (Poller & Scheduler)
 * 契约规范：docs/ARCHITECTURE.md 第 6 章（调度与熔断）、第 8.4 节 IPC
 *
 * 核心调度与隔离规则（第 6.1 节）：
 * 1. tick 只处理 due_at <= now && !in_flight 的账号，最多取 concurrency = 3 个（按 due_at 升序）
 * 2. 同 provider 串行：同一渠道同时最多 1 个在途请求，防止同一上游并发 429
 * 3. tick 幂等：重复调用不会重复发起同一账号请求（in_flight + last_attempt_at 守卫）
 * 4. 唤醒补偿：system.wake 事件分批补偿（200ms 间隔，每批 ≤ 3，总预算 20s），不并发风暴
 * 5. 单账号失败只改自己的 due_at，按账号完全隔离熔断，Promise.allSettled 聚合
 * 6. 面板打开：对剩余最低的 3 个 Normal 账号即时刷新，受 last_attempt_at + 60s 防抖约束
 */

import type {
  AccountHealthState,
  EpochMillis,
  ProviderKind,
  QuotaReading,
  StateDetail,
} from '../domain/types.js';
import {
  type PollPolicy,
  applyJitter,
  nextDueAfterFailure,
} from './backoff.js';

export interface ScheduledAccount {
  readonly account_id: string;
  readonly provider: ProviderKind;
  due_at: EpochMillis;
  last_attempt_at: EpochMillis | null;
  last_success_at: EpochMillis | null;
  in_flight: boolean;
  state: AccountHealthState;
  state_detail?: StateDetail;
  consecutive_failures: number;
  retry_at: EpochMillis | null;
  poll_policy: PollPolicy;
  reading: QuotaReading | null;
  remaining_ratio: number | null;
  /** 暂停轮询到此时刻（I11）；null = 未暂停 */
  pause_until: EpochMillis | null;
}

export interface ScheduledAccountInput {
  readonly account_id: string;
  readonly provider: ProviderKind;
  readonly due_at?: EpochMillis;
  readonly last_attempt_at?: EpochMillis | null;
  readonly last_success_at?: EpochMillis | null;
  readonly in_flight?: boolean;
  readonly state?: AccountHealthState;
  readonly state_detail?: StateDetail;
  readonly consecutive_failures?: number;
  readonly retry_at?: EpochMillis | null;
  readonly poll_policy?: PollPolicy;
  readonly reading?: QuotaReading | null;
  readonly remaining_ratio?: number | null;
  readonly pause_until?: EpochMillis | null;
}

export interface FetchExecutionSuccess {
  readonly ok: true;
  readonly reading?: QuotaReading | null;
  readonly remaining_ratio?: number | null;
}

export interface FetchExecutionErrorPayload {
  readonly class:
    | 'network'
    | 'timeout'
    | 'http'
    | 'auth'
    | 'rate_limit'
    | 'deprecated'
    | 'schema';
  readonly message: string;
  readonly http_status?: number | null;
  readonly retry_after_secs?: number | null;
  readonly upstream_code?: string | null;
}

export interface FetchExecutionFailure {
  readonly ok: false;
  readonly error: FetchExecutionErrorPayload;
}

export type FetchExecutionOutcome =
  | FetchExecutionSuccess
  | FetchExecutionFailure;

export type FetchHandler = (
  account: ScheduledAccount,
  signal?: AbortSignal
) => Promise<FetchExecutionOutcome>;

export interface SchedulerOptions {
  /** 默认全局并发上限，默认 3 */
  readonly concurrency?: number;
  /** 面板打开刷新防抖间隔（毫秒），默认 60,000ms (60s) */
  readonly panelDebounceMs?: number;
  /** 唤醒补偿批次间隔（毫秒），默认 200ms */
  readonly wakeBatchDelayMs?: number;
  /** 唤醒补偿总时间预算（毫秒），默认 20,000ms (20s) */
  readonly wakeBudgetMs?: number;
  /** 外部注入的探测执行器 */
  readonly executeFetch?: FetchHandler;
  /** 随机数生成器（用于单测确定性 jitter） */
  readonly randomFn?: () => number;
}

export interface TickResult {
  readonly processedAccountIds: readonly string[];
  readonly skippedDueToProviderInFlight: readonly string[];
}

export const DEFAULT_POLL_POLICY: PollPolicy = {
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
};

;

export class Scheduler {
  private readonly accounts = new Map<string, ScheduledAccount>();
  readonly concurrency: number;
  readonly panelDebounceMs: number;
  readonly wakeBatchDelayMs: number;
  readonly wakeBudgetMs: number;
  private readonly fetchHandler: FetchHandler;
  private readonly randomFn: () => number;

  constructor(options?: SchedulerOptions) {
    this.concurrency = options?.concurrency ?? 3;
    this.panelDebounceMs = options?.panelDebounceMs ?? 60_000;
    this.wakeBatchDelayMs = options?.wakeBatchDelayMs ?? 200;
    this.wakeBudgetMs = options?.wakeBudgetMs ?? 20_000;
    this.fetchHandler =
      options?.executeFetch ?? (async () => ({ ok: true as const }));
    this.randomFn = options?.randomFn ?? Math.random;
  }

  /**
   * 注册或更新待调度账号
   */
  addAccount(input: ScheduledAccountInput): ScheduledAccount {
    const defaultPolicy =
      DEFAULT_POLL_POLICY;

    const account: ScheduledAccount = {
      account_id: input.account_id,
      provider: input.provider,
      due_at: input.due_at ?? 0,
      last_attempt_at: input.last_attempt_at ?? null,
      last_success_at: input.last_success_at ?? null,
      in_flight: input.in_flight ?? false,
      state: input.state ?? 'never_synced',
      consecutive_failures: input.consecutive_failures ?? 0,
      retry_at: input.retry_at ?? null,
      pause_until: input.pause_until ?? null,
      poll_policy: input.poll_policy ?? defaultPolicy,
      reading: input.reading ?? null,
      remaining_ratio: input.remaining_ratio ?? null,
    };
    if (input.state_detail) {
      account.state_detail = input.state_detail;
    }

    this.accounts.set(account.account_id, account);
    return account;
  }

  /**
   * 移除指定账号
   */
  removeAccount(accountId: string): boolean {
    return this.accounts.delete(accountId);
  }

  /**
   * 获取指定账号当前快照
   */
  getAccount(accountId: string): ScheduledAccount | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * 获取当前全部已调度账号快照
   */
  snapshot(): readonly ScheduledAccount[] {
    return Array.from(this.accounts.values()).map((acc) => ({ ...acc }));
  }

  /**
   * 检查指定渠道是否已有请求在途 (同 provider 串行约束)
   */
  private isProviderInFlight(provider: ProviderKind): boolean {
    for (const acc of this.accounts.values()) {
      if (acc.provider === provider && acc.in_flight) {
        return true;
      }
    }
    return false;
  }

  /**
   * 单次心跳或驱动触发 (tick)
   *
   * 规则：
   * 1. 只处理 due_at <= now && !in_flight 的账号
   * 2. 最多取 concurrency = 3 个（按 due_at 升序）
   * 3. 同 provider 串行：同一批内及与在途中互斥
   * 4. 幂等执行，单个账号请求失败不影响其他账号
   */
  async tick(now: EpochMillis): Promise<TickResult> {
    // 1. 筛选到期且非在途账号（已失效凭据 auth_expired 停止自动轮询）
    const candidates: ScheduledAccount[] = [];
    for (const acc of this.accounts.values()) {
      if (
        acc.due_at <= now &&
        !acc.in_flight &&
        acc.state !== 'auth_expired' &&
        // I11：暂停期内的账号一律不发请求；到期后 due_at 仍然 <= now，自然恢复
        (acc.pause_until === null || acc.pause_until <= now)
      ) {
        candidates.push(acc);
      }
    }

    // 按 due_at 升序排列
    candidates.sort((a, b) => a.due_at - b.due_at);

    // 2. 按并发限制与同 provider 串行规则选取本批次
    const batch: ScheduledAccount[] = [];
    const providersInBatch = new Set<string>();
    const skippedProviders: string[] = [];

    for (const candidate of candidates) {
      if (batch.length >= this.concurrency) {
        break;
      }

      if (
        this.isProviderInFlight(candidate.provider) ||
        providersInBatch.has(candidate.provider)
      ) {
        skippedProviders.push(candidate.account_id);
        continue;
      }

      batch.push(candidate);
      providersInBatch.add(candidate.provider);
    }

    if (batch.length === 0) {
      return {
        processedAccountIds: [],
        skippedDueToProviderInFlight: skippedProviders,
      };
    }

    // 3. 标记在途并记录本次发起时刻（幂等守卫）
    for (const acc of batch) {
      acc.in_flight = true;
      acc.last_attempt_at = now;
    }

    // 4. 并发执行，独立熔断
    await Promise.allSettled(
      batch.map((acc) => this.executeAccountFetch(acc, now))
    );

    return {
      processedAccountIds: batch.map((a) => a.account_id),
      skippedDueToProviderInFlight: skippedProviders,
    };
  }

  /**
   * 执行单个账号探测并更新自身状态（按账号绝对隔离熔断）
   */
  private async executeAccountFetch(
    account: ScheduledAccount,
    now: EpochMillis
  ): Promise<void> {
    try {
      const outcome = await this.fetchHandler(account);

      if (outcome.ok) {
        // 成功分支
        account.state = 'normal';
        account.consecutive_failures = 0;
        account.last_success_at = now;
        account.retry_at = null;

        if (outcome.reading !== undefined) {
          account.reading = outcome.reading;
        }
        if (outcome.remaining_ratio !== undefined) {
          account.remaining_ratio = outcome.remaining_ratio;
        }

        // 下一次成功轮询时刻
        const baseIntervalMs = account.poll_policy.base_interval_secs * 1000;
        const jitteredMs = applyJitter(
          baseIntervalMs,
          account.poll_policy.jitter_ratio,
          this.randomFn
        );
        account.due_at = now + jitteredMs;
      } else {
        // 失败分支：独立熔断
        const err = outcome.error;
        account.consecutive_failures += 1;

        if (err.class === 'rate_limit' || err.http_status === 429) {
          account.state = 'rate_limited';
          const nextDue = nextDueAfterFailure(
            account.poll_policy,
            account.consecutive_failures,
            err.retry_after_secs ?? null,
            now
          );
          account.due_at = nextDue;
          account.retry_at = nextDue;
        } else if (err.class === 'auth' || err.http_status === 401) {
          account.state = 'auth_expired';
          account.retry_at = null;
          // 凭据失效停止常规轮询
          account.due_at = Number.MAX_SAFE_INTEGER;
        } else if (err.class === 'deprecated') {
          account.state = 'service_deprecated';
          // 24 小时兜底探测
          const probe24h = now + 24 * 3600 * 1000;
          account.retry_at = probe24h;
          account.due_at = probe24h;
        } else {
          // network / timeout / http 5xx / schema
          account.state = 'offline_stale';
          const nextDue = nextDueAfterFailure(
            account.poll_policy,
            account.consecutive_failures,
            null,
            now
          );
          account.due_at = nextDue;
          account.retry_at = nextDue;
        }
      }
    } catch {
      // 未捕获异常兜底为 offline_stale，保持单账号隔离
      account.consecutive_failures += 1;
      account.state = 'offline_stale';
      account.due_at = nextDueAfterFailure(
        account.poll_policy,
        account.consecutive_failures,
        null,
        now
      );
      account.retry_at = account.due_at;
    } finally {
      account.in_flight = false;
    }
  }

  /**
   * 系统唤醒补偿 (system.wake)
   *
   * 规则（ARCHITECTURE.md §6.1 规则 4 & 验收要求 4）：
   * - 唤醒后只补算到期账号 (due_at <= now)
   * - 一次 tick 内每账号最多 1 次请求，绝不风暴
   * - 按 200ms 间隔分批，每批 ≤ 3 个，总时间预算 20s
   * - 超预算的账号保持 due，留待下一心跳继续
   */
  async handleWake(
    now: EpochMillis,
    sleepFn: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ): Promise<{
    processedAccountIds: string[];
    remainingDueCount: number;
  }> {
    const processed: string[] = [];
    const startTime = now;

    while (now - startTime < this.wakeBudgetMs) {
      // 选取当前到期且尚未在本次处理过的账号
      const tickRes = await this.tick(now);
      if (tickRes.processedAccountIds.length === 0) {
        break;
      }

      for (const id of tickRes.processedAccountIds) {
        processed.push(id);
      }

      // 检查是否仍有已到期账号
      const hasMoreDue = Array.from(this.accounts.values()).some(
        (a) => a.due_at <= now && !a.in_flight && a.state !== 'auth_expired'
      );

      if (!hasMoreDue) {
        break;
      }

      // 分批等待 200ms 间隔
      await sleepFn(this.wakeBatchDelayMs);
    }

    const remainingDue = Array.from(this.accounts.values()).filter(
      (a) => a.due_at <= now && !a.in_flight && a.state !== 'auth_expired'
    ).length;

    return {
      processedAccountIds: processed,
      remainingDueCount: remainingDue,
    };
  }

  /**
   * 面板打开即时刷新 (panel.opened)
   *
   * 规则（ARCHITECTURE.md §6.1 规则 6）：
   * - 对「剩余最低的 3 个 Normal 账号」发起一次即时刷新
   * - 受 last_attempt_at + 60s 下限约束（防抖），60s 内尝试过的直接跳过
   * - 同 provider 串行约束仍生效
   */
  async handlePanelOpen(now: EpochMillis): Promise<{
    refreshedAccountIds: readonly string[];
    debouncedAccountIds: readonly string[];
  }> {
    const normalAccounts: ScheduledAccount[] = [];
    const debouncedIds: string[] = [];

    for (const acc of this.accounts.values()) {
      if (acc.state !== 'normal' || acc.in_flight) {
        continue;
      }

      // 防抖检查：last_attempt_at + 60s > now 则跳过
      if (
        acc.last_attempt_at !== null &&
        now - acc.last_attempt_at < this.panelDebounceMs
      ) {
        debouncedIds.push(acc.account_id);
        continue;
      }

      normalAccounts.push(acc);
    }

    // 按 remaining_ratio 升序（额度最紧张的在前，null 视为 1.0 排在后）
    normalAccounts.sort((a, b) => {
      const ratioA = a.remaining_ratio ?? 1.0;
      const ratioB = b.remaining_ratio ?? 1.0;
      if (ratioA !== ratioB) {
        return ratioA - ratioB;
      }
      return (a.last_attempt_at ?? 0) - (b.last_attempt_at ?? 0);
    });

    // 选取至多 3 个，同 provider 串行
    const batch: ScheduledAccount[] = [];
    const providersInBatch = new Set<string>();

    for (const acc of normalAccounts) {
      if (batch.length >= 3) {
        break;
      }
      if (
        this.isProviderInFlight(acc.provider) ||
        providersInBatch.has(acc.provider)
      ) {
        continue;
      }
      batch.push(acc);
      providersInBatch.add(acc.provider);
    }

    if (batch.length === 0) {
      return {
        refreshedAccountIds: [],
        debouncedAccountIds: debouncedIds,
      };
    }

    for (const acc of batch) {
      acc.in_flight = true;
      acc.last_attempt_at = now;
    }

    await Promise.allSettled(
      batch.map((acc) => this.executeAccountFetch(acc, now))
    );

    return {
      refreshedAccountIds: batch.map((a) => a.account_id),
      debouncedAccountIds: debouncedIds,
    };
  }
}
