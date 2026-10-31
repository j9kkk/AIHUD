/**
 * AI HUD UI 格式化工具与视图模型定义 (Presentation & Format Helpers)
 * 契约规范：docs/ARCHITECTURE.md（第 1 章硬规则 6、第 3.8 节与 5.6 节）
 * 严格按照 docs/ARCHITECTURE.md 3.8 节与 core/src/domain/types.ts 映射
 */

// ==========================================
// 投影视图模型类型定义 (Presentation View Models)
// ==========================================

export type Tone = 'healthy' | 'warn' | 'hot' | 'neutral' | 'purple';

export type BuiltinProviderKind = 'claude' | 'codex' | 'workbuddy' | 'gemini';
export type ProviderKind = BuiltinProviderKind | `custom.${string}`;

export type MetricVisualKind =
  | 'dual_sliding_window'    // 双滑动窗口：外环短窗 + 内环长窗（同心双环 52px）
  | 'single_periodic_window' // 单周期窗口：单大环（48px/52px）
  | 'credits_pool';          // 积分池：积分环 + 绝对值

export type AccountHealthState =
  | 'never_synced'
  | 'normal'
  | 'offline_stale'
  | 'auth_expired'
  | 'rate_limited'
  | 'service_deprecated'
  | 'parse_degraded';

export interface RingArc {
  readonly ratio: number;
  readonly dash: string;
  readonly cap_color: string;
  readonly track_color: string;
  readonly glow: boolean;
}

export interface CardRingView {
  readonly mode: 'value' | 'unknown' | 'deprecated';
  readonly outer: RingArc | null;
  readonly inner: RingArc | null;
  readonly center_text: string;
  readonly center_tone: Tone;
}

export type PrimarySlotView =
  | { readonly kind: 'percent'; readonly text: string; readonly tone: Tone }
  | { readonly kind: 'absolute'; readonly text: string }
  | { readonly kind: 'status'; readonly text: string; readonly tone: Tone; readonly glyph: string };

export interface CardActionView {
  readonly kind: 'none' | 'retry' | 'reauth' | 'migrate';
  readonly label: string | null;
}

export interface AccountCardView {
  readonly account_id: string;
  readonly alias: string;
  readonly plan_name: string | null;
  readonly visual_kind: MetricVisualKind;
  readonly ring: CardRingView;
  readonly primary_slot: PrimarySlotView;
  readonly history_slot: { readonly text: string } | null;
  readonly reset_text: string | null;
  readonly action: CardActionView;
  readonly dimmed: boolean;
  readonly state?: AccountHealthState;
}

export interface MenuBarView {
  readonly text: string | null;
  readonly glyph: 'none' | 'stale' | 'auth' | 'rate' | 'deprecated';
  readonly tone: Tone;
  readonly tooltip: string;
}

export interface ChannelGroup {
  readonly provider: ProviderKind;
  readonly label: string;
  readonly accounts: readonly AccountCardView[];
  readonly worst: { readonly account_id: string; readonly text: string; readonly tone: Tone } | null;
  readonly page: { readonly index: number; readonly count: number };
}

export interface HudViewModel {
  readonly menu_bar: MenuBarView;
  readonly channels: readonly ChannelGroup[];
  readonly footer: {
    readonly last_refresh_at: number | null;
    readonly abnormal_count: number;
  };
}

// ==========================================
// 格式化函数实现 (Pure Formatters)
// ==========================================

/**
 * 格式化百分比读数（纯数字裸串，不带 %，不换行由 CSS white-space:nowrap 保证）
 * 缺失或非法值返回 null，绝不返回 '0'。
 */
export function formatPercent(ratio: number | null | undefined): string | null {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  return String(Math.round(clamped * 100));
}

/**
 * 格式化绝对数值（精简千分位表示，如 12,400 -> '12.4k'）
 */
export function formatAbsolute(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < 1000) {
    return `${sign}${Math.round(abs)}`;
  }
  if (abs < 1000000) {
    const k = +(abs / 1000).toFixed(1);
    return `${sign}${k}k`;
  }
  const m = +(abs / 1000000).toFixed(1);
  return `${sign}${m}M`;
}

/**
 * 格式化带千分位逗号的数字（如 15240 -> '15,240'）
 */
export function formatNumberWithCommas(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('en-US');
}

/**
 * 格式化倒计时（如 '45s'、'1h04m'、'3d'）
 */
export function formatCountdown(
  secondsOrEpoch: number | null | undefined,
  now?: number
): string | null {
  if (secondsOrEpoch === null || secondsOrEpoch === undefined || Number.isNaN(secondsOrEpoch)) {
    return null;
  }
  let remainingSecs: number;
  if (now !== undefined) {
    remainingSecs = Math.floor((secondsOrEpoch - now) / 1000);
  } else if (secondsOrEpoch > 10_000_000_000) {
    remainingSecs = Math.floor((secondsOrEpoch - Date.now()) / 1000);
  } else {
    remainingSecs = Math.floor(secondsOrEpoch);
  }

  if (remainingSecs <= 0) {
    return '已复位';
  }
  if (remainingSecs < 60) {
    return `${remainingSecs}s`;
  }
  if (remainingSecs < 3600) {
    const m = Math.floor(remainingSecs / 60);
    const s = remainingSecs % 60;
    return s > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${m}m`;
  }
  if (remainingSecs < 86400) {
    const h = Math.floor(remainingSecs / 3600);
    const m = Math.floor((remainingSecs % 3600) / 60);
    return `${h}h${String(m).padStart(2, '0')}m`;
  }
  const d = Math.floor(remainingSecs / 86400);
  const h = Math.floor((remainingSecs % 86400) / 3600);
  return h > 0 ? `${d}d${h}h` : `${d}d`;
}

/**
 * 色带函数（剩余语义，硬规则 6）：
 * - < 0.20: 'hot' (红)
 * - < 0.50: 'warn' (黄)
 * - >= 0.50: 'healthy' (绿)
 * - null: 'neutral' (中性灰)
 */
export function colorBand(ratio: number | null | undefined): Tone {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return 'neutral';
  }
  if (ratio < 0.20) return 'hot';
  if (ratio < 0.50) return 'warn';
  return 'healthy';
}

/**
 * Tone 到标准色值映射（高对比度语义色，regular material 对比度 ≥ 4.5:1）
 */
export function toneToColor(tone: Tone): string {
  switch (tone) {
    case 'healthy':
      return '#32D74B';
    case 'warn':
      return '#FFD60A';
    case 'hot':
      return '#FF453A';
    case 'purple':
      return '#BF5AF2';
    case 'neutral':
    default:
      return '#98A2B3';
  }
}

/**
 * Tone 到文本 CSS 类映射
 */
export function toneToTextClass(tone: Tone): string {
  switch (tone) {
    case 'healthy':
      return 'c-green';
    case 'warn':
      return 'c-yellow';
    case 'hot':
      return 'c-red';
    case 'purple':
      return 'c-violet';
    case 'neutral':
    default:
      return 'c-gray';
  }
}

/**
 * Tone 到徽标 Badge CSS 类映射
 */
export function toneToBadgeClass(tone: Tone): string {
  switch (tone) {
    case 'healthy':
      return 'badge--normal';
    case 'warn':
      return 'badge--warn';
    case 'hot':
      return 'badge--low';
    case 'purple':
      return 'badge--dep';
    case 'neutral':
    default:
      return 'badge--offline';
  }
}

/**
 * 渠道品牌主色
 */
export function providerToColor(provider: ProviderKind | string): string {
  switch (provider) {
    case 'claude':
      return '#D97757';
    case 'codex':
      return '#10A37F';
    case 'workbuddy':
      return '#0A84FF';
    case 'gemini':
      return '#4285F4';
    default:
      return '#8E8E93';
  }
}

/**
 * 渠道显示名
 */
export function providerToLabel(provider: ProviderKind | string): string {
  switch (provider) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'workbuddy':
      return 'WorkBuddy';
    case 'gemini':
      return 'Gemini';
    default:
      return provider.startsWith('custom.') ? provider.slice(7) : provider;
  }
}

/**
 * 格式化更新时刻（如 '12:30'）
 */
export function formatTime(millis: number | null | undefined): string {
  if (!millis) return '—';
  const d = new Date(millis);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
