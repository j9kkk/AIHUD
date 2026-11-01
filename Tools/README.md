# quota_probe — 四端点健康检查（只读）

在**已经登录过** Claude Code / Codex / Antigravity / WorkBuddy 的机器上跑一遍。
它只做一件事：**把每个渠道的用量接口真实打一次，把返回体脱敏后存下来**。

为什么必须先做这一步：所有渠道的接口都是未公开的，没有 fixture 的解析器就是猜，
后面的 UI、提醒、边界处理全都建在猜测上。

- 不安装任何依赖（Python 3 标准库）
- 不刷新 token、不改账号状态、不代跑推理
- 不把 token 打印到屏幕；落盘前统一脱敏（token / cookie / 邮箱 / JWT / 登录 state）

---

## 1. 快速开始

### macOS（终端）

```bash
cd quota-hud/tools
python3 quota_probe.py --selftest          # 先确认脚本本身没问题（不联网）
python3 quota_probe.py --all --out ./fixtures
```

### Windows（PowerShell）

```powershell
cd quota-hud\tools
python quota_probe.py --selftest
python quota_probe.py --all --out .\fixtures
```

输出长这样（每行一个渠道）：

```
✔  claude      ok              正常           |  5 小时窗口 82.0%@2026-10-30T09:00:00Z, 7 天窗口 41.0%@...
·  codex       not_configured  未配置（未找到登录态）  |  未找到 Codex 登录态（auth.json / Keychain / Keyring）
!  workbuddy   auth_expired    需要重新登录      |  HTTP 401：<html><head><title>401 Authorization Required...
```

跑完把 `fixtures/` 整个目录发给开发者即可——里面的 token 已经替换成 `<redacted>`。

---

## 2. 每个渠道的前置条件

| 渠道 | 需要什么 | 凭据来源（脚本自动找） |
|---|---|---|
| `claude` | 本机登录过 Claude Code | macOS Keychain `Claude Code-credentials`（含 `CLAUDE_CONFIG_DIR` 哈希变体）→ `~/.claude/.credentials.json` |
| `codex` | 本机 `codex login` 过 | `$CODEX_HOME/auth.json` → `~/.config/codex/auth.json` → `~/.codex/auth.json` → macOS Keychain `Codex Auth` |
| `gemini` | 旧 Gemini CLI 登录态（多半会返回"已停服"，这本身是有效结论） | `~/.gemini/oauth_creds.json` |
| `antigravity` | 装了 `agy` CLI 并登录过 | 直接执行 `agy -p /usage --output-format json` |
| `workbuddy` | 需要先登录拿 token（见第 4 节） | `--workbuddy-token-file` 指向 `wb_login.py` 写出的文件 |

也可以在探测前用环境变量临时覆盖：`ANTHROPIC_OAUTH_TOKEN`。

---

## 3. 输出怎么读

| 标记 | 状态 | 含义 |
|---|---|---|
| ✔ | `ok` | 拿到数据并解析成功 |
| ~ | `stale` | 有返回但数据不可用（上游结构变了 / 5xx / 字段缺失） |
| ! | `auth_expired` | 401/403，需要重新登录 |
| ! | `rate_limited` | 429，被限流 |
| × | `deprecated` | 接口已停服（Gemini 消费级账号就是这条） |
| ? | `unreachable` / `parse_error` | 网络不可达 / 返回体解析不了 |
| · | `not_configured` | 本机没有这个渠道的登录态（不是错误） |

退出码：`0` 有成功且无待处理 → `1` 有失败 → `2` 一个都没探到 → `3` selftest 失败 → `4` 登录超时。

单渠道调试：

```bash
python3 quota_probe.py --provider claude --json
```

`--json` 输出结构化结果，字段与架构里的 `QuotaSnapshot` 一一对应
（`provider / status / windows[{label,used_pct,resets_at}] / credits / source / fetched_at`）。

---

## 4. WorkBuddy：先登录，再探测

WorkBuddy 没有"本机已存好的 token"可以直接读，它走设备登录：

```bash
python3 wb_login.py --edition cn      # 国内版；国际版用 --edition intl
```

它会打印（并尝试打开）官方登录页，你登录后它自动换到 token，写到
`~/.workbuddy-probe.json`（权限 0600），然后：

```bash
python3 quota_probe.py --provider workbuddy \
  --workbuddy-token-file ~/.workbuddy-probe.json \
  --workbuddy-host https://www.workbuddy.cn
```

注意：国内版与国际版是两套账号体系，`auth_host` 与计费 `api_host` 也不同
（国内鉴权 `codebuddy.cn`、计费 `workbuddy.cn`；国际统一 `workbuddy.ai`）。
拿错域名会得到 **401 HTML**，脚本会归类为 `auth_expired`。

---

## 5. 生成的文件

```
fixtures/
  claude.20261030T091500Z.json            # 原始返回体（已脱敏）
  claude.20261030T091500Z.snapshot.json   # 归一化后的 QuotaSnapshot
  workbuddy.error.20261030T092000Z.json   # 失败样本也要存，它是错误处理的测试输入
```

可以直接进版本库（不含任何密钥），但建议只提交一份"每天一条"的样本，避免噪音。

---

## 6. 已知限制（诚实清单）

1. **成功分支未验证**：本脚本的 WorkBuddy 登录成功路径、以及 Claude/Codex/Antigravity 的真实返回，
   我这边都没有账号可打——只验证了 WorkBuddy 的 `auth/state`（真实 200）与 `billing` 的 401。
   你第一次跑通后，fixture 就是基线，之后所有解析改动都要对它回归。
2. **Windows 的 Codex keyring 没实现**：Codex 默认把凭据存文件（`%USERPROFILE%\.codex\auth.json`），
   走文件即可；如果用了 keyring 模式，需要先用桌面客户端导出一次。
3. **不刷新 token**：过期就报过期。这是故意的——Claude Code 的 refresh token 是一次性的，
   抢刷新会把用户踢下线。刷新逻辑留给 App 本体，且只在 401/过期时触发。
4. **Gemini 消费级账号必然返回停服**：2026-06-18 起 Google 停掉了个人 / AI Pro / Ultra 的
   Gemini CLI 额度接口，脚本会把 403 `SUBSCRIPTION_REQUIRED` 归类为 `deprecated` 并提示改用 Antigravity。
5. **只探测用量**：不验证历史、燃尽、通知等行为，那些靠 `ai-quota-hud-user-stories.html` 里的故事验收。

---

## 7. 自测（两套）

```bash
python3 quota_probe.py --selftest      # 25 项：解析器 + 状态分类 + 脱敏 + 落盘
python3 test_integration.py            # 14 项：起一个本地 HTTP server 假装上游，跑通整条链路
```

`--selftest` 不需要网络、不需要账号，验证纯函数。
`test_integration.py` 走真实 socket，覆盖：正常返回、401 纯 HTML、429 + Retry-After、
200 但返回 HTML、Gemini 403 停服、fixture 无 token 泄漏、全绿时退出码为 0。

典型成功输出：

```
✔  claude      ok              正常  |  5 小时窗口 25.0% @2026-10-30T15:00:00Z, 7 天窗口 40.0% @...
✔  codex       ok              正常  |  主窗口 6.0% @..., 次窗口 24.0% @...
✔  gemini      ok              正常  |  gemini-2.5-pro 65.0% @..., gemini-2.5-flash 8.0% @?
·  antigravity not_configured  未配置（未找到登录态）  |  未安装 agy CLI
✔  workbuddy   ok              正常  |  积分余量 25.0% @?
```

（上面这组是本地 mock 跑出来的，用来证明输出格式与 fixture 落盘可用；你机器上跑出来的才是真实基线。）
