#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rust 壳层结构自检（无 rustc 环境下的替代验证）。

它不能替代编译器，只做四类可判定的静态断言：
  A. 括号/引号平衡（粗粒度，跳过字符串与注释）
  B. `crate::mod::item` 引用都能在对应模块文件里找到定义
  C. generate_handler! 里的命令名都能在 ipc.rs 找到同名 #[tauri::command] 函数
  D. 白名单完整性：四个渠道域名都在 http.rs 的 ALLOWED_ORIGINS，命令白名单含 agy/gemini

退出码 0 = 全部通过；1 = 有失败项。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src-tauri" / "src"


def strip_code(text: str) -> str:
    """去掉注释与字符串字面量，保留结构字符。"""
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
        elif c == '"':
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == '"':
                    i += 1
                    break
                i += 1
        elif c == "'":
            # 字符字面量或生命周期；只在明显是 char 时跳过
            if i + 2 < n and (text[i + 2] == "'" or (text[i + 1] == "\\" and i + 3 < n and text[i + 3] == "'")):
                i += 4 if text[i + 1] == "\\" else 3
            else:
                out.append(c)
                i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def check_balance(path: Path) -> list[str]:
    text = strip_code(path.read_text(encoding="utf-8"))
    errs = []
    for open_c, close_c in (("{", "}"), ("(", ")"), ("[", "]")):
        depth = 0
        for ch in text:
            if ch == open_c:
                depth += 1
            elif ch == close_c:
                depth -= 1
                if depth < 0:
                    errs.append(f"多余的 {close_c}")
                    depth = 0
        if depth != 0:
            errs.append(f"{open_c}{close_c} 不平衡（差 {depth}）")
    return errs


def items_defined(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    names: set[str] = set()
    for pat in (
        r"\bfn\s+([a-z_][a-z0-9_]*)",
        r"\bstruct\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\benum\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\bconst\s+([A-Z_][A-Z0-9_]*)",
        r"\btype\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\bmod\s+([a-z_][a-z0-9_]*)",
    ):
        names.update(re.findall(pat, text))
    return names


def main() -> int:
    failures: list[str] = []
    mods = {p.stem: p for p in SRC.glob("*.rs")}
    print(f"扫描 {len(mods)} 个模块：{', '.join(sorted(mods))}")

    # A. 括号平衡
    for name, path in sorted(mods.items()):
        errs = check_balance(path)
        if errs:
            failures.extend(f"[A] {name}.rs: {e}" for e in errs)
    print(f"A. 括号平衡：{'通过' if not any(f.startswith('[A]') for f in failures) else '失败'}")

    # B. crate::mod::item 引用
    defined = {name: items_defined(path) for name, path in mods.items()}
    missing = []
    for name, path in mods.items():
        for m, item in re.findall(r"crate::([a-z_][a-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)", path.read_text(encoding="utf-8")):
            if m not in mods:
                missing.append(f"{name}.rs → crate::{m}（模块不存在）")
            elif item not in defined[m]:
                missing.append(f"{name}.rs → crate::{m}::{item}（{m}.rs 中未定义）")
    failures.extend(f"[B] {x}" for x in sorted(set(missing)))
    print(f"B. 跨模块引用：{'通过' if not missing else f'{len(set(missing))} 处缺失'}")

    # C. generate_handler! 与 ipc.rs 命令对齐
    lib = (SRC / "lib.rs").read_text(encoding="utf-8")
    m = re.search(r"generate_handler!\s*\[(.*?)\]", lib, re.S)
    handlers = []
    if m:
        handlers = [h.strip().split("::")[-1] for h in m.group(1).split(",") if h.strip()]
    ipc_text = (SRC / "ipc.rs").read_text(encoding="utf-8")
    commands = set(re.findall(r"#\[tauri::command\]\s*\n\s*pub\s+(?:async\s+)?fn\s+([a-z_][a-z0-9_]*)", ipc_text))
    unregistered = sorted(commands - set(handlers))
    unknown = sorted(set(handlers) - commands)
    for h in unknown:
        failures.append(f"[C] lib.rs 注册了未定义命令：{h}")
    for c in unregistered:
        failures.append(f"[C] ipc.rs 定义了未注册命令：{c}")
    print(f"C. IPC 命令：注册 {len(handlers)} / 定义 {len(commands)}：{'对齐' if not unknown and not unregistered else '不一致'}")

    # D. 白名单
    http_text = (SRC / "http.rs").read_text(encoding="utf-8")
    origins = set(re.findall(r'"(https://[^"]+)"', http_text))
    need = {
        "https://api.anthropic.com",
        "https://chatgpt.com",
        "https://www.workbuddy.cn",
        "https://www.workbuddy.ai",
    }
    lost = need - origins
    for o in sorted(lost):
        failures.append(f"[D] http.rs 白名单缺少：{o}")
    cli_text = (SRC / "cli.rs").read_text(encoding="utf-8")
    for cmd in ("agy", "gemini"):
        if f'"{cmd}"' not in cli_text:
            failures.append(f"[D] cli.rs 白名单缺少：{cmd}")
    print(f"D. 白名单：{len(origins)} 个 origin，缺 {len(lost)} 个" if lost else f"D. 白名单：{len(origins)} 个 origin 完整")

    # E. 致命项：IPC 返回值里不得出现明文 token 的字段名
    leaks = []
    for name, path in mods.items():
        for line in path.read_text(encoding="utf-8").splitlines():
            if re.match(r'\s*"?token"?\s*:', line) and "json!" in line:
                leaks.append(f"{name}.rs: {line.strip()[:60]}")
    for l in leaks:
        failures.append(f"[E] 疑似返回明文 token：{l}")
    print(f"E. 明文泄漏点：{len(leaks)}")

    print()
    if failures:
        print("失败项：")
        for f in failures:
            print("  -", f)
        print(json.dumps({"ok": False, "failures": len(failures)}, ensure_ascii=False))
        return 1
    print("全部静态断言通过（注意：这不等于编译通过，rustc 检查仍需在 macOS 上执行）")
    print(json.dumps({"ok": True, "modules": len(mods), "handlers": len(handlers), "origins": len(origins)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
