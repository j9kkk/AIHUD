/**
 * SPEC S01：账号级边界（暂停 / 隐藏 / 版本号）+ I11–I13
 *
 * 三条规则的共同点：都只影响「要不要展示 / 要不要发请求」，
 * 绝不影响「读到了什么」——因此它们不能改写 reading、不能清空最后已知值。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertRevisionMonotonic,
  effectivePauseUntil,
  isVisible,
  nextRevision,
  validateAccountFlags,
} from '../../src/domain/invariants.js';
import { toChannelGroups } from '../../src/presentation/channels.js';
import { toCardView } from '../../src/presentation/card.js';
import type { AccountSnapshot } from '../../src/domain/types.js';

const NOW = 1_790_000_000_000;

function snap(over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    account_id: 'a1',
    provider: 'claude',
    region: 'global',
    alias: '工作主力',
    identity: { kind: 'email', masked: 'a***@ex.com' },
    plan_name: 'Max 5x',
    visual_kind: 'dual_sliding_window',
    reading: {
      kind: 'windows',
      windows: [
        {
          id: 'five_hour',
          label: '5 小时窗口',
          scope: 'account',
          duration_secs: 18000,
          remaining_ratio: 0.62,
          amount: { unit: 'percent', used: 38, limit: 100 },
          resets_at: NOW + 3600_000,
          exhausted: false,
          quality: 'exact',
          source_field: 'five_hour.utilization',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    },
    reading_observed_at: NOW - 60_000,
    state: 'normal',
    state_detail: { code: 'ok', message: '' },
    last_attempt_at: NOW - 60_000,
    last_success_at: NOW - 60_000,
    consecutive_failures: 0,
    retry_at: null,
    schema_version: 'claude.v1',
    ...over,
  } as AccountSnapshot;
}

describe('I11 暂停到期判定', () => {
  it('未来时刻保持；过去时刻等价于 null', () => {
    expect(effectivePauseUntil(NOW + 1000, NOW)).toBe(NOW + 1000);
    expect(effectivePauseUntil(NOW - 1000, NOW)).toBeNull();
    expect(effectivePauseUntil(NOW, NOW)).toBeNull();
  });

  it('缺省 / null / 非有限值都视为未暂停', () => {
    expect(effectivePauseUntil(undefined, NOW)).toBeNull();
    expect(effectivePauseUntil(null, NOW)).toBeNull();
    expect(effectivePauseUntil(Number.NaN, NOW)).toBeNull();
    expect(effectivePauseUntil(Number.POSITIVE_INFINITY, NOW)).toBeNull();
  });

  it('暂停不清空读数：最后已知值原样保留', () => {
    const s = snap({ pause_until: NOW + 60_000 });
    expect(s.reading).not.toBeNull();
    const card = toCardView(s, NOW);
    expect(card.ring.mode).toBe('value');
  });
});

describe('I12 隐藏只影响可见集合', () => {
  it('hidden=true 的账号被分组过滤，其余账号不受影响', () => {
    const visible = snap({ account_id: 'a1' });
    const hidden = snap({ account_id: 'a2', hidden: true });
    const groups = toChannelGroups([visible, hidden], { now: NOW });
    const all = groups.flatMap((g) => g.accounts);
    expect(all.map((a) => a.account_id)).toEqual(['a1']);
  });

  it('隐藏不等于暂停：仍在暂停的账号照常可见（要能显示「已暂停」角标）', () => {
    expect(isVisible({ hidden: false, pause_until: NOW + 60_000 }, NOW)).toBe(true);
    expect(isVisible({ hidden: true, pause_until: null }, NOW)).toBe(false);
    expect(isVisible({}, NOW)).toBe(true);
  });

  it('全部隐藏时分组为空而不是崩', () => {
    const groups = toChannelGroups([snap({ hidden: true })], { now: NOW });
    expect(groups).toEqual([]);
  });
});

describe('I13 版本号单调', () => {
  it('nextRevision 从 0 起递增', () => {
    expect(nextRevision(undefined)).toBe(1);
    expect(nextRevision(0)).toBe(1);
    expect(nextRevision(7)).toBe(8);
  });

  it('写入必须携带更大的 revision，否则判定冲突', () => {
    expect(assertRevisionMonotonic(3, 4)).toBe(true);
    expect(assertRevisionMonotonic(3, 3)).toBe(false);
    expect(assertRevisionMonotonic(3, 2)).toBe(false);
    expect(assertRevisionMonotonic(undefined, 1)).toBe(true);
    expect(assertRevisionMonotonic(3, undefined)).toBe(true);
  });
});

describe('账号级字段校验', () => {
  it('合法组合返回空数组', () => {
    expect(validateAccountFlags({ pause_until: null, hidden: false, revision: 0 })).toEqual([]);
    expect(validateAccountFlags({})).toEqual([]);
  });

  it('NaN 暂停时刻被拒', () => {
    expect(validateAccountFlags({ pause_until: Number.NaN })[0]?.field).toBe('pause_until');
  });

  it('超过一年的暂停时刻疑似秒/毫秒混用', () => {
    vi.setSystemTime(NOW);
    const issues = validateAccountFlags({ pause_until: NOW + 400 * 24 * 3600 * 1000 });
    expect(issues[0]?.field).toBe('pause_until');
    vi.useRealTimers();
  });

  it('revision 必须是非负整数', () => {
    expect(validateAccountFlags({ revision: -1 })[0]?.field).toBe('revision');
    expect(validateAccountFlags({ revision: 1.5 })[0]?.field).toBe('revision');
  });
});
