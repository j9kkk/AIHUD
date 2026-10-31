/**
 * Claude 渠道读数归一化 (Claude Response Normalization)
 * 契约规范：docs/ARCHITECTURE.md（第 5.2 节 claude 双滑动窗口）
 */

import type { QuotaWindow, WindowsReading, ReadingQuality } from '../../domain/types.js';

export interface ClaudeNormalizedOutcome {
  readonly reading: WindowsReading;
  readonly warnings: readonly string[];
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'extra_usage',
]);

function clamp01(ratio: number): { ratio: number; clamped: boolean } {
  if (ratio < 0) {
    return { ratio: 0, clamped: true };
  }
  if (ratio > 1) {
    return { ratio: 1, clamped: true };
  }
  return { ratio: +ratio.toFixed(4), clamped: false };
}

function parseResetsAt(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 将 Claude usage 接口响应归一化为统一 WindowsReading。
 *
 * 核心不变式约束：
 * 1. remaining_ratio = 1 - utilization / 100；
 * 2. 缺失窗口严禁补 0；
 * 3. 字段漂移记入 warnings，不抛出异常。
 */
export function normalizeClaudeResponse(data: unknown): ClaudeNormalizedOutcome | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }

  const record = data as Record<string, unknown>;
  const warnings: string[] = [];

  // 检测未知顶层字段（字段漂移警告）
  for (const key of Object.keys(record)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`Unrecognized top-level field in claude response: "${key}"`);
    }
  }

  const windows: QuotaWindow[] = [];

  // 1. five_hour: 5 小时窗口
  if (record.five_hour && typeof record.five_hour === 'object') {
    const raw5h = record.five_hour as Record<string, unknown>;
    if (typeof raw5h.utilization === 'number' && !Number.isNaN(raw5h.utilization)) {
      const { ratio, clamped } = clamp01(1 - raw5h.utilization / 100);
      const resets_at = parseResetsAt(raw5h.resets_at);
      const quality: ReadingQuality = clamped ? 'clamped' : 'exact';

      windows.push({
        id: 'five_hour',
        label: '5 小时窗口',
        scope: 'account',
        duration_secs: 18000,
        remaining_ratio: ratio,
        amount: null,
        resets_at,
        exhausted: ratio === 0,
        quality,
        source_field: 'five_hour.utilization',
      });
    } else {
      warnings.push('five_hour window present but utilization is not a valid number');
    }
  }

  // 2. seven_day: 周窗口
  if (record.seven_day && typeof record.seven_day === 'object') {
    const raw7d = record.seven_day as Record<string, unknown>;
    if (typeof raw7d.utilization === 'number' && !Number.isNaN(raw7d.utilization)) {
      const { ratio, clamped } = clamp01(1 - raw7d.utilization / 100);
      const resets_at = parseResetsAt(raw7d.resets_at);
      const quality: ReadingQuality = clamped ? 'clamped' : 'exact';

      windows.push({
        id: 'seven_day',
        label: '周窗口',
        scope: 'account',
        duration_secs: 604800,
        remaining_ratio: ratio,
        amount: null,
        resets_at,
        exhausted: ratio === 0,
        quality,
        source_field: 'seven_day.utilization',
      });
    } else {
      warnings.push('seven_day window present but utilization is not a valid number');
    }
  }

  // 3. seven_day_opus: 模型级 Opus 专用周窗口（不进卡片主环，仅详情展示）
  if (record.seven_day_opus && typeof record.seven_day_opus === 'object') {
    const rawOpus = record.seven_day_opus as Record<string, unknown>;
    if (typeof rawOpus.utilization === 'number' && !Number.isNaN(rawOpus.utilization)) {
      const { ratio, clamped } = clamp01(1 - rawOpus.utilization / 100);
      const resets_at = parseResetsAt(rawOpus.resets_at);
      const quality: ReadingQuality = clamped ? 'clamped' : 'exact';

      windows.push({
        id: 'seven_day_opus',
        label: 'Opus 周窗口',
        scope: { model: 'opus' },
        duration_secs: 604800,
        remaining_ratio: ratio,
        amount: null,
        resets_at,
        exhausted: ratio === 0,
        quality,
        source_field: 'seven_day_opus.utilization',
      });
    } else {
      warnings.push('seven_day_opus window present but utilization is not a valid number');
    }
  }

  // 4. extra_usage: 额外用量金额（美分）
  let extra_usage_cents: number | null = null;
  if (record.extra_usage && typeof record.extra_usage === 'object') {
    const rawExtra = record.extra_usage as Record<string, unknown>;
    if (typeof rawExtra.amount_cents === 'number' && !Number.isNaN(rawExtra.amount_cents)) {
      extra_usage_cents = rawExtra.amount_cents;
    }
  }

  if (windows.length === 0) {
    return null;
  }

  return {
    reading: {
      kind: 'windows',
      windows,
      extra_usage_cents,
      credits_balance: null,
      reset_credits: null,
    },
    warnings,
  };
}
