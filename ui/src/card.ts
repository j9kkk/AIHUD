/**
 * AI HUD 账号卡片组件 (Account Card Component)
 * 契约规范：
 * - docs/ARCHITECTURE.md 第 3.8 节与 5.6 节
 * - docs/PROTOTYPE-SPEC.md 第 1.3 节排版硬约束
 * 
 * 硬性验收：
 * 1. 非 Normal 状态绝不渲染百分比（组件层断言）；
 * 2. 百分比不换行：.pct{white-space:nowrap} 且卡片容器无 overflow:hidden 硬截断——360pt 宽下 0 裁剪；
 * 3. 每个交互元素有 role 与 aria-label（卡片、按钮）。
 */

import type { AccountCardView, AccountHealthState } from './format.js';
import { createRingElement, assertRingInvariants } from './ring.js';
import { toneToTextClass } from './format.js';

export interface CardCallbacks {
  onSelect?: (accountId: string) => void;
  onAction?: (accountId: string, actionKind: string) => void;
}

/**
 * 严格断言：非 Normal 状态绝不允许渲染百分比（硬性验收第 1 条）
 */
export function assertCardInvariants(card: AccountCardView): void {
  assertRingInvariants(card.ring);

  // 若对象带有 state 字段，或通过 ring.mode 与 primary_slot.kind 判定
  const state = (card as { state?: AccountHealthState }).state;
  if (state && state !== 'normal') {
    // 1. 主读数槽禁止 percent
    if (card.primary_slot.kind === 'percent') {
      throw new Error(`[Card Invariant Violation] Non-Normal state '${state}' cannot render percent in primary_slot for account '${card.account_id}'`);
    }
    // 2. 环中心文字禁止含 '%'
    if (card.ring.center_text.includes('%')) {
      throw new Error(`[Card Invariant Violation] Non-Normal state '${state}' cannot have '%' in ring.center_text for account '${card.account_id}'`);
    }
    // 3. 状态主文本禁止包含裸百分比（防止拼接注入）
    if (card.primary_slot.kind === 'status' && card.primary_slot.text.includes('%')) {
      throw new Error(`[Card Invariant Violation] Non-Normal state '${state}' cannot include '%' in status text: '${card.primary_slot.text}'`);
    }
  }

  // 环非 value 模式时主槽绝不可为 percent
  if (card.ring.mode !== 'value' && card.primary_slot.kind === 'percent') {
    throw new Error(`[Card Invariant Violation] Non-value ring mode '${card.ring.mode}' cannot pair with percent primary_slot for account '${card.account_id}'`);
  }
}

/**
 * 渲染单个账号卡片 DOM 节点
 */
export function renderCard(card: AccountCardView, callbacks: CardCallbacks = {}): HTMLElement {
  assertCardInvariants(card);

  const state = (card as { state?: AccountHealthState }).state;
  const article = document.createElement('article');
  article.className = 'card' + (card.dimmed ? ' card--dimmed' : '');
  article.setAttribute('role', 'button');
  article.setAttribute('tabindex', '0');
  article.setAttribute('data-account-id', card.account_id);
  article.setAttribute('data-state', state || (card.primary_slot.kind === 'percent' ? 'normal' : 'abnormal'));
  article.setAttribute('data-visual', card.visual_kind);

  // 构造可访问性无障碍描述 (ARIA label)
  const ariaSlotText = card.primary_slot.kind === 'percent' 
    ? `${card.primary_slot.text}%` 
    : card.primary_slot.text;
  const ariaSub = card.history_slot?.text || card.reset_text || '';
  const ariaLabel = `${card.alias}，${ariaSlotText}${ariaSub ? '，' + ariaSub : ''}`;
  article.setAttribute('aria-label', ariaLabel);

  // 卡片点击与键盘无障碍交互
  article.addEventListener('click', (e) => {
    // 若点击的是卡片内部操作按钮，则不触发卡片自身导航
    const target = e.target as HTMLElement | null;
    if (target?.closest('button') || target?.closest('.btn')) {
      return;
    }
    callbacks.onSelect?.(card.account_id);
  });

  article.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callbacks.onSelect?.(card.account_id);
    }
  });

  // 1. 卡片顶部：别名 + 标签
  const top = document.createElement('div');
  top.className = 'card-top';

  const alias = document.createElement('span');
  alias.className = 'alias';
  alias.textContent = card.alias;
  top.appendChild(alias);

  if (card.plan_name) {
    const flag = document.createElement('span');
    flag.className = 'card-flag';
    flag.textContent = card.plan_name;
    top.appendChild(flag);
  }
  article.appendChild(top);

  // 2. 卡片中部：环 + 主读数槽 + 历史/复位副文本
  const mid = document.createElement('div');
  mid.className = 'card-mid';

  // 52pt 环
  const ringEl = createRingElement(card.ring, {
    size: 52,
    visualKind: card.visual_kind,
    idPrefix: `c-${card.account_id}`,
  });
  mid.appendChild(ringEl);

  // 数字排版槽（.card-nums，严格 min-width: 0 防止 flex 溢出）
  const nums = document.createElement('div');
  nums.className = 'card-nums';

  // 主槽读数
  const slot = card.primary_slot;
  if (slot.kind === 'percent') {
    // 仅 Normal 状态允许进入
    const pctWrap = document.createElement('span');
    const toneClass = toneToTextClass(slot.tone);
    pctWrap.className = `pct pct--live ${toneClass}`;
    pctWrap.setAttribute('data-pct', slot.text);
    pctWrap.innerHTML = `${escapeHtml(slot.text)}<span class="unit">%</span>`;
    nums.appendChild(pctWrap);
  } else if (slot.kind === 'absolute') {
    const absWrap = document.createElement('span');
    absWrap.className = 'pct pct--live c-green';
    absWrap.style.fontSize = '13px';
    absWrap.textContent = slot.text;
    nums.appendChild(absWrap);
  } else {
    // kind === 'status'，脱敏状态标签，绝不含 %
    const statusWrap = document.createElement('span');
    const toneClass = toneToTextClass(slot.tone);
    statusWrap.className = `pct pct--muted ${toneClass}`;
    statusWrap.innerHTML = `<span class="pfx">${escapeHtml(slot.text)}</span>`;
    nums.appendChild(statusWrap);
  }

  // 副行信息（历史槽或复位说明）
  if (card.history_slot) {
    const sub = document.createElement('span');
    sub.className = 'subline';
    sub.textContent = card.history_slot.text;
    nums.appendChild(sub);
  } else if (card.reset_text && card.primary_slot.kind === 'percent') {
    const sub = document.createElement('span');
    sub.className = 'subline';
    sub.textContent = card.reset_text;
    nums.appendChild(sub);
  }

  mid.appendChild(nums);
  article.appendChild(mid);

  // 3. 卡片底部：操作按钮或复位底栏
  const foot = document.createElement('div');
  foot.className = 'card-foot';

  if (card.action.kind !== 'none' && card.action.label) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn btn--secondary btn--sm';
    actionBtn.setAttribute('role', 'button');
    actionBtn.setAttribute('aria-label', `${card.alias}：${card.action.label}`);
    actionBtn.textContent = card.action.label;
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onAction?.(card.account_id, card.action.kind);
    });
    foot.appendChild(actionBtn);
  } else if (card.reset_text) {
    foot.textContent = card.reset_text;
  } else {
    foot.textContent = '—';
  }

  article.appendChild(foot);
  return article;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
