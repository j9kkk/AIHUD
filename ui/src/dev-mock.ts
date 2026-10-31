/**
 * AI HUD 假数据与状态模拟 (Dev Mocks)
 * 覆盖：
 * 1. 7 个健康状态：normal, offline_stale, auth_expired, rate_limited, service_deprecated, parse_degraded, never_synced
 * 2. 3 种额度视觉类型：dual_sliding_window, single_periodic_window, credits_pool
 * 3. 极值状态：0% 耗尽（Normal 状态唯一合法 0%）
 * 4. 翻页场景（> 4 卡片）
 */

import type {
  HudViewModel,
  ChannelGroup,
  AccountCardView,
  AccountHealthState,
  MetricVisualKind,
} from './format.js';

export interface MockAccountCardView extends AccountCardView {
  readonly state: AccountHealthState;
}

/**
 * 7 个健康状态与 3 种视觉形态全覆盖账号清单
 */
export const mockAccounts: readonly MockAccountCardView[] = [
  // 1. Normal (双滑动窗口: dual_sliding_window) - Claude 工作主力
  {
    account_id: 'claude-main',
    alias: '工作主力',
    plan_name: '5h',
    visual_kind: 'dual_sliding_window',
    state: 'normal',
    ring: {
      mode: 'value',
      outer: {
        ratio: 0.62,
        dash: '88.04 142.00',
        cap_color: '#32D74B',
        track_color: 'rgba(0,0,0,0.55)',
        glow: true,
      },
      inner: {
        ratio: 0.41,
        dash: '42.25 103.04',
        cap_color: '#FFD60A',
        track_color: 'rgba(0,0,0,0.55)',
        glow: true,
      },
      center_text: '41%',
      center_tone: 'warn',
    },
    primary_slot: {
      kind: 'percent',
      text: '62',
      tone: 'healthy',
    },
    history_slot: {
      text: '1 周 41%',
    },
    reset_text: '14:35 重置 · 1h 04m',
    action: {
      kind: 'none',
      label: null,
    },
    dimmed: false,
  },

  // 2. Normal 耗尽 0% (双滑动窗口: dual_sliding_window) - Claude 客户 A 交付
  {
    account_id: 'claude-depleted',
    alias: '客户 A 交付',
    plan_name: '5h',
    visual_kind: 'dual_sliding_window',
    state: 'normal',
    ring: {
      mode: 'value',
      outer: {
        ratio: 0,
        dash: '0 142.00',
        cap_color: '#FF453A',
        track_color: 'rgba(0,0,0,0.55)',
        glow: false,
      },
      inner: {
        ratio: 0,
        dash: '0 103.04',
        cap_color: '#FF453A',
        track_color: 'rgba(0,0,0,0.55)',
        glow: false,
      },
      center_text: '0%',
      center_tone: 'hot',
    },
    primary_slot: {
      kind: 'percent',
      text: '0',
      tone: 'hot',
    },
    history_slot: null,
    reset_text: '已耗尽 · 14:35 重置',
    action: {
      kind: 'none',
      label: null,
    },
    dimmed: false,
  },

  // 3. OfflineStale (离线缓存) - Claude 交付备用
  {
    account_id: 'claude-offline',
    alias: '交付备用',
    plan_name: '5h',
    visual_kind: 'dual_sliding_window',
    state: 'offline_stale',
    ring: {
      mode: 'unknown',
      outer: null,
      inner: null,
      center_text: '?',
      center_tone: 'neutral',
    },
    primary_slot: {
      kind: 'status',
      text: '离线',
      tone: 'neutral',
      glyph: 'stale',
    },
    history_slot: {
      text: '最后 41% · 12:30',
    },
    reset_text: null,
    action: {
      kind: 'retry',
      label: '立即重试',
    },
    dimmed: true,
  },

  // 4. AuthExpired (凭据失效 401) - Codex 工作区
  {
    account_id: 'codex-auth',
    alias: 'Codex 工作区',
    plan_name: 'Pro',
    visual_kind: 'dual_sliding_window',
    state: 'auth_expired',
    ring: {
      mode: 'unknown',
      outer: null,
      inner: null,
      center_text: '!',
      center_tone: 'hot',
    },
    primary_slot: {
      kind: 'status',
      text: '凭据失效',
      tone: 'hot',
      glyph: 'auth',
    },
    history_slot: {
      text: '最后 35% · 11:20',
    },
    reset_text: null,
    action: {
      kind: 'reauth',
      label: '重新授权',
    },
    dimmed: true,
  },

  // 5. RateLimited (限流 429 冷却) - Gemini 个人配额 (单周期: single_periodic_window)
  {
    account_id: 'gemini-ratelimit',
    alias: '个人配额',
    plan_name: '1w',
    visual_kind: 'single_periodic_window',
    state: 'rate_limited',
    ring: {
      mode: 'unknown',
      outer: null,
      inner: null,
      center_text: '⏱',
      center_tone: 'warn',
    },
    primary_slot: {
      kind: 'status',
      text: '限流 45s',
      tone: 'warn',
      glyph: 'rate',
    },
    history_slot: {
      text: '最后 50% · 10:15',
    },
    reset_text: null,
    action: {
      kind: 'none',
      label: null,
    },
    dimmed: true,
  },

  // 6. ServiceDeprecated (接口已停服 403) - Gemini 旧配额 (single_periodic_window)
  {
    account_id: 'gemini-dep',
    alias: '旧 CLI 配额',
    plan_name: '停服',
    visual_kind: 'single_periodic_window',
    state: 'service_deprecated',
    ring: {
      mode: 'deprecated',
      outer: null,
      inner: null,
      center_text: '—',
      center_tone: 'purple',
    },
    primary_slot: {
      kind: 'status',
      text: '接口已停服',
      tone: 'purple',
      glyph: 'deprecated',
    },
    history_slot: {
      text: '最后 12% · 昨天',
    },
    reset_text: null,
    action: {
      kind: 'migrate',
      label: '迁移指南',
    },
    dimmed: true,
  },

  // 7. ParseDegraded (结构异常) - WorkBuddy 国际站 (积分池: credits_pool)
  {
    account_id: 'workbuddy-degraded',
    alias: '国际站团队',
    plan_name: '国际站',
    visual_kind: 'credits_pool',
    state: 'parse_degraded',
    ring: {
      mode: 'unknown',
      outer: null,
      inner: null,
      center_text: '!',
      center_tone: 'warn',
    },
    primary_slot: {
      kind: 'status',
      text: '结构异常',
      tone: 'warn',
      glyph: 'rate',
    },
    history_slot: {
      text: '最后 12,400 积分',
    },
    reset_text: null,
    action: {
      kind: 'retry',
      label: '立即重试',
    },
    dimmed: true,
  },

  // 8. NeverSynced (尚未同步) - WorkBuddy 研发中心 (credits_pool)
  {
    account_id: 'workbuddy-sync',
    alias: '研发中心',
    plan_name: '国内站',
    visual_kind: 'credits_pool',
    state: 'never_synced',
    ring: {
      mode: 'unknown',
      outer: null,
      inner: null,
      center_text: '—',
      center_tone: 'neutral',
    },
    primary_slot: {
      kind: 'status',
      text: '尚未同步',
      tone: 'neutral',
      glyph: 'none',
    },
    history_slot: null,
    reset_text: null,
    action: {
      kind: 'retry',
      label: '首次同步',
    },
    dimmed: true,
  },

  // 9. Normal 积分池 (credits_pool) - WorkBuddy 生产积分池
  {
    account_id: 'workbuddy-pool',
    alias: '生产积分池',
    plan_name: '国内站',
    visual_kind: 'credits_pool',
    state: 'normal',
    ring: {
      mode: 'value',
      outer: {
        ratio: 0.76,
        dash: '96.98 127.6',
        cap_color: '#32D74B',
        track_color: 'rgba(0,0,0,0.55)',
        glow: true,
      },
      inner: null,
      center_text: '76%',
      center_tone: 'healthy',
    },
    primary_slot: {
      kind: 'absolute',
      text: '15,240积分',
    },
    history_slot: {
      text: '总量 20,000',
    },
    reset_text: '积分池 · 无重置周期',
    action: {
      kind: 'none',
      label: null,
    },
    dimmed: false,
  },

  // 10. 自定义渠道 (custom.demo) —— 同一套 UI，仅数据格式与展示形态不同（S04 实证）
  {
    account_id: 'custom-demo',
    alias: '内网网关',
    plan_name: '自定义',
    visual_kind: 'credits_pool',
    state: 'normal',
    ring: {
      mode: 'value',
      outer: {
        ratio: 0.42,
        dash: '53.55 127.6',
        cap_color: '#32D74B',
        track_color: 'rgba(0,0,0,0.55)',
        glow: true,
      },
      inner: null,
      center_text: '42%',
      center_tone: 'healthy',
    },
    primary_slot: {
      kind: 'absolute',
      text: '4,200积分',
    },
    history_slot: {
      text: '总量 10,000',
    },
    reset_text: '滚动窗口 · 3 小时后复位',
    action: {
      kind: 'none',
      label: null,
    },
    dimmed: false,
  },
];

/**
 * 完整模拟 HudViewModel
 */
export const mockHudViewModel: HudViewModel = {
  menu_bar: {
    text: '62%',
    glyph: 'none',
    tone: 'healthy',
    tooltip: 'Claude 工作主力 62% · 5 个账号异常',
  },
  channels: [
    {
      provider: 'claude',
      label: 'Claude',
      accounts: [mockAccounts[0]!, mockAccounts[1]!, mockAccounts[2]!],
      worst: {
        account_id: 'claude-depleted',
        text: '0%',
        tone: 'hot',
      },
      page: {
        index: 1,
        count: 1,
      },
    },
    {
      provider: 'codex',
      label: 'Codex',
      accounts: [mockAccounts[3]!],
      worst: {
        account_id: 'codex-auth',
        text: '凭据失效',
        tone: 'hot',
      },
      page: {
        index: 1,
        count: 1,
      },
    },
    {
      provider: 'gemini',
      label: 'Gemini',
      accounts: [mockAccounts[4]!, mockAccounts[5]!],
      worst: {
        account_id: 'gemini-dep',
        text: '接口已停服',
        tone: 'purple',
      },
      page: {
        index: 1,
        count: 1,
      },
    },
    {
      provider: 'workbuddy',
      label: 'WorkBuddy',
      accounts: [mockAccounts[6]!, mockAccounts[7]!, mockAccounts[8]!],
      worst: {
        account_id: 'workbuddy-degraded',
        text: '结构异常',
        tone: 'warn',
      },
      page: {
        index: 1,
        count: 1,
      },
    },
    // 自定义渠道分组：UI 不认识 custom.demo，仍按同一投影规则渲染（S04 实证）
    {
      provider: 'custom.demo',
      label: '内网网关',
      accounts: [mockAccounts[9]!],
      worst: {
        account_id: 'custom-demo',
        text: '42%',
        tone: 'healthy',
      },
      page: {
        index: 1,
        count: 1,
      },
    },
  ],
  footer: {
    last_refresh_at: Date.now() - 38000,
    abnormal_count: 5,
  },
};
