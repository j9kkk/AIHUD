/**
 * AI HUD 统一领域模型 (Pure Domain Layer)
 * 契约规范：docs/ARCHITECTURE.md（第 3 章领域模型、第 0 章不变式）与 docs/FLOWS.md（第 12 章）
 *
 * 核心设计约束：
 * 1. 所有接口/类型均为不可变 `readonly`。
 * 2. 字段名统一 `snake_case`（与 Rust serde 同构，免跨语言命名重写）。
 * 3. 缺失数值必须为 `number | null`，严格禁止 `0` 兜底（永不使用 `?? 0`）。
 */

/** 时间戳：Unix 纪元毫秒（UTC） */
export type EpochMillis = number;

// ==========================================
// 1. 渠道类型 (ProviderKind)
// ==========================================

/** 内置渠道字面量：可穷尽 switch，新增渠道必须改这里才会编译报错 */
export type BuiltinProviderKind = 'claude' | 'codex' | 'workbuddy' | 'gemini';

/** 对外渠道标识：内置 + 插件扩展位（模板字面量，序列化为字符串） */
export type ProviderKind = BuiltinProviderKind | `custom.${string}`;

/** 渠道站点范围：仅 workbuddy 允许 cn/intl 双站点，其余渠道必须为 global */
export type RegionScope = 'global' | 'cn' | 'intl';

// ==========================================
// 2. 视觉形态 (MetricVisualKind)
// ==========================================

/** 额度指标视觉形态枚举 */
export type MetricVisualKind =
  | 'dual_sliding_window'    // 双滑动窗口：外环短窗 + 内环长窗（同心双环 52px）
  | 'single_periodic_window' // 单周期窗口：单大环（48px）
  | 'credits_pool';          // 积分池：积分环（48px）+ 绝对值

// ==========================================
// 3. 窗口模型 (QuotaWindow)
// ==========================================

/** 窗口作用域：账号级全局或特定模型级 */
export type WindowScope =
  | 'account'
  | { readonly model: string };

/** 绝对量单位 */
export type AmountUnit = 'percent' | 'tokens' | 'requests' | 'credits';

/** 绝对用量；服务端只给百分比时 used/limit 均为 null（禁止臆造 token 数） */
export interface WindowAmount {
  /** 用量单位 */
  readonly unit: AmountUnit;
  /** 已用量；未知时为 null */
  readonly used: number | null;
  /** 配额上限；未知时为 null */
  readonly limit: number | null;
}

/** 读数可信度分类 */
export type ReadingQuality = 'exact' | 'derived' | 'clamped';

/** 单个配额时间窗口 */
export interface QuotaWindow {
  /** 稳定标识，用于跨次比对与通知去重：'five_hour' | 'seven_day' | 'model:gpt-5-codex:primary' */
  readonly id: string;
  /** 中文展示标签：如 '5 小时窗口' / '周窗口' */
  readonly label: string;
  /** 作用域：账号全局或针对特定模型 */
  readonly scope: WindowScope;
  /** 窗口时长（秒）：18000 / 604800 / 86400；未知或无固定时长则为 null */
  readonly duration_secs: number | null;
  /** 剩余比例，闭区间 [0, 1]，环视觉的唯一数值输入 */
  readonly remaining_ratio: number;
  /** 绝对用量；若上游未提供则为 null */
  readonly amount: WindowAmount | null;
  /** 复位时刻（绝对毫秒）；过去时刻保留但不显示倒计时；未知则为 null */
  readonly resets_at: EpochMillis | null;
  /** 撞限流/耗尽标志，严格等于 `remaining_ratio === 0` */
  readonly exhausted: boolean;
  /** exact=上游直接给；derived=经换算/求和；clamped=越界后被裁剪 */
  readonly quality: ReadingQuality;
  /** 溯源路径：上游原始字段名或路径，如 'five_hour.utilization' */
  readonly source_field: string;
}

// ==========================================
// 4. 积分池模型 (CreditsPool)
// ==========================================

/** 积分包细项（WorkBuddy 等渠道） */
export interface CreditPackage {
  /** 包唯一标识 */
  readonly id: string;
  /** 包标签：如 '2026-10 套餐包' / '赠送包' */
  readonly label: string;
  /** 该包总点数 */
  readonly total: number;
  /** 该包可用剩余点数 */
  readonly remaining: number;
  /** 到期时间（毫秒）；永久包为 null */
  readonly expires_at: EpochMillis | null;
  /** 上游 expired=true：已过期，不计入可用余额 */
  readonly expired: boolean;
}

/** 积分池聚合读数形态 */
export interface CreditsPool {
  /** 积分池单位，固定为 'credits' */
  readonly unit: 'credits';
  /** 可用总额（仅计未过期包或服务端总剩余） */
  readonly remaining: number;
  /** 上游总配额；缺失或无上限时为 null */
  readonly total: number | null;
  /** remaining / total 比例；total 为 null 或 0 时为 null，此时不画环比例 */
  readonly remaining_ratio: number | null;
  /** 细分积分包列表 */
  readonly packages: readonly CreditPackage[];
  /** 最近一个将到期的包截止时间；无到期则为 null */
  readonly expires_at: EpochMillis | null;
  /** 溯源：上游字段路径，如 'summary.totalRemaining' */
  readonly source_field: string;
}

// ==========================================
// 5. 探活读数 (QuotaReading)
// ==========================================

/** 窗口形态读数（Claude / Codex / Gemini） */
export interface WindowsReading {
  readonly kind: 'windows';
  /** 配额窗口列表，非空 */
  readonly windows: readonly QuotaWindow[];
  /** 额外用量金额（美分）；无额外计费时为 null */
  readonly extra_usage_cents: number | null;
  /** 辅助 credits 余额（如 codex 赠送点数）；无则为 null */
  readonly credits_balance: number | null;
  /** 可用重置券数量；无则为 null */
  readonly reset_credits: number | null;
}

/** 积分池形态读数（WorkBuddy） */
export interface CreditsReading {
  readonly kind: 'credits';
  /** 积分池数据 */
  readonly pool: CreditsPool;
}

/** 探活读数联合体：只有窗口形态或积分池形态 */
export type QuotaReading = WindowsReading | CreditsReading;

// ==========================================
// 6. 健康状态机与不可用原因
// ==========================================

/**
 * 账号健康状态（全生命周期共 7 态，对应 docs/FLOWS.md 第 12 章）：
 * - never_synced: 刚创建未同步
 * - normal: 数据新鲜且所有领域不变量通过
 * - offline_stale: 网络失败、超时、网关 HTML 等暂态异常
 * - auth_expired: 401 或 refresh 失败
 * - rate_limited: 上游 429 或限流
 * - service_deprecated: 403 停服或端点退役
 * - parse_degraded: 返回体结构异常或数值越界
 */
export type AccountHealthState =
  | 'never_synced'
  | 'normal'
  | 'offline_stale'
  | 'auth_expired'
  | 'rate_limited'
  | 'service_deprecated'
  | 'parse_degraded';

/** 不可用原因诊断枚举 */
export type UnavailableReason =
  | 'never_fetched'
  | 'network'
  | 'timeout'
  | 'http_5xx'
  | 'schema_drift'
  | 'gateway_html'
  | 'auth_401'
  | 'rate_limited'
  | 'deprecated';

/** 异常与健康状态补充明细（已脱敏，可安全向 UI / 日志输出） */
export interface StateDetail {
  /** 机器可识别原因 */
  readonly reason: UnavailableReason;
  /** 人类可读脱敏提示文案 */
  readonly message: string;
  /** HTTP 响应状态码；无网络交互时为 null */
  readonly http_status: number | null;
  /** 上游错误码：如 'SUBSCRIPTION_REQUIRED' / 'region_mismatch' */
  readonly upstream_code: string | null;
  /** 引导用户的处置动作 */
  readonly auth_action: 'reauth' | 'refresh' | 'open_settings' | 'none';
  /** 停服时的迁移建议指引 */
  readonly migration_hint: string | null;
}

// ==========================================
// 7. 账号快照 (AccountSnapshot)
// ==========================================

/** 账号身份信息（仅存脱敏形态，完整明文仅在 OS Keychain） */
export interface AccountIdentity {
  /** 脱敏标识符，如 'a***@corp.com' */
  readonly real_identifier_masked: string | null;
  /** 组织或工作区名称 */
  readonly organization: string | null;
}

/** 账号完整领域快照（写入 DB 与输入投影的唯一实体） */
export interface AccountSnapshot {
  /** 账号唯一 UUIDv4 */
  readonly account_id: string;
  /** 渠道标识 */
  readonly provider: ProviderKind;
  /** 站点范围（仅 workbuddy 允许 cn/intl） */
  readonly region: RegionScope;
  /** 用户设置的展示别名 */
  readonly alias: string;
  /** 脱敏身份信息 */
  readonly identity: AccountIdentity;
  /** 套餐计划名称，如 'Max 5x' / 'Pro' / 'Team' */
  readonly plan_name: string | null;
  /** 视觉形态类型（由 deriveVisualKind 推导） */
  readonly visual_kind: MetricVisualKind;
  /** 最近一次成功读数；离线时保留以供历史槽展示，不可清空 */
  readonly reading: QuotaReading | null;
  /** 读数观测时间戳；从未成功时为 null */
  readonly reading_observed_at: EpochMillis | null;
  /** 当前健康状态 */
  readonly state: AccountHealthState;
  /** 健康状态详细诊断信息 */
  readonly state_detail: StateDetail;
  /** 最近一次发起探测的时刻；从未发起则为 null */
  readonly last_attempt_at: EpochMillis | null;
  /** 最近一次成功获取新鲜读数的时刻；从未成功则为 null */
  readonly last_success_at: EpochMillis | null;
  /** 连续失败次数：>= 0；成功时立即归零（满足 I9） */
  readonly consecutive_failures: number;
  /** 退避/冷却重试时刻；处于冷却期时不发起请求；无需冷却则为 null */
  readonly retry_at: EpochMillis | null;
  /** 驱动解析器版本标识，如 'claude.v1' */
  readonly schema_version: string;
  /**
   * 用户暂停轮询到此时刻（毫秒，含）。
   * - null / 缺省 ⇒ 未暂停；
   * - 过去时刻 ⇒ 视为已到期（读侧按 null 处理，不报错、不写库）；
   * - 调度器在该时刻之前不得发起请求（I11）。
   */
  readonly pause_until?: EpochMillis | null;
  /** 面板隐藏但不删除：Level-1/2 均不展示，仍可轮询与通知（I12） */
  readonly hidden?: boolean;
  /** 配置/凭据版本号，写入时单调 +1，用于乐观并发与投影缓存失效（I13） */
  readonly revision?: number;
}

// ==========================================
// 8. 投影视图模型 (Presentation View Models)
// ==========================================

/** 视觉色调档位 */
export type Tone = 'healthy' | 'warn' | 'hot' | 'neutral' | 'purple';

/** 单段环弧渲染规格 */
export interface RingArc {
  /** 比例 0..1 */
  readonly ratio: number;
  /** SVG stroke-dasharray */
  readonly dash: string;
  /** 端点与前景色 */
  readonly cap_color: string;
  /** 轨道背景色 */
  readonly track_color: string;
  /** 是否开启光晕 drop-shadow */
  readonly glow: boolean;
}

/** 卡片环规格 */
export interface CardRingView {
  /** 环呈现模式 */
  readonly mode: 'value' | 'unknown' | 'deprecated';
  /** 外环弧，未知时为 null */
  readonly outer: RingArc | null;
  /** 内环弧（双环专有），单环或未知时为 null */
  readonly inner: RingArc | null;
  /** 环内中心文案（百分比或 '?' / '!' / '⏱' / '—'） */
  readonly center_text: string;
  /** 中心文案色调 */
  readonly center_tone: Tone;
}

/** 主读数槽规格：非 normal 状态严格禁止 kind='percent'（硬规则 1 与 I6） */
export type PrimarySlotView =
  | { readonly kind: 'percent'; readonly text: string; readonly tone: Tone }
  | { readonly kind: 'absolute'; readonly text: string }
  | { readonly kind: 'status'; readonly text: string; readonly tone: Tone; readonly glyph: string };

/** 交互操作按钮规格 */
export interface CardActionView {
  readonly kind: 'none' | 'retry' | 'reauth' | 'migrate';
  readonly label: string | null;
}

/** L1 账号卡片视图（ui 渲染层的输入，杜绝直接读快照） */
export interface AccountCardView {
  readonly account_id: string;
  readonly alias: string;
  readonly plan_name: string | null;
  readonly visual_kind: MetricVisualKind;
  /** 环渲染形态 */
  readonly ring: CardRingView;
  /** 主槽读数 */
  readonly primary_slot: PrimarySlotView;
  /** 历史槽，如 '最后 41% · 12:30'；无历史读数时为 null */
  readonly history_slot: { readonly text: string } | null;
  /** 倒计时文案，如 '恢 1h04m'；仅 normal 且有复位时间时有效 */
  readonly reset_text: string | null;
  /** 用户操作提示 */
  readonly action: CardActionView;
  /** 是否降低饱和度（非 normal 状态降饱和防止抢戏） */
  readonly dimmed: boolean;
}

/** macOS 菜单栏托盘视图模型 */
export interface MenuBarView {
  /** 托盘主文本：仅 normal 状态取最小值；无 normal 账号时为 null */
  readonly text: string | null;
  /** 状态小图标字形 */
  readonly glyph: 'none' | 'stale' | 'auth' | 'rate' | 'deprecated';
  /** 托盘图标与文本色调 */
  readonly tone: Tone;
  /** 悬停提示文字 */
  readonly tooltip: string;
}

/** 渠道卡片组 */
export interface ChannelGroup {
  readonly provider: ProviderKind;
  readonly label: string;
  readonly accounts: readonly AccountCardView[];
  readonly worst: { readonly account_id: string; readonly text: string; readonly tone: Tone } | null;
  readonly page: { readonly index: number; readonly count: number };
}

/** 完整 HUD 视图模型 */
export interface HudViewModel {
  readonly menu_bar: MenuBarView;
  readonly channels: readonly ChannelGroup[];
  readonly footer: {
    readonly last_refresh_at: EpochMillis | null;
    readonly abnormal_count: number;
  };
}
