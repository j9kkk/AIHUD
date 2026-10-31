# 在 macOS 上构建与验证 AI HUD

> 两条路：**A. 本机构建**（需要 Xcode CLT + Rust），**B. GitHub Actions 云构建**（无需本机环境，产出未公证但可直接运行的 `.app`）。
> 本仓的 `src-tauri/` 至今**没有在 macOS 上编译过**——第一次 `cargo check` 的报错属于正常工作量，不是文档错误。

## 1. 前置

| 项 | 版本 | 检查命令 |
| :--- | :--- | :--- |
| macOS | 14.0+（Sonoma） | `sw_vers` |
| Xcode Command Line Tools | 15+ | `xcode-select -p` |
| Rust | 1.77+ | `rustc -V`（`rustup update stable`） |
| Node | 20+ | `node -v` |
| Tauri CLI | 2.x | 已在 `devDependencies`（`npx tauri --version`） |

## 2. 路径 A：本机一键构建

```bash
cd ai-hud
npm ci                          # 含 @tauri-apps/cli
npm run build:ui                # tsc -p ui → ui/dist → 组装 ui/prod（frontendDist）
npx tauri icon assets/icon.png  # 1024px 源图 → src-tauri/icons/{icns,png 套装}
cargo check --manifest-path src-tauri/Cargo.toml --all-targets   # 先只求编译通过
npx tauri build --bundles app --verbose                          # 产物：src-tauri/target/release/bundle/macos/AI HUD.app
```

`ui/prod` 是**打包专用目录**：只含 `index.html`（源自 `ui/app.html`，无调试工具栏）、`styles.css`、`dist/*.js`。`ui/index.html` 是开发调试页（带 L1/L2/设置切换条），不要用它打包。

## 3. 路径 B：GitHub Actions（推荐，无需 macOS）

`.github/workflows/macos.yml` 两个 job：

| job | runner | 做什么 | 预估耗时 |
| :--- | :--- | :--- | :--- |
| `checks` | `ubuntu-latest` | tsc(core+ui)、vitest、凭据扫描、文档一致性 31 项、Rust 结构自检、对比度令牌 | ~2 min |
| `build-macos` | `macos-14` | rustup 双 target → `tauri icon` → `cargo check` → `tauri build --target universal-apple-darwin --bundles app` → Info.plist / lipo / codesign 校验 → 上传 `AI-HUD-macos-universal.zip` | ~10–20 min |

产物是 **ad-hoc 签名**（`bundle.macOS.signingIdentity: "-"`）的 universal `.app`。首次打开需右键 →「打开」，或：

```bash
xattr -dr com.apple.quarantine "AI HUD.app"
```

触发：push 到 `main`、提 PR、或在 Actions 页面点 **Run workflow**。

## 4. 要正式分发才需要的四件套

在仓库 Settings → Secrets 配置后，把最后一步换成带公证的构建：

| Secret | 内容 |
| :--- | :--- |
| `APPLE_CERTIFICATE` | Developer ID Application 证书的 base64（`.p12`） |
| `APPLE_CERTIFICATE_PASSWORD` | 上述 `.p12` 的密码 |
| `APPLE_SIGNING_IDENTITY` | 如 `Developer ID Application: NAME (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 公证账号（`APPLE_PASSWORD` 用 App 专用密码） |

公证改法：`npx tauri build --target universal-apple-darwin --bundles app,dmg`，Tauri 会自动跑 `notarytool`。

## 5. 首次编译预计会撞到的点（预判）

1. **`tauri::Emitter` / `tauri::Manager` trait 不在作用域**：`emit`、`manage`、`get_webview_window`、`tray_by_id` 全部由 trait 提供，漏 import 报「method not found」。本仓已补。
2. **`macos-private-api` feature**：透明无边框窗口需要；App Store 提交受限时可去掉并改不透明背景。
3. **`keyring 3` 的 `apple-native`**：链接 Security.framework；dev 构建可能每次弹钥匙串授权，ad-hoc 重建会重置信任。
4. **`rusqlite bundled`**：本地编译 SQLite，首次约 2–4 分钟。
5. **图标**：`bundle.icon` 指向 `src-tauri/icons/*`，必须先跑 `npx tauri icon`。
6. **universal 构建**：需要 `rustup target add aarch64-apple-darwin x86_64-apple-darwin`，只装默认 target 会失败。

## 6. 编译通过后的冒烟顺序

```bash
# 6.1 壳层 IPC：菜单栏出现 AI HUD，点击托盘弹出 360×480 面板
#     devtools: await window.__TAURI__.core.invoke('health_check')  → "ok"

# 6.2 Keychain 往返：写入 → probe revision 变化 → 删除 → probe 返回 no_entry

# 6.3 白名单：http_request 指向 https://example.com 必须被拒（origin 不在白名单）

# 6.4 领域内核
npm run test            # 288 tests / 19 files
```

## 7. 已知缺口（v0 壳层，不是 bug）

| 缺口 | 现状 | 补法 |
| :--- | :--- | :--- |
| **真实数据接线** | 打包版 `ui/app.html` 调 `health_check` 确认 IPC 存活；视图模型仍回退到内置样例，并显式渲染「样例视图（未连接本机 IPC）」提示条 | 新增 `hud_view_model` 命令：`store_load` 取快照 → core 的 `toChannelGroups/toMenuBarView` 投影 → 返回 VM |
| **NSPanel 非激活面板** | 标准 window + `alwaysOnTop` 近似 | 用 objc2 换成 `NSPanel { nonactivatingPanel }`，避免点击面板抢走前台 App 焦点 |
| **唤醒 / 锁屏事件** | `lifecycle.rs` 60s 心跳近似 | 订阅 `NSWorkspaceDidWakeNotification`、`com.apple.screensaver.didstart` |
| **通知权限** | 首次 `notify_post` 触发系统授权，文案未验证 | 真机验证 + 引导页 |
| **Retina 材质** | WebView 背景 + CSS `backdrop-filter` 近似 | `NSVisualEffectView`（regular material）作为窗口背景层 |
| **公证** | 无 Developer ID | 见 §4 |

## 8. 未验证项（诚实清单）

| 项 | 状态 |
| :--- | :--- |
| `cargo check` / `cargo build` | ❌ 从未执行（开发容器无 rustc） |
| `tauri build` 打包 | ❌ 从未执行 |
| 签名 / 公证 / Gatekeeper | ❌ 未配置（CI 用 ad-hoc） |
| 真机 UI 渲染（材质、字号锐度） | ❌ 仅浏览器近似 |
