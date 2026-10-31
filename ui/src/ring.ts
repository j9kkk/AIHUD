/**
 * AI HUD 额度环组件 (Ring Visual Component)
 * 契约规范：
 * - docs/ARCHITECTURE.md 第 3.8 节与第 5.6 节几何参数
 * - docs/PROTOTYPE-SPEC.md 第 1.2 节
 * 
 * 硬性几何与契约：
 * 1. 卡片环 52pt：外环 r=22.6 / 描边 3.8pt，内环 r=16.4 / 描边 3.4pt，间隙 2.6pt；单环描边 4.6pt。
 * 2. 详情环 74pt：外环 r=32.2 / 描边 5.4pt，内环 r=23.3 / 描边 4.9pt；单环 r=29.0 / 描边 6.6pt。
 * 3. 非 Normal 状态（mode !== 'value'）绝不渲染百分比，轨道呈现虚线或断裂形态，绝不画进度弧。
 */

import type { CardRingView, RingArc, MetricVisualKind, Tone } from './format.js';
import { toneToColor, toneToTextClass } from './format.js';

export interface RingRenderOptions {
  size?: number; // 52 (默认卡片) 或 74 (详情)
  visualKind?: MetricVisualKind;
  idPrefix?: string;
  showCenterText?: boolean;
}

/**
 * 校验中心文案与模式不变式：非 value 模式绝不允许包含百分号 '%'
 */
export function assertRingInvariants(ring: CardRingView): void {
  if (ring.mode !== 'value') {
    if (ring.center_text.includes('%')) {
      throw new Error(`[Ring Invariant Violation] Non-value ring mode '${ring.mode}' cannot have percent in center_text: '${ring.center_text}'`);
    }
  }
}

let nextRingId = 0;

/**
 * 渲染环形 SVG 字符串
 */
export function renderRingSvg(ring: CardRingView, options: RingRenderOptions = {}): string {
  assertRingInvariants(ring);

  const size = options.size ?? 52;
  const isLarge = size >= 70;
  const cx = size / 2;
  const cy = size / 2;
  const prefix = options.idPrefix || `ring-${++nextRingId}`;
  const visualKind = options.visualKind ?? 'dual_sliding_window';
  const isDual = visualKind === 'dual_sliding_window';

  // 几何尺寸配置
  let outerR: number;
  let outerW: number;
  let innerR: number;
  let innerW: number;

  if (isLarge) {
    // 74pt 详情环几何
    if (isDual) {
      outerR = 32.2;
      outerW = 5.4;
      innerR = 23.3;
      innerW = 4.9;
    } else {
      outerR = 29.0;
      outerW = 6.6;
      innerR = 0;
      innerW = 0;
    }
  } else {
    // 52pt 卡片环几何（硬性验收第 3 条）
    if (isDual) {
      outerR = 22.6;
      outerW = 3.8;
      // 间隙 2.6pt：外内缘 (22.6 - 1.9 = 20.7) - 内存外缘 (18.1) = 2.6pt；内半径 = 18.1 - 1.7 = 16.4pt
      innerR = 16.4;
      innerW = 3.4;
    } else {
      outerR = 20.3;
      outerW = 4.6;
      innerR = 0;
      innerW = 0;
    }
  }

  const outerC = 2 * Math.PI * outerR;
  const innerC = innerR > 0 ? 2 * Math.PI * innerR : 0;

  const defs: string[] = [];
  const tracks: string[] = [];
  const arcs: string[] = [];

  // 滤镜定义
  const glowId = `${prefix}-glow`;
  defs.push(`
    <filter id="${glowId}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${isLarge ? 3.0 : 2.2}" />
    </filter>
  `);

  if (ring.mode === 'unknown') {
    // 未知/离线/限流状态：虚线底轨，绝不画进度弧（色盲友好图形差异）
    const dash = isLarge ? '4 6' : '3 4.5';
    tracks.push(`
      <circle cx="${cx}" cy="${cy}" r="${outerR}" stroke="rgba(152,162,179,0.36)" stroke-width="${outerW}" stroke-dasharray="${dash}" fill="none" />
    `);
    if (isDual && innerR > 0) {
      tracks.push(`
        <circle cx="${cx}" cy="${cy}" r="${innerR}" stroke="rgba(152,162,179,0.24)" stroke-width="${innerW}" stroke-dasharray="${dash}" fill="none" />
      `);
    }
  } else if (ring.mode === 'deprecated') {
    // 停服状态：断裂弧 + 斜杠（紫调）
    const dash = `${outerC * 0.38} ${outerC * 0.12}`;
    tracks.push(`
      <circle cx="${cx}" cy="${cy}" r="${outerR}" stroke="rgba(191,90,242,0.35)" stroke-width="${outerW}" stroke-dasharray="${dash}" fill="none" transform="rotate(-45 ${cx} ${cy})" />
    `);
    // 停服对角斜杠标记
    const slashOffset = outerR * 0.7;
    tracks.push(`
      <line x1="${cx - slashOffset}" y1="${cy + slashOffset}" x2="${cx + slashOffset}" y2="${cy - slashOffset}" stroke="rgba(191,90,242,0.55)" stroke-width="${outerW * 0.8}" stroke-linecap="round" />
    `);
  } else {
    // value 模式：正常渲染
    // 1. 底轨（凹槽与微光）
    const outerTrackColor = ring.outer?.track_color || 'rgba(0,0,0,0.55)';
    tracks.push(`
      <circle cx="${cx}" cy="${cy}" r="${outerR}" stroke="${outerTrackColor}" stroke-width="${outerW + 1.1}" fill="none" />
    `);
    if (ring.outer?.cap_color) {
      tracks.push(`
        <circle cx="${cx}" cy="${cy}" r="${outerR}" stroke="${ring.outer.cap_color}" stroke-opacity="0.17" stroke-width="${outerW}" fill="none" />
      `);
    }

    if (isDual && innerR > 0) {
      const innerTrackColor = ring.inner?.track_color || 'rgba(0,0,0,0.55)';
      tracks.push(`
        <circle cx="${cx}" cy="${cy}" r="${innerR}" stroke="${innerTrackColor}" stroke-width="${innerW + 1.1}" fill="none" />
      `);
      if (ring.inner?.cap_color) {
        tracks.push(`
          <circle cx="${cx}" cy="${cy}" r="${innerR}" stroke="${ring.inner.cap_color}" stroke-opacity="0.17" stroke-width="${innerW}" fill="none" />
        `);
      }
    }

    // 2. 外环进度弧
    if (ring.outer && ring.outer.ratio > 0) {
      const ratio = Math.max(0, Math.min(1, ring.outer.ratio));
      const arcLen = outerC * ratio;
      const dasharray = `${arcLen.toFixed(2)} ${outerC.toFixed(2)}`;
      const color = ring.outer.cap_color || '#32D74B';

      if (ring.outer.glow) {
        arcs.push(`
          <circle cx="${cx}" cy="${cy}" r="${outerR}" stroke="${color}" stroke-opacity="0.30" stroke-width="${outerW * 2}" stroke-linecap="round" fill="none" stroke-dasharray="${dasharray}" transform="rotate(-90 ${cx} ${cy})" filter="url(#${glowId})" />
        `);
      }
      arcs.push(`
        <circle cx="${cx}" cy="${cy}" r="${outerR}" stroke="${color}" stroke-width="${outerW}" stroke-linecap="round" fill="none" stroke-dasharray="${dasharray}" transform="rotate(-90 ${cx} ${cy})" />
      `);
    }

    // 3. 内环进度弧（仅双环）
    if (isDual && innerR > 0 && ring.inner && ring.inner.ratio > 0) {
      const ratio = Math.max(0, Math.min(1, ring.inner.ratio));
      const arcLen = innerC * ratio;
      const dasharray = `${arcLen.toFixed(2)} ${innerC.toFixed(2)}`;
      const color = ring.inner.cap_color || '#FFD60A';

      if (ring.inner.glow) {
        arcs.push(`
          <circle cx="${cx}" cy="${cy}" r="${innerR}" stroke="${color}" stroke-opacity="0.30" stroke-width="${innerW * 2}" stroke-linecap="round" fill="none" stroke-dasharray="${dasharray}" transform="rotate(-90 ${cx} ${cy})" filter="url(#${glowId})" />
        `);
      }
      arcs.push(`
        <circle cx="${cx}" cy="${cy}" r="${innerR}" stroke="${color}" stroke-width="${innerW}" stroke-linecap="round" fill="none" stroke-dasharray="${dasharray}" transform="rotate(-90 ${cx} ${cy})" />
      `);
    }
  }

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" aria-hidden="true" class="ring-svg">
      <defs>${defs.join('')}</defs>
      ${tracks.join('')}
      ${arcs.join('')}
    </svg>
  `.trim();
}

/**
 * 创建包含 SVG 和中心文字的完整 Ring DOM 节点
 */
export function createRingElement(ring: CardRingView, options: RingRenderOptions = {}): HTMLElement {
  assertRingInvariants(ring);

  const size = options.size ?? 52;
  const wrap = document.createElement('div');
  wrap.className = 'ring-wrap';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;

  wrap.innerHTML = renderRingSvg(ring, options);

  if (options.showCenterText && ring.center_text) {
    const center = document.createElement('div');
    center.className = 'ring-center';
    const textClass = toneToTextClass(ring.center_tone);
    center.innerHTML = `
      <span class="pct ${textClass}" style="font-size: ${size >= 70 ? '16px' : '11px'}; font-weight: 700;">
        ${escapeHtml(ring.center_text)}
      </span>
    `;
    wrap.appendChild(center);
  }

  return wrap;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
