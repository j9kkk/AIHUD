#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
quota_probe.py — 四端点健康检查 + 返回体固化（fixture）

在"已经登录过 Claude Code / Codex / Antigravity / WorkBuddy"的真机上跑一遍，
只读地打一次每个渠道的用量接口，把原始返回体脱敏后存成 fixture，
后面所有解析器和测试都以这些真实返回体为准，而不是猜。

设计约束（刻意的）：
  * 只用 Python 3 标准库，不需要 pip / venv。
  * 绝不刷新 token。过期就报过期，不替用户续期（Claude 的 refresh token 是一次性的，
    抢刷新会把 Claude Code 踢下线）。
  * 绝不打印 token。落盘前统一脱敏：token / cookie / 邮箱 / JWT 全部替换。
  * 只打 GET/POST 的只读用量接口，不代跑推理、不改任何账号状态。
  * 每个请求 20s 超时，最多 1 次重试（仅网络错误），不连环重试。

用法：
  python3 quota_probe.py --all                       # 探测所有能探测到的渠道
  python3 quota_probe.py --provider claude --json    # 单渠道 + 机器可读输出
  python3 quota_probe.py --selftest                  # 不需要账号，验证解析与状态分类
  python3 quota_probe.py --all --out ./fixtures      # 指定 fixture 目录

退出码：
  0 = 至少一个渠道成功，且没有"需要人处理"的失败
  1 = 有渠道失败（鉴权/限流/解析等）
  2 = 一个渠道都没探测到（本机没有任何可用凭据）
  3 = selftest 失败
"""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

VERSION = "0.1.0"
UA = "quota-probe/%s (+local read-only)" % VERSION
TIMEOUT = 20

# ---------------------------------------------------------------- 状态

OK, STALE, AUTH, RATE, DEPRECATED, UNSUPPORTED, UNREACHABLE, PARSE, NOTCONF = (
    "ok", "stale", "auth_expired", "rate_limited", "deprecated", "unsupported", "unreachable",
    "parse_error", "not_configured"
)

STATUS_HINT = {
    OK: "正常",
    STALE: "数据过期",
    AUTH: "需要重新登录",
    RATE: "被限流（退避中）",
    DEPRECATED: "接口已停服",
    UNSUPPORTED: "账号类型不支持",
    UNREACHABLE: "网络不可达",
    PARSE: "返回体无法解析",
    NOTCONF: "未配置（未找到登录态）",
}


def endpoint(provider, default):
    """允许用环境变量覆盖端点，仅为调试/集成测试；正常使用不要设置。"""
    return os.environ.get("QUOTA_PROBE_%s_URL" % provider.upper(), default)


def now_ms():
    return int(time.time() * 1000)


def iso(ts):
    if ts is None:
        return None
    if ts > 1e12:            # 毫秒
        ts = ts / 1000.0
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (OverflowError, OSError, ValueError):
        return None


# ---------------------------------------------------------------- 脱敏

SECRET_KEYS = re.compile(r"(token|authorization|cookie|secret|password|apikey|api_key|session)", re.I)
EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}")
LONGOPAQUE = re.compile(r"\b[A-Za-z0-9_\-]{40,}\b")
# 登录 state 是一次性 nonce，但它带在 URL 里，落盘前擦掉（不影响结构验证）
QUERY_SECRET = re.compile(r"([?&](?:state|code|token|code_challenge)=)[^&\s\"\']+", re.I)


def redact(value, key=None, depth=0):
    """递归脱敏。结构保留，只有敏感值被替换，fixture 仍然可用于验证解析。"""
    if depth > 12:
        return "<depth-limit>"
    if key and SECRET_KEYS.search(str(key)):
        return "<redacted>"
    # 登录 nonce：字段名就是 state，值是一串 UUID/十六进制
    if key and str(key).lower() in ("state", "nonce", "verificationuri", "verification_uri"):
        if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F\-]{16,}", value):
            return "<redacted>"
        if isinstance(value, str):
            return QUERY_SECRET.sub(r"\1<redacted>", value)
        return value
    if isinstance(value, dict):
        return {k: redact(v, k, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, key, depth + 1) for v in value[:200]]
    if isinstance(value, str):
        s = QUERY_SECRET.sub(r"\1<redacted>", value)
        s = EMAIL.sub("user@example.com", s)
        s = JWT.sub("<redacted-jwt>", s)
        s = LONGOPAQUE.sub("<redacted-opaque>", s)
        return s
    return value


def redact_headers(headers):
    keep = {"content-type", "retry-after", "date", "server", "x-request-id", "request-id"}
    out = {}
    for k, v in (headers or {}).items():
        lk = k.lower()
        if lk in keep:
            out[lk] = redact(v)
        elif lk in ("www-authenticate", "x-ratelimit-limit", "x-ratelimit-remaining",
                    "x-ratelimit-reset", "anthropic-ratelimit-unified-status"):
            out[lk] = redact(v)
    return out


# ---------------------------------------------------------------- HTTP

def http(url, method="GET", headers=None, body=None, retries=1):
    """返回 (status, headers dict, text, error)。绝不抛异常给上层。"""
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    hdrs = {"User-Agent": UA, "Accept": "application/json"}
    hdrs.update(headers or {})
    if data:
        hdrs.setdefault("Content-Type", "application/json")

    attempt = 0
    last = (None, {}, "", "no attempt")
    while attempt <= retries:
        attempt += 1
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read(2 * 1024 * 1024)
                return r.status, dict(r.headers), raw.decode("utf-8", "replace"), None
        except urllib.error.HTTPError as e:
            try:
                raw = e.read(2 * 1024 * 1024).decode("utf-8", "replace")
            except Exception:
                raw = ""
            return e.code, dict(e.headers or {}), raw, None
        except Exception as e:      # URLError / timeout / ssl
            last = (None, {}, "", "%s: %s" % (type(e).__name__, e))
            if attempt <= retries:
                time.sleep(1.0)
    return last


def hget(headers, name, default=None):
    """HTTP 头大小写不敏感取值。"""
    if not headers:
        return default
    target = name.lower()
    for k, v in headers.items():
        if k.lower() == target:
            return v
    return default


def classify_http(status, text, headers, provider):
    """把 HTTP 结果映射成状态。网关 HTML、停服信号都在这层识别。"""
    ctype = (hget(headers, "content-type") or "").lower()
    body_is_json = "json" in ctype or (text.strip().startswith("{") and text.strip().endswith("}"))
    if status is None:
        return UNREACHABLE
    if status == 200:
        if not body_is_json:
            return PARSE          # 200 但返回 HTML —— 典型网关拦截
        return OK
    if status in (401, 403):
        low = text.lower()
        if provider == "gemini" and ("subscription_required" in low or "unsupported_client" in low
                                     or "ineligibletier" in low):
            return DEPRECATED
        if "subscription_required" in low:
            return DEPRECATED
        if status == 403 and not body_is_json:
            return AUTH           # 403 纯 HTML：多半是 WAF/网关，不是账号问题
        return AUTH
    if status == 429:
        return RATE
    if status in (404, 410):
        return DEPRECATED if provider == "gemini" else PARSE
    if 500 <= status < 600:
        return STALE
    return PARSE


# ---------------------------------------------------------------- 凭据定位

def home(*p):
    return os.path.join(os.path.expanduser("~"), *p)


def read_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def macos_keychain(service):
    """macOS Keychain 读取。服务名不存在时返回 None，不弹窗。"""
    if platform.system() != "Darwin" or not shutil.which("security"):
        return None
    try:
        r = subprocess.run(["security", "find-generic-password", "-s", service, "-w"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            return None
        txt = (r.stdout or "").strip()
        try:
            return json.loads(txt)
        except Exception:
            return {"_raw": txt}
    except Exception:
        return None


def find_claude_token():
    """返回 (token, 来源说明, expires_at_ms or None)。"""
    env = os.environ.get("ANTHROPIC_OAUTH_TOKEN")
    if env:
        return env, "env:ANTHROPIC_OAUTH_TOKEN", None

    services = ["Claude Code-credentials"]
    cfg_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    if cfg_dir:
        digest = hashlib.sha256(os.path.abspath(cfg_dir).encode()).hexdigest()[:8]
        services.insert(0, "Claude Code-credentials-" + digest)
    for svc in services:
        blob = macos_keychain(svc)
        tok, exp = _claude_from_blob(blob)
        if tok:
            return tok, "keychain:" + svc, exp

    candidates = []
    if cfg_dir:
        candidates.append(os.path.join(cfg_dir, ".credentials.json"))
    candidates.append(home(".claude", ".credentials.json"))
    for path in candidates:
        blob = read_json_file(path)
        tok, exp = _claude_from_blob(blob)
        if tok:
            return tok, "file:" + path, exp
    return None, "not-found", None


def _claude_from_blob(blob):
    if not isinstance(blob, dict):
        return None, None
    node = blob.get("claudeAiOauth") if isinstance(blob.get("claudeAiOauth"), dict) else blob
    tok = node.get("accessToken") or node.get("access_token") or blob.get("_raw")
    exp = node.get("expiresAt") or node.get("expires_at")
    if isinstance(exp, str):
        try:
            exp = int(exp)
        except ValueError:
            exp = None
    return (tok if isinstance(tok, str) and tok else None), exp


def find_codex_auth():
    """返回 (access_token, account_id, 来源说明)。"""
    candidates = []
    if os.environ.get("CODEX_HOME"):
        candidates.append(os.path.join(os.environ["CODEX_HOME"], "auth.json"))
    candidates += [home(".config", "codex", "auth.json"), home(".codex", "auth.json")]
    for path in candidates:
        blob = read_json_file(path)
        got = _codex_from_blob(blob)
        if got[0]:
            return got[0], got[1], "file:" + path

    # keychain 存的是同一份 auth.json 结构
    blob = macos_keychain("Codex Auth")
    got = _codex_from_blob(blob)
    if got[0]:
        return got[0], got[1], "keychain:Codex Auth"
    return None, None, "not-found"


def _codex_from_blob(blob):
    if not isinstance(blob, dict):
        return None, None
    tokens = blob.get("tokens") if isinstance(blob.get("tokens"), dict) else {}
    tok = tokens.get("access_token") or blob.get("access_token")
    acct = tokens.get("account_id") or blob.get("account_id")
    return (tok if isinstance(tok, str) and tok else None), (acct if isinstance(acct, str) else None)




def load_wb_token(path):
    """接受两种格式：纯 token 文本，或 wb_login.py 写出的 JSON。

    返回 dict(access_token, domain, uid, edition, expires_at)。
    """
    with open(os.path.expanduser(path), "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if not raw:
        return None
    if raw.startswith("{"):
        try:
            blob = json.loads(raw)
        except Exception:
            return None
        tok = blob.get("access_token") or blob.get("accessToken") or blob.get("token")
        if not tok:
            return None
        return {"access_token": tok, "domain": blob.get("domain"),
                "uid": blob.get("uid"), "edition": blob.get("edition"),
                "expires_at": blob.get("expires_at") or blob.get("expiresAt")}
    return {"access_token": raw, "domain": None, "uid": None, "edition": None, "expires_at": None}


# ---------------------------------------------------------------- 解析器（纯函数，selftest 直接测）

def parse_claude(body):
    """Claude /api/oauth/usage -> windows"""
    out = {"windows": [], "credits": None}
    for key, label, secs in (("five_hour", "5 小时窗口", 18000),
                             ("seven_day", "7 天窗口", 604800),
                             ("seven_day_opus", "7 天 Opus", 604800),
                             ("seven_day_omelette", "7 天 Design", 604800)):
        node = body.get(key)
        if not isinstance(node, dict):
            continue
        util = node.get("utilization")
        if util is None:
            continue
        out["windows"].append({
            "kind": key,
            "label": label,
            "used_pct": clamp_pct(util),
            "resets_at": node.get("resets_at"),
            "limit_seconds": secs,
        })
    extra = body.get("extra_usage")
    if isinstance(extra, dict) and extra.get("is_enabled"):
        out["credits"] = {
            "used": cents(extra.get("used_credits")),
            "limit": cents(extra.get("monthly_limit")),
            "currency": extra.get("currency") or "USD",
            "unlimited": extra.get("monthly_limit") in (0, None),
        }
    return out


def parse_codex(body):
    out = {"windows": [], "credits": None, "resets": None, "plan": body.get("plan_type")}
    rl = body.get("rate_limit") if isinstance(body.get("rate_limit"), dict) else {}
    for key, label in (("primary_window", "主窗口"), ("secondary_window", "次窗口")):
        node = rl.get(key)
        if not isinstance(node, dict):
            continue
        out["windows"].append({
            "kind": key,
            "label": label,
            "used_pct": clamp_pct(node.get("used_percent")),
            "resets_at": iso(node.get("reset_at")),
            "limit_seconds": node.get("limit_window_seconds"),
        })
    review = body.get("code_review_rate_limit")
    if isinstance(review, dict) and isinstance(review.get("primary_window"), dict):
        n = review["primary_window"]
        out["windows"].append({
            "kind": "code_review",
            "label": "代码评审窗口",
            "used_pct": clamp_pct(n.get("used_percent")),
            "resets_at": iso(n.get("reset_at")),
            "limit_seconds": n.get("limit_window_seconds"),
        })
    cr = body.get("credits")
    if isinstance(cr, dict):
        bal = cr.get("balance")
        out["credits"] = {
            "remaining": bal,
            "usd_estimate": round(bal * 0.04, 2) if isinstance(bal, (int, float)) else None,
            "unlimited": bool(cr.get("unlimited")),
        }
    rrc = body.get("rate_limit_reset_credits")
    if isinstance(rrc, dict):
        out["resets"] = {"available": rrc.get("available_count")}
    return out


def parse_gemini_quota(body):
    """cloudcode-pa retrieveUserQuota -> 每个模型取最低 remainingFraction"""
    buckets = body.get("buckets") or []
    per_model = {}
    for b in buckets:
        if not isinstance(b, dict):
            continue
        model = b.get("modelId") or b.get("model_id") or "unknown"
        frac = b.get("remainingFraction")
        if frac is None:
            continue
        try:
            frac = float(frac)
        except (TypeError, ValueError):
            continue
        per_model.setdefault(model, []).append((frac, b.get("resetTime")))
    windows = []
    for model, rows in per_model.items():
        frac, reset = min(rows, key=lambda r: r[0])
        windows.append({
            "kind": model,
            "label": model,
            "used_pct": round((1.0 - max(0.0, min(1.0, frac))) * 100, 1),
            "resets_at": reset,
            "limit_seconds": None,
        })
    windows.sort(key=lambda w: -w["used_pct"])
    return {"windows": windows}


def parse_antigravity(body):
    """agy -p /usage --output-format json：结构不固定，宽松取用。"""
    out = {"windows": [], "credits": None}
    candidates = []

    def walk(node, depth=0):
        if depth > 6:
            return
        if isinstance(node, dict):
            pct = node.get("usedPercent", node.get("used_percent", node.get("percentUsed")))
            remaining = node.get("remainingFraction", node.get("remaining_fraction"))
            if pct is not None or remaining is not None:
                used = clamp_pct(pct) if pct is not None else round((1 - float(remaining)) * 100, 1)
                candidates.append({
                    "kind": str(node.get("modelId") or node.get("model") or node.get("name") or "bucket"),
                    "label": str(node.get("modelId") or node.get("model") or node.get("name") or "额度窗口"),
                    "used_pct": used,
                    "resets_at": node.get("resetTime") or node.get("resets_at") or node.get("reset"),
                    "limit_seconds": node.get("limitWindowSeconds"),
                })
            for v in node.values():
                walk(v, depth + 1)
        elif isinstance(node, list):
            for v in node[:50]:
                walk(v, depth + 1)

    walk(body)
    seen, windows = set(), []
    for w in candidates:
        k = (w["kind"], w["used_pct"])
        if k in seen:
            continue
        seen.add(k)
        windows.append(w)
    out["windows"] = windows[:12]
    return out


def parse_workbuddy(body):
    """billing/meter/get-user-resource-summary：资源包合计。"""
    out = {"windows": [], "credits": None, "packages": []}
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    total = data.get("totalCapacity")
    left = data.get("totalRemaining")
    if isinstance(total, (int, float)) and isinstance(left, (int, float)) and total > 0:
        out["windows"].append({
            "kind": "credits",
            "label": "积分余量",
            "used_pct": round(max(0.0, min(1.0, 1 - left / total)) * 100, 1),
            "resets_at": None,
            "limit_seconds": None,
        })
    if isinstance(left, (int, float)):
        out["credits"] = {"remaining": left, "capacity": total,
                          "usd_estimate": None, "unlimited": False}
    # 资源包明细可能挂在 Accounts / Accounts[].Packages 上，宽松扫描
    def scan(node, depth=0):
        if depth > 6 or len(out["packages"]) >= 20:
            return
        if isinstance(node, dict):
            if "total" in node and ("used" in node or "remain" in node):
                out["packages"].append({
                    "total": node.get("total"),
                    "used": node.get("used"),
                    "expireAt": node.get("expireAt") or node.get("expiredTime"),
                    "expired": bool(node.get("expired")),
                })
            for v in node.values():
                scan(v, depth + 1)
        elif isinstance(node, list):
            for v in node[:50]:
                scan(v, depth + 1)
    scan(data)
    return out


def clamp_pct(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:            # NaN
        return None
    return round(max(0.0, min(100.0, f)), 1)


def cents(v):
    try:
        return round(float(v) / 100.0, 2)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- 各渠道探测

def probe_claude(save_dir=None):
    tok, source, exp = find_claude_token()
    snap = base_snapshot("claude", source)
    if not tok:
        snap.update(status=NOTCONF, error="未找到 Claude 登录态（Keychain / .credentials.json）")
        return snap, None
    if exp and exp < now_ms():
        snap.update(status=AUTH, error="本地 token 已过期（按设计不刷新，避免踢掉 Claude Code）")
        return snap, None

    url = endpoint("claude", "https://api.anthropic.com/api/oauth/usage")
    status, headers, text, err = http(url, headers={
        "Authorization": "Bearer " + tok,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
    })
    snap = finish(snap, "claude", url, status, headers, text, err, parse_claude,
                  save_dir, dict(expires_at_ms=exp))
    return snap, None


def probe_codex(save_dir=None):
    tok, acct, source = find_codex_auth()
    snap = base_snapshot("codex", source)
    if not tok:
        snap.update(status=NOTCONF, error="未找到 Codex 登录态（auth.json / Keychain / Keyring）")
        return snap, None
    url = endpoint("codex", "https://chatgpt.com/backend-api/wham/usage")
    headers = {"Authorization": "Bearer " + tok, "Accept": "application/json"}
    if acct:
        headers["ChatGPT-Account-Id"] = acct
    status, hdrs, text, err = http(url, headers=headers)
    snap = finish(snap, "codex", url, status, hdrs, text, err, parse_codex, save_dir)
    return snap, None


def probe_gemini(save_dir=None):
    """旧 Gemini CLI 通道。消费级账号现在会 403 SUBSCRIPTION_REQUIRED，这本身就是有效结论。"""
    path = home(".gemini", "oauth_creds.json")
    blob = read_json_file(path) or {}
    tok = blob.get("access_token")
    snap = base_snapshot("gemini", "file:" + path if os.path.exists(path) else "not-found")
    if not tok:
        snap.update(status=NOTCONF, error="未找到 ~/.gemini/oauth_creds.json")
        return snap, None
    headers = {"Authorization": "Bearer " + tok, "Content-Type": "application/json"}

    s1, h1, t1, e1 = http(endpoint("gemini_loadcode",
                                  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"),
                          method="POST", headers=headers,
                          body={"metadata": {"ideType": "GEMINI_CLI", "pluginType": "GEMINI"}})
    project = None
    try:
        project = (json.loads(t1).get("cloudaicompanionProject")
                   or (json.loads(t1).get("response") or {}).get("cloudaicompanionProject"))
    except Exception:
        pass

    url = endpoint("gemini", "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota")
    status, hdrs, text, err = http(url, method="POST", headers=headers,
                                   body={"project": project} if project else {})
    snap = finish(snap, "gemini", url, status, hdrs, text, err, parse_gemini_quota, save_dir,
                  {"loadCodeAssist_status": s1, "project_found": bool(project)})
    if snap["status"] == OK and not snap["windows"]:
        snap["status"] = STALE
        snap["error"] = "接口返回 200 但没有可解析的额度桶，可能账号类型不同"
    return snap, None


def probe_antigravity(save_dir=None):
    snap = base_snapshot("antigravity", "cli:agy")
    agy = shutil.which("agy") or shutil.which("antigravity")
    if not agy:
        snap.update(status=NOTCONF, error="未安装 agy CLI（brew install --cask antigravity-cli）")
        return snap, None
    try:
        r = subprocess.run([agy, "-p", "/usage", "--output-format", "json"],
                           capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        snap.update(status=UNREACHABLE, error="agy 90s 超时")
        return snap, None
    except Exception as e:
        snap.update(status=PARSE, error="%s: %s" % (type(e).__name__, e))
        return snap, None
    out = (r.stdout or "")[:1024 * 1024]
    snap["http_status"] = r.returncode
    if r.returncode != 0 and not out.strip():
        snap.update(status=AUTH if "login" in (r.stderr or "").lower() else PARSE,
                    error=(r.stderr or "")[:200].strip() or "agy 返回非 0")
        return snap, None
    try:
        body = json.loads(out)
    except Exception:
        snap.update(status=PARSE, error="agy 输出不是 JSON")
        return snap, None
    parsed = parse_antigravity(body)
    snap["windows"] = parsed["windows"]
    snap["status"] = OK if parsed["windows"] else STALE
    if save_dir:
        save_fixture(save_dir, "antigravity", {"request": {"cmd": "agy -p /usage --output-format json"},
                                               "response": {"status": r.returncode,
                                                            "body": redact(body)}},
                     snap)
    return snap, None


def probe_workbuddy(save_dir=None, token=None, host="https://www.workbuddy.cn"):
    """token 可以是字符串，也可以是 load_wb_token() 返回的 dict。"""
    token_info = token if isinstance(token, dict) else ({"access_token": token} if token else None)
    """没有 token 时也能验证两件事：授权接口是否可用、计费接口是否存活。"""
    snap = base_snapshot("workbuddy", "host:" + host)
    s0, h0, t0, e0 = http(host + "/v2/plugin/auth/state?platform=workbuddy-web", method="POST",
                          body={})
    auth_ok = (s0 == 200 and "authUrl" in (t0 or ""))
    snap["meta"] = {"auth_state_http": s0, "auth_state_ok": auth_ok}

    if not token_info or not token_info.get("access_token"):
        snap.update(status=NOTCONF if auth_ok else UNREACHABLE,
                    error="授权接口可用（HTTP %s），但尚未登录：登录后再带 --workbuddy-token-file 复测" % s0
                          if auth_ok else "授权接口不可用：%s" % (e0 or s0))
        if save_dir:
            save_fixture(save_dir, "workbuddy.authstate",
                         {"request": {"url": host + "/v2/plugin/auth/state"}, "response":
                          {"status": s0, "headers": redact_headers(h0),
                           "body": redact(safe_json(t0))}}, snap)
        return snap, None

    url = endpoint("workbuddy", host + "/billing/meter/get-user-resource-summary")
    headers = {"Authorization": "Bearer " + token_info["access_token"]}
    if token_info.get("domain"):
        headers["X-Domain"] = token_info["domain"]
    if token_info.get("uid"):
        headers["X-User-Id"] = token_info["uid"]
    snap["source"] = "token-file:%s" % (token_info.get("edition") or "unknown")
    status, hdrs, text, err = http(url, method="POST", headers=headers, body={})
    snap = finish(snap, "workbuddy", url, status, hdrs, text, err, parse_workbuddy, save_dir)
    if snap["status"] == OK and not snap["windows"]:
        snap["status"] = STALE
        snap["error"] = "返回 200 但没有 totalCapacity/totalRemaining，可能需要带 X-User-Id 头"
    return snap, None


# ---------------------------------------------------------------- 组装 / 落盘

def base_snapshot(provider, source):
    return {
        "provider": provider,
        "source": source,
        "status": UNSUPPORTED,
        "windows": [],
        "credits": None,
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "http_status": None,
        "error": None,
        "meta": {},
    }


def safe_json(text):
    try:
        return json.loads(text)
    except Exception:
        return text[:500] if isinstance(text, str) else text


def finish(snap, provider, url, status, headers, text, err, parser, save_dir, meta=None):
    snap["http_status"] = status
    st = classify_http(status, text or "", headers or {}, provider)
    if err:
        st = UNREACHABLE
    snap["status"] = st
    if meta:
        snap["meta"].update(meta)
    if st in (OK, STALE):
        try:
            body = json.loads(text)
        except Exception:
            snap["status"] = PARSE
            snap["error"] = "HTTP %s 但返回体不是 JSON" % status
            snap["meta"]["content_type"] = hget(headers, "content-type")
            body = None
        if body is not None:
            try:
                parsed = parser(body)
                snap["windows"] = [w for w in parsed.get("windows", []) if w.get("used_pct") is not None]
                snap["credits"] = parsed.get("credits")
                if parsed.get("resets"):
                    snap["meta"]["resets"] = parsed["resets"]
                if parsed.get("plan"):
                    snap["meta"]["plan"] = parsed["plan"]
                if parsed.get("packages"):
                    snap["meta"]["packages"] = parsed["packages"]
                if not snap["windows"] and not snap["credits"]:
                    snap["status"] = STALE
                    snap["error"] = "返回 200 但没有任何可解析的额度字段（上游结构可能变了）"
            except Exception as e:
                snap["status"] = PARSE
                snap["error"] = "解析失败 %s: %s" % (type(e).__name__, e)
            if save_dir:
                save_fixture(save_dir, provider,
                             {"request": {"method": "GET", "url": url,
                                          "headers_sent": ["Authorization", "Accept"]},
                              "response": {"status": status,
                                           "headers": redact_headers(headers),
                                           "body": redact(body)}}, snap)
    else:
        if err:
            snap["error"] = err
        elif not snap["error"]:
            snap["error"] = "HTTP %s：%s" % (status, (text or "")[:180].replace("\n", " "))
        snap["meta"]["retry_after"] = hget(headers, "retry-after")
        if save_dir:
            save_fixture(save_dir, provider + ".error",
                         {"request": {"url": url},
                          "response": {"status": status,
                                       "headers": redact_headers(headers),
                                       "body": redact(text[:4000] if isinstance(text, str) else text)}}, snap)
    return snap


def save_fixture(save_dir, name, payload, snap):
    try:
        os.makedirs(save_dir, exist_ok=True)
        ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        base = os.path.join(save_dir, "%s.%s" % (name, ts))
        with open(base + ".json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        with open(base + ".snapshot.json", "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("  ! 写 fixture 失败：%s" % e, file=sys.stderr)


# ---------------------------------------------------------------- 输出

def human(snap):
    mark = {OK: "✔", STALE: "~", AUTH: "!", RATE: "!", DEPRECATED: "×", UNSUPPORTED: "-",
            UNREACHABLE: "?", PARSE: "?", NOTCONF: "·"}.get(snap["status"], "?")
    line = "%-2s %-11s %-15s %s" % (mark, snap["provider"], snap["status"],
                                    STATUS_HINT.get(snap["status"], ""))
    if snap["windows"]:
        ws = ", ".join("%s %.1f%% @%s" % (w["label"], w["used_pct"], (w["resets_at"] or "?"))
                       for w in snap["windows"][:4])
        line += "  |  " + ws
    if snap["error"]:
        line += "  |  " + str(snap["error"])[:140]
    return line


def run_selftest():
    """不需要账号：用文档记录的返回体形状验证解析与状态分类。"""
    fails = []

    def check(name, cond, detail=""):
        if cond:
            print("  ok   %s" % name)
        else:
            print("  FAIL %s %s" % (name, detail))
            fails.append(name)

    claude = {"five_hour": {"utilization": 25, "resets_at": "2026-10-30T15:00:00Z"},
              "seven_day": {"utilization": 40, "resets_at": "2026-11-02T00:00:00Z"},
              "extra_usage": {"is_enabled": True, "used_credits": 500,
                              "monthly_limit": 10000, "currency": "USD"}}
    c = parse_claude(claude)
    check("claude: 两个窗口", len(c["windows"]) == 2, c)
    check("claude: 5h=25%", c["windows"][0]["used_pct"] == 25.0)
    check("claude: 超额 $5/$100", c["credits"]["used"] == 5.0 and c["credits"]["limit"] == 100.0)

    codex = {"plan_type": "plus",
             "rate_limit": {"primary_window": {"used_percent": 6, "reset_at": 1738300000,
                                               "limit_window_seconds": 18000},
                            "secondary_window": {"used_percent": 24, "reset_at": 1738900000,
                                                 "limit_window_seconds": 604800}},
             "credits": {"has_credits": True, "unlimited": False, "balance": 820.6969075},
             "rate_limit_reset_credits": {"available_count": 1}}
    x = parse_codex(codex)
    check("codex: 两窗口", len(x["windows"]) == 2)
    check("codex: 主窗口秒->ISO", str(x["windows"][0]["resets_at"]).endswith("Z"))
    check("codex: credits $32.80", x["credits"]["usd_estimate"] == 32.83 or x["credits"]["usd_estimate"] == 32.8,
          x["credits"])
    check("codex: banked reset=1", x["resets"]["available"] == 1)

    gem = {"buckets": [{"modelId": "gemini-2.5-pro", "remainingFraction": 0.35,
                        "resetTime": "2026-10-31T00:00:00Z"},
                       {"modelId": "gemini-2.5-pro", "remainingFraction": 0.62},
                       {"modelId": "gemini-2.5-flash", "remainingFraction": 0.9}]}
    g = parse_gemini_quota(gem)
    check("gemini: 每模型取最低", g["windows"][0]["used_pct"] == 65.0, g)

    wb = {"data": {"totalCapacity": 20000, "totalRemaining": 15000,
                   "Accounts": [{"Packages": [{"total": 10000, "used": 4000,
                                               "expireAt": 1790000000000, "expired": False}]}]}}
    w = parse_workbuddy(wb)
    check("workbuddy: 25% 已用", w["windows"][0]["used_pct"] == 25.0, w)
    check("workbuddy: 包明细", len(w["packages"]) == 1)

    html401 = "<html><head><title>401</title></head><body>login required</body></html>"
    check("classify: 401 HTML -> auth", classify_http(401, html401, {"content-type": "text/html"}, "workbuddy") == AUTH)
    check("classify: 403 纯 HTML -> auth", classify_http(403, html401, {"content-type": "text/html"}, "claude") == AUTH)
    check("classify: 200 HTML -> parse", classify_http(200, html401, {"content-type": "text/html"}, "codex") == PARSE)
    check("classify: 429 -> rate", classify_http(429, "", {"retry-after": "50"}, "claude") == RATE)
    sub = '{"error":{"code":"SUBSCRIPTION_REQUIRED"}}'
    check("classify: Gemini 403 停服", classify_http(403, sub, {"content-type": "application/json"}, "gemini") == DEPRECATED)
    check("classify: 5xx -> stale", classify_http(503, "", {}, "codex") == STALE)
    check("classify: 无响应 -> unreachable", classify_http(None, "", {}, "codex") == UNREACHABLE)

    r = redact({"access_token": "eyJhbGciOi.eyJzdWIiOiIxMjM0.SflKxwRJ", "email": "a.b@corp.com",
                "windows": [{"used": 6}]})
    check("redact: token 被替换", r["access_token"] == "<redacted>")
    check("redact: 邮箱被替换", r["email"] == "user@example.com")
    check("redact: 数值保留", r["windows"][0]["used"] == 6)

    # fixture 落盘 + 落盘脱敏（用假 body 走完整的 finish() 路径）
    import glob
    import tempfile
    tmp = tempfile.mkdtemp(prefix="quota-probe-selftest-")
    leaky = dict(codex)
    leaky["access_token"] = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eXoifQ.abcdefgh"
    leaky["email"] = "someone@corp.example"
    snap = base_snapshot("codex", "selftest")
    finish(snap, "codex", "https://example.invalid/usage", 200,
           {"content-type": "application/json"}, json.dumps(leaky), None, parse_codex, tmp)
    files = sorted(glob.glob(os.path.join(tmp, "*.json")))
    check("fixture: 落盘 2 个文件", len(files) == 2, files)
    check("fixture: 快照状态 ok", snap["status"] == OK, snap["status"])
    blob = "".join(open(f, encoding="utf-8").read() for f in files)
    check("fixture: JWT 未落盘", "eyJhbGciOiJIUzI1NiJ9" not in blob)
    check("fixture: 邮箱已脱敏", "someone@corp.example" not in blob)
    check("fixture: 额度数值保留", '"used_pct": 6.0' in blob or '"used_pct": 24.0' in blob)

    print()
    total = 0
    if fails:
        print("selftest 失败 %d 项：%s" % (len(fails), ", ".join(fails)))
        return 3
    print("selftest 全部通过")
    return 0


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description="AI 额度四端点健康检查（只读）")
    ap.add_argument("--provider", choices=["claude", "codex", "gemini", "antigravity", "workbuddy"],
                    help="只探测一个渠道")
    ap.add_argument("--all", action="store_true", help="探测全部渠道")
    ap.add_argument("--out", default="./fixtures", help="fixture 输出目录（默认 ./fixtures）")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    ap.add_argument("--selftest", action="store_true", help="不联网，验证解析器")
    ap.add_argument("--workbuddy-token-file", help="含 WorkBuddy Bearer token 的文件（不要用命令行参数传）")
    ap.add_argument("--workbuddy-host", default="https://www.workbuddy.cn",
                    help="workbuddy.cn（国内）或 workbuddy.ai（国际）")
    ap.add_argument("--no-fixtures", action="store_true", help="不落盘")
    args = ap.parse_args(argv)

    if args.selftest:
        return run_selftest()

    save_dir = None if args.no_fixtures else args.out
    targets = []
    if args.provider:
        targets = [args.provider]
    elif args.all or not args.provider:
        targets = ["claude", "codex", "gemini", "antigravity", "workbuddy"]
        if not args.all:
            print("未指定 --provider/--all，按全部渠道探测。\n",
                  file=sys.stderr if args.json else sys.stdout)

    wb_token = None
    if args.workbuddy_token_file:
        try:
            wb_token = load_wb_token(args.workbuddy_token_file)
            if not wb_token:
                print("token 文件为空或格式不对（应为纯 token，或 wb_login.py 写出的 JSON）", file=sys.stderr)
        except Exception as e:
            print("读取 workbuddy token 文件失败：%s" % e, file=sys.stderr)

    # --json 时所有人类可读输出走 stderr，保证 stdout 是纯 JSON
    out_stream = sys.stderr if args.json else sys.stdout
    print("quota_probe %s · %s · python %s" % (VERSION, platform.platform(), platform.python_version()),
          file=out_stream)
    print("fixtures -> %s" % (save_dir or "(disabled)"), file=out_stream)
    print("-" * 96, file=out_stream)

    results = []
    for name in targets:
        try:
            if name == "claude":
                snap, _ = probe_claude(save_dir)
            elif name == "codex":
                snap, _ = probe_codex(save_dir)
            elif name == "gemini":
                snap, _ = probe_gemini(save_dir)
            elif name == "antigravity":
                snap, _ = probe_antigravity(save_dir)
            else:
                snap, _ = probe_workbuddy(save_dir, token=wb_token, host=args.workbuddy_host)
        except Exception as e:                      # 单渠道异常绝不拖垮其它渠道
            snap = base_snapshot(name, "internal")
            snap.update(status=PARSE, error="探测函数异常 %s: %s" % (type(e).__name__, e))
        results.append(snap)
        if not args.json:
            print(human(snap))

    ok = [r for r in results if r["status"] == OK]
    auth = [r for r in results if r["status"] == AUTH]
    if not args.json:
        print("-" * 96)
        conf = [r for r in results if r["status"] == NOTCONF]
        print("成功 %d / %d ；未配置 %d ；需人工处理 %d" % (len(ok), len(results), len(conf), len(auth)))
        if ok:
            print("下一步：把 %s 整个目录发给开发者，它就是测试基线。" % (save_dir or "./fixtures"))
        elif auth:
            print("下一步：先在对应 CLI 里登录，再重跑本脚本。")
        else:
            print("下一步：本机没有可用的登录态。先装并登录至少一个渠道（claude / codex / agy / workbuddy）。")
    else:
        print(json.dumps({"version": VERSION, "generated_at": datetime.now(timezone.utc)
                          .strftime("%Y-%m-%dT%H:%M:%SZ"), "results": results},
                         ensure_ascii=False, indent=2))

    if not results:
        return 2
    if ok:
        return 0 if not auth else 1
    return 1 if any(r["status"] not in (NOTCONF, UNSUPPORTED) for r in results) else 2


if __name__ == "__main__":
    sys.exit(main())
