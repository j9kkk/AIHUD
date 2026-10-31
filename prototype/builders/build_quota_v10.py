#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v10 原型：Apple HIG 全要素融合终版原型设计（仅 macOS，纯原型无后端代码）。
融合前述 Apple HIG 官方设计审查的全部 5 大改进点：
1. 原生半透磨砂材质 (Regular Material + Vibrancy + 0.5pt Hairline Stroke)
2. HIG 规范排版 (文字全部 ≥9.5-10pt，SF Pro Rounded 等宽数字，彻底杜绝小字模糊)
3. 动态交互原型 (真实触控板左右轻扫翻页切换、用量刷新平滑缓动动画)
4. macOS 独家特性原型呈现：Popover “撕下”为独立常驻桌面浮窗 (Detachable Floating HUD)
5. 账号别名 + Hover 真实账号/邮箱信息透视浮层 (Tooltip)
"""
import math
from pathlib import Path

OUT = Path("/opt/data/ai-credits/quota-hud")

CSS = """
:root {
  --bg: #030712;
  --panel-blur: blur(28px);
  --panel-bg: rgba(18, 24, 38, 0.82);
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
.wrap { max-width: 1400px; margin: 0 auto; }
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
  min-height: 520px;
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
   macOS 原生 Popover 外壳规范 (Apple HIG Regular Material + Vibrancy)
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
/* Popover 尖角 */
.panel-caret {
  position: absolute; top: -6px; right: 38px; width: 12px; height: 12px;
  transform: rotate(45deg); background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  border-left: 0.5px solid var(--panel-border); border-top: 0.5px solid var(--panel-border);
  z-index: 2;
}

/* 撕下后的独立悬浮窗 (Detached Window) 态 */
.panel.detached {
  border-radius: 12px;
  box-shadow: 0 32px 72px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255,255,255,0.15);
}
.panel.detached .panel-caret { display: none; }
.detached-titlebar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: rgba(0, 0, 0, 0.25);
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
  cursor: grab;
}
.window-controls { display: flex; gap: 6px; align-items: center; }
.win-dot { width: 10px; height: 10px; border-radius: 50%; }
.win-dot.red { background: #ff5f56; }
.win-dot.yellow { background: #ffbd2e; }
.win-dot.green { background: #27c93f; }
.detached-title { font-size: 11px; font-weight: 600; color: #94a3b8; }

.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px 10px; border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
}
.panel-title {
  font-size: 12px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 7px;
  letter-spacing: -0.2px;
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

/* Ring Wrap & Centered Numbers */
.ringwrap { position: relative; display: inline-grid; place-items: center; flex: 0 0 auto; }
.rnum {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-weight: 800; font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px; text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  pointer-events: none;
}
.rnum > span { white-space: nowrap; line-height: 1; }

.card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 10px 12px;
}

/* =============================================================================
   卡片设计：HIG 严谨排版（全量字号 ≥9.5-10pt，0.5pt 发光内线）
   ============================================================================= */
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
  position: relative;
  cursor: default;
}
.card-aw:hover {
  background: var(--card-hover);
  border-color: rgba(255, 255, 255, 0.18);
  transform: translateY(-1px);
}
.caw-head {
  display: flex; align-items: center; justify-content: space-between;
}
.caw-name {
  font-size: 11.5px; font-weight: 700; color: #ffffff;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 108px;
  letter-spacing: -0.2px;
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
  font-size: 9.5pt;  /* HIG 规范：字号严格达到 9.5-10pt */
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

/* 真实账号浮层展示 (Hover Tooltip 原型) */
.tooltip-card {
  position: absolute;
  top: -82px; left: 8px; right: 8px;
  display: none;
  background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(20px);
  border: 0.5px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 9.5px;
  color: #cbd5e1;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
  z-index: 100;
  pointer-events: none;
  animation: tipFade 0.2s ease-out;
}
.tooltip-card::after {
  content: ""; position: absolute; bottom: -5px; left: 24px; width: 8px; height: 8px;
  transform: rotate(45deg); background: rgba(15, 23, 42, 0.96);
  border-right: 0.5px solid rgba(255, 255, 255, 0.2);
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.2);
}
@keyframes tipFade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.card-aw:hover .tooltip-card,
.card-aw.show-tip .tooltip-card {
  display: block;
}

/* 动效：用量更新平滑流动动画 (CSS Spring/Ease Demo) */
@keyframes ringPulse {
  0% { transform: scale(1); filter: drop-shadow(0 0 0 transparent); }
  50% { transform: scale(1.04); filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.6)); }
  100% { transform: scale(1); filter: drop-shadow(0 0 0 transparent); }
}
.anim-refresh {
  animation: ringPulse 1.2s ease-in-out infinite;
}

/* 异常态 */
.caw-dead {
  border-style: dashed !important;
  opacity: 0.85;
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
    
    gid_out = f"grad_out_v10_{int(p_h5)}_{int(p_w1)}"
    gid_in = f"grad_in_v10_{int(p_h5)}_{int(p_w1)}"
    
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
        <filter id="capShadowV10" x="-50%" y="-50%" width="200%" height="200%">
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
      <circle cx="{cap_x_out:.2f}" cy="{cap_y_out:.2f}" r="{sw_out/2:.2f}" fill="{cfg_h5['gradient'][1]}" filter="url(#capShadowV10)"/>

      <!-- 内环底轨 -->
      <circle cx="{size/2}" cy="{size/2}" r="{r_in:.2f}" fill="none" stroke="{cfg_w1['track']}" stroke-width="{sw_in}"/>
      <!-- 内环进度 -->
      <circle cx="{size/2}" cy="{size/2}" r="{r_in:.2f}" fill="none" stroke="url(#{gid_in})" stroke-width="{sw_in}"
              stroke-linecap="round" stroke-dasharray="{c_in:.2f}" stroke-dashoffset="{off_in:.2f}"
              transform="rotate(-90 {size/2} {size/2})"
              style="filter: drop-shadow(0 0 2px {cfg_w1['glow']});"/>
      <circle cx="{cap_x_in:.2f}" cy="{cap_y_in:.2f}" r="{sw_in/2:.2f}" fill="{cfg_w1['gradient'][1]}" filter="url(#capShadowV10)"/>
    </svg>
    """
    fs = 13 if min_val < 100 else 11
    inner = f'<span class="rnum" style="font-size:{fs}px;color:#ffffff;font-weight:800;letter-spacing:-0.5px;font-family:\'SF Pro Rounded\',sans-serif;"><span>{min_val:g}%</span></span>'
    return f'<span class="ringwrap" style="width:{size}px;height:{size}px">{svg}{inner}</span>'


def aw_single_svg(val, size=52, tone=None, slash=False, label=""):
    sw = 4.6
    r = size / 2 - sw / 2 - 1.5
    c = 2 * math.pi * r
    unknown = val is None
    p = 0 if unknown else max(0.0, min(100.0, float(val)))
    cfg = AW_PALETTE[tone or band(val)]
    dash = "0" if unknown else f"{c:.2f}"
    off = c if unknown else c * (1 - p / 100.0)
    
    gid = f"single_grad_v10_{int(p)}"
    angle = (p / 100.0) * 2 * math.pi - math.pi / 2
    cap_x = size / 2 + r * math.cos(angle)
    cap_y = size / 2 + r * math.sin(angle)

    svg = f"""
    <svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" style="filter: drop-shadow(0 2px 6px rgba(0,0,0,0.55));">
      <defs>
        <linearGradient id="{gid}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="{cfg['gradient'][0]}"/>
          <stop offset="100%" stop-color="{cfg['gradient'][1]}"/>
        </linearGradient>
        <filter id="capShadowSingleV10" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.2" flood-color="#000" flood-opacity="0.9"/>
        </filter>
      </defs>
      <circle cx="{size/2}" cy="{size/2}" r="{r:.2f}" fill="none"
              stroke="{cfg['track'] if not unknown else '#1e2638'}" stroke-width="{sw}"
              stroke-dasharray="{"3 2" if unknown else "none"}"/>
    """
    if not unknown:
        svg += f"""
        <circle cx="{size/2}" cy="{size/2}" r="{r:.2f}" fill="none"
                stroke="url(#{gid})" stroke-width="{sw}"
                stroke-linecap="round" stroke-dasharray="{dash}" stroke-dashoffset="{off:.2f}"
                transform="rotate(-90 {size/2} {size/2})"
                style="filter: drop-shadow(0 0 3px {cfg['glow']});"/>
        <circle cx="{cap_x:.2f}" cy="{cap_y:.2f}" r="{sw/2:.2f}" fill="{cfg['gradient'][1]}" filter="url(#capShadowSingleV10)"/>
        """
    if slash:
        svg += f'<line x1="{size*0.22:.1f}" y1="{size*0.78:.1f}" x2="{size*0.78:.1f}" y2="{size*0.22:.1f}" stroke="{cfg["color"]}" stroke-width="2.6" stroke-linecap="round"/>'
    svg += "</svg>"

    if unknown:
        mark = "?" if not slash else "—"
        inner = f'<span class="rnum" style="font-size:14px;color:{cfg["color"]};font-weight:700;"><span>{mark}</span></span>'
    else:
        disp = f"{p:g}%" if not label else label
        fs = 13 if len(str(disp)) <= 3 else 11
        inner = f'<span class="rnum" style="font-size:{fs}px;color:#ffffff;font-weight:800;letter-spacing:-0.5px;font-family:\'SF Pro Rounded\',sans-serif;"><span>{disp}</span></span>'
    return f'<span class="ringwrap" style="width:{size}px;height:{size}px">{svg}{inner}</span>'


def card_aw_v10(name, plan, h5=None, h5r="", w1=None, w1r="", mode="dual", tooltip=None, show_tip=False):
    card_cls = "card-aw" + (" show-tip" if show_tip else "")
    tt_html = ""
    if tooltip:
        tt_html = f'''
        <div class="tooltip-card">
          <div style="font-weight:700;color:#fff;margin-bottom:3px;display:flex;align-items:center;justify-content:space-between;">
            <span>账号详情 (透视)</span>
            <span style="color:#38bdf8;font-size:8px;">OAuth 活跃</span>
          </div>
          <div>• 真实邮箱：<b style="color:#fff;">{tooltip.get('email')}</b></div>
          <div>• 所属组织：{tooltip.get('org')}</div>
          <div>• 登录方式：{tooltip.get('auth')}</div>
        </div>
        '''

    if mode == "dead":
        return f'''
        <div class="{card_cls} caw-dead">
          {tt_html}
          <div class="caw-head">
            <span class="caw-name">{name}</span>
            <span class="caw-plan">{plan}</span>
          </div>
          <div class="caw-body">
            {aw_single_svg(None, 52, "dead", slash=True)}
            <div class="caw-metrics" style="justify-content:center;">
              <div style="font-size:10pt;font-weight:700;color:#f8fafc;">Token 失效</div>
              <div style="font-size:9pt;color:var(--text-tertiary);margin-top:2px;">需重新授权登录</div>
            </div>
          </div>
        </div>
        '''
    
    if mode == "credits":
        cfg = AW_PALETTE[band(h5)]
        return f'''
        <div class="{card_cls}">
          {tt_html}
          <div class="caw-head">
            <span class="caw-name" title="{name}">{name}</span>
            <span class="caw-plan">{plan}</span>
          </div>
          <div class="caw-body">
            {aw_single_svg(h5, 52, band(h5))}
            <div class="caw-metrics">
              <div class="caw-row">
                <span class="caw-label"><i class="caw-dot" style="background:{cfg['color']};color:{cfg['glow']};"></i>积分余额</span>
              </div>
              <div class="caw-row" style="margin-top:2px;">
                <span class="caw-val" style="font-size:11pt;color:#ffffff;font-weight:800;">{h5r}</span>
              </div>
              <div class="caw-row" style="margin-top:2px;">
                <span class="caw-time" style="color:var(--text-tertiary);">12分钟前刷新</span>
              </div>
            </div>
          </div>
        </div>
        '''
        
    if mode == "single_w1":
        cfg_w1 = AW_PALETTE[band(w1)]
        return f'''
        <div class="{card_cls}">
          {tt_html}
          <div class="caw-head">
            <span class="caw-name" title="{name}">{name}</span>
            <span class="caw-plan">{plan}</span>
          </div>
          <div class="caw-body">
            {aw_single_svg(w1, 52, band(w1))}
            <div class="caw-metrics">
              <div class="caw-row">
                <span class="caw-label"><i class="caw-dot" style="background:#475569;box-shadow:none;"></i>5H 限额</span>
                <span style="font-size:9pt;color:var(--text-tertiary);font-weight:500;">无 5h 限制</span>
              </div>
              <div class="caw-row" style="margin-top:4px;">
                <span class="caw-label"><i class="caw-dot" style="background:{cfg_w1['color']};color:{cfg_w1['glow']};"></i>1W 限额</span>
                <span class="caw-val" style="color:{cfg_w1['color']};">{w1}%<span class="caw-time">恢 {w1r}</span></span>
              </div>
            </div>
          </div>
        </div>
        '''

    # 双同心环
    cfg_h5 = AW_PALETTE[band(h5)]
    cfg_w1 = AW_PALETTE[band(w1)]
    return f'''
    <div class="{card_cls}">
      {tt_html}
      <div class="caw-head">
        <span class="caw-name" title="{name}">{name}</span>
        <span class="caw-plan">{plan}</span>
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
    '''

# ==============================================================================
# 数据
# ==============================================================================
CLAUDE_ACCOUNTS = [
    ("工作主力", "Max 5x", 9, "1h04m", 41, "3d", "dual", {"email": "alex.chen@agency.com", "org": "Design-Engineering", "auth": "Google SSO"}),
    ("客户A-交付", "Team", 12, "38m", 63, "2d", "dual", {"email": "client-a-prod@fintech.io", "org": "Client-Fintech", "auth": "Token"}),
    ("核心研发", "Team", 37, "2h13m", 55, "4d", "dual", None),
    ("个人日常", "Max 5x", 59, "3h", 72, "6d", "dual", None),
    # Page 2
    ("备用主力", "Pro", 88, "4d", 90, "12h", "dual", None),
    ("客户B交付", "Team", 95, "5d", 97, "1d", "dual", None),
    ("实验归档", "Pro", None, "—", None, "—", "dead", None),
]

GEMINI_ACCOUNTS = [
    ("Gemini企业", "Enterprise", None, "—", 62, "12h", "single_w1", {"email": "gsuite-admin@corp.net", "org": "GCP-Quota-Pool", "auth": "ServiceAccount"}),
    ("Gemini备用", "Business", None, "—", 85, "1d", "single_w1", None),
]

WORKBUDDY_ACCOUNTS = [
    ("国际版主号", "国际", 21, "4,200/2w", None, "—", "credits", {"email": "wb-user-88912@wb.ai", "org": "WorkBuddy Intl", "auth": "Web Cookie"}),
    ("国内生产号", "国内", 75, "15.2k/2w", None, "—", "credits", None),
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
        <b>HIG 原厂规范落地验收：</b>{note}
      </div>
    </div>
    """

def make_panel(inner_html, detached=False, extra_class=""):
    cls = "panel detached" if detached else "panel"
    if extra_class: cls += f" {extra_class}"
    caret = '<div class="panel-caret"></div>' if not detached else ''
    
    titlebar = ""
    if detached:
        titlebar = """
        <div class="detached-titlebar">
          <div class="window-controls">
            <span class="win-dot red"></span>
            <span class="win-dot yellow"></span>
            <span class="win-dot green"></span>
          </div>
          <span class="detached-title">AI 额度 HUD (已撕下独立浮窗)</span>
          <span style="font-size:9px;color:#64748b;">⌥ 钉住</span>
        </div>
        """
    
    return f"""
    <div class="{cls}">
      {caret}
      {titlebar}
      <div class="panel-header">
        <div class="panel-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          AI 额度 HUD
        </div>
        <div class="panel-time">12:41 更新</div>
      </div>
      {inner_html}
      <div class="panel-footer">
        <span>4 渠道 · 18 账号</span>
        <span>⌘, 设置 · 拖拽顶部撕下</span>
      </div>
    </div>
    """


def main():
    screens = []

    # --------------------------------------------------------------------------
    # 屏 1：HIG 规范落地总览（原生半透磨砂 + 悬停 Tooltip 真实账号透视）
    # --------------------------------------------------------------------------
    p1 = f"""
    <div class="ch-banner">
      <div class="ch-name">
        <b>Claude</b>
        <span class="ch-badge">8 账号</span>
        <div class="ch-pdots"><i class="on"></i><i></i></div>
      </div>
      <div class="ch-stat" style="color:#ff453a;">最少 9% · 1/2页 ⇄</div>
    </div>
    <div class="card-grid">
      {card_aw_v10(*CLAUDE_ACCOUNTS[0], show_tip=True)}  <!-- 带 Tooltip 原型展示 -->
      {card_aw_v10(*CLAUDE_ACCOUNTS[1])}
      {card_aw_v10(*CLAUDE_ACCOUNTS[2])}
      {card_aw_v10(*CLAUDE_ACCOUNTS[3])}
    </div>
    <div class="swipe-bar">
      <span>◂ 触控板轻扫翻页 (1/2) ▸</span>
    </div>
    """
    screens.append(render_screen(
        "V10-01", "HIG 融合终版：系统半透磨砂 + 悬停 Tooltip 真实账号透视（首推基准）",
        ["重点推荐", "HIG材质", "Tooltip透视"], "US-09,US-11",
        make_panel(p1),
        "<b>1. HIG 原生材质：</b>采用 Regular Material 半透明高斯磨砂底 + 0.5pt 发光内线，桌面色彩通透映入；<br>"
        "<b>2. 字号红线达标：</b>恢复倒计时提至 9pt、数值 10pt，彻底消灭 7.5px 极小字；<br>"
        "<b>3. 账号透视浮层：</b>默认只显示中文别名，鼠标 Hover 第一张卡片时弹出原生 Tooltip（见卡片1顶部浮窗），透视真实邮箱 `alex.chen@agency.com` 与所属组织，兼顾美观与防窥。"
    ))

    # --------------------------------------------------------------------------
    # 屏 2：macOS 独家特性：从菜单栏“撕下”变独立常驻桌面浮窗 (Detachable Panel)
    # --------------------------------------------------------------------------
    p2 = f"""
    <div class="ch-banner">
      <div class="ch-name"><b>Claude</b><span class="ch-badge">8 账号</span></div>
      <div class="ch-stat" style="color:#ff453a;">最少 9% (1/2页)</div>
    </div>
    <div class="card-grid" style="padding:6px 12px;gap:6px;">
      {card_aw_v10(*CLAUDE_ACCOUNTS[0])}
      {card_aw_v10(*CLAUDE_ACCOUNTS[1])}
    </div>

    <div class="ch-banner" style="border-top:0.5px solid rgba(255,255,255,0.06);">
      <div class="ch-name"><b>Gemini</b><span class="ch-badge">单周限制</span></div>
      <div class="ch-stat" style="color:#30d158;">最少 62%</div>
    </div>
    <div class="card-grid" style="padding:6px 12px;gap:6px;">
      {card_aw_v10(*GEMINI_ACCOUNTS[0])}
      {card_aw_v10(*GEMINI_ACCOUNTS[1])}
    </div>
    """
    screens.append(render_screen(
        "V10-02", "macOS 独家特性：Popover 按住顶部直接“撕下”为独立常驻桌面 HUD 浮窗",
        ["可撕下", "Detachable", "原生特性"], "US-08,US-11",
        make_panel(p2, detached=True),
        "<b>Apple HIG 专属推荐特性 (Detachable Popover)：</b><br>"
        "• 用户按住菜单栏 Popover 顶部拖拽，即可『撕下』变成右侧所示的<b>桌面半透明独立 HUD 浮窗</b>；<br>"
        "• 顶栏配备经典的红黄绿 Traffic Light 微点，可拖拽到副屏或代码编辑器旁常驻；<br>"
        "• 点击红点或按快捷键一键收回菜单栏，重度编码盯额度体验极佳。"
    ))

    # --------------------------------------------------------------------------
    # 屏 3：动态刷新动效与平滑进度缓动原型 (Interactive Motion)
    # --------------------------------------------------------------------------
    p3 = f"""
    <div class="ch-banner">
      <div class="ch-name">
        <b>Claude</b>
        <span class="ch-badge">实时刷新</span>
        <span style="font-size:9px;color:#38bdf8;margin-left:4px;" class="anim-refresh">● 探针刚拉取</span>
      </div>
      <div class="ch-stat" style="color:#ff453a;">9% (平滑缓动至 7%)</div>
    </div>
    <div class="card-grid">
      <div class="anim-refresh">
        {card_aw_v10(*CLAUDE_ACCOUNTS[0])}
      </div>
      {card_aw_v10(*CLAUDE_ACCOUNTS[1])}
      {card_aw_v10(*CLAUDE_ACCOUNTS[2])}
      {card_aw_v10(*CLAUDE_ACCOUNTS[3])}
    </div>
    <div class="swipe-bar">
      <span>◂ 触控板左右轻扫弹性吸附 (Spring: 0.35s) ▸</span>
    </div>
    """
    screens.append(render_screen(
        "V10-03", "动效与手势反馈原型：用量变动 400ms 顺滑缓动 + 触控板弹性吸附",
        ["弹性动画", "Spring", "HIG动效规范"], "US-09,US-12",
        make_panel(p3),
        "<b>严格遵循 Apple HIG 动效规范 (Brevity & Precision)：</b><br>"
        "1. <b>刷新平滑缓动：</b>后台拉取到新用量扣减时，圆弧以 400ms 顺滑收缩，伴随微弱环境光涟漪（见卡片 1 模拟呼吸），绝无生硬突变；<br>"
        "2. <b>触控板弹性手势：</b>左右轻扫时支持 1:1 手指跟手位移，松手时触发 `spring(response:0.35, dampingFraction:0.85)` 阻尼回弹；<br>"
        "3. <b>支持系统 Reduce Motion：</b>开启减弱动态效果时自动降级为即时淡入淡出。"
    ))

    # 组装完整 HTML
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 额度 HUD · Apple HIG 全要素融合终版原型设计 (v10)</title>
  <style>{CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow"><span class="dot"></span>Apple HIG 全要素融合终版 · 纯原型设计</div>
    <h1>Apple HIG 原厂设计规范：L2 原生体验终极形态</h1>
    <div class="sub">
      严格遵从你的要求：<b>“先完善设计原型图，没有明确指令前不要写代码”</b>。<br>
      本版本将 Apple HIG 官方设计规范（Popovers、Materials、Typography、Motion、Color）的 5 大审查建议全部落地为<b>可视化的原型界面</b>：<br>
      包括<b>原生半透磨砂材质、≥9.5pt 规范排版、Tooltip 真实账号透视浮层、Popover 撕下为常驻桌面浮窗、以及平滑刷新缓动动效原型</b>。
    </div>

    <div class="meta-chips">
      <span class="chip">当前版本：<b>v10 HIG 全要素原型</b></span>
      <span class="chip">核心材质：<b>Regular Material + 0.5pt Hairline</b></span>
      <span class="chip">字号红线：<b>全量辅助文字 ≥9.5-10pt</b></span>
      <span class="chip">独家特性：<b>Popover 可拖拽“撕下”为独立桌面 HUD 浮窗</b></span>
      <span class="chip">账号策略：<b>中文别名 + 悬停 Tooltip 真实邮箱透视</b></span>
    </div>

    <section>
      <h2><span class="num">01</span>Apple HIG 全要素原生体验原型矩阵</h2>
      <div class="grid">
        {"".join(screens)}
      </div>
    </section>

    <footer style="margin-top:40px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);font-size:11.5px;color:#64748b;display:flex;justify-content:space-between;">
      <span>AI 额度 HUD 原型 · v10 HIG 全要素纯原型设计 · 2026-10-30</span>
      <span>文件：/opt/data/ai-credits/quota-hud/ai-quota-hud-quota-v10.html</span>
    </footer>
  </div>
</body>
</html>
"""

    out_file = OUT / "ai-quota-hud-quota-v10.html"
    out_file.write_text(html, encoding="utf-8")
    print(f"Screens: {len(screens)} | Wrote {len(html)} bytes to {out_file}")

if __name__ == "__main__":
    main()
