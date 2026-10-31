import math
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v11 原型：一级卡片界面 + 二级全区域滑入账号详情页（macOS 专属纯原型设计）。
核心演进：
1. 一级界面（Level 1 Grid View）：保持自定义中文别名（如“工作主力”），卡片纯粹清爽，Apple Watch 级同心双环。
2. 二级详情界面（Level 2 Detail View）：用户点击任意卡片后，整个面板平滑横向滑入（Push Navigation）账号全屏详情页！
3. 详情页完整使用当前全部 412px 区域，深度展示：
   - 顶部导航：返回按钮（‹ 全部账号 / 快捷键 Esc）、别名重命名编辑笔、账号所属渠道徽标
   - 核心凭据：完整登录账号（邮箱/UID）、组织架构、Token 过期时间与刷新状态、脱敏显示/一键复制
   - 额度与用量仪表盘：超大 72px 苹果级同心圆环、5h 与 1w 绝对余量/总量、已用百分比、精确复位倒计时
   - 24 小时 / 7 天调用热力图（Activity Heatmap）：类似 GitHub / Apple 风格的用量活跃网格
   - 最近模型调用明细（Claude 3.7 Sonnet / Opus / Haiku 等配额分配）
"""
from pathlib import Path

OUT = Path("/opt/data/ai-credits/quota-hud")

CSS = """
:root {
  --bg: #030712;
  --panel-blur: blur(28px);
  --panel-bg: rgba(18, 24, 38, 0.85);
  --panel-border: rgba(255, 255, 255, 0.12);
  --panel-shadow: 0 28px 64px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2);
  --hairline: inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 0 rgba(0, 0, 0, 0.35);
  
  --card-bg: rgba(255, 255, 255, 0.05);
  --card-border: rgba(255, 255, 255, 0.09);
  --card-hover: rgba(255, 255, 255, 0.09);
  --card-inner: rgba(0, 0, 0, 0.32);
  
  --text-primary: #ffffff;
  --text-secondary: rgba(235, 245, 255, 0.72);
  --text-tertiary: rgba(215, 230, 255, 0.48);
  
  /* Apple Watch Activity Palette */
  --aw-green: #30d158;
  --aw-green-track: #072a12;
  --aw-yellow: #ffd60a;
  --aw-yellow-track: #2a2202;
  --aw-red: #ff453a;
  --aw-red-track: #2a0b0a;
  --aw-cyan: #32ade6;
  --aw-cyan-track: #052331;
  --aw-purple: #bf5af2;
  --aw-purple-track: #260f33;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Helvetica Neue", sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  padding: 28px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1440px; margin: 0 auto; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  color: #38bdf8; letter-spacing: 0.8px; margin-bottom: 8px;
}
.eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
h1 { font-size: 26px; font-weight: 800; color: #fff; margin-bottom: 6px; letter-spacing: -0.5px; }
.sub { font-size: 13.5px; color: var(--text-secondary); margin-bottom: 24px; max-width: 980px; }

.meta-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 32px; }
.chip {
  font-size: 11px; padding: 4px 10px; border-radius: 6px;
  background: rgba(30, 41, 59, 0.7); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);
  display: inline-flex; align-items: center; gap: 4px;
}
.chip b { color: #fff; }

section { margin-bottom: 48px; }
h2 {
  font-size: 17px; font-weight: 700; color: #f8fafc;
  margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
}
h2 .num {
  font-size: 11px; font-weight: 800; color: #38bdf8;
  background: rgba(56, 189, 248, 0.15); padding: 2px 7px; border-radius: 5px;
}
p.lede { font-size: 13px; color: var(--text-secondary); margin-bottom: 18px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 24px;
}

/* Screen wrapper */
.screen {
  background: #0d1424;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.screen-head {
  padding: 12px 16px;
  background: rgba(20, 31, 52, 0.85);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: space-between;
}
.screen-title { font-size: 12.5px; font-weight: 700; color: #e2e8f0; }
.screen-tags { display: flex; gap: 6px; }
.tag { font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); color: #94a3b8; }
.screen-body {
  padding: 30px 24px;
  background: radial-gradient(circle at 75% 20%, #17274a 0%, #050811 85%);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 540px;
}
.screen-foot {
  padding: 12px 16px;
  background: #080d18;
  border-top: 1px solid rgba(255,255,255,0.08);
  font-size: 11.5px;
  color: #94a3b8;
  line-height: 1.5;
}

/* =============================================================================
   macOS Popover 面板外壳规范 (412px 宽度)
   ============================================================================= */
.panel {
  width: 412px;
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 0.5px solid var(--panel-border);
  box-shadow: var(--panel-shadow);
  border-radius: 15px;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}
.panel::before {
  content: ""; position: absolute; inset: 0; border-radius: 15px;
  box-shadow: var(--hairline); pointer-events: none; z-index: 10;
}
.panel-caret {
  position: absolute; top: -6px; right: 38px; width: 12px; height: 12px;
  transform: rotate(45deg); background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  border-left: 0.5px solid var(--panel-border); border-top: 0.5px solid var(--panel-border);
  z-index: 2;
}

/* 一级界面顶部导航 */
.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px 10px; border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
}
.panel-title {
  font-size: 12px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 7px;
}
.panel-time {
  font-size: 10px; font-weight: 500; color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.panel-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px; background: rgba(0, 0, 0, 0.22); border-top: 0.5px solid rgba(255, 255, 255, 0.06);
  font-size: 10px; color: var(--text-tertiary);
}

.ch-banner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px 7px;
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.06);
}
.ch-name { font-size: 11px; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 6px; }
.ch-badge {
  font-size: 9.5px; font-weight: 600; padding: 1.5px 6px; border-radius: 99px;
  background: rgba(255, 255, 255, 0.1); color: var(--text-secondary);
}
.ch-stat { font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ch-pdots { display: flex; gap: 3.5px; align-items: center; margin-left: 6px; }
.ch-pdots i { width: 4.5px; height: 4.5px; border-radius: 50%; background: rgba(255,255,255,0.2); }
.ch-pdots i.on { width: 11px; border-radius: 99px; background: #38bdf8; box-shadow: 0 0 6px #38bdf8; }

.swipe-bar {
  display: flex; align-items: center; justify-content: center; gap: 5px;
  padding: 5px 0 3px; font-size: 9px; color: var(--text-tertiary);
}

/* 2列网格 */
.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 10px 12px;
}

/* Ring & Digits */
.ringwrap { position: relative; display: inline-grid; place-items: center; flex: 0 0 auto; }
.rnum {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-weight: 800; font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  pointer-events: none;
}
.rnum > span { white-space: nowrap; line-height: 1; }

/* 一级界面卡片样式 */
.card-aw {
  background: var(--card-bg);
  border: 0.5px solid var(--card-border);
  border-radius: 11px;
  padding: 9px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25), inset 0 0.5px 0 rgba(255,255,255,0.12);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
  position: relative;
}
.card-aw:hover {
  background: var(--card-hover);
  border-color: rgba(255, 255, 255, 0.22);
  transform: translateY(-1.5px);
  box-shadow: 0 4px 14px rgba(0,0,0,0.4), inset 0 0.5px 0 rgba(255,255,255,0.18);
}
.caw-head {
  display: flex; align-items: center; justify-content: space-between;
}
.caw-name {
  font-size: 11.5px; font-weight: 700; color: #ffffff;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 108px;
  display: flex; align-items: center; gap: 4px;
}
.caw-plan {
  font-size: 9pt; font-weight: 600; color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.35); padding: 1px 5px; border-radius: 4px;
  border: 0.5px solid rgba(255, 255, 255, 0.08); white-space: nowrap;
}
.caw-body {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--card-inner);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 9px;
  padding: 7px 8px;
}
.caw-metrics {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.caw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9.5pt;
  line-height: 1.15;
  white-space: nowrap;
}
.caw-label {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--text-secondary); font-size: 9pt; font-weight: 500;
}
.caw-dot { width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 5px currentColor; }
.caw-val {
  font-weight: 700; color: #ffffff; font-variant-numeric: tabular-nums; font-size: 10pt;
}
.caw-time {
  font-size: 9pt; color: var(--text-tertiary); margin-left: 3px; font-weight: 500;
}

/* =============================================================================
   二级详情界面：全屏滑入卡片视图 (Level 2 Account Detail Full View)
   ============================================================================= */
.detail-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  animation: slideInRight 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideInRight {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}

/* 二级导航栏 */
.detail-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px 9px;
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
}
.back-btn {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600; color: #38bdf8;
  cursor: pointer; padding: 2px 6px; border-radius: 5px;
  background: rgba(56, 189, 248, 0.1); border: 0.5px solid rgba(56, 189, 248, 0.2);
  transition: all 0.15s ease;
}
.back-btn:hover {
  background: rgba(56, 189, 248, 0.2);
}
.detail-channel-tag {
  font-size: 9.5px; font-weight: 600; color: var(--text-secondary);
  display: flex; align-items: center; gap: 5px;
}

/* 二级页面核心内容体 */
.detail-content {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 账号身份卡 (Identity Box) */
.id-box {
  background: rgba(255, 255, 255, 0.04);
  border: 0.5px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.id-header {
  display: flex; align-items: center; justify-content: space-between;
}
.id-alias {
  font-size: 13.5px; font-weight: 700; color: #ffffff;
  display: flex; align-items: center; gap: 6px;
}
.edit-pen {
  font-size: 10px; color: #64748b; cursor: pointer;
  padding: 2px 4px; border-radius: 3px;
}
.edit-pen:hover { color: #38bdf8; background: rgba(56, 189, 248, 0.1); }
.id-email-row {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10pt; color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.25); padding: 5px 8px; border-radius: 6px;
}
.copy-badge {
  font-size: 8.5px; font-weight: 600; color: #38bdf8;
  cursor: pointer; padding: 1.5px 5px; border-radius: 3px;
  background: rgba(56, 189, 248, 0.12);
}
.copy-badge:hover { background: rgba(56, 189, 248, 0.25); }

.id-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  font-size: 9pt;
  color: var(--text-tertiary);
}
.id-meta-grid b { color: var(--text-secondary); font-weight: 600; }

/* 大仪表盘区 (Large Gauge Hub) */
.gauge-hub {
  background: rgba(0, 0, 0, 0.35);
  border: 0.5px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.gauge-hub-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.stat-slot {
  display: flex; flex-direction: column; gap: 2px;
}
.stat-slot-title {
  font-size: 9pt; font-weight: 600; color: var(--text-secondary);
  display: flex; align-items: center; justify-content: space-between;
}
.stat-slot-num {
  font-size: 11pt; font-weight: 800; color: #ffffff;
  font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 4px;
}
.stat-slot-num span { font-size: 9pt; font-weight: 500; color: var(--text-tertiary); }
.stat-bar {
  height: 4px; width: 100%; background: rgba(255,255,255,0.1); border-radius: 99px; overflow: hidden; margin-top: 2px;
}
.stat-bar-fill { height: 100%; border-radius: 99px; }

/* 24小时 / 7天用量热力图 (Activity Heatmap) */
.heatmap-card {
  background: rgba(255, 255, 255, 0.04);
  border: 0.5px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.hm-title {
  font-size: 10pt; font-weight: 700; color: var(--text-secondary);
  display: flex; align-items: center; justify-content: space-between;
}
.hm-grid {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  gap: 2.5px;
  padding: 2px 0;
}
.hm-cell {
  height: 18px; border-radius: 2px; background: rgba(255,255,255,0.06);
  transition: transform 0.1s ease;
}
.hm-cell:hover { transform: scale(1.2); }
.hm-cell.lvl-1 { background: rgba(56, 189, 248, 0.25); }
.hm-cell.lvl-2 { background: rgba(56, 189, 248, 0.55); }
.hm-cell.lvl-3 { background: rgba(56, 189, 248, 0.85); }
.hm-cell.lvl-hot { background: #ff453a; }
.hm-legend {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 8.5px; color: var(--text-tertiary);
}

/* 模型调用占比条 */
.model-breakdown {
  display: flex; gap: 4px; align-items: center; font-size: 9pt; color: var(--text-secondary);
}
.mb-pill {
  padding: 2px 6px; border-radius: 4px; font-size: 8.5px; font-weight: 600;
}
"""

AW_PALETTE = {
    "ok": {
        "color": "#30d158",
        "track": "#0a2613",
        "glow": "rgba(48, 209, 88, 0.3)",
        "gradient": ("#34d861", "#22b747")
    },
    "warn": {
        "color": "#ffd60a",
        "track": "#2a2202",
        "glow": "rgba(255, 214, 10, 0.3)",
        "gradient": ("#ffe033", "#e6be00")
    },
    "hot": {
        "color": "#ff453a",
        "track": "#2b0a08",
        "glow": "rgba(255, 69, 58, 0.35)",
        "gradient": ("#ff5e54", "#e03026")
    },
    "dead": {
        "color": "#8e8e93",
        "track": "#1b2029",
        "glow": "none",
        "gradient": ("#8e8e93", "#636366")
    }
}

def band(p):
    if p is None: return "dead"
    return "ok" if p > 50 else ("warn" if p >= 20 else "hot")

def aw_concentric_svg(h5_val, w1_val, size=52):
    p_h5 = max(0.0, min(100.0, float(h5_val)))
    p_w1 = max(0.0, min(100.0, float(w1_val)))
    cfg_h5 = AW_PALETTE[band(h5_val)]
    cfg_w1 = AW_PALETTE[band(w1_val)]
    
    sw_out = 3.8
    r_out = size / 2 - sw_out / 2 - 1.5
    c_out = 2 * math.pi * r_out
    off_out = c_out * (1 - p_h5 / 100.0)
    
    sw_in = 3.4
    gap = 2.6
    r_in = r_out - sw_out / 2 - gap - sw_in / 2
    c_in = 2 * math.pi * r_in
    off_in = c_in * (1 - p_w1 / 100.0)
    
    min_val = min(p_h5, p_w1)
    
    gid_out = f"grad_out_v11_{int(p_h5)}_{int(p_w1)}_{size}"
    gid_in = f"grad_in_v11_{int(p_h5)}_{int(p_w1)}_{size}"
    
    angle_out = (p_h5 / 100.0) * 2 * math.pi - math.pi / 2
    cap_x_out = size / 2 + r_out * math.cos(angle_out)
    cap_y_out = size / 2 + r_out * math.sin(angle_out)
    
    angle_in = (p_w1 / 100.0) * 2 * math.pi - math.pi / 2
    cap_x_in = size / 2 + r_in * math.cos(angle_in)
    cap_y_in = size / 2 + r_in * math.sin(angle_in)
    
    svg = f"""
    <svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.55));">
      <defs>
        <linearGradient id="{gid_out}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="{cfg_h5['gradient'][0]}"/>
          <stop offset="100%" stop-color="{cfg_h5['gradient'][1]}"/>
        </linearGradient>
        <linearGradient id="{gid_in}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="{cfg_w1['gradient'][0]}"/>
          <stop offset="100%" stop-color="{cfg_w1['gradient'][1]}"/>
        </linearGradient>
        <filter id="capShadowV11_{size}" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.0" flood-color="#000" flood-opacity="0.9"/>
        </filter>
      </defs>
      <!-- 外环底轨 -->
      <circle cx="{size/2}" cy="{size/2}" r="{r_out:.2f}" fill="none" stroke="{cfg_h5['track']}" stroke-width="{sw_out}"/>
      <!-- 外环进度 -->
      <circle cx="{size/2}" cy="{size/2}" r="{r_out:.2f}" fill="none" stroke="url(#{gid_out})" stroke-width="{sw_out}"
              stroke-linecap="round" stroke-dasharray="{c_out:.2f}" stroke-dashoffset="{off_out:.2f}"
              transform="rotate(-90 {size/2} {size/2})"
              style="filter: drop-shadow(0 0 2.5px {cfg_h5['glow']});"/>
      <circle cx="{cap_x_out:.2f}" cy="{cap_y_out:.2f}" r="{sw_out/2:.2f}" fill="{cfg_h5['gradient'][1]}" filter="url(#capShadowV11_{size})"/>

      <!-- 内环底轨 -->
      <circle cx="{size/2}" cy="{size/2}" r="{r_in:.2f}" fill="none" stroke="{cfg_w1['track']}" stroke-width="{sw_in}"/>
      <!-- 内环进度 -->
      <circle cx="{size/2}" cy="{size/2}" r="{r_in:.2f}" fill="none" stroke="url(#{gid_in})" stroke-width="{sw_in}"
              stroke-linecap="round" stroke-dasharray="{c_in:.2f}" stroke-dashoffset="{off_in:.2f}"
              transform="rotate(-90 {size/2} {size/2})"
              style="filter: drop-shadow(0 0 2px {cfg_w1['glow']});"/>
      <circle cx="{cap_x_in:.2f}" cy="{cap_y_in:.2f}" r="{sw_in/2:.2f}" fill="{cfg_w1['gradient'][1]}" filter="url(#capShadowV11_{size})"/>
    </svg>
    """
    fs = round(size * 0.25)
    inner = f'<span class="rnum" style="font-size:{fs}px;color:#ffffff;font-weight:800;letter-spacing:-0.5px;font-family:\'SF Pro Rounded\',sans-serif;"><span>{min_val:g}%</span></span>'
    return f'<span class="ringwrap" style="width:{size}px;height:{size}px">{svg}{inner}</span>'


def card_aw_v11(name, plan, h5=None, h5r="", w1=None, w1r="", active_click=False):
    card_cls = "card-aw" + (" active-target" if active_click else "")
    cfg_h5 = AW_PALETTE[band(h5)]
    cfg_w1 = AW_PALETTE[band(w1)]
    click_hint = '<span style="font-size:8px;color:#38bdf8;margin-left:auto;">点击详情 ➔</span>' if active_click else ''
    
    return f"""
    <div class="{card_cls}" title="点击进入【{name}】全屏详情">
      <div class="caw-head">
        <span class="caw-name">{name}</span>
        <span class="caw-plan">{plan}</span>
        {click_hint}
      </div>
      <div class="caw-body">
        {aw_concentric_svg(h5, w1, 52)}
        <div class="caw-metrics">
          <div class="caw-row">
            <span class="caw-label"><i class="caw-dot" style="background:{cfg_h5['color']};color:{cfg_h5['glow']};"></i>外 5h</span>
            <span class="caw-val" style="color:{cfg_h5['color']};">{h5}%<span class="caw-time">恢 {h5r}</span></span>
          </div>
          <div class="caw-row" style="margin-top:4px;">
            <span class="caw-label"><i class="caw-dot" style="background:{cfg_w1['color']};color:{cfg_w1['glow']};"></i>内 1w</span>
            <span class="caw-val" style="color:{cfg_w1['color']};">{w1}%<span class="caw-time">恢 {w1r}</span></span>
          </div>
        </div>
      </div>
    </div>
    """


# ==============================================================================
# 数据
# ==============================================================================
CLAUDE_ACCOUNTS = [
    ("工作主力", "Max 5x", 9, "1h04m", 41, "3d"),
    ("客户A-交付", "Team", 12, "38m", 63, "2d"),
    ("核心研发", "Team", 37, "2h13m", 55, "4d"),
    ("个人日常", "Max 5x", 59, "3h", 72, "6d"),
]


def render_screen(sid, title, meta_tags, story, body_html, note=""):
    tags = "".join(f'<span class="tag">{t}</span>' for t in meta_tags)
    return f"""
    <div class="screen" id="{sid}">
      <div class="screen-head">
        <div class="screen-title">{sid} · {title}</div>
        <div class="screen-tags">{tags}</div>
      </div>
      <div class="screen-body">
        {body_html}
      </div>
      <div class="screen-foot">
        <b>交互与设计说明：</b>{note}
      </div>
    </div>
    """

def make_panel(inner_html):
    return f"""
    <div class="panel">
      <div class="panel-caret"></div>
      {inner_html}
    </div>
    """


def main():
    screens = []

    # --------------------------------------------------------------------------
    # 屏 1：一级界面 (Level 1: Cards Overview)
    # --------------------------------------------------------------------------
    p1 = f"""
    <div class="panel-header">
      <div class="panel-title">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        AI 额度 HUD
      </div>
      <div class="panel-time">12:41 更新</div>
    </div>
    <div class="ch-banner">
      <div class="ch-name">
        <b>Claude</b>
        <span class="ch-badge">8 账号</span>
        <div class="ch-pdots"><i class="on"></i><i></i></div>
      </div>
      <div class="ch-stat" style="color:#ff453a;">最少 9% · 1/2页 ⇄</div>
    </div>
    <div class="card-grid">
      {card_aw_v11(*CLAUDE_ACCOUNTS[0], active_click=True)}  <!-- 第一张卡片提示点击 -->
      {card_aw_v11(*CLAUDE_ACCOUNTS[1])}
      {card_aw_v11(*CLAUDE_ACCOUNTS[2])}
      {card_aw_v11(*CLAUDE_ACCOUNTS[3])}
    </div>
    <div class="swipe-bar">
      <span>◂ 触控板左右轻扫翻页 (1/2) ▸</span>
    </div>
    <div class="panel-footer">
      <span>4 渠道 · 18 账号</span>
      <span>点击任意卡片查看全量详情 ➔</span>
    </div>
    """
    screens.append(render_screen(
        "V11-01", "一级界面：保留自定义别名，卡片纯粹清爽（点击卡片触发滑入）",
        ["一级概览", "自定义别名", "触发详情"], "US-09,US-11",
        make_panel(p1),
        "<b>1. 一级纯粹性：</b>卡片上只保留最能一眼认出的自定义别名（如『工作主力』、『客户A-交付』），无任何长邮箱打扰；<br>"
        "<b>2. 原生交互触点：</b>点击卡片任意区域，整个面板平滑横向滑入（Push Navigation）到二级账号详情页；<br>"
        "<b>3. 零挤压承诺：</b>同心环、百分比、恢复倒计时严密对齐，字号全部规范在 9.5-10pt。"
    ))

    # --------------------------------------------------------------------------
    # 屏 2：二级详情全屏视图 (Level 2: Full View Account Details)
    # --------------------------------------------------------------------------
    # 模拟 24 小时热力图格子状态
    heatmap_cells = []
    # 模拟早9点到晚24点的调用频率
    levels = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 1, 2, 3, "hot", "hot", 3, 2, 3, 2, 1, 0, 0]
    for lvl in levels:
        cls = f"lvl-{lvl}" if lvl != 0 else ""
        heatmap_cells.append(f'<div class="hm-cell {cls}"></div>')

    p2 = f"""
    <div class="detail-view">
      <!-- 二级导航栏 -->
      <div class="detail-nav">
        <div class="back-btn" title="返回全部账号列表">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
          全部账号 (Esc)
        </div>
        <div class="detail-channel-tag">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
          Claude 官方组织
        </div>
      </div>

      <div class="detail-content">
        <!-- 1. 账号身份与凭据区 (可自由编辑别名) -->
        <div class="id-box">
          <div class="id-header">
            <div class="id-alias">
              <span>💼 工作主力</span>
              <span class="edit-pen" title="点击重命名别名">✎ 重命名</span>
            </div>
            <span class="caw-plan" style="font-size:9pt;background:rgba(56,189,248,0.15);color:#38bdf8;">Max 5x 套餐</span>
          </div>
          <div class="id-email-row">
            <span style="font-family:monospace;font-size:10pt;color:#f8fafc;">alex.chen@design-lab.agency</span>
            <span class="copy-badge" title="复制邮箱">复制</span>
          </div>
          <div class="id-meta-grid">
            <div>组织架构：<b>Design-Eng Lab</b></div>
            <div>登录协议：<b>Google OAuth</b></div>
            <div>授权状态：<b style="color:#30d158;">活跃有效 (28d后刷新)</b></div>
            <div>最后同步：<b>12:41:08 (刚刚)</b></div>
          </div>
        </div>

        <!-- 2. 全量额度与恢复大仪表盘 (74px 苹果大环 + 进度条) -->
        <div class="gauge-hub">
          {aw_concentric_svg(9, 41, 74)}
          <div class="gauge-hub-stats">
            <!-- 5h 窗口 -->
            <div class="stat-slot">
              <div class="stat-slot-title">
                <span style="display:flex;align-items:center;gap:4px;"><i class="caw-dot" style="background:#ff453a;"></i>5小时限额</span>
                <span style="color:#ff453a;font-weight:700;">告急 (9%)</span>
              </div>
              <div class="stat-slot-num">
                <b>45</b> / 500 <span>可用 Token (已用 91%)</span>
              </div>
              <div class="stat-bar"><div class="stat-bar-fill" style="width:9%;background:#ff453a;"></div></div>
              <div style="font-size:8.5px;color:#94a3b8;margin-top:1px;">预计复位时间：<b>13:45 (还剩 1h04m)</b></div>
            </div>

            <!-- 1w 窗口 -->
            <div class="stat-slot" style="margin-top:2px;">
              <div class="stat-slot-title">
                <span style="display:flex;align-items:center;gap:4px;"><i class="caw-dot" style="background:#bf5af2;"></i>周度总限额</span>
                <span style="color:#bf5af2;font-weight:700;">充裕 (41%)</span>
              </div>
              <div class="stat-slot-num">
                <b>205k</b> / 500k <span>可用 Token (已用 59%)</span>
              </div>
              <div class="stat-bar"><div class="stat-bar-fill" style="width:41%;background:#bf5af2;"></div></div>
              <div style="font-size:8.5px;color:#94a3b8;margin-top:1px;">本周周期复位：<b>周日 24:00 (还剩 3天)</b></div>
            </div>
          </div>
        </div>

        <!-- 3. 24小时调用热力图与峰值 -->
        <div class="heatmap-card">
          <div class="hm-title">
            <span>24 小时调用强度热力图</span>
            <span style="font-size:8.5px;color:#ff453a;font-weight:600;">15:00–17:00 踩上限速</span>
          </div>
          <div class="hm-grid">
            {"".join(heatmap_cells)}
          </div>
          <div class="hm-legend">
            <span>00:00 (夜间)</span>
            <span>12:00 (午间)</span>
            <span>24:00 (实时)</span>
          </div>
        </div>

        <!-- 4. 模型调用配额与历史分布 -->
        <div class="heatmap-card" style="padding:8px 12px;gap:5px;">
          <div class="hm-title" style="font-size:9pt;">
            <span>活跃模型与速率占比</span>
            <span style="font-size:8px;color:#94a3b8;">过去 24 小时</span>
          </div>
          <div class="model-breakdown">
            <span class="mb-pill" style="background:rgba(56,189,248,0.15);color:#38bdf8;">Sonnet 3.7 (72%)</span>
            <span class="mb-pill" style="background:rgba(191,90,242,0.15);color:#bf5af2;">Opus 3.5 (21%)</span>
            <span class="mb-pill" style="background:rgba(255,255,255,0.08);color:#cbd5e1;">Haiku (7%)</span>
          </div>
        </div>
      </div>

      <!-- 详情页底部操作栏 -->
      <div class="panel-footer" style="padding:8px 14px;">
        <span style="color:#38bdf8;cursor:pointer;">⟳ 手动强刷用量</span>
        <span style="color:#ef4444;cursor:pointer;">断开此账号</span>
      </div>
    </div>
    """
    screens.append(render_screen(
        "V11-02", "二级界面：全区域滑入账号详情页（完整邮箱、74px大环、绝对数值、热力图）",
        ["二级详情", "全屏展示", "热力图"], "US-11,US-12",
        make_panel(p2),
        "<b>充分利用 412px 全部可视区域：</b><br>"
        "1. <b>顶部导航返回：</b>点击『‹ 全部账号』或按键盘 Esc 平滑滑回一级卡片网格；<br>"
        "2. <b>凭据管理：</b>展示真实邮箱（带一键复制）、组织、OAuth 协议，支持直接点击『✎ 重命名』自定义别名；<br>"
        "3. <b>深度额度仪表：</b>74px 苹果级同心圆环，附带 5h/1w 绝对 Token 消耗值、已用比例和精确恢复时间点；<br>"
        "4. <b>24小时活跃热力图：</b>24 个时段格清晰标出何时调用最猛、何时撞限流（红格）；<br>"
        "5. <b>模型分布：</b>展示 Sonnet / Opus 的真实配额调用占比。"
    ))

    # --------------------------------------------------------------------------
    # 屏 3：动效与转场流程总览 (Transition Flow: Level 1 -> Level 2)
    # --------------------------------------------------------------------------
    flow_html = f"""
    <div style="background:#090e1a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;width:100%;max-width:370px;">
      <div style="font-size:12px;font-weight:700;color:#38bdf8;margin-bottom:12px;">
        macOS Push Navigation 转场架构
      </div>
      <div style="font-size:11px;color:#cbd5e1;line-height:1.7;">
        <b>• 点击交互：</b>在一级卡片点击任意账号（例如『工作主力』）；<br>
        <b>• 物理滑入：</b>一级网格向左轻微平移 (X: -40px) 并淡出，二级详情页从右侧平滑滑入 (X: 0)；<br>
        <b>• 动画曲线：</b><code>cubic-bezier(0.16, 1, 0.3, 1)</code>（Apple 原厂轻巧减速曲线），耗时 <b>280ms</b>；<br>
        <b>• 返回方式：</b><br>
        &nbsp;&nbsp;1. 点击顶部 <code>‹ 全部账号</code><br>
        &nbsp;&nbsp;2. 键盘直接按 <code>Esc</code> 键<br>
        &nbsp;&nbsp;3. 触控板从左边缘向右单指轻扫 (Edge Swipe Back)；<br>
        <b>• 尺寸一致：</b>面板宽高完全保持 412px，视窗绝不抖动变形。
      </div>
      <div style="margin-top:14px;padding:8px 10px;background:rgba(56,189,248,0.1);border-radius:6px;font-size:10px;color:#38bdf8;">
        ✓ 完美兼顾：一级界面极致防窥与紧凑，二级界面极致详尽与硬核。
      </div>
    </div>
    """
    screens.append(render_screen(
        "V11-03", "转场与交互架构：极速 280ms 弹性滑入 + 3 种极简返回途径",
        ["转场动效", "PushNavigation", "手势返回"], "US-09,US-12",
        flow_html,
        "<b>为什么这是最佳体验组合？</b><br>"
        "• 传统 Tooltip 悬停浮层容易遮挡下方卡片，且面积狭小无法展示调用趋势；<br>"
        "• 弹窗 Modal 会破坏 HUD 沉浸感；<br>"
        "• <b>全区域滑入（Push Navigation）</b> 是 macOS / iOS 最地道的原生导航范式，让一个小小 412px 的 HUD 面板具备了专业级开发工具的纵深。"
    ))

    # 组装完整 HTML
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 额度 HUD · 一级别名概览 + 二级全屏滑入详情原型 (v11)</title>
  <style>{CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow"><span class="dot"></span>层级架构演进 · 一级极致简洁 + 二级硬核全景</div>
    <h1>一级别名概览 + 二级全区域滑入账号详情</h1>
    <div class="sub">
      响应你的关键指示：<b>“一级界面展示还是保留用户自定义名称；登录账号换一种方式，点击后整个界面滑入点击账号详情，利用当前全部区域展示真实账号、具体额度、使用量、调用历史热力图等”</b>。<br>
      本版本将 HUD 升级为经典的 <b>macOS Push-Navigation 双层架构</b>：一级看全局定性，二级看深度定量。
    </div>

    <div class="meta-chips">
      <span class="chip">当前版本：<b>v11 双层全景原型</b></span>
      <span class="chip">一级界面：<b>纯粹别名 + Apple Watch 同心双环</b></span>
      <span class="chip">二级界面：<b>利用全部 412px 区域深度展开</b></span>
      <span class="chip">核心数据：<b>真实邮箱 + 74px大环 + 24h调用热力图 + 模型配额</b></span>
      <span class="chip">返回体验：<b>‹ 返回按钮 / Esc 键 / 触控板边缘右滑</b></span>
    </div>

    <section>
      <h2><span class="num">01</span>一级概览与二级滑入详情全景设计对照</h2>
      <div class="grid">
        {"".join(screens)}
      </div>
    </section>

    <footer style="margin-top:40px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);font-size:11.5px;color:#64748b;display:flex;justify-content:space-between;">
      <span>AI 额度 HUD 原型 · v11 双层全景纯原型设计 · 2026-10-30</span>
      <span>文件：/opt/data/ai-credits/quota-hud/ai-quota-hud-quota-v11.html</span>
    </footer>
  </div>
</body>
</html>
"""

    out_file = OUT / "ai-quota-hud-quota-v11.html"
    out_file.write_text(html, encoding="utf-8")
    print(f"Screens: {len(screens)} | Wrote {len(html)} bytes to {out_file}")

if __name__ == "__main__":
    main()
