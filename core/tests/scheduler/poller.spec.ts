import { describe, it, expect, vi } from 'vitest';
import {
  Scheduler,
  DEFAULT_POLL_POLICY,
  type FetchHandler,
} from '../../src/scheduler/poller.js';

describe('Scheduler & Poller (docs/ARCHITECTURE.md §6.1, §6.2)', () => {
  const NOW = 1_000_000;

  describe('concurrency limit (default 3) & due calculation', () => {
    it('processes at most concurrency = 3 accounts per tick in due_at ascending order', async () => {
      const executed: string[] = [];
      const fetchHandler: FetchHandler = async (account) => {
        executed.push(account.account_id);
        return { ok: true };
      };

      const scheduler = new Scheduler({
        concurrency: 3,
        executeFetch: fetchHandler,
      });

      // 注册 5 个不同 provider 的到期账号
      scheduler.addAccount({
        account_id: 'acc_claude',
        provider: 'claude',
        due_at: 100, // 最早到期
      });
      scheduler.addAccount({
        account_id: 'acc_codex',
        provider: 'codex',
        due_at: 200,
      });
      scheduler.addAccount({
        account_id: 'acc_workbuddy',
        provider: 'workbuddy',
        due_at: 300,
      });
      scheduler.addAccount({
        account_id: 'acc_gemini',
        provider: 'gemini',
        due_at: 400,
      });
      scheduler.addAccount({
        account_id: 'acc_custom',
        provider: 'custom.other',
        due_at: 500,
      });

      const res = await scheduler.tick(NOW);

      // 仅选取前 3 个到期账号（升序）
      expect(res.processedAccountIds).toEqual([
        'acc_claude',
        'acc_codex',
        'acc_workbuddy',
      ]);
      expect(executed).toEqual([
        'acc_claude',
        'acc_codex',
        'acc_workbuddy',
      ]);

      // 未选中的账号保持原有 due_at
      expect(scheduler.getAccount('acc_gemini')?.due_at).toBe(400);
      expect(scheduler.getAccount('acc_custom')?.due_at).toBe(500);
    });

    it('ignores accounts where due_at > now', async () => {
      const executed: string[] = [];
      const scheduler = new Scheduler({
        executeFetch: async (acc) => {
          executed.push(acc.account_id);
          return { ok: true };
        },
      });

      scheduler.addAccount({
        account_id: 'acc_due',
        provider: 'claude',
        due_at: NOW - 100,
      });
      scheduler.addAccount({
        account_id: 'acc_future',
        provider: 'codex',
        due_at: NOW + 50_000, // 尚未到期
      });

      const res = await scheduler.tick(NOW);
      expect(res.processedAccountIds).toEqual(['acc_due']);
      expect(executed).toEqual(['acc_due']);
    });
  });

  describe('same provider serialization', () => {
    it('serializes accounts under the same provider (at most 1 in-flight per provider)', async () => {
      const executed: string[] = [];
      const scheduler = new Scheduler({
        concurrency: 3,
        executeFetch: async (acc) => {
          executed.push(acc.account_id);
          return { ok: true };
        },
      });

      // 注册同为 claude 的两个账号
      scheduler.addAccount({
        account_id: 'claude_1',
        provider: 'claude',
        due_at: 100,
      });
      scheduler.addAccount({
        account_id: 'claude_2',
        provider: 'claude',
        due_at: 150,
      });
      // 另一个不同 provider 账号
      scheduler.addAccount({
        account_id: 'codex_1',
        provider: 'codex',
        due_at: 120,
      });

      const res = await scheduler.tick(NOW);

      // claude 渠道只选取了 claude_1，claude_2 因同渠道串行被跳过
      expect(res.processedAccountIds).toEqual(['claude_1', 'codex_1']);
      expect(res.skippedDueToProviderInFlight).toContain('claude_2');
      expect(executed).toEqual(['claude_1', 'codex_1']);
    });
  });

  describe('tick idempotence', () => {
    it('does not re-execute accounts that are currently in-flight', async () => {
      let callCount = 0;
      let releaseBlock: () => void;
      const blockPromise = new Promise<void>((r) => {
        releaseBlock = r;
      });

      const scheduler = new Scheduler({
        executeFetch: async () => {
          callCount += 1;
          await blockPromise;
          return { ok: true };
        },
      });

      scheduler.addAccount({
        account_id: 'acc_block',
        provider: 'claude',
        due_at: 100,
      });

      // 第一次 tick 触发，但异步阻塞在途
      const firstTickPromise = scheduler.tick(NOW);

      // 第二次立即 tick：由于 acc_block 处于 in_flight，绝不会重复发起
      const secondTickRes = await scheduler.tick(NOW);
      expect(secondTickRes.processedAccountIds).toEqual([]);
      expect(callCount).toBe(1);

      // 解除阻塞
      releaseBlock!();
      await firstTickPromise;
    });
  });

  describe('system wake compensation & no storm (hard requirement 4)', () => {
    // 硬性验收 4: 睡眠唤醒后 tick 只补算到期账号，不风暴（一次 tick 内每账号最多 1 次请求）
    it('hard requirement 4: sleep wake tick only compensates due accounts, no request storm (max 1 request per account per tick)', async () => {
      const callLog: Record<string, number> = {};
      const scheduler = new Scheduler({
        concurrency: 10, // 设大并发以检验是否对单账号发起多次
        executeFetch: async (acc) => {
          callLog[acc.account_id] = (callLog[acc.account_id] ?? 0) + 1;
          return { ok: true };
        },
      });

      // 睡眠 5 小时后醒来：有 3 个账号由于睡眠严重逾期
      scheduler.addAccount({
        account_id: 'acc_overdue_1',
        provider: 'claude',
        due_at: NOW - 5 * 3600 * 1000, // 5小时前就已到期
      });
      scheduler.addAccount({
        account_id: 'acc_overdue_2',
        provider: 'codex',
        due_at: NOW - 2 * 3600 * 1000, // 2小时前到期
      });
      scheduler.addAccount({
        account_id: 'acc_overdue_3',
        provider: 'workbuddy',
        due_at: NOW - 1000,
      });
      // 另有 1 个账号未到期
      scheduler.addAccount({
        account_id: 'acc_not_due',
        provider: 'gemini',
        due_at: NOW + 600 * 1000, // 10分钟后才到期
      });

      // 执行唤醒 tick
      const tickRes = await scheduler.tick(NOW);

      // 1. 只补算到期账号：acc_not_due 未被请求
      expect(tickRes.processedAccountIds).toContain('acc_overdue_1');
      expect(tickRes.processedAccountIds).toContain('acc_overdue_2');
      expect(tickRes.processedAccountIds).toContain('acc_overdue_3');
      expect(tickRes.processedAccountIds).not.toContain('acc_not_due');
      expect(callLog['acc_not_due']).toBeUndefined();

      // 2. 不风暴：一次 tick 内每个账号最多 1 次请求
      expect(callLog['acc_overdue_1']).toBe(1);
      expect(callLog['acc_overdue_2']).toBe(1);
      expect(callLog['acc_overdue_3']).toBe(1);

      // 3. 成功后 due_at 被推移到未来绝对时刻，不会连续重复触发
      expect(scheduler.getAccount('acc_overdue_1')!.due_at).toBeGreaterThan(NOW);
      expect(scheduler.getAccount('acc_overdue_2')!.due_at).toBeGreaterThan(NOW);
      expect(scheduler.getAccount('acc_overdue_3')!.due_at).toBeGreaterThan(NOW);

      // 再次立即调用 tick，无任何账号再被触发
      const secondTick = await scheduler.tick(NOW);
      expect(secondTick.processedAccountIds).toEqual([]);
      expect(callLog['acc_overdue_1']).toBe(1);
    });

    it('handleWake processes overdue accounts in batches with 200ms delay up to 20s budget', async () => {
      const delays: number[] = [];
      const sleepMock = async (ms: number) => {
        delays.push(ms);
      };

      const scheduler = new Scheduler({
        concurrency: 2, // 每批 2 个
        wakeBatchDelayMs: 200,
        wakeBudgetMs: 20_000,
        executeFetch: async () => ({ ok: true }),
      });

      // 注册 4 个不同 provider 的到期账号
      scheduler.addAccount({ account_id: 'acc_1', provider: 'claude', due_at: 100 });
      scheduler.addAccount({ account_id: 'acc_2', provider: 'codex', due_at: 110 });
      scheduler.addAccount({ account_id: 'acc_3', provider: 'workbuddy', due_at: 120 });
      scheduler.addAccount({ account_id: 'acc_4', provider: 'gemini', due_at: 130 });

      const wakeRes = await scheduler.handleWake(NOW, sleepMock);

      expect(wakeRes.processedAccountIds.length).toBe(4);
      expect(wakeRes.remainingDueCount).toBe(0);
      // 4 个账号，每批 2 个，共 2 批，批次间休眠 1 次 200ms
      expect(delays).toEqual([200]);
    });
  });

  describe('panel open 60s debounce (docs/ARCHITECTURE.md §6.1 规则 6)', () => {
    it('refreshes top 3 lowest remaining Normal accounts, debounced by 60s', async () => {
      const refreshed: string[] = [];
      const scheduler = new Scheduler({
        panelDebounceMs: 60_000,
        executeFetch: async (acc) => {
          refreshed.push(acc.account_id);
          return { ok: true };
        },
      });

      // 注册 4 个 Normal 账号，不同剩余额度比例
      scheduler.addAccount({
        account_id: 'acc_lowest',
        provider: 'claude',
        state: 'normal',
        remaining_ratio: 0.05, // 5% 最低
        last_attempt_at: NOW - 120_000, // 120s 前尝试过，已过 60s 防抖期
      });
      scheduler.addAccount({
        account_id: 'acc_second',
        provider: 'codex',
        state: 'normal',
        remaining_ratio: 0.15, // 15% 次低
        last_attempt_at: NOW - 90_000,
      });
      scheduler.addAccount({
        account_id: 'acc_third',
        provider: 'workbuddy',
        state: 'normal',
        remaining_ratio: 0.30, // 30% 第三低
        last_attempt_at: NOW - 70_000,
      });
      scheduler.addAccount({
        account_id: 'acc_highest',
        provider: 'gemini',
        state: 'normal',
        remaining_ratio: 0.90, // 90% 最高
        last_attempt_at: NOW - 100_000,
      });
      // 注册 1 个 30s 前尝试过的账号（应被 60s 防抖拦截）
      scheduler.addAccount({
        account_id: 'acc_debounced',
        provider: 'custom.x',
        state: 'normal',
        remaining_ratio: 0.01, // 虽然极低，但仍在 60s 防抖内
        last_attempt_at: NOW - 30_000, // 30s < 60s
      });

      const res = await scheduler.handlePanelOpen(NOW);

      // acc_debounced 被防抖拦截
      expect(res.debouncedAccountIds).toContain('acc_debounced');
      // 选取了未被防抖且剩余最低的 3 个 Normal 账号
      expect(res.refreshedAccountIds).toEqual([
        'acc_lowest',
        'acc_second',
        'acc_third',
      ]);
      expect(refreshed).toEqual([
        'acc_lowest',
        'acc_second',
        'acc_third',
      ]);
    });
  });

  describe('I11 暂停：暂停期内不发请求，到期自动恢复', () => {
    it('pause_until 在未来的账号被跳过，其余账号照常执行', async () => {
      const executed: string[] = [];
      const scheduler = new Scheduler({
        concurrency: 3,
        executeFetch: async (account) => {
          executed.push(account.account_id);
          return { ok: true };
        },
      });

      scheduler.addAccount({ account_id: 'paused', provider: 'claude', due_at: 100, pause_until: 5_000 });
      scheduler.addAccount({ account_id: 'active', provider: 'codex', due_at: 100 });

      await scheduler.tick(1_000);
      expect(executed).toEqual(['active']);
    });

    it('暂停到期后无需重新注册，下一次 tick 自然恢复', async () => {
      const executed: string[] = [];
      const scheduler = new Scheduler({
        concurrency: 3,
        executeFetch: async (account) => {
          executed.push(account.account_id);
          return { ok: true };
        },
      });

      scheduler.addAccount({ account_id: 'paused', provider: 'claude', due_at: 100, pause_until: 5_000 });

      await scheduler.tick(4_999);
      expect(executed).toEqual([]);

      await scheduler.tick(5_001);
      expect(executed).toEqual(['paused']);
    });
  });
});
