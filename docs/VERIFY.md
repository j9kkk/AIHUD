# 验证报告（VERIFY）

> 生成于 2026-10-31 02:25 · 命令：`bash scripts/verify.sh`
> 本文件里的每个数字都来自真实命令输出，未执行的项一律标 ❌。

## 1. 一键验证结果

```
== AI HUD 验证 ==
root: /opt/data/ai-hud

✓ core 类型检查 (tsc -p core)
✓ ui 类型检查 (tsc -p ui)

✓ core 测试：Tests  222 passed (222)

✓ 凭据零明文 (tests/security-scan.sh)
✓ 对比度与字号 (tests/contrast-sweep.mjs)

✓ Rust 壳层结构 (scripts/check-rust-shell.py)

== 汇总 ==
✓ core 类型检查 (tsc -p core)
✓ ui 类型检查 (tsc -p ui)
✓ core 测试
✓ 凭据零明文 (tests/security-scan.sh)
✓ 对比度与字号 (tests/contrast-sweep.mjs)
✓ Rust 壳层结构 (scripts/check-rust-shell.py)

通过 6 / 失败 0

未验证项（本环境无法执行，不计入失败）：
  · src-tauri 的 cargo build / 签名 / 公证（容器无 rustc、非 macOS）
  · 真实端点联调（本机无任何渠道登录态，fixtures 为脱敏构造样本）
  · 材质在浅色壁纸下的对比度（需 macOS 实机截图取样）
```

**结论：6 项通过 / 0 项失败（exit 0）。**

## 2. 逐项说明

| # | 检查项 | 命令 | 判据 | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 领域内核类型 | `tsc -p core --noEmit` | 退出 0，strict + exactOptionalPropertyTypes | ✅ |
| 2 | 渲染层类型 | `tsc -p ui --noEmit` | 退出 0 | ✅ |
| 3 | 单元测试 | `vitest run --root core` | 16 个 spec 文件 / 222 个用例全绿 | ✅ 222 passed |
| 4 | 凭据零明文 | `bash tests/security-scan.sh` | 7 条密钥正则 × 8 个目录，0 命中 | ✅ |
| 5 | 对比度与字号 | `node tests/contrast-sweep.mjs` | 文本令牌 ≥4.5:1，字号 ≥9.5px | ✅ |
| 6 | Rust 壳层结构 | `python3 scripts/check-rust-shell.py` | 括号平衡 / 跨模块引用 / 13 条 IPC 对齐 / 5 origin 白名单 / 0 明文返回 | ✅ |

## 3. 其它已实测（不在 verify.sh 内，但同样真实执行过）

| 项 | 方法 | 实测结果 |
| :--- | :--- | :--- |
| 原型屏数 | `grep -c '<section class="screen"'` | **44 屏**（P1 4 / P2 9 / P3 6 / P4 5 / P5 12 / P6 8） |
| 原型边界覆盖 | `data-covers` 去重 | **E01–E32 = 32/32** |
| 原型文本裁切 | 无头 Chromium：`scrollWidth > clientWidth+1` | **0 处**（修复前 13 处 `.pct` + 2 处 `.card-foot`） |
| 原型图例重叠 | 同级文本矩形相交 > 2×2px | **0 对**（修复前 4 对） |
| 原型无障碍 | DOM 计数 | role **216** / aria-label **159** / tabindex **221** / `:focus-visible` 存在 |
| 渲染层实跑 | 本地 8849 端口 + 无头浏览器 | 9 卡片 / 24 环形 SVG / 7 状态全覆盖；61 个文本节点 0 处 <4.5:1；最小字号 10px |
| 面板宽度口径 | 浏览器实测 | 360 CSS px（1pt = 1px），与 ARCHITECTURE 一致 |

## 4. 未验证项（能力边界，不计入失败）

| 项 | 原因 | 何时能验 |
| :--- | :--- | :--- |
| 公证 / 分发 | 需要 Developer ID 证书 | 配置 §4 四个 secret |
| 签名 / 公证 / 分发 | 需要 Developer ID | 发布前 |
| NSPanel 非激活面板、NSWorkspace 唤醒事件 | 需要 AppKit 原生类替换 | macOS 实机阶段 |
| 真实端点联调（4 渠道） | 本机无任何登录态；workspace 出网受限 | 有对应账号的机器上跑 `tools/quota_probe.py` |
| 材质在浅色壁纸下的对比度 | 需要实机截图取样 | macOS 实机 + Increase Contrast 开关 |
| 通知授权弹窗文案 | 需要系统首次授权 | 实机首次 `notify_post` |


## 6. CI 实测（GitHub Actions，2026-10-31）

仓库：[`j9kkk/AIHUD`](https://github.com/j9kkk/AIHUD) · 工作流：[`macOS Build`](https://github.com/j9kkk/AIHUD/actions/workflows/macos.yml)
镜像：`macos-14-arm64`（macOS 14.8.9，runner 2.338.2）

| 阶段 | 结果 | 真实输出 |
| :--- | :--- | :--- |
| `checks`（ubuntu-latest） | ✅ 10/10 步骤 | tsc(core+ui) / vitest 288 / 凭据扫描 / 文档 31 项 / Rust 结构 / 对比度 全绿 |
| Rust 工具链 | ✅ | stable + `aarch64-apple-darwin`、`x86_64-apple-darwin` |
| `tauri icon` | ✅ | 1024px → `src-tauri/icons/{32x32,128x128,128x128@2x}.png + icon.icns` |
| `cargo check --all-targets` | ✅ | **0 error / 0 warning**——手写的 11 个壳层模块一次编译通过 |
| `tauri build --target universal-apple-darwin` | ✅ | `Bundling [tauri_bundler::bundle::macos::app] AI HUD.app` |
| 架构 | ✅ | `lipo -info` → `x86_64 arm64` |
| 签名 | ✅ | `Signature=adhoc`、`TeamIdentifier=not set`（预期：无 Developer ID） |
| Info.plist | ✅ | `CFBundleIdentifier=app.aihud.desktop`、`LSMinimumSystemVersion=14.0` |
| 体积 | ✅ | `.app` **18 MB**；`AI-HUD-macos-universal.zip` **8.5 MB** |

**结论：`src-tauri/` 不再是"未编译的代码"** —— 它已经在 macOS 14 上编译、打包、ad-hoc 签名并产出 universal 应用。仍未验证的是**运行行为**（托盘交互、面板定位、Keychain 授权弹窗、通知权限），那需要人坐在 Mac 前面点。

### 6.1 由于网络限制采用的发布方式

开发容器到 `github.com:443`（网页 + git 传输）不可达，只有 `api.github.com` 可用。因此本仓通过 Git Data API 发布（`scripts/publish-api.py`：blob → tree → commit → ref），效果与 `git push` 等价。
注意：**空仓库**直接调 blob 接口会返回 `409 Git Repository is empty`，脚本会先用 Contents API 播种一个 README 提交再继续。

## 7. 复现方式

```bash
cd /opt/data/ai-hud
bash scripts/verify.sh            # 全量
bash scripts/verify.sh --quick    # 跳过 UI 编译与对比度（约 5s）
python3 scripts/check-rust-shell.py
python3 scripts/status.py         # 重新生成 docs/STATUS.html
```
