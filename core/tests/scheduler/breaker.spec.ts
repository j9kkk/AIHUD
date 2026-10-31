import { describe, it, expect } from 'vitest';
import { Scheduler, type FetchHandler } from '../../src/scheduler/poller.js';
import type { Clock } from '../../src/ports/clock.js';
import type { QuotaReading } from '../../src/domain/types.js';

describe('Circuit Breaker Isolation (docs/ARCHITECTURE.md §6.4)', () => {
  class FakeClock implements Clock {
    private currentTime: number;

    constructor(initialTime: number) {
      this.currentTime = initialTime;
    }

    now(): number {
      return this.currentTime;
    }

    advance(ms: number): void {
      this.currentTime += ms;
    }

    set(time: number): void {
      this.currentTime = time;
    }
  }

  // 硬性验收 1: 假时钟 4 个账号并发：1 个 429 后 due_at 后移，其余 3 个 due_at 不变（独立熔断）
  it('hard requirement 1: with fake clock, 4 concurrent accounts: 1 gets 429 and its due_at moves back, other 3 due_at unchanged (independent circuit breaker)', async () => {
    const fakeClock = new FakeClock(1_000_000);
    const initialDue = 1_000_000;

    // 预置初始读数
    const sampleReading: QuotaReading = {
      kind: 'windows',
      windows: [
        {
          id: '5h',
          label: '5小时',
          scope: 'account',
          duration_secs: 18000,
          remaining_ratio: 0.8,
          amount: null,
          resets_at: 2_000_000,
          exhausted: false,
          quality: 'exact',
          source_field: 'five_hour',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    };

    // 4 个账号同时在途，其中 acc_claude 遇到 429（Retry-After 60s），其余 3 个保持在途或延迟完成
    let releaseOtherAccounts: () => void;
    const holdOthersPromise = new Promise<void>((resolve) => {
      releaseOtherAccounts = resolve;
    });

    const fetchHandler: FetchHandler = async (account) => {
      if (account.account_id === 'acc_claude') {
        // acc_claude 返回 429，Retry-After 60 秒
        return {
          ok: false,
          error: {
            class: 'rate_limit',
            http_status: 429,
            retry_after_secs: 60,
            message: 'Too many requests',
          },
        };
      }

      // 其他 3 个账号在途等待信号
      await holdOthersPromise;
      return {
        ok: true,
        reading: sampleReading,
        remaining_ratio: 0.8,
      };
    };

    const scheduler = new Scheduler({
      concurrency: 4, // 允许 4 个账号同时并发
      executeFetch: fetchHandler,
      randomFn: () => 0.5, // 确定性 jitter (0)
    });

    // 注册 4 个不同渠道的账号，初始 due_at 均为 initialDue (1,000,000)
    scheduler.addAccount({
      account_id: 'acc_claude',
      provider: 'claude',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });
    scheduler.addAccount({
      account_id: 'acc_codex',
      provider: 'codex',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });
    scheduler.addAccount({
      account_id: 'acc_workbuddy',
      provider: 'workbuddy',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });
    scheduler.addAccount({
      account_id: 'acc_gemini',
      provider: 'gemini',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });

    // 触发 tick(1,000,000)，4 个账号同时发起
    const tickPromise = scheduler.tick(fakeClock.now());

    // 等待微任务队列让 acc_claude 429 完成处理
    await new Promise((r) => setTimeout(r, 10));

    // 此时 acc_claude 遭遇 429：due_at 后移（至少 60s = 60,000ms）
    const claudeAcc = scheduler.getAccount('acc_claude')!;
    expect(claudeAcc.state).toBe('rate_limited');
    expect(claudeAcc.due_at).toBeGreaterThanOrEqual(initialDue + 60_000);
    expect(claudeAcc.consecutive_failures).toBe(1);

    // 断言：其余 3 个账号的 due_at 不变！依然等于 initialDue，读数未变，未受 429 污染（独立熔断）
    const codexAcc = scheduler.getAccount('acc_codex')!;
    const workbuddyAcc = scheduler.getAccount('acc_workbuddy')!;
    const geminiAcc = scheduler.getAccount('acc_gemini')!;

    expect(codexAcc.due_at).toBe(initialDue);
    expect(workbuddyAcc.due_at).toBe(initialDue);
    expect(geminiAcc.due_at).toBe(initialDue);

    expect(codexAcc.reading).toBe(sampleReading);
    expect(workbuddyAcc.reading).toBe(sampleReading);
    expect(geminiAcc.reading).toBe(sampleReading);

    // 释放其余账号完成
    releaseOtherAccounts!();
    await tickPromise;
  });

  it('proves isolation with 1 account 429 and 1 account 401: other 2 accounts remain normal & reading unchanged (ARCHITECTURE.md §6.4 line 912)', async () => {
    const NOW = 5_000_000;
    const initialDue = NOW;

    const sampleReading: QuotaReading = {
      kind: 'credits',
      pool: {
        unit: 'credits',
        remaining: 500,
        total: 1000,
        remaining_ratio: 0.5,
        packages: [],
        expires_at: null,
        source_field: 'summary.totalRemaining',
      },
    };

    const fetchHandler: FetchHandler = async (account) => {
      if (account.account_id === 'acc_429') {
        return {
          ok: false,
          error: {
            class: 'rate_limit',
            http_status: 429,
            retry_after_secs: 100,
            message: 'Rate limited',
          },
        };
      }
      if (account.account_id === 'acc_401') {
        return {
          ok: false,
          error: {
            class: 'auth',
            http_status: 401,
            message: 'Token expired',
          },
        };
      }
      // 其余两个账号正常成功
      return {
        ok: true,
        reading: sampleReading,
        remaining_ratio: 0.5,
      };
    };

    const scheduler = new Scheduler({
      concurrency: 4,
      executeFetch: fetchHandler,
      randomFn: () => 0.5, // 0 jitter
    });

    scheduler.addAccount({
      account_id: 'acc_429',
      provider: 'claude',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });
    scheduler.addAccount({
      account_id: 'acc_401',
      provider: 'codex',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });
    scheduler.addAccount({
      account_id: 'acc_ok_1',
      provider: 'workbuddy',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });
    scheduler.addAccount({
      account_id: 'acc_ok_2',
      provider: 'gemini',
      due_at: initialDue,
      state: 'normal',
      reading: sampleReading,
    });

    await scheduler.tick(NOW);

    const acc429 = scheduler.getAccount('acc_429')!;
    const acc401 = scheduler.getAccount('acc_401')!;
    const accOk1 = scheduler.getAccount('acc_ok_1')!;
    const accOk2 = scheduler.getAccount('acc_ok_2')!;

    // 1. acc_429: 进入 rate_limited，due_at 后移 100s
    expect(acc429.state).toBe('rate_limited');
    expect(acc429.due_at).toBe(NOW + 100 * 1000);
    expect(acc429.consecutive_failures).toBe(1);

    // 2. acc_401: 进入 auth_expired，retry_at 为 null，停止常规轮询
    expect(acc401.state).toBe('auth_expired');
    expect(acc401.retry_at).toBeNull();
    expect(acc401.due_at).toBe(Number.MAX_SAFE_INTEGER);

    // 3. 其余 2 个账号正常成功：状态为 normal，reading 未变
    expect(accOk1.state).toBe('normal');
    expect(accOk1.reading).toBe(sampleReading);
    expect(accOk1.consecutive_failures).toBe(0);

    expect(accOk2.state).toBe('normal');
    expect(accOk2.reading).toBe(sampleReading);
    expect(accOk2.consecutive_failures).toBe(0);

    // 4. 第二个 tick：在下一个周期前（如 NOW + 10s），429 还在冷却，401 已停轮询，正常账号未到期 => 0 个请求发起
    const secondTick = await scheduler.tick(NOW + 10_000);
    expect(secondTick.processedAccountIds).toEqual([]);
  });

  it('transitions to service_deprecated on 403 deprecated and schedules 24h fallback probe', async () => {
    const NOW = 2_000_000;
    const scheduler = new Scheduler({
      executeFetch: async () => ({
        ok: false,
        error: {
          class: 'deprecated',
          http_status: 403,
          message: 'Endpoint retired',
        },
      }),
    });

    scheduler.addAccount({
      account_id: 'gemini_deprecated',
      provider: 'gemini',
      due_at: NOW,
    });

    await scheduler.tick(NOW);

    const acc = scheduler.getAccount('gemini_deprecated')!;
    expect(acc.state).toBe('service_deprecated');
    expect(acc.retry_at).toBe(NOW + 24 * 3600 * 1000);
    expect(acc.due_at).toBe(NOW + 24 * 3600 * 1000);
  });

  it('transitions to offline_stale on network / 5xx error and increments consecutive_failures independently', async () => {
    const NOW = 3_000_000;
    const scheduler = new Scheduler({
      executeFetch: async (acc) => {
        if (acc.account_id === 'failing_acc') {
          return {
            ok: false,
            error: {
              class: 'network',
              message: 'DNS lookup timeout',
            },
          };
        }
        return { ok: true };
      },
    });

    scheduler.addAccount({
      account_id: 'failing_acc',
      provider: 'claude',
      due_at: NOW,
    });
    scheduler.addAccount({
      account_id: 'healthy_acc',
      provider: 'codex',
      due_at: NOW,
    });

    await scheduler.tick(NOW);

    const failing = scheduler.getAccount('failing_acc')!;
    const healthy = scheduler.getAccount('healthy_acc')!;

    expect(failing.state).toBe('offline_stale');
    expect(failing.consecutive_failures).toBe(1);

    // healthy 账号连续失败次数依然为 0
    expect(healthy.state).toBe('normal');
    expect(healthy.consecutive_failures).toBe(0);
  });
});
