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
| `cargo build` / `tauri build` | 容器无 rustc、非 macOS | 在 Mac 上按 `docs/BUILD-macOS.md` 首次构建 |
| 签名 / 公证 / 分发 | 需要 Developer ID | 发布前 |
| NSPanel 非激活面板、NSWorkspace 唤醒事件 | 需要 AppKit 原生类替换 | macOS 实机阶段 |
| 真实端点联调（4 渠道） | 本机无任何登录态；workspace 出网受限 | 有对应账号的机器上跑 `tools/quota_probe.py` |
| 材质在浅色壁纸下的对比度 | 需要实机截图取样 | macOS 实机 + Increase Contrast 开关 |
| 通知授权弹窗文案 | 需要系统首次授权 | 实机首次 `notify_post` |

## 5. 复现方式

```bash
cd /opt/data/ai-hud
bash scripts/verify.sh            # 全量
bash scripts/verify.sh --quick    # 跳过 UI 编译与对比度（约 5s）
python3 scripts/check-rust-shell.py
python3 scripts/status.py         # 重新生成 docs/STATUS.html
```
