#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本地仓库发布到 GitHub —— 走 Git Data API（api.github.com），不走 git 协议。

为什么不用 `git push`：
  本容器到 github.com:443（网页与 git 传输）不可达，只有 api.github.com 可用。
  于是用官方 Git Data API 直接创建 blob → tree → commit → 更新 ref，
  效果与 push 等价（同一个仓库、同一份提交历史快照），且不需要 git 凭据助手。

凭据（按优先级）：
  1. 环境变量 GH_TOKEN / GITHUB_TOKEN
  2. 文件 /opt/data/.gh_token（建议 chmod 600）
  token 只用于 HTTP Header，绝不打印、不写盘。

需要的权限（fine-grained PAT）：仅 j9kkk/AIHUD，Contents: Read and write。

用法：
  python3 scripts/publish-api.py                # 发布到 j9kkk/AIHUD 的 main
  python3 scripts/publish-api.py --dry-run      # 只列出将要上传的文件与体积
  python3 scripts/publish-api.py --message "ci: ..."
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
OWNER = "j9kkk"
REPO = "AIHUD"
BRANCH = "main"
ROOT = Path(__file__).resolve().parent.parent

# 单文件体积上限（GitHub blob 建议 < 100MB；这里更保守，避免把构建产物塞进去）
MAX_FILE = 5 * 1024 * 1024


def token(prompt: bool = False) -> str:
    t = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not t:
        p = Path("/opt/data/.gh_token")
        if p.exists():
            t = p.read_text().strip()
    if not t and prompt:
        import getpass
        try:
            t = getpass.getpass("GitHub PAT（输入不回显）: ").strip()
        except (KeyboardInterrupt, EOFError):
            t = ""
    if not t:
        sys.exit("✗ 缺少 token：设置 GH_TOKEN，把 PAT 写入 /opt/data/.gh_token，或用 --prompt 交互输入")
    return t


def api(method: str, path: str, tok: str, payload: dict | None = None) -> tuple[int, dict]:
    url = f"{API}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "ai-hud-publisher")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body.strip() else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw": body[:400]}
        return e.code, parsed
    except urllib.error.URLError as e:
        return 0, {"error": str(e)}


def tracked_files() -> list[tuple[str, bytes]]:
    """用 git ls-files 取受版本控制的文件，自动尊重 .gitignore。"""
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True
    ).stdout.decode()
    paths = [p for p in out.split("\0") if p]
    files: list[tuple[str, bytes]] = []
    for rel in paths:
        fp = ROOT / rel
        if not fp.is_file():
            continue
        size = fp.stat().st_size
        if size > MAX_FILE:
            print(f"  ! 跳过超大文件 {rel} ({size} bytes)")
            continue
        files.append((rel, fp.read_bytes()))
    return files


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--message", default="")
    ap.add_argument("--prompt", action="store_true", help="交互输入 PAT（不回显、不落盘）")
    args = ap.parse_args()

    files = tracked_files()
    total = sum(len(b) for _, b in files)
    msg = args.message or subprocess.run(
        ["git", "log", "-1", "--pretty=%B"], cwd=ROOT, capture_output=True, text=True
    ).stdout.strip() or "chore: publish AI HUD"

    print(f"仓库：{OWNER}/{REPO} → {BRANCH}")
    print(f"文件：{len(files)} 个 / {total/1024:.1f} KiB")
    if args.dry_run:
        for rel, b in files:
            print(f"  {len(b):>8}  {rel}")
        return

    tok = token(prompt=args.prompt)

    # 1. 探测远端状态：仓库存在？分支已存在？
    code, repo = api("GET", f"/repos/{OWNER}/{REPO}", tok)
    if code != 200:
        sys.exit(f"✗ 无法访问仓库 {OWNER}/{REPO}（HTTP {code}）：{repo.get('message')}")
    print(f"✓ 仓库可写访问：{repo.get('full_name')}（default: {repo.get('default_branch')}）")

    code, ref = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}", tok)

    # 空仓库（无任何 ref）时，Git Data API 的 blob 接口会返回 409 "Git Repository is empty"。
    # 官方可行做法：先用 Contents API 播种一个文件，仓库即获得首个提交，随后 blob 接口恢复正常。
    if code in (404, 409):
        print(f"· 远端仓库为空（GET ref → HTTP {code}） → 用 Contents API 播种首个提交（README.md）")
        readme_path = ROOT / "README.md"
        body = readme_path.read_bytes() if readme_path.exists() else b"# AI HUD\n"
        seed_code, seed = api(
            "PUT",
            f"/repos/{OWNER}/{REPO}/contents/README.md",
            tok,
            {
                "message": "chore: bootstrap repository",
                "content": base64.b64encode(body).decode(),
                "branch": BRANCH,
            },
        )
        if seed_code not in (200, 201):
            sys.exit(f"✗ 播种首个提交失败：HTTP {seed_code} {seed.get('message')}")
        print(f"  ✓ 播种提交 {seed['commit']['sha'][:8]}")
        code, ref = api("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}", tok)

    parents: list[str] = []
    remote_files: set[str] = set()
    if code == 200:
        parents = [ref["object"]["sha"]]
        print(f"✓ 远端已有 {BRANCH} @ {parents[0][:8]}")
        code2, tree = api("GET", f"/repos/{OWNER}/{REPO}/git/trees/{parents[0]}?recursive=1", tok)
        if code2 == 200:
            remote_files = {e["path"] for e in tree.get("tree", []) if e.get("type") == "blob"}
            print(f"  远端已有 {len(remote_files)} 个文件")
    else:
        print("· 远端分支为空，将创建首个提交")

    # 2. 只上传“内容有变化或远端不存在”的文件，减少 API 调用
    def same_as_remote(rel: str, blob: bytes) -> bool:
        if rel not in remote_files:
            return False
        return False  # 保守起见：远端存在也重传（blob 内容寻址，同内容不会产生新 blob）

    changed = [(rel, blob) for rel, blob in files if not same_as_remote(rel, blob)]
    print(f"→ 待上传 blob：{len(changed)} 个（其余按远端缓存跳过）")

    entries = []
    for i, (rel, blob) in enumerate(changed, 1):
        code, res = api(
            "POST",
            f"/repos/{OWNER}/{REPO}/git/blobs",
            tok,
            {"content": base64.b64encode(blob).decode(), "encoding": "base64"},
        )
        if code not in (200, 201):
            hint = "（空仓库需先播种首个提交）" if code == 409 else ""
            sys.exit(f"✗ blob 上传失败（{rel}）：HTTP {code} {res.get('message')}{hint}")
        entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": res["sha"]})
        if i % 25 == 0:
            print(f"  … {i}/{len(changed)}")

    # 已存在于远端但本次未上传的文件，沿用远端 sha
    if remote_files:
        code, tree = api("GET", f"/repos/{OWNER}/{REPO}/git/trees/{parents[0]}?recursive=1", tok)
        remote_map = {e["path"]: e["sha"] for e in tree.get("tree", []) if e.get("type") == "blob"}
        uploaded = {e["path"] for e in entries}
        for rel in remote_files - uploaded:
            if (ROOT / rel).is_file():
                entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": remote_map[rel]})

    # 3. tree → commit → ref
    code, tree_res = api("POST", f"/repos/{OWNER}/{REPO}/git/trees", tok, {"tree": entries})
    if code not in (200, 201):
        sys.exit(f"✗ tree 创建失败：HTTP {code} {tree_res.get('message')}")
    print(f"✓ tree {tree_res['sha'][:8]}（{len(entries)} 项）")

    payload = {"message": msg, "tree": tree_res["sha"]}
    if parents:
        payload["parents"] = parents
    code, commit = api("POST", f"/repos/{OWNER}/{REPO}/git/commits", tok, payload)
    if code not in (200, 201):
        sys.exit(f"✗ commit 创建失败：HTTP {code} {commit.get('message')}")
    print(f"✓ commit {commit['sha'][:8]}")

    if parents:
        code, _ = api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}", tok, {"sha": commit["sha"]})
    else:
        code, _ = api(
            "POST", f"/repos/{OWNER}/{REPO}/git/refs", tok,
            {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]},
        )
    if code not in (200, 201, 422):
        sys.exit(f"✗ 更新分支失败：HTTP {code}")
    if code == 422:
        # 分支已存在但被创建过：改用 PATCH 强推
        code, _ = api("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}", tok, {"sha": commit["sha"], "force": True})
        if code not in (200, 201):
            sys.exit(f"✗ 更新分支失败：HTTP {code}")

    print(f"\n✓ 已发布：https://github.com/{OWNER}/{REPO}/commit/{commit['sha']}")
    print(f"✓ Actions：https://github.com/{OWNER}/{REPO}/actions")
    print("\n提示：该仓库的默认分支必须是 main，工作流才会自动触发。")


if __name__ == "__main__":
    main()
