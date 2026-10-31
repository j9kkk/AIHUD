/**
 * AI HUD 格式化函数 (Pure Formatting Utilities)
 * 契约规范：docs/ARCHITECTURE.md（第 1 章硬规则 6、第 3.8 节色带规范）
 *
 * 硬性要求：
 * 1. 缺失数值必须返回 null，绝不使用 0 兜底（严格禁止 `?? 0`、`|| 0`）。
 * 2. 百分比绝不换行由 ui 负责，formatPercent 必须返回不含空格的裸数字字符串。
 */

import type { Tone } from './types.js';

/**
 * 格式化百分比读数：
 * - 返回纯数字字符串（如 '9'、'50'、'100'），不带 '%'，不含前后空格。
 * - 结果为四舍五入整数，不产生小数位。
 * - 输入越界裁剪至 [0, 1] 区间（<0 剪为 '0'，>1 剪为 '100'）。
 * - 缺失或非法数值（null / undefined / NaN）一律返回 null，绝不返回 '0'。
 *
 * @param ratio 剩余比例 (0..1)
 * @returns 裸数字字符串（'0'..'100'）或 null
 */
export function formatPercent(ratio: number | null | undefined): string | null {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return null;
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  // D-02 裁决：向下取整。理由——四舍五入会把 0.996 显示成 100%，而 100% 在语义上
  // 等价于「满额度」，会掩盖已经发生的消耗；floor 永远不会把未耗尽读成满环。
  const intVal = Math.floor(clamped * 100);
  return String(intVal);
}

/**
 * 格式化绝对数值为精简千分位表示（如 12400 -> '12.4k'，20000 -> '20k'）。
 * - 缺失或非法数值返回 null。
 * - < 1,000 直接返回整数或精简数值。
 * - 1,000 ~ 999,999 格式化为 'k'。
 * - >= 1,000,000 格式化为 'M'。
 * - 最多保留 1 位有效小数，末尾 .0 自动抹除。
 *
 * @param value 绝对数量
 * @returns 格式化字符串或 null
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
 * 格式化倒计时（如 '45s'、'1h04m'、'3d'）。
 * - 负值或 0 一律返回 '已复位'。
 * - 缺失输入一律返回 null。
 * - 可接受剩余秒数，或绝对毫秒时间戳 + 当前时刻。
 *
 * @param secondsOrEpoch 剩余秒数或目标时刻绝对毫秒
 * @param now 可选的基准当前时刻（毫秒）
 * @returns 倒计时文案或 null
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
    // 自动识别为纪元毫秒
    remainingSecs = Math.floor((secondsOrEpoch - Date.now()) / 1000);
  } else {
    // 作为相对秒数
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
 * 剩余比例色带分档映射（硬规则 6）：
 * - < 0.20: 'hot' (红色 / 低额度危机)
 * - < 0.50: 'warn' (黄色 / 紧张预警)
 * - >= 0.50: 'healthy' (绿色 / 充裕健康)
 * - null/非法值: 'neutral' (中性灰)
 *
 * @param ratio 剩余比例 (0..1)
 * @returns Tone 语义档位
 */
export function colorBand(ratio: number | null | undefined): Tone {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return 'neutral';
  }
  if (ratio < 0.20) {
    return 'hot';
  }
  if (ratio < 0.50) {
    return 'warn';
  }
  return 'healthy';
}
