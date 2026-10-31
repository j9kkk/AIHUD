/**
 * AI HUD 视觉几何与形态计算 (Visual Geometry & Kind Derivation)
 * 契约规范：docs/ARCHITECTURE.md（第 3.2 节、第 5.6 节视觉形态差异）
 */

import type { MetricVisualKind, QuotaReading } from './types.js';

/**
 * 环轨几何参数
 */
export interface RingArcGeometry {
  /** 环心到中心线的半径 (px) */
  readonly radius: number;
  /** 描边粗细 (px) */
  readonly stroke_width: number;
  /** 环周长 2 * Math.PI * radius */
  readonly circumference: number;
}

/**
 * 完整圆环组件的几何参数定义
 */
export interface RingGeometry {
  /** 视觉容器直径 (px) */
  readonly size: number;
  /** 外环几何参数 */
  readonly outer: RingArcGeometry;
  /** 内环几何参数（双环独有；单环/积分环为 null） */
  readonly inner: RingArcGeometry | null;
  /** 外环内缘与内环外缘间隙 (px) */
  readonly gap: number | null;
}

/**
 * 推导指标的视觉形态 (MetricVisualKind)。
 * 契约规则（第 3.2 节）：
 * 1. reading 为 null 时返回 fallback（默认 'single_periodic_window'）。
 * 2. reading.kind === 'credits' 返回 'credits_pool'。
 * 3. reading.kind === 'windows' 时：
 *    - windows.length >= 2 返回 'dual_sliding_window'。
 *    - windows.length < 2 返回 'single_periodic_window'。
 *
 * @param reading 探活读数
 * @param fallback 缺省形态
 */
export function deriveVisualKind(
  reading: QuotaReading | null,
  fallback: MetricVisualKind = 'single_periodic_window'
): MetricVisualKind {
  if (reading === null) {
    return fallback;
  }
  if (reading.kind === 'credits') {
    return 'credits_pool';
  }
  return reading.windows.length >= 2 ? 'dual_sliding_window' : 'single_periodic_window';
}

/**
 * 获取对应视觉形态的几何参数。
 * 契约规则（第 5.6 节）：
 * - 卡片态 (card):
 *   - dual_sliding_window: 52px 直径，外环 r=22.6 / 3.8px，内环 r=16.4 / 3.4px，间隙 2.6px
 *   - single_periodic_window: 48px 直径，外环 r=20.3 / 4.6px，无内环
 *   - credits_pool: 48px 直径，外环 r=20.3 / 4.6px，无内环
 * - 详情态 (detail):
 *   - 直径统一为 74px
 *   - dual_sliding_window: 外环 r=32.2 / 5.4px，内环 r=23.3 / 4.9px
 *   - single_periodic_window / credits_pool: 外环 r=29.0 / 6.6px
 *
 * @param kind 视觉形态类型
 * @param sizeVariant 尺寸变体：'card' (默认) 或 'detail'
 */
export function ringGeometryFor(
  kind: MetricVisualKind,
  sizeVariant: 'card' | 'detail' = 'card'
): RingGeometry {
  if (sizeVariant === 'card') {
    if (kind === 'dual_sliding_window') {
      const outerR = 22.6;
      const outerStroke = 3.8;
      const innerR = 16.4;
      const innerStroke = 3.4;
      return {
        size: 52,
        outer: {
          radius: outerR,
          stroke_width: outerStroke,
          circumference: +(2 * Math.PI * outerR).toFixed(1),
        },
        inner: {
          radius: innerR,
          stroke_width: innerStroke,
          circumference: +(2 * Math.PI * innerR).toFixed(1),
        },
        gap: 2.6,
      };
    }

    // single_periodic_window 与 credits_pool：48px 单大环
    const outerR = 20.3;
    const outerStroke = 4.6;
    return {
      size: 48,
      outer: {
        radius: outerR,
        stroke_width: outerStroke,
        circumference: +(2 * Math.PI * outerR).toFixed(1),
      },
      inner: null,
      gap: null,
    };
  }

  // 详情态 (detail: 74px)
  if (kind === 'dual_sliding_window') {
    const outerR = 32.2;
    const outerStroke = 5.4;
    const innerR = 23.3;
    const innerStroke = 4.9;
    return {
      size: 74,
      outer: {
        radius: outerR,
        stroke_width: outerStroke,
        circumference: +(2 * Math.PI * outerR).toFixed(1),
      },
      inner: {
        radius: innerR,
        stroke_width: innerStroke,
        circumference: +(2 * Math.PI * innerR).toFixed(1),
      },
      gap: 3.8,
    };
  }

  // 详情态单环 / 积分环
  const outerR = 29.0;
  const outerStroke = 6.6;
  return {
    size: 74,
    outer: {
      radius: outerR,
      stroke_width: outerStroke,
      circumference: +(2 * Math.PI * outerR).toFixed(1),
    },
    inner: null,
    gap: null,
  };
}
