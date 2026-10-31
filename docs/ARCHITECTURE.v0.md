# AI HUD (macOS) 统一架构设计与多渠道抽象规范

**软件名称**：`AI HUD`  
**首发平台**：macOS (14.0+ Sonoma / Sequoia 原生沉浸体验)  
**技术底座**：Tauri 2 (Rust 核心调度 + macOS AppKit 系统原语 + WebKit 硬件加速视口)  
**核心定位**：常驻菜单栏与桌面 HUD 的极客级、高安全性多渠道 AI 额度用量感知与预警中枢。

---

## 1. 跨渠道统一抽象内核 (The Core Abstraction Architecture)

不同 AI 渠道的本质差异在于 **【数据源协议不同】**、**【额度模型结构不同】** 与 **【在卡片和详情上的渲染形态不同】**。系统采用“插件化驱动 + 统一归一化数据模型”架构。

### 1.1 核心数据结构归一化 (Domain Entities)

无论上游是 Claude 的双滑动窗口、Gemini 的纯周配额、还是 WorkBuddy 的阶梯扣费积分，统一转换为如下四个不可变 Rust 结构体：

```rust
/// 渠道提供商枚举 (可扩展)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ProviderKind {
    Claude,
    WorkBuddy,
    Codex,
    Gemini,
    Custom(u32),
}

/// 额度形态分类（决定前端卡片选用同心双环、单大环还是积分卡）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MetricVisualKind {
    /// 双滑动窗口 (5h 短效瞬时 + 1w 长效周期)，渲染 Apple Watch 同心双环
    DualSlidingWindow,
    /// 单周期窗口 (无 5h 限制，仅 1w / 1m 恢复)，渲染 52px 单大环
    SinglePeriodicWindow,
    /// 纯数值/积分消耗池 (如 WorkBuddy 4,200/20,000)，渲染积分进度环 + 绝对值
    CreditsBalancePool,
}

/// 单个时间窗口配额
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaWindow {
    pub label: String,             // 如 "5小时限制" / "周度配额"
    pub used_amount: f64,          // 已用量 (Token 或 点数)
    pub total_amount: f64,         // 总额度 (如 500, 或 100.0 代表百分比)
    pub remaining_percent: f64,    // 0.0 ~ 100.0 (严禁越界)
    pub reset_at: Option<i64>,     // 绝对 Unix 时间戳 (秒)
    pub reset_relative: String,    // 相对倒计时，如 "1h04m", "3d"
    pub is_exhausted: bool,        // 是否已撞限流 (remaining == 0)
}

/// 归一化的单账号快照 (Normalized Account Snapshot)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountSnapshot {
    pub account_id: String,        // 本地唯一 UUID
    pub provider: ProviderKind,    // 所属渠道
    pub user_alias: String,        // 用户自定义别名 (如 "💼 工作主力")
    pub real_identifier: String,   // 真实账号/邮箱 (如 "alex@corp.com", 支持脱敏)
    pub organization: Option<String>,
    pub plan_name: String,         // 套餐名 (如 "Max 5x", "Team", "Pro")
    pub visual_kind: MetricVisualKind,
    
    // 窗口数据 (根据 visual_kind 选用)
    pub primary_window: Option<QuotaWindow>,   // 5h 窗口或单主窗口
    pub secondary_window: Option<QuotaWindow>, // 1w 周度窗口 (可选)
    
    // 积分池数据 (WorkBuddy 专用)
    pub credits_pool: Option<CreditsPoolInfo>,
    
    // 状态分类与熔断保护
    pub state: AccountHealthState,
    pub last_synced_at: i64,       // 最后成功同步时间戳
    pub error_message: Option<String>,
    pub retry_after_secs: Option<u32>, // 429 频控退避时长
}

/// 状态枚举 (与安全硬规则严格绑定)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AccountHealthState {
    /// 正常健康 (只有此状态允许渲染纯绿/黄/红彩色百分比)
    Normal,
    /// 网络离线 (展示最后已知快照 + 离线标志，严禁渲染成 0%)
    OfflineStale,
    /// 凭据失效 (401 Unauthorized / Token Expired，独立熔断)
    AuthExpired,
    /// 限流冷却 (429 Rate Limit，严格执行指数退避)
    RateLimited,
    /// 渠道停服 (403 Deprecated，如 Gemini 旧接口退役)
    ServiceDeprecated,
}
```

### 1.2 驱动接口抽象 (The Channel Driver Trait)

每个渠道独立实现 `ChannelDriver` trait，内聚各自的抓包、端点解析、轮询策略与凭据刷新逻辑：

```rust
#[async_trait]
pub trait ChannelDriver: Send + Sync {
    /// 渠道标识
    fn provider(&self) -> ProviderKind;
    
    /// 获取该渠道支持的鉴权模式列表 (OAuth, DeviceCode, APIKey, SessionCookie)
    fn supported_auth_flows(&self) -> Vec<AuthFlowType>;
    
    /// 执行一次只读用量探活
    async fn fetch_snapshot(&self, credential: &SecureCredential) -> Result<AccountSnapshot, DriverError>;
    
    /// 尝试静默刷新 Token (永不提前刷新可用 Token，仅在 401 或确知过期时触发)
    async fn refresh_token(&self, credential: &mut SecureCredential) -> Result<bool, DriverError>;
}
```

---

## 2. 四大首发渠道差异化适配矩阵

| 渠道 Provider | 数据协议与端点来源 | 额度模型差异 | L1 菜单栏映射 | L2 一级卡片展示形态 | L2 二级详情页深度数据 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Claude** (Anthropic) | OAuth 网页登录换取 Bearer Token，探针调 `usage` 接口 | **双滑动窗口**：5h 瞬时请求池 + 7d 周期总额度 | 显示 5h 剩余最低百分比及彩色环 | **Apple Watch 52px 同心双环**：外环 5h、内环 1w，双行绝对不换行槽 | 74px 大双环、Token 实际消耗量 (如 `45/500`)、Sonnet/Opus 比例、24h 限流热力图 |
| **WorkBuddy** | 国内/国际双站点、设备配对码换 Token，积分查询端点 | **积分扣费池**：无固定时间窗口，按对话/代码消耗积分 | 积分耗尽比例映射为单环百分比 | **48px 单周大环** (3.8px 描边) + 右侧 `15.2k/2w` 积分大字 | 剩余积分、历史充值包、每日点数扣费走势、国内外环境切点标识 |
| **Codex / ChatGPT** | Session Token / OAuth，ChatGPT backend usage | **动态窗口**：按模型分别限额 (GPT-4o 3h窗口 + o1 周限额) | 提取当前最紧张模型的最低百分比 | **52px 同心双环** (主模型 3h 限额 + 周期限额) | 区分 o1 / GPT-4o 单独额度柱状对比、预计恢复钟点 |
| **Gemini** | Antigravity 插件 / CLI 凭据 Cookie 探活 (防旧接口 403) | **单周期配额**：无 5h 限制，按日/周更新 | 呈现周度剩余百分比 | **48px 单周大环** + 首行灰色占位 `5h：无限制`，第二行展开周额度 | 区分 Pro / Flash 配额、API 调用成功率与限流冷却时间 |

---

## 3. 全量端到端操作流与边界条件状态机

整个系统围绕 **6 大业务阶段** 形成不可被阻断的体验闭环：

```
[阶段 1: 首次启动与零配置] ──> [阶段 2: 渠道账号添加与授权] ──> [阶段 3: 一级面板日常感知]
          │                                 │                               │
          v                                 v                               v
    (空状态引导)                      (Keychain加密)                  (同心环双列流)
                                            │                               │
          ┌─────────────────────────────────┴───────────────────────────────┤
          │                                                                 │
          v                                                                 v
[阶段 4: 异常边界与自动熔断] ◄────────────────────────────────── [阶段 5: 二级全屏滑入详情]
  • 离线 (保留最后快照+时间戳)                                        • 真实邮箱/组织透视
  • 401 (单账号熔断+重登入口)                                        • 74px 苹果大环
  • 429 (Retry-After指数退避)                                        • 24h 调用热力图
  • 停服 (403 明确退役指引)                                          • 别名原地重命名
          │
          v
[阶段 6: 偏好设置与多账号管理]
  • 账号拖拽排序 (⠿)、账号隐藏防臃肿
  • ≤20% 系统通知告警、开机自启、全局快捷键
```

### 3.1 关键边界条件逻辑规则表 (Boundary Rules)

1. **绝对禁止伪造 0% 或 100%**：遇到网络断开、超时或上游接口不可解析时，必须进入 `OfflineStale` 状态，页面强制标注“最后已知快照 (12:30)”及离线图标；
2. **故障隔离（独立熔断）**：单个账号报错或会话失效，其影响作用域仅限于该账号对应卡片及菜单栏最低值权重剔除，绝不可中断其他正常账号的后台轮询；
3. **频控退避（Rate-limit Compliance）**：上游返回 HTTP 429 时，必须解析 `Retry-After` 标头（默认 60s），UI 显示冷却倒计时，调度器在该时间段内挂起该账号请求；
4. **安全凭据硬件级隔离**：OAuth Refresh Token 和 API Key 强制通过 macOS `Security.framework` 存入操作系统级钥匙串 (Keychain)，内存中仅在使用时刻短暂解密，杜绝一切明文落盘。

---

## 4. 原型系统设计与 Apple 设计规范映射

全套原型实现于独立的交互式原生标准文档 `ai-quota-hud-complete-flow.html` 中，严格遵循 Apple HIG：
* **材质**：macOS 原生 `regular` 材质，高斯模糊模糊半径 28px，边框为 0.5pt 发光内线；
* **排版**：数字一律采用 `SF Pro Rounded` 并锁定 `tabular-nums`，辅助文字严格保持在 9.5–10pt；
* **层级转场**：一级主面板向二级详情页推进采用 Apple 官方 `cubic-bezier(0.16, 1, 0.3, 1)` 280ms 弹性滑入，支持触控板边缘右滑及 Esc 物理键极速返回。
