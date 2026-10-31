/**
 * AI HUD 渲染层入口 (Main Application Controller)
 * 契约规范：
 * - docs/ARCHITECTURE.md 第 3.8 节与第 11.1 节
 * - 纯消费 HudViewModel，管理 Level-1 面板、Level-2 详情、设置视图之间的流转
 * - 纯浏览器原生 ESM，由 tsc 编译输出至 dist/
 */

import type { HudViewModel, AccountCardView } from './format.js';
import { renderPanel, PanelState } from './panel.js';
import { renderDetail } from './detail.js';
import { renderSettings, SettingsState } from './settings.js';
import { mockHudViewModel, mockAccounts } from './dev-mock.js';

export type ActiveView = 'panel' | 'detail' | 'settings';

export interface AppState {
  currentView: ActiveView;
  selectedAccountId: string | null;
  panelState: PanelState;
  settingsState: SettingsState;
}

export interface RenderHudOptions {
  initialView?: ActiveView;
  selectedAccountId?: string | null;
  onViewChange?: (view: ActiveView, accountId: string | null) => void;
}

/**
 * 在目标容器内渲染并挂载 AI HUD 应用
 */
export function renderHud(
  container: HTMLElement,
  viewModel: HudViewModel = mockHudViewModel,
  options: RenderHudOptions = {}
): {
  updateViewModel: (newVm: HudViewModel) => void;
  navigateTo: (view: ActiveView, accountId?: string | null) => void;
  getState: () => AppState;
} {
  let currentVm = viewModel;

  const appState: AppState = {
    currentView: options.initialView || 'panel',
    selectedAccountId: options.selectedAccountId || null,
    panelState: {
      activeChannelFilter: null,
      channelPages: {},
    },
    settingsState: {
      launchAtLogin: true,
      showNumbersInMenuBar: true,
      refreshInterval: 300,
      reducedMotion: document.body.classList.contains('reduced'),
      appearance: 'dark',
    },
  };

  function findAccount(accountId: string): AccountCardView | null {
    // 先在当前 view model 中查找
    for (const ch of currentVm.channels) {
      const found = ch.accounts.find((a) => a.account_id === accountId);
      if (found) return found;
    }
    // 降级在全局 mockAccounts 中查找
    const fallback = mockAccounts.find((a) => a.account_id === accountId);
    return fallback || null;
  }

  function renderCurrentView(): void {
    container.innerHTML = '';

    if (appState.currentView === 'detail' && appState.selectedAccountId) {
      const account = findAccount(appState.selectedAccountId);
      if (account) {
        const detailEl = renderDetail(account, {
          onBack: () => navigateTo('panel'),
          onRefresh: (id) => console.log(`[HUD] Refresh requested for ${id}`),
          onReauth: (id) => console.log(`[HUD] Reauth requested for ${id}`),
          onHide: (id) => {
            console.log(`[HUD] Hide requested for ${id}`);
            navigateTo('panel');
          },
          onDelete: (id) => {
            console.log(`[HUD] Delete requested for ${id}`);
            navigateTo('panel');
          },
        });
        container.appendChild(detailEl);
        return;
      }
    }

    if (appState.currentView === 'settings') {
      const settingsEl = renderSettings(
        {
          onBack: () => navigateTo('panel'),
          onToggleReduceMotion: (reduced) => {
            appState.settingsState.reducedMotion = reduced;
          },
          onRefreshIntervalChange: (sec) => {
            appState.settingsState.refreshInterval = sec;
          },
        },
        appState.settingsState
      );
      container.appendChild(settingsEl);
      return;
    }

    // 默认 Level-1 一级面板
    const panelEl = renderPanel(
      currentVm,
      {
        onSelect: (accId) => navigateTo('detail', accId),
        onRefreshAll: () => console.log('[HUD] Refresh all triggered'),
        onOpenSettings: () => navigateTo('settings'),
        onExit: () => console.log('[HUD] Exit application'),
      },
      appState.panelState
    );
    container.appendChild(panelEl);
  }

  function navigateTo(view: ActiveView, accountId: string | null = null): void {
    appState.currentView = view;
    appState.selectedAccountId = accountId;
    options.onViewChange?.(view, accountId);
    renderCurrentView();
  }

  function updateViewModel(newVm: HudViewModel): void {
    currentVm = newVm;
    renderCurrentView();
  }

  // 初次渲染
  renderCurrentView();

  return {
    updateViewModel,
    navigateTo,
    getState: () => ({ ...appState }),
  };
}

// 浏览器环境下自动挂载到 #app 容器
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // 挂载全局对象以便测试和控制台调试
  (window as unknown as { AiHud: unknown }).AiHud = {
    renderHud,
    mockHudViewModel,
    mockAccounts,
  };

  document.addEventListener('DOMContentLoaded', () => {
    const appEl = document.getElementById('app');
    if (appEl && !appEl.hasChildNodes()) {
      renderHud(appEl, mockHudViewModel);
    }
  });
}
