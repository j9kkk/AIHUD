/**
 * AI HUD Level-2 二级详情组件 (Level-2 Detail Component)
 * 契约规范：
 * - docs/ARCHITECTURE.md 第 3.8 节与第 5.6 节
 * - docs/PROTOTYPE-SPEC.md 第 1.2 节与阶段 04 (F4-S1 ~ F4-S4)
 * 
 * 硬性验收：
 * 1. 非 Normal 状态绝不渲染百分比（组件层断言）；
 * 2. 74pt 详情环：双环外 5.4pt / 内 4.9pt；单环 6.6pt；
 * 3. 每个交互元素均有显式 role 与 aria-label。
 */

import type { AccountCardView, AccountHealthState } from './format.js';
import { createRingElement, assertRingInvariants } from './ring.js';
import { providerToColor, providerToLabel, toneToTextClass } from './format.js';

export interface DetailCallbacks {
  onBack?: () => void;
  onRefresh?: (accountId: string) => void;
  onReauth?: (accountId: string) => void;
  onHide?: (accountId: string) => void;
  onDelete?: (accountId: string) => void;
  onToggleAlertWhileHidden?: (accountId: string, enabled: boolean) => void;
}

/**
 * 校验详情组件不变式：非 Normal 状态绝不允许渲染百分比（硬性验收第 1 条）
 */
export function assertDetailInvariants(card: AccountCardView): void {
  assertRingInvariants(card.ring);

  const state = (card as { state?: AccountHealthState }).state;
  if (state && state !== 'normal') {
    if (card.primary_slot.kind === 'percent') {
      throw new Error(`[Detail Invariant Violation] Non-Normal state '${state}' cannot render percent in hero for account '${card.account_id}'`);
    }
    if (card.ring.center_text.includes('%')) {
      throw new Error(`[Detail Invariant Violation] Non-Normal state '${state}' cannot have '%' in ring for account '${card.account_id}'`);
    }
  }
}

/**
 * 渲染 Level-2 详情面板 DOM 节点
 */
export function renderDetail(card: AccountCardView, callbacks: DetailCallbacks = {}): HTMLElement {
  assertDetailInvariants(card);

  const panel = document.createElement('div');
  panel.className = 'panel panel--detail';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', `${card.alias} 额度详情`);

  const state = (card as { state?: AccountHealthState }).state;
  const isNormal = !state || state === 'normal';

  // 1. 顶栏：返回按钮 + 标题 + 渠道信息
  const ph = document.createElement('div');
  ph.className = 'ph';

  const backBtn = document.createElement('button');
  backBtn.className = 'ph-back';
  backBtn.setAttribute('role', 'button');
  backBtn.setAttribute('aria-label', '返回上一级');
  backBtn.textContent = '‹';
  backBtn.addEventListener('click', () => callbacks.onBack?.());
  ph.appendChild(backBtn);

  const phTitle = document.createElement('div');
  phTitle.className = 'ph-title';

  const pdot = document.createElement('span');
  pdot.className = 'pdot';
  const pColor = providerToColor(card.account_id.split('-')[0] || 'claude');
  pdot.style.backgroundColor = pColor;
  pdot.style.color = pColor;
  phTitle.appendChild(pdot);

  const titleText = document.createElement('span');
  titleText.textContent = card.alias;
  phTitle.appendChild(titleText);
  ph.appendChild(phTitle);

  const phMeta = document.createElement('div');
  phMeta.className = 'ph-meta';
  phMeta.textContent = `${card.plan_name || 'Standard'} · ${isNormal ? '正常' : '需要关注'}`;
  ph.appendChild(phMeta);

  panel.appendChild(ph);

  // 2. 主体区 (pb)
  const pb = document.createElement('div');
  pb.className = 'pb';
  pb.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  // 异常状态横幅
  if (!isNormal) {
    const banner = document.createElement('div');
    const isError = state === 'auth_expired' || state === 'service_deprecated';
    banner.className = `banner ${isError ? 'banner--danger' : 'banner--warn'}`;
    banner.innerHTML = `
      <span class="bi">${isError ? '⚠' : '⏱'}</span>
      <div style="flex:1 1 auto;min-width:0">
        <b>${card.primary_slot.kind === 'status' ? card.primary_slot.text : '账号状态异常'}</b>
        ${card.history_slot?.text ? card.history_slot.text : '请查看并处理该账号状态。'}
      </div>
    `;
    pb.appendChild(banner);
  }

  // 英雄区：74pt 环 + 大号主读数
  const hero = document.createElement('div');
  hero.className = 'hero';

  // 74pt 详情大环
  const ringEl = createRingElement(card.ring, {
    size: 74,
    visualKind: card.visual_kind,
    idPrefix: `d-${card.account_id}`,
  });
  hero.appendChild(ringEl);

  // 英雄区主文案
  const heroNums = document.createElement('div');
  heroNums.className = 'hero-nums';

  const heroCap = document.createElement('div');
  heroCap.className = 'hero-cap';
  heroCap.textContent = card.visual_kind === 'credits_pool' 
    ? '剩余积分 / 总量' 
    : (card.visual_kind === 'single_periodic_window' ? '周期用量窗口' : '主窗口 · 5 小时');
  heroNums.appendChild(heroCap);

  const heroMain = document.createElement('div');
  if (card.primary_slot.kind === 'percent') {
    const toneClass = toneToTextClass(card.primary_slot.tone);
    heroMain.className = `hero-main ${toneClass}`;
    heroMain.textContent = `${card.primary_slot.text}%`;
  } else if (card.primary_slot.kind === 'absolute') {
    heroMain.className = 'hero-main c-green';
    heroMain.textContent = card.primary_slot.text;
  } else {
    const toneClass = toneToTextClass(card.primary_slot.tone);
    heroMain.className = `hero-main ${toneClass}`;
    heroMain.textContent = card.primary_slot.text;
  }
  heroNums.appendChild(heroMain);

  if (card.reset_text) {
    const heroSub1 = document.createElement('div');
    heroSub1.className = 'hero-sub';
    heroSub1.textContent = `${card.reset_text} 后复位`;
    heroNums.appendChild(heroSub1);
  }

  if (card.history_slot) {
    const heroSub2 = document.createElement('div');
    heroSub2.className = 'hero-sub';
    heroSub2.style.marginTop = '2px';
    heroSub2.textContent = card.history_slot.text;
    heroNums.appendChild(heroSub2);
  }

  hero.appendChild(heroNums);
  pb.appendChild(hero);

  // 环图例说明 (Ring Legend)
  const legend = document.createElement('div');
  legend.className = 'ring-legend';
  if (card.visual_kind === 'dual_sliding_window') {
    legend.innerHTML = `
      <span><i style="background:#32D74B"></i>外环 5h 3.8pt</span>
      <span><i style="background:#FFD60A"></i>内环 1w 3.4pt</span>
      <span>间隙 2.6pt · 环 = 剩余</span>
    `;
  } else if (card.visual_kind === 'credits_pool') {
    legend.innerHTML = `
      <span><i style="background:#0A84FF"></i>积分池环 4.6pt</span>
      <span>绝对值积分 · 环 = 剩余比例</span>
    `;
  } else {
    legend.innerHTML = `
      <span><i style="background:#4285F4"></i>单周期环 4.6pt</span>
      <span>周期用量 · 环 = 剩余比例</span>
    `;
  }
  pb.appendChild(legend);

  // 窗口明细表格
  const sectHead = document.createElement('div');
  sectHead.className = 'sect';
  sectHead.innerHTML = `
    <span class="sect-t">窗口明细</span>
    <span class="sect-r">实时读数</span>
  `;
  pb.appendChild(sectHead);

  const table = document.createElement('table');
  table.className = 'wtable';
  table.innerHTML = `
    <thead>
      <tr>
        <th>窗口</th>
        <th style="text-align:right">剩余</th>
        <th style="text-align:right">总量</th>
        <th style="text-align:right">重置</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="wname">主要配额<span class="wsub">活动窗口</span></td>
        <td class="n">${card.primary_slot.kind === 'percent' ? card.primary_slot.text + '%' : card.primary_slot.text}</td>
        <td class="n" style="color:var(--label3)">—</td>
        <td class="n" style="color:var(--label3)">${card.reset_text || '—'}</td>
      </tr>
    </tbody>
  `;
  pb.appendChild(table);

  // 账号信息清单 (Row Group)
  const infoHead = document.createElement('div');
  infoHead.className = 'sect';
  infoHead.innerHTML = `<span class="sect-t">账号配置</span>`;
  pb.appendChild(infoHead);

  const rowGroup = document.createElement('div');
  rowGroup.className = 'row-group';

  // 鉴权行
  const row1 = document.createElement('div');
  row1.className = 'row';
  row1.innerHTML = `
    <div style="flex:1 1 auto;min-width:0">
      <div class="row-t">钥匙串凭据</div>
      <div class="row-d">aihud/${card.account_id.slice(0, 8)}…/credential</div>
    </div>
    <span class="badge badge--normal"><span class="bd"></span>已就绪</span>
  `;
  rowGroup.appendChild(row1);

  // 隐藏也提醒开关行
  const row2 = document.createElement('div');
  row2.className = 'row';
  row2.innerHTML = `
    <div style="flex:1 1 auto;min-width:0">
      <div class="row-t">隐藏也提醒</div>
      <div class="row-d">移出面板后仍按低额阈值通知</div>
    </div>
  `;
  const alertSw = document.createElement('button');
  alertSw.className = 'sw';
  alertSw.setAttribute('role', 'switch');
  alertSw.setAttribute('aria-checked', 'false');
  alertSw.setAttribute('aria-label', '隐藏也提醒开关，当前关闭');
  alertSw.addEventListener('click', () => {
    const cur = alertSw.getAttribute('aria-checked') === 'true';
    const next = !cur;
    alertSw.setAttribute('aria-checked', String(next));
    alertSw.className = `sw ${next ? 'sw--on' : ''}`;
    alertSw.setAttribute('aria-label', `隐藏也提醒开关，当前${next ? '开启' : '关闭'}`);
    callbacks.onToggleAlertWhileHidden?.(card.account_id, next);
  });
  row2.appendChild(alertSw);
  rowGroup.appendChild(row2);

  pb.appendChild(rowGroup);

  // 操作按钮组
  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:2px';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn--secondary btn--sm';
  refreshBtn.setAttribute('role', 'button');
  refreshBtn.setAttribute('aria-label', '立即刷新账号数据');
  refreshBtn.textContent = '立即刷新';
  refreshBtn.addEventListener('click', () => callbacks.onRefresh?.(card.account_id));
  btnGroup.appendChild(refreshBtn);

  const reauthBtn = document.createElement('button');
  reauthBtn.className = 'btn btn--secondary btn--sm';
  reauthBtn.setAttribute('role', 'button');
  reauthBtn.setAttribute('aria-label', '重新授权凭据');
  reauthBtn.textContent = '重新授权';
  reauthBtn.addEventListener('click', () => callbacks.onReauth?.(card.account_id));
  btnGroup.appendChild(reauthBtn);

  const hideBtn = document.createElement('button');
  hideBtn.className = 'btn btn--secondary btn--sm';
  hideBtn.setAttribute('role', 'button');
  hideBtn.setAttribute('aria-label', '在面板中隐藏该账号');
  hideBtn.textContent = '收纳隐藏';
  hideBtn.addEventListener('click', () => callbacks.onHide?.(card.account_id));
  btnGroup.appendChild(hideBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn--secondary btn--sm';
  deleteBtn.style.cssText = 'color:#FF8D84;border-color:rgba(255,69,58,.28)';
  deleteBtn.setAttribute('role', 'button');
  deleteBtn.setAttribute('aria-label', '删除当前账号');
  deleteBtn.textContent = '删除账号';
  deleteBtn.addEventListener('click', () => callbacks.onDelete?.(card.account_id));
  btnGroup.appendChild(deleteBtn);

  pb.appendChild(btnGroup);
  panel.appendChild(pb);

  // 3. 底栏 (Footer)
  const footer = document.createElement('div');
  footer.className = 'pf';
  footer.innerHTML = `
    <span class="num">剩余语义：环与数字均为「剩余」</span>
    <span class="num">${card.alias}</span>
  `;
  panel.appendChild(footer);

  return panel;
}
