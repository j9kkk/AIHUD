#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文档一致性自检（SPEC S16）。

只做可判定的断言，不做风格建议。任何一条失败都返回非 0：
  D1  宽度唯一基准：ARCHITECTURE 必须写 360pt，且不能出现「应使用 412px」式表述
  D2  流程清单：FLOWS.md 必须覆盖 F1–F8 与 E01–E32
  D3  原型覆盖：原型必须引用全部 32 个边界编号，且屏数 >= 44
  D4  切片清单：SPEC.md 必须定义 S01–S16
  D5  七状态词表：七种健康状态在 ARCHITECTURE / SPEC / 原型三处都必须出现
  D6  安全红线：文档中不得出现「读不到显示 0%」类表述，必须出现「最后已知值」
  D7  凭据：docs/ 与 prototype/ 下不得有 token 明文
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
PROTO = ROOT / "prototype" / "ai-hud-prototype.html"

failures: list[str] = []
checks: list[tuple[str, bool, str]] = []


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, ok, detail))
    if not ok:
        failures.append(f"{name}: {detail}")


arch = read(DOCS / "ARCHITECTURE.md")
flows = read(DOCS / "FLOWS.md")
spec = read(DOCS / "SPEC.md")
proto = read(PROTO) if PROTO.exists() else ""

# D1 宽度基准
check("D1 宽度唯一基准 360pt", "360pt" in arch, "ARCHITECTURE.md 未声明 360pt")
live_412 = [
    l for l in arch.splitlines()
    if "412" in l and not re.search(r"废弃|旧稿|outdated|deprecated", l)
]
check("D1 无第二套宽度值", not live_412, f"ARCHITECTURE.md 仍有 {len(live_412)} 行把 412 当作现行值")

# D2 流程与边界清单
missing_flows = [f"F{i}" for i in range(1, 9) if f"F{i}" not in flows]
check("D2 F1–F8 齐全", not missing_flows, f"FLOWS.md 缺少 {missing_flows}")
missing_edges = [f"E{i:02d}" for i in range(1, 33) if f"E{i:02d}" not in flows]
check("D2 E01–E32 齐全", not missing_edges, f"FLOWS.md 缺少 {missing_edges}")

# D3 原型覆盖
missing_in_proto = [f"E{i:02d}" for i in range(1, 33) if f"E{i:02d}" not in proto]
check("D3 原型覆盖 32 个边界", not missing_in_proto, f"原型缺少 {missing_in_proto}")
screens = len(re.findall(r'<section class="screen"', proto))
check("D3 原型屏数 >= 44", screens >= 44, f"实测 {screens} 屏")

# D4 切片清单
missing_slices = [f"S{i:02d}" for i in range(1, 17) if f"S{i:02d}" not in spec]
check("D4 S01–S16 齐全", not missing_slices, f"SPEC.md 缺少 {missing_slices}")

# D5 七状态词表
states = [
    "never_synced", "normal", "offline_stale", "auth_expired",
    "rate_limited", "service_deprecated", "parse_degraded",
]
for s in states:
    for label, text in (("ARCHITECTURE", arch), ("SPEC", spec), ("原型", proto)):
        check(f"D5 {s} 出现在{label}", s in text, f"{label} 未出现 {s}")

# D6 安全红线
check("D6 表述含最后已知值", "最后已知" in arch or "最后已知" in spec, "缺少「最后已知值」表述")
# 「禁止把读不到渲染成 0%」本身是规则声明，不算违规；只抓祈使上下文缺失的写法
_zero_pat = re.compile(r"读不到[^。\n]{0,12}(?:显示|渲染)[^。\n]{0,6}0%")
_negation = re.compile(r"禁止|不得|不允许|绝不能|never")
bad_zero = []
for _src, _text in (("ARCHITECTURE", arch), ("SPEC", spec), ("原型", proto)):
    for _m in _zero_pat.finditer(_text):
        _ls = _text.rfind("\n", 0, _m.start()) + 1
        _le = _text.find("\n", _m.end())
        _line = _text[_ls: _le if _le != -1 else len(_text)]
        if not _negation.search(_line):
            _win = _text[max(0, _m.start() - 40): _m.end() + 40]
            bad_zero.append(f"{_src}: {_win.strip()[:50]}")
check("D6 无读不到显示 0% 的表述", not bad_zero, "；".join(bad_zero)[:200])

# D7 凭据扫描
pat = re.compile(r"sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{20,}")
leaks = []
for base in (DOCS, ROOT / "prototype"):
    for f in base.rglob("*"):
        if f.suffix.lower() in {".md", ".html", ".json", ".txt"} and f.is_file():
            if pat.search(read(f)):
                leaks.append(f.relative_to(ROOT).as_posix())
check("D7 文档零明文凭据", not leaks, f"命中 {leaks}")

# 输出
width = max(len(n) for n, _, _ in checks)
for name, ok, detail in checks:
    mark = "✓" if ok else "✗"
    line = f"{mark} {name.ljust(width)}"
    if not ok:
        line += f"  ← {detail}"
    print(line)

print()
if failures:
    print(f"文档一致性：{len(failures)} 项失败 / {len(checks)} 项检查")
    sys.exit(1)

print(f"文档一致性：全部 {len(checks)} 项通过（原型 {screens} 屏）")
