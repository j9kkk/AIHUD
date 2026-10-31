/**
 * 自定义渠道归一化 (Custom Normalize)
 * 契约规范：docs/ARCHITECTURE.md §4.6 + docs/SPEC.md S04 / S08
 *
 * 三条不可协商的规则（与内置驱动完全一致）：
 *   R1. total 缺失 / 为 0 / 非数 ⇒ 整条读数作废（schema 错误），**绝不**退化成 0% 或 100%；
 *   R2. remaining > total 超过容差 ⇒ 越界（out_of_range），不裁剪成 100% 假装健康；
 *   R3. remaining === 0 才允许 exhausted=true；其余情况一律 false，避免误报耗尽。
 */

import type {
  CreditsPool,
  WindowsReading,
  QuotaWindow,
  MetricVisualKind,
} from '../../domain/types.js';
import type { DriverError } from '../driver.js';
import { driverError } from '../driver.js';
import { readPath, type CustomChannelConfig } from './config.js';

/** 允许的浮点噪声：网关常做四舍五入，1% 以内不算越界 */
const RANGE_TOLERANCE = 1.005;

export type CustomNormalizeResult =
  | { readonly ok: true; readonly reading: CreditsPool | WindowsReading }
  | { readonly ok: false; readonly error: DriverError };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 复位时间：epoch 秒 / epoch 毫秒 / ISO8601 三种写法统一成毫秒 */
export function parseResetAt(raw: unknown): number | null {
  if (isFiniteNumber(raw)) {
    if (raw <= 0) return null;
    // 10 位秒级时间戳在 2286 年前都小于 1e12
    return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

const WINDOW_LABEL: Record<string, string> = {
  rolling: '滚动窗口',
  five_hour: '5 小时窗口',
  daily: '日窗口',
  weekly: '周窗口',
  monthly: '月窗口',
};

export function normalizeCustom(
  cfg: CustomChannelConfig,
  payload: unknown
): CustomNormalizeResult {
  const remainingRaw = readPath(payload, cfg.json.remaining);
  const totalRaw = readPath(payload, cfg.json.total);

  if (!isFiniteNumber(remainingRaw)) {
    return {
      ok: false,
      error: driverError('parse_degraded', {
        message: `剩余额度字段缺失或非数值：${cfg.json.remaining}`,
        http_status: null,
      }),
    };
  }

  if (remainingRaw < 0) {
    return {
      ok: false,
      error: driverError('parse_degraded', {
        message: `剩余额度为负数（${remainingRaw}），判定为上游异常`,
        http_status: null,
      }),
    };
  }

  if (!isFiniteNumber(totalRaw) || totalRaw <= 0) {
    return {
      ok: false,
      error: driverError('parse_degraded', {
        message: `总量字段缺失或非正数（${cfg.json.total}），无法计算比例——拒绝用 0%/100% 冒充`,
        http_status: null,
      }),
    };
  }

  if (remainingRaw > totalRaw * RANGE_TOLERANCE) {
    return {
      ok: false,
      error: driverError('parse_degraded', {
        message: `剩余 ${remainingRaw} 大于总量 ${totalRaw}，超出容差，判定为越界`,
        http_status: null,
      }),
    };
  }

  const ratio = Math.max(0, Math.min(1, remainingRaw / totalRaw));
  const resetsAt =
    cfg.json.resets_at !== undefined ? parseResetAt(readPath(payload, cfg.json.resets_at)) : null;
  const windowId = cfg.json.window_id ?? 'rolling';
  const visual: MetricVisualKind = cfg.visual ?? 'credits_pool';

  if (visual === 'single_periodic_window') {
    const window: QuotaWindow = {
      id: windowId,
      label: WINDOW_LABEL[windowId] ?? windowId,
      scope: 'account',
      duration_secs: null,
      remaining_ratio: ratio,
      amount: {
        unit: cfg.unit ?? 'credits',
        used: Math.round(totalRaw - remainingRaw),
        limit: Math.round(totalRaw),
      },
      resets_at: resetsAt,
      exhausted: remainingRaw === 0,
      quality: 'exact',
      source_field: cfg.json.remaining,
    };
    const reading: WindowsReading = {
      kind: 'windows',
      windows: [window],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    };
    return { ok: true, reading };
  }

  const pool: CreditsPool = {
    unit: 'credits',
    remaining: remainingRaw,
    total: totalRaw,
    remaining_ratio: ratio,
    packages: [],
    expires_at: resetsAt,
    source_field: cfg.json.remaining,
  };
  return { ok: true, reading: pool };
}
