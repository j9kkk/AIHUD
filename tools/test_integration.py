#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_integration.py — 用本地 HTTP server 假装上游，把整条管线跑通（不需要任何真实账号）。

验证的是"真实 socket → 状态分类 → 解析 → QuotaSnapshot → fixture 落盘"这条链路，
而不只是解析函数。文档里记录的返回体形状都在这里当 fixture 用。

    python3 test_integration.py
    # 退出码 0 = 全通过
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PROBE = os.path.join(HERE, "quota_probe.py")

CLAUDE_BODY = {
    "five_hour": {"utilization": 25, "resets_at": "2026-10-30T15:00:00Z"},
    "seven_day": {"utilization": 40, "resets_at": "2026-11-02T00:00:00Z"},
    "extra_usage": {"is_enabled": True, "used_credits": 500, "monthly_limit": 10000, "currency": "USD"},
}
CODEX_BODY = {
    "plan_type": "plus",
    "rate_limit": {
        "primary_window": {"used_percent": 6, "reset_at": 1738300000, "limit_window_seconds": 18000},
        "secondary_window": {"used_percent": 24, "reset_at": 1738900000, "limit_window_seconds": 604800},
    },
    "credits": {"has_credits": True, "unlimited": False, "balance": 820.6969075},
    "rate_limit_reset_credits": {"available_count": 1},
}
GEMINI_BODY = {"buckets": [
    {"modelId": "gemini-2.5-pro", "remainingFraction": 0.35, "resetTime": "2026-10-31T00:00:00Z"},
    {"modelId": "gemini-2.5-flash", "remainingFraction": 0.92},
]}
WB_BODY = {"code": 0, "data": {"totalCapacity": 20000, "totalRemaining": 15000}}

ROUTES = {}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body, ctype="application/json", extra=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        route = ROUTES.get(self.path.split("?")[0])
        if not route:
            return self._send(404, {"error": "no route"})
        self._send(*route)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)
        self.do_GET()


def run(args, env):
    e = dict(os.environ)
    e.update(env)
    r = subprocess.run([sys.executable, PROBE] + args, capture_output=True, text=True, env=e)
    return r


def main():
    ROUTES.update({
        "/claude": (200, CLAUDE_BODY),
        "/claude-401html": (401, "<html><head><title>401 Authorization Required</title></head><body>login</body></html>", "text/html"),
        "/codex": (200, CODEX_BODY),
        "/codex-429": (429, {"error": "rate limited"}, "application/json", {"Retry-After": "50"}),
        "/codex-html200": (200, "<html>ok</html>", "text/html"),
        "/gemini-loadcode": (200, {"cloudaicompanionProject": "gen-lang-client-123"}),
        "/gemini": (200, GEMINI_BODY),
        "/gemini-dead": (403, {"error": {"code": "SUBSCRIPTION_REQUIRED"}}),
        "/wb": (200, WB_BODY),
    })

    srv = HTTPServer(("127.0.0.1", 0), H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % port

    tmp = tempfile.mkdtemp(prefix="qprobe-it-")
    codex_home = os.path.join(tmp, "codex")
    os.makedirs(codex_home)
    with open(os.path.join(codex_home, "auth.json"), "w") as f:
        json.dump({"tokens": {"access_token": "test-access-token", "account_id": "acct-1"}}, f)
    wb_token = os.path.join(tmp, "wb.json")
    with open(wb_token, "w") as f:
        json.dump({"access_token": "test-wb-token", "domain": "workbuddy.cn", "uid": "u1"}, f)

    claude_json = os.path.join(tmp, "claude.oauth.json")
    with open(claude_json, "w") as f:
        json.dump({"claudeAiOauth": {"accessToken": "test-claude-token", "expiresAt": 9999999999999}}, f)
    claude_dir = os.path.join(tmp, "claude-cfg")
    os.makedirs(claude_dir, exist_ok=True)
    shutil.move(claude_json, os.path.join(claude_dir, ".credentials.json"))
    gemini_home = os.path.join(tmp, "home")
    os.makedirs(os.path.join(gemini_home, ".gemini"), exist_ok=True)
    with open(os.path.join(gemini_home, ".gemini", "oauth_creds.json"), "w") as f:
        json.dump({"access_token": "test-gemini-token"}, f)

    env = {
        "HOME": gemini_home,
        "CLAUDE_CONFIG_DIR": claude_dir,
        "CODEX_HOME": codex_home,
        "QUOTA_PROBE_CLAUDE_URL": base + "/claude",
        "QUOTA_PROBE_CODEX_URL": base + "/codex",
        "QUOTA_PROBE_GEMINI_LOADCODE_URL": base + "/gemini-loadcode",
        "QUOTA_PROBE_GEMINI_URL": base + "/gemini",
        "QUOTA_PROBE_WORKBUDDY_URL": base + "/wb",
    }

    ok, fail = [], []

    def check(name, cond, detail=""):
        (ok if cond else fail).append(name)
        print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else "  " + str(detail)))

    # 1) 三个渠道全绿
    out = os.path.join(tmp, "fx-ok")
    r = run(["--all", "--json", "--out", out, "--workbuddy-token-file", wb_token], env)
    try:
        data = json.loads(r.stdout)
    except Exception:
        data = {"results": []}
    by = {x["provider"]: x for x in data.get("results", [])}
    check("claude 走完真实 socket 得到 ok", by.get("claude", {}).get("status") == "ok", r.stdout[:300])
    check("claude 两个窗口 + 超额", len(by.get("claude", {}).get("windows", [])) == 2
          and by["claude"]["credits"]["used"] == 5.0)
    check("codex 得到 ok 且有 credits/resets", by.get("codex", {}).get("status") == "ok"
          and by["codex"]["credits"]["usd_estimate"] in (32.8, 32.83), by.get("codex"))
    check("gemini 得到 ok（企业路）", by.get("gemini", {}).get("status") == "ok", by.get("gemini"))
    check("gemini 取最低剩余（pro 65%）", any(w["used_pct"] == 65.0 for w in by.get("gemini", {}).get("windows", [])))
    check("workbuddy 得到 ok（25% 已用）", by.get("workbuddy", {}).get("status") == "ok"
          and by["workbuddy"]["windows"][0]["used_pct"] == 25.0, by.get("workbuddy"))
    check("fixture 落盘 ≥ 8 个文件", len([f for f in os.listdir(out) if f.endswith(".json")]) >= 8, os.listdir(out))

    # 2) 401 纯 HTML -> auth_expired（WorkBuddy 网关真实行为）
    env2 = dict(env, QUOTA_PROBE_CLAUDE_URL=base + "/claude-401html")
    r = run(["--provider", "claude", "--json", "--no-fixtures"], env2)
    d = json.loads(r.stdout)["results"][0]
    check("401 HTML 归为 auth_expired", d["status"] == "auth_expired", d["status"])

    # 3) 429 + Retry-After -> rate_limited，且记下 retry_after
    env3 = dict(env, QUOTA_PROBE_CODEX_URL=base + "/codex-429")
    r = run(["--provider", "codex", "--json", "--no-fixtures"], env3)
    d = json.loads(r.stdout)["results"][0]
    check("429 归为 rate_limited", d["status"] == "rate_limited", d["status"])
    check("429 保留 Retry-After", str(d["meta"].get("retry_after")) == "50", d["meta"])

    # 4) 200 但返回 HTML -> parse_error，不是 ok
    env4 = dict(env, QUOTA_PROBE_CODEX_URL=base + "/codex-html200")
    r = run(["--provider", "codex", "--json", "--no-fixtures"], env4)
    d = json.loads(r.stdout)["results"][0]
    check("200 HTML 归为 parse_error", d["status"] == "parse_error", d["status"])

    # 5) Gemini 停服 -> deprecated
    env5 = dict(env, QUOTA_PROBE_GEMINI_URL=base + "/gemini-dead")
    r = run(["--provider", "gemini", "--json", "--no-fixtures"], env5)
    d = json.loads(r.stdout)["results"][0]
    check("Gemini 403 SUBSCRIPTION_REQUIRED -> deprecated", d["status"] == "deprecated", d["status"])

    # 6) fixture 里不能出现 token
    blob = ""
    for f in os.listdir(out):
        if f.endswith(".json"):
            blob += open(os.path.join(out, f), encoding="utf-8").read()
    check("fixture 无 token 泄漏", "test-claude-token" not in blob and "test-access-token" not in blob
          and "test-wb-token" not in blob)

    # 7) 退出码：全绿 = 0
    r = run(["--all", "--out", os.path.join(tmp, "fx2"), "--workbuddy-token-file", wb_token], env)
    check("全绿时退出码为 0", r.returncode == 0, "exit=%s\n%s" % (r.returncode, r.stdout[-400:]))

    srv.shutdown()
    print()
    print("通过 %d / %d" % (len(ok), len(ok) + len(fail)))
    if fail:
        print("失败：%s" % ", ".join(fail))
        return 1
    shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
