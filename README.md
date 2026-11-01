# AI HUD

> 常驻 macOS 菜单栏的多渠道 AI 额度 HUD —— 一个环看余额，点一下看全部。
> 当前实现：**Swift / AppKit 原生**（`mvp/`），覆盖 Claude / Codex / WorkBuddy 三个渠道。

## 它解决什么

同时订阅多个 AI 编码渠道时，额度是分散的：Claude 有 5 小时 + 周双窗口，Codex 是周窗口，WorkBuddy 是积分池。
你不该为了看一眼「还剩多少」去开三个网页。

AI HUD 把这件事收成一个 352pt 的菜单栏面板：

- **菜单栏**：一个小圆环 + 数字 = 当前**剩余最少**的账号；低于 20% 数字转红加粗；需要重新授权时显示 `!`。
- **面板一级**：三种展示方式，右上角分段控件切换（记住选择）
  - **列表**：每行 账号 / 套餐、重置倒计时、右对齐百分比、24pt 小圆环
  - **圆环**：4 列圆环磁贴，系统小组件风格
  - **模块**：最紧张账号通栏 + 其余两列卡片（容量条）
- **面板二级**：统一的时间轴详情——倒计时列、竖轨 + 圆点、窗口名、17pt 数值、容量条、重置说明。
- **不打扰**：点图标展开 / 再点收起、Esc 收起、失焦收起、Reduce Motion 降级。

## 三条硬规则（不可协商）

1. **只有「正常」状态才显示百分比**，其余状态显示状态文案，绝不渲染成 `0%` 或 `100%`。
2. **明文凭据不进 UI、不进日志**；HTTP 只走白名单域名；本地库不存密钥。
3. **单个渠道故障不影响其他渠道**：每个渠道独立取数、独立失败。

## 目录

```text
mvp/           当前实现（SwiftPM）
  Sources/HUDCore/   模型、三渠道取数（Providers/）、凭据、存储
  Sources/HUDKit/    面板外壳（AppShell / PanelLayout / PanelProbes）、样式与绘制、补间
  Sources/AIHUD/     界面：PanelScreen + 列表 / 圆环 / 模块 + 时间轴详情
  scripts/bundle.sh  打包成 mvp/build/AIHUD.app（ad-hoc 签名 + build 戳）
slice/         真实数据垂直切片：命令行登录 / 取数，凭据存自己的钥匙串
tools/         渠道端点探针（只读、脱敏）
docs/reboot/   产品规格、决策、风险、原型、验收与复盘
  explore/p11.html p12.html       已验收原型（measure-*.json 为逐元素实测）
  explore/MVP-ACCEPTANCE.md       逐轮验收记录（含每次缺陷的根因）
  explore/POSTMORTEM-MOTION.md    动效 / 几何问题复盘
scripts/push.sh 推送到 GitHub（PAT 不落盘）
```

## 构建与运行

```bash
cd mvp
swift build                 # 编译，约 2 秒
./scripts/bundle.sh         # 打包 → build/AIHUD.app，并打印 build 戳
open build/AIHUD.app
```

支持 macOS 14+。本机若只有 Command Line Tools（无 Xcode），SwiftUI 宏编译不过，本实现全部用 AppKit 手绘。

## 验收开关（环境变量）

```text
AIHUD_DEMO=1|issue     演示数据 / 含失效账号的演示数据
AIHUD_OPEN=1           启动即展开面板
AIHUD_VIEW=0|1|2       列表 / 圆环 / 模块
AIHUD_SELECT=<n>       直接进第 n 个账号的详情
AIHUD_SNAPSHOT=<png>   离屏渲染成图（不依赖屏幕，可后台跑）
AIHUD_GEOM_TEST=<n>    n 轮开关 + 切页，断言顶边 / 右边缘离散度为 0
AIHUD_SWITCH_TEST=1    打印每次切页后的面板 / 材质 / 内容几何
AIHUD_TRACK=1          120Hz 采样面板 / 内容 / 阴影矩形，验证动效不变量
```

验收标准与历史缺陷根因见 `docs/reboot/explore/MVP-ACCEPTANCE.md`。

## 历史

`v0` 是 Tauri 2 + TypeScript 实现（托盘、44 屏原型、DSL 契约），已从工作区移除，保留在 git 历史里：
`git checkout 3460ccc -- core ui src-tauri prototype` 可取回。原生重写的第一版（`macos/`）源码存档在
`~/Desktop/work/AIHUD-archive/macos-v1-sources-20261102.tar.gz`。

## 许可

MIT
