#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v12 原型：macOS 端端到端全生命周期全流程原型设计（全覆盖、全边界）。
覆盖用户从安装启动到日常巡检、异常恢复的完整链路：
阶段 ①：首次进入与零配置（欢迎向导、空状态、快捷引导）
阶段 ②：多渠道账号添加与授权配置（Claude 浏览器OAuth、WorkBuddy 设备码登录、Gemini/Codex 凭据配置）
阶段 ③：配置中与边界条件（网络离线、Token失效、限流429、停服下线、权限被拒、凭据冲突）
阶段 ④：多账号管理与偏好设置（账号排序/隐藏、通知预警阈值、开机自启、快捷键设置）
阶段 ⑤：主界面额度巡检与全景详情（保持 v11 验证通过的同心圆环与滑入详情）
"""
import math
from pathlib import Path

OUT = Path("/opt/data/ai-credits/quota-hud")

CSS = """
:root {
  --bg: #030712;
  --panel-blur: blur(28px);
  --panel-bg: rgba(18, 24, 38, 0.88);
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
  
  --aw-green: #30d158;
  --aw-yellow: #ffd60a;
  --aw-red: #ff453a;
  --aw-cyan: #32ade6;
  --aw-purple: #bf5af2;
  --aw-blue: #0a84ff;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Helvetica Neue", sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  padding: 32px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1480px; margin: 0 auto; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  color: #38bdf8; letter-spacing: 0.8px; margin-bottom: 8px;
}
.eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
h1 { font-size: 26px; font-weight: 800; color: #fff; margin-bottom: 8px; letter-spacing: -0.5px; }
.sub { font-size: 13.5px; color: var(--text-secondary); margin-bottom: 24px; max-width: 1040px; }

.meta-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 36px; }
.chip {
  font-size: 11px; padding: 4px 10px; border-radius: 6px;
  background: rgba(30, 41, 59, 0.7); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1);
  display: inline-flex; align-items: center; gap: 4px;
}
.chip b { color: #fff; }

section { margin-bottom: 56px; }
h2 {
  font-size: 18px; font-weight: 700; color: #f8fafc;
  margin-bottom: 16px; display: flex; align-items: center; gap: 8px;
  padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08);
}
h2 .num {
  font-size: 11.5px; font-weight: 800; color: #38bdf8;
  background: rgba(56, 189, 248, 0.15); padding: 2px 8px; border-radius: 5px;
}
p.lede { font-size: 13px; color: var(--text-secondary); margin-bottom: 20px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 28px;
}

/* Screen container */
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
  padding: 32px 24px;
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

/* Base Panel */
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

.panel-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px 10px; border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
}
.panel-title {
  font-size: 12px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 7px;
}
.panel-time {
  font-size: 10px; font-weight: 500; color: var(--text-tertiary);
}
.panel-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: rgba(0, 0, 0, 0.25); border-top: 0.5px solid rgba(255, 255, 255, 0.06);
  font-size: 10px; color: var(--text-tertiary);
}

/* UI Elements */
.btn-primary {
  background: #0a84ff; color: #fff; font-size: 11px; font-weight: 600;
  padding: 7px 14px; border-radius: 7px; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; justify-content: center;
  transition: all 0.15s ease; text-decoration: none;
}
.btn-primary:hover { background: #0071e3; }
.btn-secondary {
  background: rgba(255, 255, 255, 0.08); color: var(--text-secondary); font-size: 11px; font-weight: 600;
  padding: 7px 12px; border-radius: 7px; border: 0.5px solid rgba(255,255,255,0.12); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; justify-content: center;
}
.btn-secondary:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }

/* 引导与空状态 */
.welcome-box {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 14px;
}
.welcome-icon {
  width: 52px; height: 52px; border-radius: 14px;
  background: linear-gradient(135deg, #0a84ff 0%, #38bdf8 100%);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(10, 132, 255, 0.35);
}
.welcome-title { font-size: 15px; font-weight: 700; color: #fff; }
.welcome-desc { font-size: 11.5px; color: var(--text-secondary); line-height: 1.5; max-width: 320px; }

.channel-pick-list {
  display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 4px;
}
.channel-pick-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; background: rgba(255, 255, 255, 0.04);
  border: 0.5px solid rgba(255, 255, 255, 0.08); border-radius: 9px;
  cursor: pointer; transition: all 0.15s ease;
}
.channel-pick-item:hover {
  background: rgba(255, 255, 255, 0.08); border-color: rgba(56, 189, 248, 0.4);
}
.cp-left { display: flex; align-items: center; gap: 9px; }
.cp-icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
.cp-name { font-size: 11.5px; font-weight: 700; color: #f8fafc; }
.cp-desc { font-size: 9.5px; color: var(--text-tertiary); margin-top: 1px; }

/* 授权表单视图 */
.auth-form-view {
  padding: 16px 16px 12px;
  display: flex; flex-direction: column; gap: 14px;
}
.auth-step-box {
  background: rgba(0, 0, 0, 0.28);
  border: 0.5px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  padding: 12px;
  display: flex; flex-direction: column; gap: 10px;
}
.form-group { display: flex; flex-direction: column; gap: 5px; text-align: left; }
.form-label { font-size: 10.5px; font-weight: 600; color: var(--text-secondary); display: flex; justify-content: space-between; }
.form-input {
  background: rgba(255, 255, 255, 0.06); border: 0.5px solid rgba(255, 255, 255, 0.14);
  border-radius: 7px; padding: 7px 10px; color: #fff; font-size: 11px;
  outline: none; font-family: inherit;
}
.form-input:focus { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2); }

/* 设备码登录卡片 (WorkBuddy) */
.device-code-box {
  background: rgba(14, 165, 233, 0.08); border: 0.5px dashed rgba(56, 189, 248, 0.4);
  border-radius: 9px; padding: 12px; text-align: center;
  display: flex; flex-direction: column; gap: 8px; align-items: center;
}
.device-code-display {
  font-family: monospace; font-size: 18px; font-weight: 800; letter-spacing: 3px;
  color: #38bdf8; background: rgba(0, 0, 0, 0.35); padding: 4px 14px; border-radius: 6px;
}

/* 异常边界状态卡片 (Banners & Errors) */
.banner-error {
  background: rgba(239, 68, 68, 0.12); border: 0.5px solid rgba(239, 68, 68, 0.35);
  border-radius: 9px; padding: 10px 12px; display: flex; gap: 9px; align-items: flex-start;
}
.banner-warn {
  background: rgba(245, 158, 11, 0.12); border: 0.5px solid rgba(245, 158, 11, 0.35);
  border-radius: 9px; padding: 10px 12px; display: flex; gap: 9px; align-items: flex-start;
}
.banner-icon { flex: 0 0 16px; margin-top: 1px; }
.banner-text b { display: block; font-size: 11px; font-weight: 700; color: #fff; }
.banner-text span { display: block; font-size: 9.5px; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; }

/* 设置偏好视图 (Settings) */
.settings-view {
  padding: 14px 16px; display: flex; flex-direction: column; gap: 14px;
}
.setting-section-title { font-size: 10.5px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
.setting-group {
  background: rgba(255, 255, 255, 0.04); border: 0.5px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px; overflow: hidden;
}
.setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 0.5px solid rgba(255, 255, 255, 0.05);
}
.setting-row:last-child { border-bottom: none; }
.setting-info b { display: block; font-size: 11px; font-weight: 600; color: #f8fafc; }
.setting-info span { display: block; font-size: 9pt; color: var(--text-tertiary); }
.toggle-switch {
  width: 34px; height: 20px; border-radius: 99px; background: #30d158;
  position: relative; cursor: pointer;
}
.toggle-switch::after {
  content: ""; position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.toggle-switch.off { background: rgba(255,255,255,0.18); }
.toggle-switch.off::after { right: auto; left: 2px; }

/* 账号排序与显隐列表 */
.acct-manage-list { display: flex; flex-direction: column; gap: 5px; }
.acct-manage-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px; background: rgba(0, 0, 0, 0.25); border-radius: 6px;
}
.ami-left { display: flex; align-items: center; gap: 8px; font-size: 10.5px; color: #fff; }
.ami-drag { color: #64748b; cursor: grab; font-size: 11px; }
.ami-actions { display: flex; align-items: center; gap: 8px; font-size: 9.5px; }
"""

def make_panel(inner_html, caret=True, title="AI 额度 HUD", right_text="12:41 更新"):
    c = '<div class="panel-caret"></div>' if caret else ''
    return f"""
    <div class="panel">
      {c}
      <div class="panel-header">
        <div class="panel-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          {title}
        </div>
        <div class="panel-time">{right_text}</div>
      </div>
      {inner_html}
    </div>
    """

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
        <b>流程与边界验收说明：</b>{note}
      </div>
    </div>
    """


def main():
    screens = []

    # ==========================================================================
    # 阶段 ①：用户首次启动与零配置引导
    # ==========================================================================
    p_welcome = """
    <div class="welcome-box">
      <div class="welcome-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      </div>
      <div>
        <div class="welcome-title">欢迎使用 AI 额度 HUD</div>
        <div class="welcome-desc" style="margin-top:4px;">
          常驻菜单栏，实时监控各 AI 渠道用量与复位倒计时。在开始前，请接入你的第一个渠道账号。
        </div>
      </div>
      <div class="channel-pick-list">
        <div class="channel-pick-item">
          <div class="cp-left">
            <div class="cp-icon" style="background:#cc6633;color:#fff;">C</div>
            <div>
              <div class="cp-name">Claude Code / Anthropic</div>
              <div class="cp-desc">支持 Pro / Team / Max 5x 账号</div>
            </div>
          </div>
          <span class="btn-primary" style="padding:4px 8px;font-size:9.5px;">添加 ➔</span>
        </div>

        <div class="channel-pick-item">
          <div class="cp-left">
            <div class="cp-icon" style="background:#0a84ff;color:#fff;">W</div>
            <div>
              <div class="cp-name">WorkBuddy</div>
              <div class="cp-desc">国内版 / 国际版积分余额</div>
            </div>
          </div>
          <span class="btn-secondary" style="padding:4px 8px;font-size:9.5px;">添加</span>
        </div>

        <div class="channel-pick-item">
          <div class="cp-left">
            <div class="cp-icon" style="background:#10a37f;color:#fff;">O</div>
            <div>
              <div class="cp-name">OpenAI Codex / ChatGPT</div>
              <div class="cp-desc">支持 Plus / Team 额度与窗口</div>
            </div>
          </div>
          <span class="btn-secondary" style="padding:4px 8px;font-size:9.5px;">添加</span>
        </div>

        <div class="channel-pick-item">
          <div class="cp-left">
            <div class="cp-icon" style="background:#4285f4;color:#fff;">G</div>
            <div>
              <div class="cp-name">Google Gemini / Antigravity</div>
              <div class="cp-desc">企业版 / 开发者配额</div>
            </div>
          </div>
          <span class="btn-secondary" style="padding:4px 8px;font-size:9.5px;">添加</span>
        </div>
      </div>
    </div>
    <div class="panel-footer">
      <span>已遵循零明文落盘安全规范</span>
      <span style="color:#64748b;">跳过向导 (使用访客态)</span>
    </div>
    """
    screens.append(render_screen(
        "FLOW-01", "阶段 ①：首次启动零配置欢迎态（空状态与渠道挑选）",
        ["首次进入", "向导", "US-01,US-02"], "US-01,US-02",
        make_panel(p_welcome, title="AI 额度 HUD (初次配置)", right_text="未登录"),
        "<b>体验目标：</b>用户首次安装后点击菜单栏，绝不展示冷冰冰的报错或空白面板，而是展示清晰的【欢迎向导】；<br>"
        "<b>边界覆盖：</b>首发 4 大渠道（Claude、WorkBuddy、Codex、Gemini）一键接入入库，安全协议声明直观明确。"
    ))

    # ==========================================================================
    # 阶段 ②：账号配置流程（以 Claude 浏览器 OAuth 与 WorkBuddy 设备码为例）
    # ==========================================================================
    p_auth_claude = """
    <div class="auth-form-view">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:11px;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px;">
          <span style="width:7px;height:7px;border-radius:50%;background:#cc6633;"></span>接入 Claude 账号
        </span>
        <span style="font-size:9pt;color:#38bdf8;cursor:pointer;">‹ 返回渠道列表</span>
      </div>

      <div class="auth-step-box">
        <div class="form-group">
          <span class="form-label">自定义账号别名 (必填)</span>
          <input class="form-input" value="💼 工作主力账号" placeholder="例如：工作主力、客户A交付">
          <span style="font-size:8.5px;color:#64748b;">用于一级界面卡片展示，完全支持随时自定义与重命名</span>
        </div>

        <div class="form-group" style="margin-top:4px;">
          <span class="form-label">授权模式</span>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <div style="background:rgba(56,189,248,0.15);border:1px solid #38bdf8;border-radius:6px;padding:6px;font-size:9.5px;color:#fff;text-align:center;">
              <b>网页免密授权 (推荐)</b>
              <div style="font-size:7.5px;color:#94a3b8;margin-top:2px;">唤起浏览器 1 键同意</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.1);border-radius:6px;padding:6px;font-size:9.5px;color:#cbd5e1;text-align:center;">
              手动输入 Token
              <div style="font-size:7.5px;color:#64748b;margin-top:2px;">适合离线或受限网络</div>
            </div>
          </div>
        </div>

        <div style="background:rgba(0,0,0,0.3);border-radius:6px;padding:8px 10px;font-size:9pt;color:var(--text-secondary);line-height:1.4;">
          点击下方按钮将在你的默认浏览器中打开 Anthropic 授权页。授权完成后将自动完成回调并获取用量配额。
        </div>

        <button class="btn-primary" style="width:100%;padding:9px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          在默认浏览器中打开授权页
        </button>
      </div>

      <div style="font-size:8.5px;color:#64748b;display:flex;align-items:center;gap:4px;justify-content:center;">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Token 将使用 macOS 钥匙串 (Keychain) 加密隔离存储，本插件绝不上传至任何云端。
      </div>
    </div>
    """
    screens.append(render_screen(
        "FLOW-02", "阶段 ②：账号配置流 A（Claude 网页 OAuth 授权与别名命名）",
        ["账号授权", "OAuth", "别名定义"], "US-03,US-04",
        make_panel(p_auth_claude, title="添加账号 · Claude", right_text="步骤 1/2"),
        "<b>设计要点：</b>进入配置时，首先引导用户设定【自定义别名】，建立良好心智；<br>"
        "<b>边界处理：</b>支持网页免密 OAuth 与手动 Token 双通道，底层强制绑定 macOS Keychain 本地安全存储。"
    ))

    p_auth_wb = """
    <div class="auth-form-view">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:11px;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px;">
          <span style="width:7px;height:7px;border-radius:50%;background:#0a84ff;"></span>WorkBuddy 设备登录流
        </span>
        <span style="font-size:9pt;color:#38bdf8;cursor:pointer;">‹ 返回</span>
      </div>

      <div class="device-code-box">
        <span style="font-size:10px;color:var(--text-secondary);">请在手机微信 / 网页端打开并输入配对码</span>
        <div class="device-code-display">WB-8921-9920</div>
        <span style="font-size:8.5px;color:#38bdf8;cursor:pointer;">点击复制配对码</span>
      </div>

      <div class="auth-step-box" style="gap:6px;">
        <div class="form-group">
          <span class="form-label">账号别名</span>
          <input class="form-input" value="🌐 国际版主号" placeholder="别名">
        </div>
        <div class="form-group">
          <span class="form-label">站点与网络通道</span>
          <div style="display:flex;gap:6px;">
            <label style="font-size:9.5px;color:#fff;display:flex;align-items:center;gap:4px;"><input type="radio" checked name="site"> 国际站 (workbuddy.ai)</label>
            <label style="font-size:9.5px;color:#94a3b8;display:flex;align-items:center;gap:4px;"><input type="radio" name="site"> 国内站 (workbuddy.cn)</label>
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:9.5px;color:#38bdf8;margin-top:2px;">
        <span class="anim-refresh">●</span>
        <span>正在轮询授权状态... (有效时间 04:32)</span>
      </div>
    </div>
    """
    screens.append(render_screen(
        "FLOW-03", "阶段 ②：账号配置流 B（WorkBuddy 设备配对码与国内外站点切换）",
        ["设备码登录", "站点隔离", "US-04"], "US-04,US-06",
        make_panel(p_auth_wb, title="添加账号 · WorkBuddy", right_text="轮询中"),
        "<b>边界覆盖：</b>WorkBuddy 国内/国际双域名体系分离（.cn / .ai），单页提供明确单选切换；<br>"
        "<b>体验闭环：</b>16–20 位设备配对码原生呈现，自动倒计时轮询，授权完成后无需二次确认自动跳转。"
    ))

    # ==========================================================================
    # 阶段 ③：配置与运行中的各种边界异常条件
    # ==========================================================================
    p_edge_errors = """
    <div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px;">
      <!-- 边界 1：网络离线/无网络 -->
      <div class="banner-warn">
        <svg class="banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/></svg>
        <div class="banner-text">
          <b>当前网络离线 (显示最后已知快照)</b>
          <span>已保留 12:30 的最后额度记录。网络恢复后将自动静默重新同步，禁止显示 0% 误导。</span>
        </div>
      </div>

      <!-- 边界 2：Token 过期失效 (401) -->
      <div class="banner-error">
        <svg class="banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div class="banner-text">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <b>【客户A-交付】Token 已过期 (401)</b>
            <span style="color:#38bdf8;font-size:9px;cursor:pointer;">重新授权 ➔</span>
          </div>
          <span>远程会话已被登出或凭据失效。其他正常账号不受影响，独立熔断。</span>
        </div>
      </div>

      <!-- 边界 3：频控限流 (429 Rate Limit) -->
      <div class="banner-warn">
        <svg class="banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <div class="banner-text">
          <b>API 触发频率限制 (429)</b>
          <span>服务商返回 Retry-After: 45 秒。HUD 已进入指数退避等待，避免刷崩接口。</span>
        </div>
      </div>

      <!-- 边界 4：服务下线停服 (Gemini CLI 停服退役) -->
      <div class="banner-error" style="background:rgba(191,90,242,0.12);border-color:rgba(191,90,242,0.35);">
        <svg class="banner-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#bf5af2" stroke-width="2.2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
        <div class="banner-text">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <b>Gemini 旧接口停止服务 (403 Deprecated)</b>
            <span style="color:#bf5af2;font-size:9px;cursor:pointer;">查看迁移指南</span>
          </div>
          <span>该渠道端点已于 2026 年停服，请切换至 Antigravity 插件或新版 Cookie 授权。</span>
        </div>
      </div>
    </div>
    <div class="panel-footer">
      <span>各渠道独立隔离，单故障永不拖垮其他账号</span>
      <span style="color:#38bdf8;cursor:pointer;">一键重试异常项</span>
    </div>
    """
    screens.append(render_screen(
        "FLOW-04", "阶段 ③：核心边界与异常条件综合矩阵（离线、401、429、停服）",
        ["边界条件", "401失效", "429退避", "停服退役"], "US-19,US-20,US-21,US-22",
        make_panel(p_edge_errors, title="状态诊断与异常预警", right_text="4 项异常"),
        "<b>硬规则闭环检验：</b><br>"
        "1. <b>严禁将读不到渲染成 0%</b>：离线时展示『最后已知快照 + 时间戳』；<br>"
        "2. <b>独立熔断</b>：单个账号 401 或停服绝不阻塞其他正常卡片刷新；<br>"
        "3. <b>429 指数退避</b>：严格遵守服务端 Retry-After 头，防止被封 IP。"
    ))

    # ==========================================================================
    # 阶段 ④：多账号管理与系统偏好设置 (Settings & Management)
    # ==========================================================================
    p_settings = """
    <div class="settings-view">
      <!-- 偏好设置项 -->
      <div class="setting-section-title">通用偏好</div>
      <div class="setting-group">
        <div class="setting-row">
          <div class="setting-info">
            <b>开机自动静默启动</b>
            <span>登录 macOS 后在菜单栏常驻运行</span>
          </div>
          <div class="toggle-switch"></div>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <b>全局快捷键唤出面板</b>
            <span>当前为 ⌃⌥ 空格</span>
          </div>
          <span class="btn-secondary" style="font-size:9.5px;padding:3px 8px;">更改快捷键</span>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <b>额度急迫系统通知</b>
            <span>任意账号剩余 ≤20% 时弹出 macOS 告警</span>
          </div>
          <div class="toggle-switch"></div>
        </div>
      </div>

      <!-- 多账号显隐与排序管理 -->
      <div class="setting-section-title" style="margin-top:4px;">已绑定账号管理 (4 渠道 · 6 账号)</div>
      <div class="acct-manage-list">
        <div class="acct-manage-item">
          <div class="ami-left">
            <span class="ami-drag">⠿</span>
            <span style="width:6px;height:6px;border-radius:50%;background:#cc6633;"></span>
            <b>💼 工作主力 (Max 5x)</b>
          </div>
          <div class="ami-actions">
            <span style="color:#38bdf8;cursor:pointer;">编辑</span>
            <span style="color:#94a3b8;cursor:pointer;">显示</span>
          </div>
        </div>

        <div class="acct-manage-item">
          <div class="ami-left">
            <span class="ami-drag">⠿</span>
            <span style="width:6px;height:6px;border-radius:50%;background:#cc6633;"></span>
            <b>客户A-交付 (Team)</b>
          </div>
          <div class="ami-actions">
            <span style="color:#38bdf8;cursor:pointer;">编辑</span>
            <span style="color:#94a3b8;cursor:pointer;">显示</span>
          </div>
        </div>

        <div class="acct-manage-item">
          <div class="ami-left">
            <span class="ami-drag">⠿</span>
            <span style="width:6px;height:6px;border-radius:50%;background:#0a84ff;"></span>
            <b>🌐 国际版主号</b>
          </div>
          <div class="ami-actions">
            <span style="color:#38bdf8;cursor:pointer;">编辑</span>
            <span style="color:#94a3b8;cursor:pointer;">显示</span>
          </div>
        </div>

        <div class="acct-manage-item" style="opacity:0.6;">
          <div class="ami-left">
            <span class="ami-drag">⠿</span>
            <span style="width:6px;height:6px;border-radius:50%;background:#64748b;"></span>
            <b style="text-decoration:line-through;color:#94a3b8;">实验归档 (已隐藏)</b>
          </div>
          <div class="ami-actions">
            <span style="color:#38bdf8;cursor:pointer;">恢复</span>
            <span style="color:#ef4444;cursor:pointer;">删除</span>
          </div>
        </div>
      </div>

      <button class="btn-secondary" style="width:100%;padding:7px;margin-top:2px;">
        + 绑定新的渠道账号...
      </button>
    </div>
    <div class="panel-footer">
      <span>配置存储于本地 ~/Library/Application Support/</span>
      <span style="color:#38bdf8;cursor:pointer;">‹ 返回主面板</span>
    </div>
    """
    screens.append(render_screen(
        "FLOW-05", "阶段 ④：偏好设置与多账号管理（排序/隐藏/预警通知/开机启动）",
        ["设置", "排序与隐藏", "US-25,US-26"], "US-25,US-26,US-27",
        make_panel(p_settings, title="偏好设置 · AI 额度 HUD", right_text="v1.0.0"),
        "<b>控制权交还用户：</b><br>"
        "• 支持拖拽手柄 <code>⠿</code> 调整账号展示顺序；<br>"
        "• 支持将弃用或低频账号【隐藏】而不删除，避免面板拥挤；<br>"
        "• 支持自定义 ≤20% 告警阈值与开机自启动设置。"
    ))

    # 组装完整 HTML
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 额度 HUD · 全流程用户旅程与边界条件原型 (v12)</title>
  <style>{CSS}</style>
</head>
<body>
  <div class="wrap">
    <div class="eyebrow"><span class="dot"></span>全流程设计原型 · 端到端闭环体验</div>
    <h1>AI 额度 HUD 全生命周期体验流程</h1>
    <div class="sub">
      响应你的要求：<b>“继续补充完整的其他界面流程，用户首次进入、配置账号、查看额度完整流程都要覆盖，包括各种边界条件”</b>。<br>
      本版本将从<b>首次启动零配置向导</b>、<b>OAuth / 设备码添加流</b>、<b>离线/失效/限流/停服等全量边界条件</b>到<b>偏好设置与多账号管理</b>全部完整落地为可视化原型图。
    </div>

    <div class="meta-chips">
      <span class="chip">当前版本：<b>v12 全流程原型</b></span>
      <span class="chip">覆盖流程：<b>首次安装 ➔ 渠道添加 ➔ 异常熔断 ➔ 偏好设置 ➔ 额度全景</b></span>
      <span class="chip">边界覆盖：<b>401失效 · 429退避 · 离线快照 · 停服下线 · 账号隐藏</b></span>
      <span class="chip">平台规范：<b>macOS 原生 Popover 交互体系</b></span>
    </div>

    <section>
      <h2><span class="num">01</span>首次进入、账号配置、边界异常与管理全景原型</h2>
      <div class="grid">
        {"".join(screens)}
      </div>
    </section>

    <footer style="margin-top:40px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08);font-size:11.5px;color:#64748b;display:flex;justify-content:space-between;">
      <span>AI 额度 HUD 原型 · v12 全流程覆盖纯原型设计 · 2026-10-30</span>
      <span>文件：/opt/data/ai-credits/quota-hud/ai-quota-hud-quota-v12.html</span>
    </footer>
  </div>
</body>
</html>
"""

    out_file = OUT / "ai-quota-hud-quota-v12.html"
    out_file.write_text(html, encoding="utf-8")
    print(f"Screens: {len(screens)} | Wrote {len(html)} bytes to {out_file}")

if __name__ == "__main__":
    main()
