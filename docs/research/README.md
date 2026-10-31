# 研究阶段产物（provenance）

这三个文件是 AI HUD 立项阶段的原始交付物，保留它们是为了让后面的每个设计决定都可追溯——不是装饰。

| 文件 | 内容 | 与实现的关系 |
| :--- | :--- | :--- |
| `feasibility-report.html` | 可行性调研：Claude Code / Codex / WorkBuddy / Gemini 的额度端点实测、iOS 与 Android 常驻能力的平台约束、两个 MIT 桌面先例（CodexBar、OpenTokenUsage）、技术栈体积实测（PyInstaller 9.6 MiB / PySide6 161 MB / Tauri 估算） | 决定了 **Tauri 2**、**桌面优先**、**WorkBuddy 进 P0** |
| `user-stories.html` | **32 条用户故事 / 50 个边界条件 / 32 格状态矩阵 / 12 条体验闭环** | 后续 `docs/FLOWS.md`（8 flows / 32 边界 / 50 屏）与 `docs/SPEC.md` 的故事编号均由此收敛而来 |
| `architecture.svg` | 第一版分层架构图（渠道插件、调度、投影、壳层四层） | 与 `docs/ARCHITECTURE.md` 的章节结构一一对应 |

时间线：这三个文件早于 `docs/ARCHITECTURE.md`。若两者冲突，**以 `docs/` 为准**（`docs/ARCHITECTURE.md` 第 0 章声明了权威链：SPEC > ARCHITECTURE > FLOWS > PROTOTYPE-SPEC）。

原型生成器在 `prototype/builders/`：
- `build_quota_v10.py` — HIG 材质融合版（面板 360pt、同心双环 52px、Apple Watch 工艺）
- `build_quota_v11.py` — 双层 Push-Navigation（一级只显别名，点卡片整面板滑入详情）
- `build_quota_v12.py` — 全流程与边界（首启、OAuth、设备码、异常矩阵、偏好管理）

这三版对应的 HTML 已归档为 `prototype/reference-v10|v11|v12.html`。
