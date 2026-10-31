# AI HUD

常驻 macOS 菜单栏 / 桌面 HUD 的多渠道 AI 额度感知与预警工具。

- 设计文档：`docs/`
- 交互原型：`prototype/`
- 领域内核（渠道抽象 / 状态机 / 熔断）：`core/`
- 界面层：`ui/`
- Tauri 2 外壳：`src-tauri/`

## 本机验证

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck # 或 npx tsc --noEmit

# 单元测试
npm test -- --passWithNoTests # 或 npx vitest run --passWithNoTests
```
