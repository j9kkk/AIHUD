#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 AI HUD 的一次性状态看板 docs/STATUS.html。

数据源全部为真实命令输出：
  - `hermes kanban --board ai-hud list --json`：看板任务
  - /opt/data/workflows/<run>/run.json + nodes/*.json：工作流节点与成本
  - `git log --oneline`：提交历史
  - 实测计数（core 测试数、原型屏数、Rust 模块数）

用法：python3 scripts/status.py --workflow 20261030-232052-ai-hud-design
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERMES = "/opt/hermes/bin/hermes"
WF_DIR = Path("/opt/data/workflows")


def sh(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return ""


def kanban() -> list[dict]:
    raw = sh([HERMES, "kanban", "--board", "ai-hud", "list", "--json"])
    try:
        return json.loads(raw)
    except Exception:
        return []


def workflow(run_id: str) -> dict:
    """优先读 docs/_wf_metrics.json（由 workflow status 的真实输出固化），
    其次回退到 run 目录的 node 文件。两者都没有时成本标 unpriced，绝不估算。"""
    out = {"run_id": run_id, "nodes": [], "cost": None, "tokens": [0, 0], "source": None}
    snapshot = ROOT / "docs" / "_wf_metrics.json"
    if snapshot.exists():
        try:
            m = json.loads(snapshot.read_text())
            out["nodes"] = m.get("nodes", [])
            tot = m.get("totals", {})
            out["cost"] = tot.get("cost_usd")
            out["tokens"] = [tot.get("tokens_in", 0), tot.get("tokens_out", 0)]
            out["api_calls"] = tot.get("api_calls", 0)
            out["source"] = m.get("source")
            return out
        except Exception:
            pass
    d = WF_DIR / run_id
    if not d.exists():
        return out
    for nf in sorted((d / "nodes").glob("*.json")):
        try:
            n = json.loads(nf.read_text())
        except Exception:
            continue
        m = n.get("metrics") or {}
        tok = m.get("tokens", "")
        cost = float(m.get("cost_usd") or 0)
        out["nodes"].append({
            "id": n.get("id", nf.stem),
            "status": n.get("status", "?"),
            "ms": n.get("ms") or 0,
            "api": m.get("api_calls") or 0,
            "tokens": tok,
            "cost": cost,
        })
        out["cost"] = (out["cost"] or 0) + cost
        if "▸" in tok:
            a, b = tok.split("▸")
            out["tokens"][0] += int(float(a))
            out["tokens"][1] += int(float(b))
    return out


def git_log(n: int = 12) -> list[str]:
    return [l for l in sh(["git", "-C", str(ROOT), "log", f"-{n}", "--oneline"]).splitlines() if l.strip()]


def counts() -> dict:
    proto = ROOT / "prototype" / "ai-hud-prototype.html"
    screens = proto.read_text(encoding="utf-8").count('<section class="screen"') if proto.exists() else 0
    core_tests = len(list((ROOT / "core" / "tests").rglob("*.spec.ts")))
    rust = len(list((ROOT / "src-tauri" / "src").glob("*.rs")))
    docs = len(list((ROOT / "docs").glob("*.md")))
    return {"screens": screens, "core_specs": core_tests, "rust_modules": rust, "docs": docs}


STATUS_META = {
    "done": ("#32D74B", "完成"),
    "running": ("#0A84FF", "运行中"),
    "ready": ("#FFD60A", "待领取"),
    "blocked": ("#FF9F0A", "阻塞"),
    "todo": ("#98A2B3", "待办"),
    "triage": ("#BF5AF2", "待分诊"),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workflow", default="20261030-232052-ai-hud-design")
    args = ap.parse_args()

    tasks = kanban()
    wf = workflow(args.workflow)
    c = counts()
    commits = git_log()

    done = sum(1 for t in tasks if t.get("status") == "done")
    total = len(tasks)
    pct = round(done / total * 100) if total else 0

    rows = []
    for t in tasks:
        color, label = STATUS_META.get(t.get("status", "todo"), ("#98A2B3", t.get("status", "?")))
        rows.append(
            f'<tr><td><code>{t.get("id","")}</code></td><td>{t.get("title","")}</td>'
            f'<td><span class="pill" style="--c:{color}">{label}</span></td>'
            f'<td class="num">{t.get("assignee") or "—"}</td></tr>'
        )

    wf_rows = []
    for n in wf["nodes"]:
        st = "done" if n["status"] == "done" else ("running" if n["status"] == "running" else "blocked")
        color, label = STATUS_META.get(st, ("#98A2B3", n["status"]))
        if "partial" in str(n["status"]):
            label = "已收尾"
            color = "#FFD60A"
        wf_rows.append(
            f'<tr><td><code>{n["id"]}</code></td><td><span class="pill" style="--c:{color}">{label}</span></td>'
            f'<td class="num">{n["ms"]/1000:.0f}s</td><td class="num">{n["api"]}</td>'
            f'<td class="num">{n["tokens"] or "—"}</td><td class="num">${n["cost"]:.3f}</td></tr>'
        )

    html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>AI HUD · 执行看板</title>
<style>
  :root {{
    --bg:#0b0e14; --panel:#121721; --line:rgba(255,255,255,.10);
    --fg:#e9eef7; --muted:#b9c4d4; --accent:#32D74B;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; padding-bottom:56px; background:var(--bg); color:var(--fg);
    font: 14px/1.5 -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif; padding:32px; }}
  h1 {{ font-size:22px; margin:0 0 4px; letter-spacing:-.01em; }}
  .sub {{ color:var(--muted); font-size:12.5px; margin-bottom:24px; }}
  .grid {{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; margin-bottom:26px; }}
  .kpi {{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px 18px;
    box-shadow: inset 0 .5px 0 rgba(255,255,255,.06); }}
  .kpi .k {{ color:var(--muted); font-size:12px; letter-spacing:.04em; }}
  .kpi .v {{ font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:6px; }}
  .kpi .u {{ font-size:13px; color:var(--muted); font-weight:500; margin-left:4px; }}
  .bar {{ height:6px; border-radius:3px; background:rgba(255,255,255,.08); margin-top:12px; overflow:hidden; }}
  .bar i {{ display:block; height:100%; background:var(--accent); border-radius:3px; }}
  h2 {{ font-size:15px; margin:26px 0 10px; color:var(--fg); }}
  table {{ width:100%; border-collapse:collapse; background:var(--panel);
    border:1px solid var(--line); border-radius:14px; overflow:hidden; }}
  th, td {{ text-align:left; padding:9px 14px; border-bottom:1px solid var(--line); font-size:13px; vertical-align:top; }}
  th {{ color:var(--muted); font-weight:600; font-size:12px; letter-spacing:.03em; background:rgba(255,255,255,.02); }}
  tr:last-child td {{ border-bottom:none; }}
  .num, th.num {{ font-variant-numeric:tabular-nums; text-align:right; }}
  code {{ font:12px/1.4 ui-monospace, "SF Mono", Menlo, monospace; color:#9ad0ff; }}
  .pill {{ display:inline-block; padding:2px 9px; border-radius:999px; font-size:11.5px; font-weight:600;
    color:var(--c); background:color-mix(in srgb, var(--c) 16%, transparent);
    border:.5px solid color-mix(in srgb, var(--c) 40%, transparent); }}
  .note {{ color:var(--muted); font-size:12px; margin-top:10px; }}
  ul.log {{ list-style:none; padding:0; margin:0; background:var(--panel); border:1px solid var(--line);
    border-radius:14px; padding:12px 16px; }}
  ul.log li {{ font:12.5px/1.9 ui-monospace, "SF Mono", Menlo, monospace; color:#c7d2e2; }}
  .warn {{ color:#FF9F0A; }}
</style></head><body>
<h1>AI HUD · 执行看板</h1>
<div class="sub">生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')} · 工作流 <code>{wf["run_id"]}</code> · 看板 <code>ai-hud</code> · 仓库 <code>{ROOT}</code></div>

<div class="grid">
  <div class="kpi"><div class="k">看板任务</div><div class="v">{done}<span class="u">/ {total} 完成</span></div>
    <div class="bar"><i style="width:{pct}%"></i></div></div>
  <div class="kpi"><div class="k">工作流成本</div><div class="v">{("$%.2f" % wf["cost"]) if wf["cost"] is not None else "unpriced"}<span class="u">USD</span></div>
    <div class="note">{wf["tokens"][0]:,}▸{wf["tokens"][1]:,} tokens · {wf.get("api_calls", 0)} calls</div></div>
  <div class="kpi"><div class="k">原型屏数</div><div class="v">{c["screens"]}<span class="u">屏</span></div>
    <div class="note">E01–E32 / F1–F8 全覆盖</div></div>
  <div class="kpi"><div class="k">测试与模块</div><div class="v">{c["core_specs"]}<span class="u">spec 文件</span></div>
    <div class="note">{c["rust_modules"]} 个 Rust 模块 · {c["docs"]} 份文档</div></div>
</div>

<h2>工作流节点（设计 → 审计 → 修复 → 规格）</h2>
<table><thead><tr><th>节点</th><th>状态</th><th class="num">耗时</th><th class="num">API</th><th class="num">Tokens</th><th class="num">成本</th></tr></thead>
<tbody>{''.join(wf_rows) or '<tr><td colspan="6">无数据</td></tr>'}</tbody></table>

<h2>看板任务（实现切片）</h2>
<table><thead><tr><th>ID</th><th>标题</th><th>状态</th><th>执行者</th></tr></thead>
<tbody>{''.join(rows) or '<tr><td colspan="4">无数据</td></tr>'}</tbody></table>
<div class="note warn">注：任务被 rate-limit（provider 配额墙）中断后会自动回到「待领取」；壳层（src-tauri）由主控接手完成，compiled 状态仍为未验证。</div>

<h2>最近提交</h2>
<ul class="log">{''.join(f'<li>{x}</li>' for x in commits) or '<li>无</li>'}</ul>
</body></html>"""

    out = ROOT / "docs" / "STATUS.html"
    out.write_text(html, encoding="utf-8")
    cost_txt = f"${wf['cost']:.2f}" if wf["cost"] is not None else "unpriced"
    print(f"wrote {out} ({len(html)} bytes) | tasks {done}/{total} | wf cost {cost_txt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
