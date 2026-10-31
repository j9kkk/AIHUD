import { describe, it, expect } from 'vitest';
import type {
  AccountSnapshot,
  WindowsReading,
  CreditsReading,
  AccountHealthState,
  ProviderKind,
} from '../../src/domain/types.js';
import { toCardView } from '../../src/presentation/card.js';
import { toMenuBarView, getSnapshotRemainingRatio } from '../../src/presentation/menu-bar.js';
import { toChannelGroups, formatChannelLabel } from '../../src/presentation/channels.js';
import { bootstrap } from '../../src/bootstrap.js';
import { assertCardViewInvariants, assertInvariants } from '../../src/domain/invariants.js';

// 基础时间戳：2026-10-31 12:30:00 本地时间
const BASE_NOW = new Date(2026, 9, 31, 12, 30, 0).getTime();

function createWindowsReading(): WindowsReading {
  return {
    kind: 'windows',
    windows: [
      {
        id: 'five_hour',
        label: '5 小时窗口',
        scope: 'account',
        duration_secs: 18000,
        remaining_ratio: 0.09,
        amount: { unit: 'percent', used: 91, limit: 100 },
        resets_at: BASE_NOW + 3840 * 1000, // +1h04m
        exhausted: false,
        quality: 'exact',
        source_field: 'five_hour.utilization',
      },
      {
        id: 'seven_day',
        label: '周窗口',
        scope: 'account',
        duration_secs: 604800,
        remaining_ratio: 0.41,
        amount: { unit: 'percent', used: 59, limit: 100 },
        resets_at: BASE_NOW + 3 * 86400 * 1000, // +3d
        exhausted: false,
        quality: 'exact',
        source_field: 'seven_day.utilization',
      },
    ],
    extra_usage_cents: null,
    credits_balance: null,
    reset_credits: null,
  };
}

function createSnapshot(
  state: AccountHealthState,
  reading: WindowsReading | CreditsReading | null = createWindowsReading(),
  overrides: Partial<AccountSnapshot> = {}
): AccountSnapshot {
  return {
    account_id: `acc-${state}`,
    provider: 'claude' as ProviderKind,
    region: 'global',
    alias: '工作主力',
    identity: {
      real_identifier_masked: 'a***@corp.com',
      organization: 'Corp',
    },
    plan_name: 'Max 5x',
    visual_kind: 'dual_sliding_window',
    reading,
    reading_observed_at: BASE_NOW,
    state,
    state_detail: {
      reason: state === 'normal' ? 'network' : 'network',
      message: 'status detail',
      http_status: state === 'normal' ? 200 : 500,
      upstream_code: null,
      auth_action: 'none',
      migration_hint: null,
    },
    last_attempt_at: BASE_NOW,
    last_success_at: reading ? BASE_NOW : null,
    consecutive_failures: state === 'normal' ? 0 : 2,
    retry_at: state === 'rate_limited' ? BASE_NOW + 45 * 1000 : null,
    schema_version: 'v1.0',
    ...overrides,
  };
}

describe('toCardView: 硬性断言 1 - 7 个状态逐个断言非 normal 绝不为 percent', () => {
  it('1. state === "normal" => primary_slot.kind === "percent"', () => {
    const snap = createSnapshot('normal');
    const card = toCardView(snap, BASE_NOW);
    expect(card.primary_slot.kind).toBe('percent');
    if (card.primary_slot.kind === 'percent') {
      expect(card.primary_slot.text).toBe('9%');
      expect(card.primary_slot.tone).toBe('hot');
    }
    expect(card.dimmed).toBe(false);
    expect(() => assertCardViewInvariants(card, 'normal')).not.toThrow();
  });

  it('2. state === "never_synced" => primary_slot.kind !== "percent"', () => {
    const snap = createSnapshot('never_synced', null, {
      reading_observed_at: null,
      last_success_at: null,
    });
    const card = toCardView(snap, BASE_NOW);
    expect(card.primary_slot.kind).not.toBe('percent');
    expect(card.primary_slot.kind).toBe('status');
    expect(card.dimmed).toBe(true);
    expect(() => assertCardViewInvariants(card, 'never_synced')).not.toThrow();
  });

  it('3. state === "offline_stale" => primary_slot.kind !== "percent"', () => {
    const snap = createSnapshot('offline_stale');
    const card = toCardView(snap, BASE_NOW);
    expect(card.primary_slot.kind).not.toBe('percent');
    expect(card.primary_slot.kind).toBe('status');
    expect(card.primary_slot.text).toBe('离线');
    expect(card.dimmed).toBe(true);
    expect(() => assertCardViewInvariants(card, 'offline_stale')).not.toThrow();
  });

  it('4. state === "auth_expired" => primary_slot.kind !== "percent"', () => {
    const snap = createSnapshot('auth_expired');
    const card = toCardView(snap, BASE_NOW);
    expect(card.primary_slot.kind).not.toBe('percent');
    expect(card.primary_slot.kind).toBe('status');
    expect(card.primary_slot.text).toBe('凭据失效');
    expect(card.dimmed).toBe(true);
    expect(() => assertCardViewInvariants(card, 'auth_expired')).not.toThrow();
  });

  it('5. state === "rate_limited" => primary_slot.kind !== "percent"', () => {
    const snap = createSnapshot('rate_limited', createWindowsReading(), {
      retry_at: BASE_NOW + 45 * 1000,
    });
    const card = toCardView(snap, BASE_NOW);
    expect(card.primary_slot.kind).not.toBe('percent');
    expect(card.primary_slot.kind).toBe('status');
    expect(card.primary_slot.text).toBe('限流 45s');
    expect(card.dimmed).toBe(true);
    expect(() => assertCardViewInvariants(card, 'rate_limited')).not.toThrow();
  });

  it('6. state === "service_deprecated" => primary_slot.kind !== "percent"', () => {
    const snap = createSnapshot('service_deprecated');
    const card = toCardView(snap, BASE_NOW);
    expect(card.primary_slot.kind).not.toBe('percent');
    expect(card.primary_slot.kind).toBe('status');
    expect(card.primary_slot.text).toBe('接口已停服');
    expect(card.dimmed).toBe(true);
    expect(() => assertCardViewInvariants(card, 'service_deprecated')).not.toThrow();
  });

  it('7. state === "parse_degraded" => primary_slot.kind !== "percent"', () => {
    const snap = createSnapshot('parse_degraded');
    const card = toCardView(snap, BASE_NOW);
    expect(card.primary_slot.kind).not.toBe('percent');
    expect(card.primary_slot.kind).toBe('status');
    expect(card.primary_slot.text).toBe('数据格式异常');
    expect(card.dimmed).toBe(true);
    expect(() => assertCardViewInvariants(card, 'parse_degraded')).not.toThrow();
  });
});

describe('toCardView: 硬性断言 2 - reading === null 输出状态槽，且绝不出 0 或 100', () => {
  it('reading === null outputs status slot and never contains 0 or 100', () => {
    const states: AccountHealthState[] = [
      'never_synced',
      'offline_stale',
      'auth_expired',
      'rate_limited',
      'service_deprecated',
      'parse_degraded',
    ];

    for (const st of states) {
      const snap = createSnapshot(st, null, {
        reading_observed_at: null,
        last_success_at: null,
      });
      const card = toCardView(snap, BASE_NOW);

      // 绝不出 0 或 100
      expect(card.primary_slot.kind).toBe('status');
      expect(card.primary_slot.text).toBe('尚未同步');
      expect(card.primary_slot.text).not.toContain('0');
      expect(card.primary_slot.text).not.toContain('100');
      expect(card.primary_slot.text).not.toContain('%');

      expect(card.ring.center_text).not.toContain('0');
      expect(card.ring.center_text).not.toContain('100');
      expect(card.ring.center_text).toBe('?');

      expect(card.ring.mode).toBe('unknown');
      expect(card.ring.outer).toBeNull();
      expect(card.ring.inner).toBeNull();
      expect(card.history_slot).toBeNull();
      expect(card.reset_text).toBeNull();
      expect(card.action.kind).toBe('retry');
      expect(card.dimmed).toBe(true);
    }
  });
});

describe('toCardView: 五状态快照矩阵契约 (docs/ARCHITECTURE.md 3.8 表)', () => {
  it('matches normal state row', () => {
    const snap = createSnapshot('normal');
    const card = toCardView(snap, BASE_NOW);

    expect(card.ring.mode).toBe('value');
    expect(card.ring.center_text).toBe('9%');
    expect(card.ring.center_tone).toBe('hot');
    expect(card.ring.outer).not.toBeNull();
    expect(card.ring.inner).not.toBeNull();
    expect(card.primary_slot).toEqual({
      kind: 'percent',
      text: '9%',
      tone: 'hot',
    });
    expect(card.history_slot).toBeNull();
    expect(card.reset_text).toBe('恢 1h04m');
    expect(card.action).toEqual({ kind: 'none', label: null });
    expect(card.dimmed).toBe(false);
  });

  it('matches offline_stale state row', () => {
    const snap = createSnapshot('offline_stale');
    const card = toCardView(snap, BASE_NOW);

    expect(card.ring.mode).toBe('unknown');
    expect(card.ring.center_text).toBe('?');
    expect(card.ring.center_tone).toBe('neutral');
    expect(card.ring.outer).toBeNull();
    expect(card.ring.inner).toBeNull();
    expect(card.primary_slot).toEqual({
      kind: 'status',
      text: '离线',
      tone: 'neutral',
      glyph: '?',
    });
    expect(card.history_slot).toEqual({ text: '最后 9% · 12:30' });
    expect(card.reset_text).toBeNull();
    expect(card.action).toEqual({ kind: 'retry', label: '立即重试' });
    expect(card.dimmed).toBe(true);
  });

  it('matches auth_expired state row', () => {
    const snap = createSnapshot('auth_expired');
    const card = toCardView(snap, BASE_NOW);

    expect(card.ring.mode).toBe('unknown');
    expect(card.ring.center_text).toBe('!');
    expect(card.ring.center_tone).toBe('hot');
    expect(card.primary_slot).toEqual({
      kind: 'status',
      text: '凭据失效',
      tone: 'hot',
      glyph: '!',
    });
    expect(card.history_slot).toEqual({ text: '最后 9% · 12:30' });
    expect(card.reset_text).toBeNull();
    expect(card.action).toEqual({ kind: 'reauth', label: '重新授权' });
    expect(card.dimmed).toBe(true);
  });

  it('matches rate_limited state row', () => {
    const snap = createSnapshot('rate_limited', createWindowsReading(), {
      retry_at: BASE_NOW + 45 * 1000,
    });
    const card = toCardView(snap, BASE_NOW);

    expect(card.ring.mode).toBe('unknown');
    expect(card.ring.center_text).toBe('⏱');
    expect(card.ring.center_tone).toBe('warn');
    expect(card.primary_slot).toEqual({
      kind: 'status',
      text: '限流 45s',
      tone: 'warn',
      glyph: '⏱',
    });
    expect(card.history_slot).toEqual({ text: '最后 9% · 12:30' });
    expect(card.reset_text).toBeNull();
    expect(card.action).toEqual({ kind: 'none', label: null });
    expect(card.dimmed).toBe(true);
  });

  it('matches service_deprecated state row', () => {
    const snap = createSnapshot('service_deprecated');
    const card = toCardView(snap, BASE_NOW);

    expect(card.ring.mode).toBe('deprecated');
    expect(card.ring.center_text).toBe('—');
    expect(card.ring.center_tone).toBe('purple');
    expect(card.primary_slot).toEqual({
      kind: 'status',
      text: '接口已停服',
      tone: 'purple',
      glyph: '—',
    });
    expect(card.history_slot).toEqual({ text: '最后 9% · 12:30' });
    expect(card.reset_text).toBeNull();
    expect(card.action).toEqual({ kind: 'migrate', label: '迁移指南' });
    expect(card.dimmed).toBe(true);
  });
});

describe('toMenuBarView: 硬性断言 4 与聚合契约', () => {
  it('4. 菜单栏文案 <= 12 字符', () => {
    const snapNormal = createSnapshot('normal');
    const view = toMenuBarView([snapNormal]);
    expect(view.text).not.toBeNull();
    expect(view.text!.length).toBeLessThanOrEqual(12);
    expect(view.text).toBe('9%');
    expect(view.tone).toBe('hot');
    expect(view.glyph).toBe('none');
  });

  it('只取 state === "normal" 的最小剩余；无 Normal 时 text = null', () => {
    const snapNormal1 = createSnapshot('normal', {
      kind: 'windows',
      windows: [
        {
          id: 'w1',
          label: 'w1',
          scope: 'account',
          duration_secs: 3600,
          remaining_ratio: 0.85,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w1',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    }, { account_id: 'acc-normal-1', alias: '账号1' });

    const snapNormal2 = createSnapshot('normal', {
      kind: 'windows',
      windows: [
        {
          id: 'w2',
          label: 'w2',
          scope: 'account',
          duration_secs: 3600,
          remaining_ratio: 0.25,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w2',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    }, { account_id: 'acc-normal-2', alias: '账号2' });

    const snapOffline = createSnapshot('offline_stale', {
      kind: 'windows',
      windows: [
        {
          id: 'w3',
          label: 'w3',
          scope: 'account',
          duration_secs: 3600,
          remaining_ratio: 0.05, // 即使离线账号只有 5%，也绝不参与聚合
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w3',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    }, { account_id: 'acc-offline', alias: '离线账号' });

    const view = toMenuBarView([snapNormal1, snapNormal2, snapOffline]);
    // 应该取 normal 中的最小值 25%，而非 offline 的 5%
    expect(view.text).toBe('25%');
    expect(view.tone).toBe('warn');
    expect(view.tooltip).toContain('账号2 25%');
    expect(view.tooltip).toContain('1 个账号异常');
  });

  it('全部异常无 Normal 账号时 text 严格为 null', () => {
    const snap1 = createSnapshot('offline_stale');
    const snap2 = createSnapshot('auth_expired');
    const view = toMenuBarView([snap1, snap2]);

    expect(view.text).toBeNull();
    expect(view.glyph).toBe('auth');
    expect(view.tone).toBe('hot');
    expect(view.tooltip).toContain('2 个账号异常');
  });

  it('账号列表为空时返回标准空视图', () => {
    const view = toMenuBarView([]);
    expect(view.text).toBeNull();
    expect(view.glyph).toBe('none');
    expect(view.tone).toBe('neutral');
    expect(view.tooltip).toBe('未添加渠道');
  });
});

describe('toChannelGroups: 硬性断言 3 - 分组与组内排序、分页', () => {
  it('3. 分组排序：组内剩余升序，null 排在最后', () => {
    const snap1 = createSnapshot('normal', {
      kind: 'windows',
      windows: [
        {
          id: 'w1',
          label: 'w1',
          scope: 'account',
          duration_secs: 3600,
          remaining_ratio: 0.65,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w1',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    }, { account_id: 'acc-1', provider: 'claude' });

    const snap2 = createSnapshot('normal', {
      kind: 'windows',
      windows: [
        {
          id: 'w2',
          label: 'w2',
          scope: 'account',
          duration_secs: 3600,
          remaining_ratio: 0.12,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w2',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    }, { account_id: 'acc-2', provider: 'claude' });

    const snapNull = createSnapshot('never_synced', null, {
      account_id: 'acc-null',
      provider: 'claude',
      reading_observed_at: null,
      last_success_at: null,
    });

    const snap3 = createSnapshot('normal', {
      kind: 'windows',
      windows: [
        {
          id: 'w3',
          label: 'w3',
          scope: 'account',
          duration_secs: 3600,
          remaining_ratio: 0.35,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w3',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    }, { account_id: 'acc-3', provider: 'claude' });

    const groups = toChannelGroups([snap1, snapNull, snap2, snap3]);
    expect(groups).toHaveLength(1);
    const claudeGroup = groups[0]!;

    expect(claudeGroup.provider).toBe('claude');
    expect(claudeGroup.label).toBe('Claude');
    expect(claudeGroup.worst).toEqual({
      account_id: 'acc-2',
      text: '最少 12%',
      tone: 'hot',
    });

    // 顺序必须为：acc-2 (0.12) -> acc-3 (0.35) -> acc-1 (0.65) -> acc-null (null 排最后)
    const cardIds = claudeGroup.accounts.map((c) => c.account_id);
    expect(cardIds).toEqual(['acc-2', 'acc-3', 'acc-1', 'acc-null']);
  });

  it('分页逻辑：每渠道 8 张/页（2 行 × 4 格）', () => {
    // 创建 10 个账号
    const snapshots: AccountSnapshot[] = [];
    for (let i = 0; i < 10; i++) {
      snapshots.push(
        createSnapshot('normal', {
          kind: 'windows',
          windows: [
            {
              id: `w-${i}`,
              label: `w-${i}`,
              scope: 'account',
              duration_secs: 3600,
              remaining_ratio: i * 0.1,
              amount: null,
              resets_at: null,
              exhausted: false,
              quality: 'exact',
              source_field: 'w',
            },
          ],
          extra_usage_cents: null,
          credits_balance: null,
          reset_credits: null,
        }, { account_id: `card-${i}`, provider: 'codex' })
      );
    }

    // 默认获取第 0 页
    const groupsPage0 = toChannelGroups(snapshots, { pageSize: 8 });
    expect(groupsPage0[0]!.page).toEqual({ index: 0, count: 2 });
    expect(groupsPage0[0]!.accounts).toHaveLength(8);
    expect(groupsPage0[0]!.accounts[0]!.account_id).toBe('card-0');
    expect(groupsPage0[0]!.accounts[7]!.account_id).toBe('card-7');

    // 请求第 1 页
    const groupsPage1 = toChannelGroups(snapshots, {
      pageSize: 8,
      pages: { codex: 1 },
    });
    expect(groupsPage1[0]!.page).toEqual({ index: 1, count: 2 });
    expect(groupsPage1[0]!.accounts).toHaveLength(2);
    expect(groupsPage1[0]!.accounts[0]!.account_id).toBe('card-8');
    expect(groupsPage1[0]!.accounts[1]!.account_id).toBe('card-9');
  });
});

describe('bootstrap: 依赖注入与装配', () => {
  it('组装 registry + poller + ipc 绑定并能够触发 tick 与 getViewModel', async () => {
    const normalSnap = createSnapshot('normal');
    let tickCalled = false;
    let sentCommand: string | null = null;
    let sentPayload: unknown = null;
    const eventHandlers: Record<string, Function> = {};

    const kernel = bootstrap({
      registry: {
        get: () => ({}),
        list: () => [],
      },
      poller: {
        tick: () => {
          tickCalled = true;
        },
      },
      ipc: {
        on: (event, handler) => {
          eventHandlers[event] = handler;
        },
        send: (cmd, payload) => {
          sentCommand = cmd;
          sentPayload = payload;
          return { ok: true };
        },
      },
      storage: {
        loadSnapshots: () => [normalSnap],
      },
      now: () => BASE_NOW,
    });

    // 初始状态
    expect(eventHandlers['core.tick']).toBeDefined();
    expect(eventHandlers['system.wake']).toBeDefined();
    expect(eventHandlers['get_view_model']).toBeDefined();

    // 验证 getViewModel
    const vm = await kernel.getViewModel();
    expect(vm.menu_bar.text).toBe('9%');
    expect(vm.channels).toHaveLength(1);
    expect(vm.footer.abnormal_count).toBe(0);

    // 验证 tick
    await kernel.tick();
    expect(tickCalled).toBe(true);
    expect(sentCommand).toBe('tray.set_view');
    expect((sentPayload as any).text).toBe('9%');

    // 验证通过事件触发 core.tick
    tickCalled = false;
    await eventHandlers['core.tick']!();
    expect(tickCalled).toBe(true);
  });
});
