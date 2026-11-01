# 参考实现对照（源码级，2026-10-31 拉取）

本地副本在 `/Users/joker/Desktop/work/.refs/`：
- `router-for-me/CLIProxyAPI`（Go）
- `3304711297/workbuddy2api`、`hawklithm/workbuddy2api`（Python）
- `steipete/CodexBar`（Swift）

结论：**三渠道“独立授权 + 长期保活”都有生产级参考实现**，不需要靠挂机来证明可行。要验证的只剩一件事：我们的实现**和参考实现的协议一致**（见 RISKS.md）。

---

## 1. Claude（参考 CLIProxyAPI `internal/auth/claude/anthropic_auth.go`）

| 项 | 参考实现 | 上一轮实现 | 要改 |
|---|---|---|---|
| 授权回调 | **本机回调** `http://localhost:54545/callback`，浏览器授权后自动回到本机 | 粘贴授权码（走 `platform.claude.com` 回调页） | ✅ 改为本机回调，去掉粘贴步骤（直接消除上一轮“填码后卡住”这一类问题） |
| scope | `user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` | 未对齐 | ✅ 对齐 |
| token 端点 | `POST platform.claude.com/v1/oauth/token`，JSON 请求体 | 相同 | — |
| 请求头 | `User-Agent: axios/1.15.2`、`Connection: close` 等 axios 形态的请求头 | `AIHUD/0.4` | ✅ 对齐（UA 不同可能是上一轮触发 429 的原因之一，**未证实**） |
| 续期时机 | 到期前 **4 小时** 主动续期（`RefreshLead = 4h`） | 临近过期才续 | ✅ 对齐 |
| 并发 | 同一个 refresh_token 走 **single-flight**，同一时间只有一个续期请求 | 每个账号一个 actor，串行 | 等价 |
| 429 | 读取 `Retry-After` / `Retry-After-Ms`，限制在 5 秒～5 分钟之间；在此期间**屏蔽这个 refresh_token** | 无 | ✅ 照抄 |
| 网络错误 | **不重试**。refresh token 是一次性的，响应丢失时服务端可能已经消费了它，重试会变成 invalid_grant | 会重试 | ✅ 照抄（这是“掉线”的典型成因） |
| 等级 | 授权响应里带 account；另查 `/api/oauth/profile` | 相同 | — |

## 2. Codex（参考 CLIProxyAPI `internal/auth/codex/openai_auth.go`）

| 项 | 参考实现 | 要改 |
|---|---|---|
| 回调 | `http://localhost:1455/auth/callback`（与上一轮相同） | — |
| 续期 | `POST auth.openai.com/oauth/token`，**form-urlencoded**，`scope=openid profile email` | 核对 |
| 续期时机 | access token 名义有效期约 10 天；**提前 96 小时**续期（`CodexOuterRefreshLead`） | ✅ 对齐 |
| 不可重试的错误 | `refresh_token_reused / expired / invalidated`、`token_revoked`、`invalid_grant`、`invalid_client`、401 → 直接判为“需重新授权”，**不要反复重试** | ✅ 照抄 |
| 并发 | single-flight | 等价 |

## 3. WorkBuddy（参考 workbuddy2api `converter.py`、`token_refresher.py`）

| 项 | 参考实现 | 要改 |
|---|---|---|
| 续期 | `POST copilot.tencent.com/v2/plugin/auth/token/refresh`，请求头带 `X-Refresh-Token`、`X-Auth-Refresh-Source: plugin` 和全套身份头（X-User-Id、X-Enterprise-Id、X-Tenant-Id、X-Domain） | 补齐 X-Enterprise-Id 和 X-Tenant-Id |
| 续期时机 | 每 **5 分钟**巡检；`expiresAt` **或** `refreshExpiresAt` 任意一个在 **30 分钟**内到期，就续期 | ✅ 照抄。上一轮只看了 access token；refresh token 自己的过期时间也必须监控，否则会“突然掉线” |
| 新 token | 后端没直接给 `expiresAt` / `refreshExpiresAt` 时，用 `expiresIn` / `refreshExpiresIn` 推算 | ✅ 照抄 |
| 风控头 | `X-Device-Token`（Turing Shield），拿不到就不带 | v1 不带，作为已知风险记录 |

## 4. CodexBar（技术栈与界面对标）

| 项 | CodexBar 的做法 | 我们采用 |
|---|---|---|
| 工程 | SwiftPM，swift-tools 6.2，**Swift 6 严格并发**，最低 macOS 14 | 相同 |
| 模块 | `Core`（取数和解析，无 UI）/ `App`（状态和 UI）/ `CLI`（命令行，共用 Core） | 相同的三层；CLI 用来做协议验证和排障 |
| 入口 | SwiftUI `App` 只负责保活和 Settings 场景；`AppDelegate` 创建 `NSStatusItem` | 相同 |
| 菜单栏 | `NSStatusItem` + 18×18 模板图；需要颜色时改用 attributed 文本渲染 | 相同（满足你选的“红字加粗”告警） |
| 下拉 | **原生 `NSMenu`**，账号卡片是 `NSMenuItem.view = NSHostingView(SwiftUI)`；收起、材质、高亮、键盘操作都由系统负责 | 相同 |
| 设置 | SwiftUI `Settings` 窗口，侧边栏 + 分栏 | 相同，但只保留 4 个面板 |
| 依赖 | Sparkle、KeyboardShortcuts 等 | v1 **零三方依赖** |
| 多账号 | Claude 的多账号依赖外部工具 `claude-swap`，**不自己存 OAuth** | 我们自己存（这是和 CodexBar 的主要区别，所以授权部分参考 CLIProxyAPI） |

> CodexBar 自己的说明里写着：之所以不自己存 Claude OAuth，是为了“不做第二个凭据库”（docs/claude-multi-account-and-status-items.md）。我们的需求恰好相反，所以**授权层抄 CLIProxyAPI，UI 层抄 CodexBar**。
