import { describe, it, expect } from 'vitest';
import {
  evaluateRefreshGate,
  RefreshLeaseLock,
  SingleFlight,
  RefreshCoordinator,
  REFRESH_LEASE_DURATION_MS,
} from '../../src/scheduler/refresh.js';

describe('Refresh Gate & Single-Flight Coordinator (docs/ARCHITECTURE.md §6.5 & FLOWS.md §14)', () => {
  const NOW = 10_000_000;

  describe('evaluateRefreshGate (5 intervals & state gating)', () => {
    // 硬性验收 2: evaluateRefreshGate 5 个区间全覆盖（expires_at-now 为 -1s/0/30s/1h/24h）
    it('hard requirement 2: interval 1 -> expires_at - now = -1s (-1000ms): returns refresh_before_fetch', () => {
      const gate = evaluateRefreshGate({
        expires_at: NOW - 1000, // -1s
        now: NOW,
        can_refresh: true,
        state: 'normal',
      });
      expect(gate).toBe('refresh_before_fetch');
    });

    it('hard requirement 2: interval 2 -> expires_at - now = 0 (0ms): returns refresh_before_fetch', () => {
      const gate = evaluateRefreshGate({
        expires_at: NOW, // 0s
        now: NOW,
        can_refresh: true,
        state: 'normal',
      });
      expect(gate).toBe('refresh_before_fetch');
    });

    it('hard requirement 2: interval 3 -> expires_at - now = 30s (+30,000ms): returns skip (rule 5: never pre-refresh)', () => {
      const gate = evaluateRefreshGate({
        expires_at: NOW + 30_000, // +30s
        now: NOW,
        can_refresh: true,
        state: 'normal',
      });
      expect(gate).toBe('skip');
    });

    it('hard requirement 2: interval 4 -> expires_at - now = 1h (+3,600,000ms): returns skip', () => {
      const gate = evaluateRefreshGate({
        expires_at: NOW + 3_600_000, // +1h
        now: NOW,
        can_refresh: true,
        state: 'normal',
      });
      expect(gate).toBe('skip');
    });

    it('hard requirement 2: interval 5 -> expires_at - now = 24h (+86,400,000ms): returns skip', () => {
      const gate = evaluateRefreshGate({
        expires_at: NOW + 86_400_000, // +24h
        now: NOW,
        can_refresh: true,
        state: 'normal',
      });
      expect(gate).toBe('skip');
    });

    it('returns forbidden if driver cannot refresh (can_refresh = false)', () => {
      expect(
        evaluateRefreshGate({
          expires_at: NOW - 1000,
          now: NOW,
          can_refresh: false,
          state: 'normal',
        })
      ).toBe('forbidden');

      expect(
        evaluateRefreshGate({
          expires_at: NOW + 3600_000,
          now: NOW,
          can_refresh: false,
          state: 'normal',
        })
      ).toBe('forbidden');
    });

    it('returns forbidden under rate_limited or service_deprecated state', () => {
      expect(
        evaluateRefreshGate({
          expires_at: NOW - 1000,
          now: NOW,
          can_refresh: true,
          state: 'rate_limited',
        })
      ).toBe('forbidden');

      expect(
        evaluateRefreshGate({
          expires_at: NOW - 1000,
          now: NOW,
          can_refresh: true,
          state: 'service_deprecated',
        })
      ).toBe('forbidden');
    });

    it('handles 401 response: refresh_after_401 on first 401, forbidden on repeated 401 in same tick', () => {
      // 首次遇到 401: 触发被动单飞刷新
      const first401 = evaluateRefreshGate({
        expires_at: NOW + 3600_000,
        now: NOW,
        can_refresh: true,
        state: 'normal',
        http_status: 401,
        already_refreshed_this_tick: false,
      });
      expect(first401).toBe('refresh_after_401');

      // 本轮已刷新过一次仍 401: 禁止二次刷新，直接报失效
      const second401 = evaluateRefreshGate({
        expires_at: NOW + 3600_000,
        now: NOW,
        can_refresh: true,
        state: 'normal',
        http_status: 401,
        already_refreshed_this_tick: true,
      });
      expect(second401).toBe('forbidden');
    });

    it('returns skip for token with no expires_at (expires_at = null)', () => {
      expect(
        evaluateRefreshGate({
          expires_at: null,
          now: NOW,
          can_refresh: true,
          state: 'normal',
        })
      ).toBe('skip');
    });
  });

  describe('SingleFlight lock', () => {
    it('deduplicates concurrent calls with identical keys', async () => {
      const flight = new SingleFlight<string>();
      let executionCount = 0;

      const task = async () => {
        executionCount += 1;
        await new Promise((r) => setTimeout(r, 20));
        return 'token_v2';
      };

      const [res1, res2, res3] = await Promise.all([
        flight.do('claude:acc_1', task),
        flight.do('claude:acc_1', task),
        flight.do('claude:acc_1', task),
      ]);

      expect(res1).toBe('token_v2');
      expect(res2).toBe('token_v2');
      expect(res3).toBe('token_v2');
      expect(executionCount).toBe(1); // 仅执行一次
      expect(flight.isInFlight('claude:acc_1')).toBe(false);
    });

    it('runs distinct keys concurrently', async () => {
      const flight = new SingleFlight<string>();
      let count = 0;

      const [resA, resB] = await Promise.all([
        flight.do('claude:acc_1', async () => {
          count += 1;
          return 'res_a';
        }),
        flight.do('codex:acc_2', async () => {
          count += 1;
          return 'res_b';
        }),
      ]);

      expect(resA).toBe('res_a');
      expect(resB).toBe('res_b');
      expect(count).toBe(2);
    });
  });

  describe('RefreshLeaseLock (90s lease)', () => {
    it('defaults to 90 seconds (90,000 ms) lease duration', () => {
      expect(REFRESH_LEASE_DURATION_MS).toBe(90_000);
      const lock = new RefreshLeaseLock();
      const lease = lock.acquire('acc_1', NOW);
      expect(lease).not.toBeNull();
      expect(lease?.expires_at).toBe(NOW + 90_000);
      expect(lease?.acquired_at).toBe(NOW);
    });

    it('rejects acquire while existing lease is still active', () => {
      const lock = new RefreshLeaseLock();
      const lease1 = lock.acquire('acc_1', NOW);
      expect(lease1).not.toBeNull();

      // 在 90s 内重复获取：返回 null
      const leaseDuplicate = lock.acquire('acc_1', NOW + 45_000);
      expect(leaseDuplicate).toBeNull();

      // 查询当前活跃租约
      const active = lock.getLease('acc_1', NOW + 45_000);
      expect(active?.lease_id).toBe(lease1?.lease_id);
    });

    it('allows acquire after 90s lease expires', () => {
      const lock = new RefreshLeaseLock();
      const lease1 = lock.acquire('acc_1', NOW);
      expect(lease1).not.toBeNull();

      // 90s 之后过期重获：成功
      const lease2 = lock.acquire('acc_1', NOW + 90_001);
      expect(lease2).not.toBeNull();
      expect(lease2?.lease_id).not.toBe(lease1?.lease_id);
    });

    it('releases lease explicitly', () => {
      const lock = new RefreshLeaseLock();
      const lease = lock.acquire('acc_1', NOW);
      expect(lease).not.toBeNull();

      const released = lock.release('acc_1', lease?.lease_id);
      expect(released).toBe(true);

      // 释放后可立即重新获取
      const newLease = lock.acquire('acc_1', NOW + 1000);
      expect(newLease).not.toBeNull();
    });
  });

  describe('RefreshCoordinator', () => {
    it('executes single-flight refresh protected by lease', async () => {
      const coordinator = new RefreshCoordinator(90_000);
      let runCount = 0;

      const refreshFn = async () => {
        runCount += 1;
        await new Promise((r) => setTimeout(r, 15));
        return { newRevision: 'rev_99' };
      };

      const [r1, r2] = await Promise.all([
        coordinator.executeRefresh('acc_test', NOW, refreshFn),
        coordinator.executeRefresh('acc_test', NOW, refreshFn),
      ]);

      expect(r1).toEqual({ ok: true, value: { newRevision: 'rev_99' } });
      expect(r2).toEqual({ ok: true, value: { newRevision: 'rev_99' } });
      expect(runCount).toBe(1);
    });
  });
});
