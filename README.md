# AI HUD

> 常驻 macOS 菜单栏的多渠道 AI 额度 HUD —— 一个环看余额，点一下看全部。
> 渠道可插拔：Claude / Codex / WorkBuddy / Gemini / 自定义网关。

[![macOS Build](https://github.com/j9kkk/AIHUD/actions/workflows/macos.yml/badge.svg)](https://github.com/j9kkk/AIHUD/actions/workflows/macos.yml)

## 它解决什么

同时订阅多个 AI 编码渠道时，额度是分散的：Claude 有 5h + 周双窗口，Codex 有滚动窗口和赠送点数，WorkBuddy 是积分池，Gemini 是单周期。你不该为了看一眼"还剩多少"去开四个网页。

AI HUD 把这件事收成一个 360pt 的菜单栏面板：

- **L1 菜单栏**：一个圆环 + 数字 = 当前**剩余最少**的账号；异常用形状区分（虚线、斜杠、`!`），不靠颜色猜。
- **L2 面板**：按渠道分组、组内按剩余升序；每张卡片一个同心双环（外环短窗口 / 内环长窗口）。
- **L3 详情**：点卡片整面板滑入，展示真实登录账号、绝对用量、24h 调用热力图、模型配额分布。
- **不打扰**：失焦自动收起、支持暂停轮询、隐藏账号、Reduce Motion 降级。

## 三条硬规则（不可协商）

1. **只有「正常」状态才显示百分比**；其余六种状态显示「状态文案 + 最后已知值 + 时间戳」。
2. **绝不把「读不到」渲染成 0% 或 100%** —— 类型层 `number | null`，禁止 `?? 0` 兜底。
3. **单个渠道故障不影响其他渠道** —— 每渠道独立熔断、独立退避、独立 fixture。

## 目录

```text
docs/         架构、流程（8 flows / 32 边界 / 50 屏）、实现规格（S01–S16）、审计与验证报告
prototype/    44 屏可视化原型（单 HTML，直接浏览器打开）
core/         TypeScript 领域内核：渠道驱动、状态机、调度与熔断、投影（288 测试）
ui/           渲染层：卡片、同心环、详情页、设置（无框架，原生 TS + SVG）
src-tauri/    Tauri 2 壳：托盘、无边框面板、Keychain、白名单 HTTP、CLI 桥、SQLite
tools/        端点探针：只读探测四渠道额度接口，全程脱敏（25 项自检 + 14 项集成测试）
.github/      macOS CI：检查 + universal .app/.dmg 打包 + 自动 Release
```

## 构建

```bash
npm ci
npm run build:ui                     # ui/dist + ui/prod
npx tauri icon assets/icon.png       # 生成 icns / png 套装
npx tauri build --bundles app        # 需要 macOS + Xcode CLT + Rust
```

没有 Mac 也可以用 CI：push 到 `main` 或在 Actions 页点 **Run workflow**，产物是 ad-hoc 签名的 universal `AI HUD.app`（arm64 + x86_64），从 Artifacts 下载 `AI-HUD-macos-universal.zip`。

首次打开（未公证），右键 →「打开」，或：

```bash
xattr -dr com.apple.quarantine "AI HUD.app"
```

详细说明与已知缺口见 [`docs/BUILD-macOS.md`](docs/BUILD-macOS.md)。

## 验证

```bash
npm test                 # 288 个用例 / 19 个 spec
bash scripts/verify.sh   # 7 项：类型、测试、凭据扫描、对比度、Rust 结构、文档一致性

# 端点探针（不需要 App，也不需要登录态即可跑自检）
python3 tools/quota_probe.py --selftest     # 25 项：脱敏、状态分类、fixture 固化
python3 tools/test_integration.py           # 14 项：本地冒充四个上游，覆盖 401/429/403/HTML
```

## 文档索引

| 文件 | 内容 |
| :--- | :--- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 领域模型、`ChannelDriver` 契约、四渠道差异矩阵、7 状态熔断机、IPC 表 |
| [`docs/FLOWS.md`](docs/FLOWS.md) | 8 条主流程、32 个边界条件、50 屏交互注册表 |
| [`docs/SPEC.md`](docs/SPEC.md) | 16 个实现切片 + 自定义渠道配置格式 + 实现状态 |
| [`prototype/ai-hud-prototype.html`](prototype/ai-hud-prototype.html) | 44 屏原型（含状态矩阵与异常路径） |
| [`prototype/builders/`](prototype/builders/) | v10/v11/v12 原型生成器（HIG 材质 / 双层导航 / 全流程） |
| [`docs/research/`](docs/research/) | 立项三件套：可行性报告、32 故事 50 边界、首版架构图 |
| [`docs/VERIFY.md`](docs/VERIFY.md) | 验证报告（真实命令输出 + 未验证项清单） |
| [`docs/BUILD-macOS.md`](docs/BUILD-macOS.md) | 构建、公证、冒烟顺序、已知缺口 |

## 许可

MIT
