# mvp — AI HUD 菜单栏 App

Swift Package，三个 target：

| target | 职责 |
|---|---|
| `HUDCore` | 领域模型、三渠道取数、凭据（钥匙串）、本地存储 |
| `HUDKit` | 面板外壳：状态栏图标、窗口锚定、阴影、高度动画、样式令牌与绘制原语、数值补间 |
| `AIHUD` | 唯一的交付 App：界面与交互 |

## 目录

```text
Sources/
  HUDCore/
    Model.swift          账号元信息 / 额度窗口 / 状态 / 读取结果
    HUD.swift            取数入口 live() / demo() / demoIssue() + 日志
    Support.swift        日志、白名单 HTTP、解析辅助、脱敏
    Auth.swift           PKCE、凭据结构、钥匙串读写
    Store.swift          账号与最后读数（不含密钥）
    Providers/           Shared 公共类型 + Claude / Codex / WorkBuddy / Fetch
  HUDKit/
    AppShell.swift       NSApplication 装配、状态栏、菜单、刷新、登录
    PanelLayout.swift    唯一布局入口 place()：四层同源、高度动画、阴影路径
    PanelProbes.swift    验收探针（GEOM / SWITCH / TRACK / ANIM / GROW）
    HUDScreen.swift      屏幕协议 + BaseScreen（字体平滑、ticker）
    Style.swift          颜色与字号令牌
    Drawing.swift        drawText / drawBar / drawRing / drawHairline / drawSymbol
    Formatting.swift     倒计时与 meta 文案
    ValueTween.swift     数值补间（值 + 旧字/新字过渡）
    Motion.swift         出现动画、缓动曲线、Reduce Motion 判定
  AIHUD/
    main.swift           AppShell { PanelScreen() }.run()
    PanelScreen.swift    状态、高度、命中测试、绘制分发
    Chrome.swift         标题行、视图分段控件、底部命令、空状态
    OverviewList.swift   一级 · 列表
    OverviewGrid.swift   一级 · 圆环
    OverviewModules.swift 一级 · 模块
    DetailTimeline.swift 二级 · 时间轴详情
scripts/bundle.sh        打包 build/AIHUD.app（ad-hoc 签名 + build 戳）
```

## 命名约定

- 类型 `PascalCase`，文件名 = 文件内主类型名（`AppShell.swift` / `PanelScreen.swift`）。
- 扩展拆分时文件名用「对象 + 用途」：`Overview*.swift`（一级视图）、`Detail*.swift`（二级）。
- 环境变量统一 `AIHUD_` 前缀；UserDefaults 键统一 `AIHUD.` 前缀。
- 尺寸常量集中在 `PanelScreen.Metrics`，颜色与字号集中在 `Style.swift`，两处之外不写魔数。

## 构建 / 运行 / 验收

```bash
swift build
AIHUD_DEMO=1 .build/debug/AIHUD            # 演示数据
AIHUD_DEMO=1 AIHUD_VIEW=2 AIHUD_OPEN=1 .build/debug/AIHUD   # 模块视图
./scripts/bundle.sh                        # → build/AIHUD.app（必须先跑这个再交付）
```

回归（任一非 0/非预期都算失败）：

```bash
AIHUD_DEMO=1     AIHUD_GEOM_TEST=8 .build/debug/AIHUD   # topSpread=0.00 rightSpread=0.00 offscreen=0
AIHUD_DEMO=issue AIHUD_GEOM_TEST=8 .build/debug/AIHUD   # 同上，含失效账号
AIHUD_DEMO=issue AIHUD_SWITCH_TEST=1 .build/debug/AIHUD # effectH == contentH == want
AIHUD_DEMO=1     AIHUD_TRACK=1 AIHUD_SWITCH_LIVE=1 .build/debug/AIHUD
# TRACK 采样里必须满足：panelTop 恒定、contentTop 恒定、shadowY − effectY == 0
```

离屏出图（不依赖屏幕是否唤醒）：

```bash
AIHUD_DEMO=1 AIHUD_VIEW=2 AIHUD_SNAPSHOT=/tmp/modules.png .build/debug/AIHUD
```

## 约束

- 本机只有 Command Line Tools 时 SwiftUI 宏编译不过，界面全部 AppKit 手绘（`BaseScreen` 负责关字体加粗平滑）。
- 面板换页**不做内容转场**：内容瞬时替换，只做高度伸缩。理由见 `../docs/reboot/explore/POSTMORTEM-MOTION.md`。
- 明文凭据不进 UI、不进日志；HTTP 只走白名单域名。
