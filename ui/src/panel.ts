/**
 * AI HUD Level-1 一级面板组件 (Level-1 Panel Component)
 * 契约规范：
 * - docs/ARCHITECTURE.md 第 3.8 节
 * - docs/PROTOTYPE-SPEC.md 第 1.1 节与第 1.3 节
 * 
 * 核心特性：
 * 1. 严格只消费 HudViewModel，不接触 AccountSnapshot。
 * 2. 宽度固定 360pt（--panel-w），2 列网格，每页固定 4 卡片。
 * 3. 单账号或奇数账号右列留白（.slot），绝不拉伸破坏环与数字比例。
 * 4. 每个交互元素均有显式 role 与 aria-label。
 */

import type { HudViewModel, ChannelGroup, AccountCardView } from './format.js';
import { renderCard, CardCallbacks } from './card.js';
import { providerToColor, formatTime } from './format.js';

export interface PanelCallbacks extends CardCallbacks {
  onRefreshAll?: () => void;
  onOpenSettings?: () => void;
  onExit?: () => void;
}

export interface PanelState {
  activeChannelFilter: string | null; // null 为 "全部"
  channelPages: Record<string, number>; // provider -> 当前页码 (从 1 起)
}

/**
 * 渲染 Level-1 HUD 面板
 */
export function renderPanel(
  vm: HudViewModel,
  callbacks: PanelCallbacks = {},
  state: PanelState = { activeChannelFilter: null, channelPages: {} }
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'AI HUD 一级巡检面板');

  // 计算总账号与异常统计
  let totalAccounts = 0;
  for (const ch of vm.channels) {
    totalAccounts += ch.accounts.length;
  }

  // 1. 面板顶部栏 (Header)
  const header = document.createElement('div');
  header.className = 'panel-head-wrap';
  header.style.cssText = 'padding:9px 12px 8px;border-bottom:.5pt solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:7px';

  // 顶栏首行：Logo + 标题 + 更新时间 + 头部快捷操作
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:7px';

  // App 图标
  const logo = document.createElement('div');
  logo.style.cssText = 'width:17px;height:17px;border-radius:4.5px;flex:0 0 auto;background:linear-gradient(150deg,#2F96FF,#0A5BD6);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 .5pt 0 rgba(255,255,255,.45)';
  logo.innerHTML = `<svg width="10.5" height="10.5" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M5 19V9"/><path d="M12 19V5"/><path d="M19 19v-7"/></svg>`;
  topRow.appendChild(logo);

  // 标题与时间
  const titleBox = document.createElement('div');
  titleBox.style.cssText = 'display:flex;flex-direction:column;line-height:1.25';
  const titleText = document.createElement('span');
  titleText.style.cssText = 'font-size:var(--fs-body);font-weight:700';
  titleText.textContent = 'AI HUD';
  const timeText = document.createElement('span');
  timeText.style.cssText = 'font-size:var(--fs-nano);color:var(--label3);font-variant-numeric:tabular-nums';
  timeText.textContent = `${formatTime(vm.footer.last_refresh_at)} 更新`;
  titleBox.appendChild(titleText);
  titleBox.appendChild(timeText);
  topRow.appendChild(titleBox);

  // 顶栏右侧快捷按钮
  const topActions = document.createElement('div');
  topActions.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:4px';

  // 立即刷新全部按钮
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'mb-item';
  refreshBtn.setAttribute('role', 'button');
  refreshBtn.setAttribute('aria-label', '立即刷新全部账号');
  refreshBtn.innerHTML = '↻';
  refreshBtn.addEventListener('click', () => callbacks.onRefreshAll?.());
  topActions.appendChild(refreshBtn);

  // 设置按钮
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'mb-item';
  settingsBtn.setAttribute('role', 'button');
  settingsBtn.setAttribute('aria-label', '打开偏好设置');
  settingsBtn.innerHTML = '···';
  settingsBtn.addEventListener('click', () => callbacks.onOpenSettings?.());
  topActions.appendChild(settingsBtn);

  topRow.appendChild(topActions);
  header.appendChild(topRow);

  // 顶栏次行：渠道过滤标签 (Chips)
  if (vm.channels.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.setAttribute('role', 'tablist');
    chips.setAttribute('aria-label', '渠道筛选');

    // "全部 N" 标签
    const allChip = document.createElement('button');
    allChip.className = `chip ${state.activeChannelFilter === null ? 'chip--on' : ''}`;
    allChip.setAttribute('role', 'tab');
    allChip.setAttribute('aria-selected', state.activeChannelFilter === null ? 'true' : 'false');
    allChip.setAttribute('aria-label', `查看全部 ${totalAccounts} 个账号`);
    allChip.textContent = `全部 ${totalAccounts}`;
    allChip.addEventListener('click', () => {
      state.activeChannelFilter = null;
      reRenderBody();
    });
    chips.appendChild(allChip);

    // 各渠道标签
    for (const ch of vm.channels) {
      const chip = document.createElement('button');
      const isOn = state.activeChannelFilter === ch.provider;
      chip.className = `chip ${isOn ? 'chip--on' : ''}`;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', isOn ? 'true' : 'false');
      chip.setAttribute('aria-label', `筛选 ${ch.label} 渠道，共 ${ch.accounts.length} 个账号`);
      chip.textContent = `${ch.label} ${ch.accounts.length}`;
      chip.addEventListener('click', () => {
        state.activeChannelFilter = isOn ? null : ch.provider;
        reRenderBody();
      });
      chips.appendChild(chip);
    }
    header.appendChild(chips);
  }

  panel.appendChild(header);

  // 2. 面板内容区 (Body)
  const body = document.createElement('div');
  body.className = 'pb';
  body.style.cssText = 'padding:10px 12px 11px';

  function renderChannelList(): void {
    body.innerHTML = '';

    const visibleChannels = state.activeChannelFilter
      ? vm.channels.filter((c) => c.provider === state.activeChannelFilter)
      : vm.channels;

    if (visibleChannels.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.style.cssText = 'text-align:center;padding:24px 0;font-size:var(--fs-body);color:var(--label3)';
      emptyNotice.textContent = '暂无账号接入';
      body.appendChild(emptyNotice);
      return;
    }

    for (const ch of visibleChannels) {
      const chanEl = document.createElement('section');
      chanEl.className = 'chan';
      chanEl.setAttribute('data-provider', ch.provider);

      // 渠道标题行
      const chanHead = document.createElement('div');
      chanHead.className = 'chan-head';

      const pdot = document.createElement('span');
      pdot.className = 'pdot';
      const pColor = providerToColor(ch.provider);
      pdot.style.backgroundColor = pColor;
      pdot.style.color = pColor;
      chanHead.appendChild(pdot);

      const chanName = document.createElement('span');
      chanName.className = 'chan-name';
      chanName.textContent = ch.label;
      chanHead.appendChild(chanName);

      const chanCount = document.createElement('span');
      chanCount.className = 'chan-count';
      chanCount.textContent = `${ch.accounts.length} 个账号`;
      chanHead.appendChild(chanCount);

      // 分页逻辑（每页固定 4 卡片：2 列 × 2 行）
      const pageSize = 4;
      const totalPages = Math.max(1, Math.ceil(ch.accounts.length / pageSize));
      const currentPage = Math.min(totalPages, Math.max(1, state.channelPages[ch.provider] || 1));
      state.channelPages[ch.provider] = currentPage;

      // 如果有 2 页及以上，显示页码指示器 (dots)
      if (totalPages > 1) {
        const dots = document.createElement('div');
        dots.className = 'dots';
        dots.setAttribute('role', 'navigation');
        dots.setAttribute('aria-label', `${ch.label} 翻页导航`);

        for (let i = 1; i <= totalPages; i++) {
          const dotBtn = document.createElement('button');
          dotBtn.setAttribute('role', 'button');
          dotBtn.setAttribute('aria-selected', i === currentPage ? 'true' : 'false');
          dotBtn.setAttribute('aria-label', `${ch.label} 第 ${i} 页`);
          dotBtn.addEventListener('click', () => {
            state.channelPages[ch.provider] = i;
            reRenderBody();
          });
          dots.appendChild(dotBtn);
        }
        chanHead.appendChild(dots);
      }

      chanEl.appendChild(chanHead);

      // 卡片网格容器
      const cardPages = document.createElement('div');
      cardPages.className = 'card-pages';

      const cardPage = document.createElement('div');
      cardPage.className = 'card-page';

      const startIndex = (currentPage - 1) * pageSize;
      const pageAccounts = ch.accounts.slice(startIndex, startIndex + pageSize);

      for (const account of pageAccounts) {
        const cardEl = renderCard(account, callbacks);
        cardPage.appendChild(cardEl);
      }

      // 如果当前页只有奇数个卡片（如单账号 1 个或 3 个），添加占位槽 .slot
      // 保持卡片宽度恒定（1 列宽），绝不横向拉伸变形
      if (pageAccounts.length % 2 === 1) {
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.setAttribute('aria-hidden', 'true');
        cardPage.appendChild(slot);
      }

      cardPages.appendChild(cardPage);
      chanEl.appendChild(cardPages);
      body.appendChild(chanEl);
    }
  }

  function reRenderBody(): void {
    // 重新更新 chip 状态
    const chipBtns = header.querySelectorAll('.chips .chip');
    chipBtns.forEach((btn, index) => {
      if (index === 0) {
        const isOn = state.activeChannelFilter === null;
        btn.className = `chip ${isOn ? 'chip--on' : ''}`;
        btn.setAttribute('aria-selected', isOn ? 'true' : 'false');
      } else {
        const ch = vm.channels[index - 1];
        if (ch) {
          const isOn = state.activeChannelFilter === ch.provider;
          btn.className = `chip ${isOn ? 'chip--on' : ''}`;
          btn.setAttribute('aria-selected', isOn ? 'true' : 'false');
        }
      }
    });
    renderChannelList();
  }

  renderChannelList();
  panel.appendChild(body);

  // 3. 面板底部栏 (Footer)
  const footer = document.createElement('div');
  footer.className = 'pf';

  const leftSummary = document.createElement('span');
  leftSummary.className = 'num';
  const abnormal = vm.footer.abnormal_count;
  leftSummary.textContent = abnormal > 0
    ? `${totalAccounts} 个账号 · ${abnormal} 个异常`
    : `${totalAccounts} 个账号全部健康`;
  footer.appendChild(leftSummary);

  const rightActions = document.createElement('div');
  rightActions.style.cssText = 'display:flex;align-items:center;gap:8px';

  const setBtn = document.createElement('button');
  setBtn.className = 'link';
  setBtn.setAttribute('role', 'button');
  setBtn.setAttribute('aria-label', '打开设置');
  setBtn.textContent = '设置';
  setBtn.addEventListener('click', () => callbacks.onOpenSettings?.());
  rightActions.appendChild(setBtn);

  const exitBtn = document.createElement('button');
  exitBtn.className = 'link';
  exitBtn.setAttribute('role', 'button');
  exitBtn.setAttribute('aria-label', '退出 AI HUD');
  exitBtn.textContent = '退出';
  exitBtn.addEventListener('click', () => callbacks.onExit?.());
  rightActions.appendChild(exitBtn);

  footer.appendChild(rightActions);
  panel.appendChild(footer);

  return panel;
}
