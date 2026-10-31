/**
 * Gemini Cookie GraphQL / Web 端点数据归一化
 * 契约规范：docs/ARCHITECTURE.md 第 5.5 节
 */

import type {
  QuotaWindow,
  WindowsReading,
  EpochMillis,
} from '../../domain/types.js';

function clamp01(val: number): number {
  if (Number.isNaN(val)) return 0;
  if (val <= 0) return 0;
  if (val >= 1) return 1;
  return val;
}

function parseEpoch(val: unknown): EpochMillis | null {
  if (val == null) return null;
  if (typeof val === 'number' && !Number.isNaN(val) && val > 0) {
    return val;
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export interface NormalizeCookieOutcome {
  readonly reading: WindowsReading;
  readonly warnings: readonly string[];
}

/**
 * 归一化 Cookie 通道返回的 JSON 数据
 */
export function normalizeGeminiCookie(bodyText: string): NormalizeCookieOutcome {
  if (!bodyText || bodyText.trim() === '') {
    throw new Error('Gemini response body is empty (empty_response)');
  }

  let raw: any;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    throw new Error('Gemini response is not valid JSON (parse_error)');
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('Gemini JSON payload must be an object');
  }

  const warnings: string[] = [];
  const root =
    raw.data?.userQuota ??
    raw.data?.usage ??
    raw.user_quota ??
    raw.quota ??
    raw;

  let remainingRatio: number | null = null;
  if (typeof root.remaining_ratio === 'number') {
    remainingRatio = clamp01(root.remaining_ratio);
  } else if (typeof root.remainingRatio === 'number') {
    remainingRatio = clamp01(root.remainingRatio);
  } else if (typeof root.remaining === 'number' && typeof root.total === 'number' && root.total > 0) {
    remainingRatio = clamp01(root.remaining / root.total);
  } else if (typeof root.used === 'number' && typeof root.limit === 'number' && root.limit > 0) {
    remainingRatio = clamp01(1 - root.used / root.limit);
  } else if (typeof root.used_percent === 'number') {
    remainingRatio = clamp01(1 - root.used_percent / 100);
  } else if (typeof root.utilization === 'number') {
    remainingRatio = clamp01(1 - root.utilization / 100);
  }

  if (remainingRatio === null) {
    throw new Error('Unable to derive remaining_ratio from Gemini Cookie response');
  }

  let durationSecs: number = 604800; // 默认周配额
  if (typeof root.duration_secs === 'number' && root.duration_secs > 0) {
    durationSecs = root.duration_secs;
  } else if (typeof root.period_seconds === 'number' && root.period_seconds > 0) {
    durationSecs = root.period_seconds;
  } else if (root.period === 'daily' || root.window_type === 'daily') {
    durationSecs = 86400;
  }

  const id = durationSecs <= 86400 ? 'daily' : 'weekly';
  const label = durationSecs <= 86400 ? '日窗口' : '周窗口';
  const resetsAt = parseEpoch(root.resets_at ?? root.reset_at ?? root.reset_time);

  const window: QuotaWindow = {
    id,
    label,
    scope: 'account',
    duration_secs: durationSecs,
    remaining_ratio: remainingRatio,
    amount: null,
    resets_at: resetsAt,
    exhausted: remainingRatio === 0,
    quality: 'exact',
    source_field: 'cookie.gemini.usage',
  };

  const reading: WindowsReading = {
    kind: 'windows',
    windows: [window],
    extra_usage_cents: null,
    credits_balance: null,
    reset_credits: null,
  };

  return { reading, warnings };
}
