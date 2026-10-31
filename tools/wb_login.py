#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wb_login.py — WorkBuddy / CodeBuddy 设备登录辅助（给 quota_probe.py 用）

流程（与官方客户端一致，逆向自 cv-superding/WorkBuddy-Switch2api 的 oauth.rs）：
  1. POST {auth_host}/v2/plugin/auth/state?platform=workbuddy-web
     -> data.state + data.authUrl
  2. 把 authUrl 打印出来（并尝试用系统浏览器打开），等你在网页里登录
  3. 轮询 GET {auth_host}/v2/plugin/auth/token?state=…（code != 0/200 表示还没登录）
  4. 拿到 token 后 GET {auth_host}/v2/plugin/login/account?state=… 取 uid / nickname
  5. 写成 0600 权限的 JSON 文件，交给 quota_probe.py --workbuddy-token-file

注意：
  * token 绝不打印到屏幕，只写文件。
  * 状态码语义来自开源实现，本机的"成功分支"没有真实账号可验证（只验证了 200 的 state 接口）。
    如果第 3 步一直 pending，先用桌面客户端登录一次再重试。

用法：
  python3 wb_login.py                      # 国内版，token 写到 ~/.workbuddy-probe.json
  python3 wb_login.py --edition intl       # 国际版（workbuddy.ai）
  python3 wb_login.py --timeout 300 --no-open
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

UA = "wb-login/0.1 (+local read-only)"
TIMEOUT = 20

EDITIONS = {
    "cn": {
        "auth_host": "https://www.codebuddy.cn",   # 插件鉴权域（国内）
        "api_host": "https://www.workbuddy.cn",    # 计费用量域（国内）
        "label": "国内版",
    },
    "intl": {
        "auth_host": "https://www.workbuddy.ai",
        "api_host": "https://www.workbuddy.ai",
        "label": "国际版",
    },
}


def post(url, payload=None, headers=None):
    body = json.dumps(payload or {}).encode()
    h = {"User-Agent": UA, "Content-Type": "application/json", "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, json.loads(r.read(2 * 1024 * 1024).decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return e.code, None
    except Exception as e:
        return None, {"_error": "%s: %s" % (type(e).__name__, e)}


def get_json(url, headers=None):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, json.loads(r.read(2 * 1024 * 1024).decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return e.code, None
    except Exception as e:
        return None, {"_error": "%s: %s" % (type(e).__name__, e)}


def open_url(url):
    try:
        sysname = platform.system()
        if sysname == "Darwin":
            subprocess.run(["open", url], check=False)
        elif sysname == "Windows":
            os.startfile(url)          # type: ignore[attr-defined]
        else:
            subprocess.run(["xdg-open", url], check=False)
        return True
    except Exception:
        return False


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--edition", choices=list(EDITIONS), default="cn")
    ap.add_argument("--timeout", type=int, default=240, help="等待登录的秒数（默认 240）")
    ap.add_argument("--out", default=os.path.join(os.path.expanduser("~"), ".workbuddy-probe.json"))
    ap.add_argument("--no-open", action="store_true", help="不要自动打开浏览器")
    ap.add_argument("--poll-interval", type=float, default=2.0)
    args = ap.parse_args(argv)

    ed = EDITIONS[args.edition]
    host = ed["auth_host"]

    print("WorkBuddy 设备登录（%s）" % ed["label"])
    status, body = post(host + "/v2/plugin/auth/state?platform=workbuddy-web", {})
    if status != 200 or not isinstance(body, dict):
        print("✗ 发起登录失败：HTTP %s %s" % (status, (body or {})))
        return 2
    data = body.get("data") or {}
    state = data.get("state")
    auth_url = data.get("authUrl") or host
    if not state:
        print("✗ 返回里没有 state：%s" % json.dumps(body)[:300])
        return 2

    print("→ 请在浏览器完成登录（%d 秒内）：" % args.timeout)
    print("  " + auth_url)
    if not args.no_open:
        opened = open_url(auth_url)
        print("  （已尝试自动打开浏览器）" if opened else "  （自动打开失败，请手动复制上面的链接）")

    deadline = time.time() + args.timeout
    token = None
    token_data = {}
    dots = 0
    while time.time() < deadline:
        s2, b2 = get_json("%s/v2/plugin/auth/token?state=%s" % (host, state))
        code = None
        if isinstance(b2, dict):
            code = b2.get("code")
        if s2 == 200 and code in (0, 200) and isinstance(b2.get("data"), dict):
            cand = b2["data"].get("accessToken") or b2["data"].get("access_token")
            if cand:
                token = cand
                token_data = b2["data"]
                break
        dots += 1
        print(".", end="", flush=True)
        if dots % 60 == 0:
            print(" (%ds)" % int(args.timeout - (deadline - time.time())))
        time.sleep(args.poll_interval)

    print()
    if not token:
        print("✗ 等待超时，未拿到 token。先用 WorkBuddy 桌面客户端登录一次，再重试本脚本。")
        return 4

    uid = nickname = domain = None
    headers = {"Authorization": "Bearer " + token}
    if token_data.get("domain"):
        domain = token_data["domain"]
        headers["X-Domain"] = domain
    s3, b3 = get_json("%s/v2/plugin/login/account?state=%s" % (host, state), headers)
    if isinstance(b3, dict) and isinstance(b3.get("data"), dict):
        acc = b3["data"]
        uid = acc.get("uid") or acc.get("userId")
        nickname = acc.get("nickname") or acc.get("name")

    expires_at = token_data.get("expiresAt") or token_data.get("expires_at")
    if not expires_at and token_data.get("expiresIn"):
        try:
            expires_at = int(time.time() * 1000) + int(token_data["expiresIn"]) * 1000
        except Exception:
            expires_at = None

    out = {
        "access_token": token,
        "domain": domain,
        "uid": uid,
        "nickname": nickname,
        "edition": args.edition,
        "api_host": ed["api_host"],
        "expires_at": expires_at,
        "saved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    path = os.path.expanduser(args.out)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("✓ 已保存凭据到 %s（权限 0600）" % path)
    print("  账号：%s%s" % (nickname or "未知", (" / uid " + str(uid)) if uid else ""))
    print("  下一步：python3 quota_probe.py --provider workbuddy --workbuddy-token-file %s --workbuddy-host %s"
          % (path, ed["api_host"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
