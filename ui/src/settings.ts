/**
 * AI HUD 偏好设置与管理组件 (Settings Component)
 * 契约规范：
 * - docs/PROTOTYPE-SPEC.md 阶段 06 (F7-S1, F5-S1 ~ F5-S3)
 * - 包含通用偏好、Reduce Motion 减弱动态切换、账号管理
 * - 每个交互元素均带有 role 与 aria-label
 */

export interface SettingsCallbacks {
  onBack?: () => void;
  onToggleReduceMotion?: (reduced: boolean) => void;
  onRefreshIntervalChange?: (seconds: number) => void;
}

export interface SettingsState {
  launchAtLogin: boolean;
  showNumbersInMenuBar: boolean;
  refreshInterval: number; // 秒数，默认 300
  reducedMotion: boolean;
  appearance: 'dark' | 'system';
}

/**
 * 渲染通用设置面板 DOM 节点
 */
export function renderSettings(
  callbacks: SettingsCallbacks = {},
  state: SettingsState = {
    launchAtLogin: true,
    showNumbersInMenuBar: true,
    refreshInterval: 300,
    reducedMotion: document.body.classList.contains('reduced'),
    appearance: 'dark',
  }
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'AI HUD 偏好设置');

  // 1. 顶栏
  const ph = document.createElement('div');
  ph.className = 'ph';

  const backBtn = document.createElement('button');
  backBtn.className = 'ph-back';
  backBtn.setAttribute('role', 'button');
  backBtn.setAttribute('aria-label', '返回面板');
  backBtn.textContent = '‹';
  backBtn.addEventListener('click', () => callbacks.onBack?.());
  ph.appendChild(backBtn);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'ph-title';
  titleWrap.innerHTML = `<span>偏好设置</span>`;
  ph.appendChild(titleWrap);

  const meta = document.createElement('div');
  meta.className = 'ph-meta';
  meta.textContent = '通用';
  ph.appendChild(meta);

  panel.appendChild(ph);

  // 2. 主体设置区
  const pb = document.createElement('div');
  pb.className = 'pb';
  pb.style.cssText = 'display:flex;flex-direction:column;gap:10px';

  // 通用开关组
  const group1 = document.createElement('div');
  group1.className = 'row-group';

  // 开机自启
  const rowAuto = document.createElement('div');
  rowAuto.className = 'row';
  rowAuto.innerHTML = `
    <div style="flex:1 1 auto;min-width:0">
      <div class="row-t">开机自启</div>
      <div class="row-d">登录 macOS 时自动在托盘运行</div>
    </div>
  `;
  const swAuto = document.createElement('button');
  swAuto.className = `sw ${state.launchAtLogin ? 'sw--on' : ''}`;
  swAuto.setAttribute('role', 'switch');
  swAuto.setAttribute('aria-checked', String(state.launchAtLogin));
  swAuto.setAttribute('aria-label', `开机自启开关，当前${state.launchAtLogin ? '开启' : '关闭'}`);
  swAuto.addEventListener('click', () => {
    state.launchAtLogin = !state.launchAtLogin;
    swAuto.className = `sw ${state.launchAtLogin ? 'sw--on' : ''}`;
    swAuto.setAttribute('aria-checked', String(state.launchAtLogin));
    swAuto.setAttribute('aria-label', `开机自启开关，当前${state.launchAtLogin ? '开启' : '关闭'}`);
  });
  rowAuto.appendChild(swAuto);
  group1.appendChild(rowAuto);

  // 菜单栏显示数字
  const rowMenuNums = document.createElement('div');
  rowMenuNums.className = 'row';
  rowMenuNums.innerHTML = `
    <div style="flex:1 1 auto;min-width:0">
      <div class="row-t">菜单栏显示数字</div>
      <div class="row-d">关闭后仅显示状态图标，隐藏百分比</div>
    </div>
  `;
  const swMenu = document.createElement('button');
  swMenu.className = `sw ${state.showNumbersInMenuBar ? 'sw--on' : ''}`;
  swMenu.setAttribute('role', 'switch');
  swMenu.setAttribute('aria-checked', String(state.showNumbersInMenuBar));
  swMenu.setAttribute('aria-label', `菜单栏显示数字开关，当前${state.showNumbersInMenuBar ? '开启' : '关闭'}`);
  swMenu.addEventListener('click', () => {
    state.showNumbersInMenuBar = !state.showNumbersInMenuBar;
    swMenu.className = `sw ${state.showNumbersInMenuBar ? 'sw--on' : ''}`;
    swMenu.setAttribute('aria-checked', String(state.showNumbersInMenuBar));
    swMenu.setAttribute('aria-label', `菜单栏显示数字开关，当前${state.showNumbersInMenuBar ? '开启' : '关闭'}`);
  });
  rowMenuNums.appendChild(swMenu);
  group1.appendChild(rowMenuNums);

  pb.appendChild(group1);

  // 减弱动态效果 (Reduce Motion) 辅助功能分区
  const motionSect = document.createElement('div');
  motionSect.className = 'sect';
  motionSect.innerHTML = `<span class="sect-t">视觉与辅助功能</span>`;
  pb.appendChild(motionSect);

  const group2 = document.createElement('div');
  group2.className = 'row-group';

  const rowMotion = document.createElement('div');
  rowMotion.className = 'row';
  rowMotion.innerHTML = `
    <div style="flex:1 1 auto;min-width:0">
      <div class="row-t">减弱动态效果 (Reduce Motion)</div>
      <div class="row-d">将 280ms 弹性过渡降级为 0s 即时替换</div>
    </div>
  `;
  const swMotion = document.createElement('button');
  swMotion.className = `sw ${state.reducedMotion ? 'sw--on' : ''}`;
  swMotion.setAttribute('role', 'switch');
  swMotion.setAttribute('aria-checked', String(state.reducedMotion));
  swMotion.setAttribute('aria-label', `减弱动态效果开关，当前${state.reducedMotion ? '开启' : '关闭'}`);
  swMotion.addEventListener('click', () => {
    state.reducedMotion = !state.reducedMotion;
    swMotion.className = `sw ${state.reducedMotion ? 'sw--on' : ''}`;
    swMotion.setAttribute('aria-checked', String(state.reducedMotion));
    swMotion.setAttribute('aria-label', `减弱动态效果开关，当前${state.reducedMotion ? '开启' : '关闭'}`);
    document.body.classList.toggle('reduced', state.reducedMotion);
    callbacks.onToggleReduceMotion?.(state.reducedMotion);
  });
  rowMotion.appendChild(swMotion);
  group2.appendChild(rowMotion);
  pb.appendChild(group2);

  // 刷新频率分段控制
  const intervalSect = document.createElement('div');
  intervalSect.className = 'sect';
  intervalSect.innerHTML = `<span class="sect-t">基础轮询频率</span><span class="sect-r">T_base 节拍</span>`;
  pb.appendChild(intervalSect);

  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'tablist');
  seg.setAttribute('aria-label', '刷新频率选项');

  const intervals = [
    { label: '1 分钟', secs: 60 },
    { label: '5 分钟', secs: 300 },
    { label: '15 分钟', secs: 900 },
    { label: '30 分钟', secs: 1800 },
  ];

  for (const item of intervals) {
    const tab = document.createElement('button');
    const isSel = state.refreshInterval === item.secs;
    tab.className = `seg-item ${isSel ? 'on' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(isSel));
    tab.setAttribute('aria-label', `设置刷新周期为 ${item.label}`);
    tab.textContent = item.label;
    tab.addEventListener('click', () => {
      state.refreshInterval = item.secs;
      seg.querySelectorAll('.seg-item').forEach((el) => {
        el.classList.remove('on');
        el.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('on');
      tab.setAttribute('aria-selected', 'true');
      callbacks.onRefreshIntervalChange?.(item.secs);
    });
    seg.appendChild(tab);
  }
  pb.appendChild(seg);

  // 提示信息
  const note = document.createElement('div');
  note.style.cssText = 'font-size:var(--fs-nano);color:var(--label3);line-height:1.5;margin-top:2px';
  note.textContent = '任一活动窗口 ≤20% 时自动提速到 T_base/2（下限 60s）；隐藏账号在后台静默刷新，不打扰通知。';
  pb.appendChild(note);

  panel.appendChild(pb);

  // 3. 底栏
  const footer = document.createElement('div');
  footer.className = 'pf';
  footer.innerHTML = `
    <span class="num">设置即时生效 · 零确认弹窗</span>
    <span class="num">AI HUD v0.1.0</span>
  `;
  panel.appendChild(footer);

  return panel;
}
