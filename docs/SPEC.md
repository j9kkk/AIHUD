# AI HUD 工程规格（SPEC v1.0）

> 地位：**实现契约**。任何实现、评审、看板切片以本文件为准；与本文件冲突的旧文档条款一律视为过期（见 §0.3 裁决记录）。
> 读者：并行执行的后端（core/、src-tauri/）、渲染（ui/）、测试（tests/）三个实现方，以及评审。
> 语言约定：文档与界面文案为简体中文；代码标识符为英文；类型字段统一 `snake_case`（与 Rust serde 同构，免跨语言重命名）。

---

## 0. 权威链与冲突裁决

### 0.1 权威链（自高到低）

| 级别 | 来源 | 作用 | 冲突时 |
| :--- | :--- | :--- | :--- |
| P0 | 任务给定的 8 条产品硬规则 | 不可协商的产品底线 | 任何文档/代码与之冲突 ⇒ 改文档/代码 |
| P1 | **本文件 `docs/SPEC.md`** | 字段、签名、参数、拆分 | 优先于 P2–P6 |
| P2 | `docs/ARCHITECTURE.md` | 设计与不变式推导来源（I1–I10） | 被 P1 覆盖时以本文件为准 |
| P3 | `docs/FLOWS.md` | 交互流与验收断言（50 屏 / 28 迁移） | 文案与状态语义以 FLOWS 为准 |
| P4 | `docs/PROTOTYPE-SPEC.md` + `prototype/ai-hud-prototype.html` | 视觉基线与实测数字 | 几何数字以原型实测为准 |
| P5 | `core/**` 已合入代码 | **事实基线**：类型、轮询参数、归一化口径 | 参数与类型以代码为准（已通过 222 条测试） |
| P6 | `docs/ARCHITECTURE.v0.md` | 历史草案 | 只读，不得引用 |

### 0.2 本文件不做什么

不在本文件写实现代码；只写**契约**（类型签名、映射表、状态机、参数、清单）。类型签名保证可复制进 `.ts` 文件并通过 `tsc --strict`（校验方式见 §5.4）。

### 0.3 裁决记录（D-01 … D-14）

已发现的文档互相矛盾项，全部在此一次性裁决。实现方**只照本表执行**，不要再去比对旧表。

| ID | 争议点 | 各文档说法 | **裁决** | 需回改的文档 |
| :--- | :--- | :--- | :--- | :--- |
| **D-01** | 首发到底是 4 个还是 5 个渠道 | 硬规则 8 说「五个」，但只列出 claude / codex / workbuddy / gemini；`ARCHITECTURE §5.1` 与 `§11 Q1` 按 4 个落地；`FLOWS §4.0` 列出 5 行（含 `custom`） | **4 个内置 + 1 个模板渠道 = 五个首发位**：`BuiltinProviderKind = 'claude' \| 'codex' \| 'workbuddy' \| 'gemini'`，第 5 位由 `custom.${string}` 承载（用户给定 URL + 字段映射，复用同一套状态组件）。**不虚构第 5 个具体厂商**。 | ARCHITECTURE §5.1 注释补一句「第 5 位 = custom 模板」 |
| **D-02** | 并发上限 | `FLOWS §1.6`：全局 4 / 渠道 2 / 账号 1；`ARCHITECTURE §6.1` 与 `core/src/scheduler/poller.ts`：全局 3 / 渠道 1 / 账号 1 | **全局 3 / 同渠道 1 / 单账号 1（single-flight）**。理由：同渠道串行是「按渠道隔离」最强的形式，直接消掉同 IP 频控与 429 竞态；4 与 2 会让同一上游在首屏刷新时并发翻倍。 | FLOWS §1.6 表改 3 / 1 / 1 |
| **D-03** | 每渠道轮询参数 | `ARCHITECTURE §6.2`：workbuddy min 180 / max 900、gemini min 300；代码：workbuddy 120 / 1800、gemini 120 / 3600 | **以 `Driver.poll_policy` 代码值为准**（见 §3.3）。注册表在构造期强校验 `120 ≤ min ≤ base ≤ max ≤ 3600`，文档表若不符直接启动失败。 | ARCHITECTURE §6.2 表 |
| **D-04** | 状态主文案 | `ARCHITECTURE §3.8`：`凭据失效` / `限流 45s` / `接口已停服`；`FLOWS §1.3`：`登录已失效` / `限流中` / `渠道已停服` | **以 `FLOWS §1.3` 为准**（该表自称「界面唯一文案来源」）。本文件 §4.6 抄录成实现常量表。 | ARCHITECTURE §3.8 表 |
| **D-05** | 非 Normal 状态怎么画环 | `ARCHITECTURE §3.8` 早期方案：45% 透明实弧 / 断点弧 / 斜杠；`FLOWS §1.3` 与 B-03 收敛：一律虚线轨道、**无弧** | **非 Normal 永远无弧**，只剩虚线轨道（`1.8 / 2.6`，`rgba(152,162,179,.42)`）。所有时间量（429 冷却、唤醒宽限、退避、24h 探测）走**环外**独立组件 `冷却条`，绝不占用额度环。 | ARCHITECTURE §3.8 表 |
| **D-06** | 一级网格容量 | `ARCHITECTURE §3.7` 注释「2×2=4 张/页」；任务要求「2 行 × 4 格 = 8 / 页」；原型在 360pt 用 2 列 | **页码容量恒为 8**（`pageSize = 8`，与宽度无关）。列数随容器：≥512pt ⇒ 4 列 × 2 行；360–511pt ⇒ 2 列 × 4 行。两种排布都是 8 个槽位，同一套翻页状态机。 | ARCHITECTURE §3.7 注释 |
| **D-07** | 第 5 渠道 `custom` 的数据来源 | 各文档未定义 | 仅支持 `manual_token` / `session_cookie`；探针 URL、Header 名、JSONPath 由用户在设置里给定，落 `custom_probe` 表；归一化仍产出同一 `QuotaReading`。**不引入渠道专属状态或文案。** | 本文件首次定义 |
| **D-08** | 热力图档位 | `ARCHITECTURE §3.9`「只有 na / l1..l4 五种状态」 | 沿用五档：`na`（无采样，斜纹）+ `l1` 0–24.9% + `l2` 25–49.9% + `l3` 50–74.9% + `l4` 75–100%。**`na` 绝不用 `l0`/0 值表达**；真实耗尽（Normal 且 0%）落 `l1` 并加 `exhausted_mark`。 | — |
| **D-09** | 数据过期阈值 | `FLOWS §1.6` G6：`stale_ttl = 2 × T_base + 60s` | 采纳。默认 `T_base=300s` ⇒ `stale_ttl=660s`；按**每渠道** `poll_policy.base_interval_secs` 计算，不取全局值。 | — |
| **D-10** | 429 退避上限 | `FLOWS §1.6`：`min(60×2^n, 1800)`；代码：max 3600（workbuddy 1800） | **以 `poll_policy.backoff.max_secs` 为准**（claude/codex/gemini 3600，workbuddy 1800）。`Retry-After` 钳制区间恒为 `[5, 7200]`。 | FLOWS §1.6 行 |
| **D-11** | 数值越界怎么处理 | `ARCHITECTURE §5.2`：clamp 后标 `clamped` 照常展示；`FLOWS §1.2 G4`：越界即 `ParseDegraded` | **偏差 ≤0.5 视为浮点噪声** ⇒ clamp + `quality='clamped'`；**偏差 >0.5 / NaN / Inf / 负值** ⇒ 整轮判 `parse_degraded`，不产出部分读数（硬规则 2：不得把垃圾数据渲染成 0%/100%）。详见 §2.8。 | ARCHITECTURE §5.2、驱动 normalize 的 clamp 分支 |
| **D-12** | 环几何数字 | 原型实测：卡片 r=22.2 / 详情 r=32.8–33.2；`ARCHITECTURE §5.6` 与 `core/src/domain/visual.ts`：卡片 r=22.6、详情 32.2 / 29.0 | **以 `ringGeometryFor()` 为唯一来源**，UI 禁止硬编码半径；原型数字为视觉验收基线，实现与基线允许 **±0.5px** 光学偏差（描边内缘对齐导致）。详见 §4.4。 | 原型注释（不改原型） |
| **D-13** | 状态色分配 | `ARCHITECTURE §3.8`：`auth_expired` 用 `hot`；`FLOWS §1.3`：`登录已失效` 为琥珀 | **`auth_expired` 用 `warn`（琥珀）**，`hot` 只留给「<20% 剩余」与「数据异常」。理由：红色必须与「额度快没了」强绑定，否则用户会把「登录过期」误读成额度告警。详见 §4.6。 | ARCHITECTURE §3.8 表 |
| **D-14** | 百分比取整方向 | 代码 `formatPercent` 用 `Math.round`（99.5% ⇒ 显示 `100%`）；FLOWS §1.4「100% = 满环」 | **改为 `Math.floor`**：`100%` 仅在 `ratio === 1` 时出现，`0%` 仅在 `ratio === 0`；其余一律向下取整。理由：向上取整会让「99.5% 显示成满环 100%」在视觉上与「真的满额」不可区分，违反硬规则 6 的编码唯一性。 | `core/src/domain/format.ts` + 对应单测 |

### 0.4 八条硬规则 → 本文件落点（可逐条验收）

| 规则 | 本文件落点 | 机器可验证形式 |
| :--- | :--- | :--- |
| 1 只有 Normal 展示百分比 | §1.6 `PrimarySlotView` 类型 + §1.7 I6 + §4.3 | `state !== 'normal' ⇒ primary_slot.kind !== 'percent'`（投影单测 + 不变式断言） |
| 2 读不到不得渲染 0/100 | §1.2 `number \| null` + §1.8 类型层禁令 + §4.6 文案表 | fixture 走查：`reading === null` 时卡片 DOM 不含 `/\d+%/` |
| 3 单渠道故障独立熔断 | §3.2 tick 伪代码 + §3.7 隔离用例 | 一渠道 429 时，其余账号 `due_at` 不变、`state` 不变 |
| 4 凭据只进 Keychain | §1.10 `SnapshotStore` 列定义 + §2.0 铁律 + §5.2 零明文扫描 | `tests/security-scan.sh` 退出码 0 |
| 5 不提前刷新仍可用 token | §3.6 `evaluateRefreshGate` 全表 | 6 条单测（含「剩 59s 仍不刷新」） |
| 6 环编码剩余、<20% 红 | §1.4 `colorBand` + §4.4 环几何 | `colorBand(0.19)==='hot'`、`colorBand(0.20)==='warn'` 边界单测 |
| 7 Apple HIG 视觉 | §4.7 视觉令牌表 | 对比度扫描 + 字号扫描 + `prefers-reduced-motion` 断言 |
| 8 渠道差异只在格式与形态 | §2 每渠道只差「端点/映射/形态」；§3/§4 零渠道分支 | `layering.spec.ts`：scheduler/ 与 presentation/ 零 provider 字面量 |

---

## 1. TypeScript 领域模型与接口

> 以下所有类型**单一处定义**，后续章节只引用不复述。全部 `readonly`；数值缺失一律 `number | null`（**禁止 `?? 0`**）。
> 与 `core/src/domain/types.ts`、`core/src/drivers/driver.ts`、`core/src/scheduler/backoff.ts` 逐字一致；新增部分（`SnapshotStore`、`HeatmapModel`、`AuthFlow`、状态组件 props）为 §1.10 / §4.4 / §1.9 / §4.5。

### 1.1 标量与枚举

```ts
/** 时间戳：Unix 纪元毫秒（UTC）。墙钟只用于展示，超时判断走单调时钟。 */
export type EpochMillis = number;

/** 内置渠道字面量：可穷尽 switch；新增渠道必须改这里才会编译报错。 */
export type BuiltinProviderKind = 'claude' | 'codex' | 'workbuddy' | 'gemini';

/** 对外渠道标识：内置 + 模板扩展位（第 5 个首发位，见 D-01）。 */
export type ProviderKind = BuiltinProviderKind | `custom.${string}`;

/** 站点范围：仅 workbuddy 允许 cn/intl 双站点，其余必须为 global（I8）。 */
export type RegionScope = 'global' | 'cn' | 'intl';

/**
 * 额度指标视觉形态（渠道差异的唯一允许出口之一）：
 * - dual_sliding_window：外环短窗 + 内环长窗（同心双环）
 * - single_periodic_window：单周期窗口（单大环）
 * - credits_pool：积分池（积分环 + 绝对值）
 */
export type MetricVisualKind =
  | 'dual_sliding_window'
  | 'single_periodic_window'
  | 'credits_pool';

/** 窗口作用域：账号级全局，或特定模型级（codex / claude opus 窗）。 */
export type WindowScope = 'account' | { readonly model: string };

/** 绝对量单位。 */
export type AmountUnit = 'percent' | 'tokens' | 'requests' | 'credits';

/** 读数可信度：exact=上游直接给；derived=换算/求和；clamped=越界后被裁剪。 */
export type ReadingQuality = 'exact' | 'derived' | 'clamped';

/** 视觉色调档位（语义色，不参与「最后已知值」渲染）。 */
export type Tone = 'healthy' | 'warn' | 'hot' | 'neutral' | 'purple';

/**
 * 账号健康状态（全生命周期 7 态，唯一枚举）。
 * 注意：暂停不是第 8 个状态，而是账号上的正交字段 pause_until（M-02）。
 */
export type AccountHealthState =
  | 'never_synced'
  | 'normal'
  | 'offline_stale'
  | 'auth_expired'
  | 'rate_limited'
  | 'service_deprecated'
  | 'parse_degraded';

/** 不可用原因诊断枚举（落 state_detail.reason，用于排障与报表，不用于文案拼接）。 */
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
```

### 1.2 配额窗口与积分池

```ts
/** 绝对用量。服务端只给百分比时 used/limit 均为 null —— 禁止由百分比反推 token 数。 */
export interface WindowAmount {
  /** 用量单位 */
  readonly unit: AmountUnit;
  /** 已用量；未知时为 null */
  readonly used: number | null;
  /** 配额上限；未知时为 null（禁止用 used 反推） */
  readonly limit: number | null;
}

/**
 * 单个配额时间窗口。这是环视觉的唯一数值输入来源。
 * 铁律：remaining_ratio 必须有值（[0,1]）；「读不到」由 reading === null 表达，
 * 不允许用 remaining_ratio = 0 或 1 表示「未知」。
 */
export interface QuotaWindow {
  /** 稳定标识，用于跨次比对与通知去重：'five_hour' | 'seven_day' | 'model:gpt-5-codex:primary' */
  readonly id: string;
  /** 中文展示标签：'5 小时窗口' / '周窗口' / '3 小时窗口' */
  readonly label: string;
  /** 作用域：账号全局或针对特定模型 */
  readonly scope: WindowScope;
  /** 窗口时长（秒）：18000 / 604800 / 86400；无固定时长则为 null */
  readonly duration_secs: number | null;
  /** 剩余比例，闭区间 [0, 1]，**环编码剩余而非已用**（硬规则 6） */
  readonly remaining_ratio: number;
  /** 绝对用量；上游未提供则为 null */
  readonly amount: WindowAmount | null;
  /** 复位时刻（绝对毫秒）；过去时刻保留但不显示倒计时；未知为 null */
  readonly resets_at: EpochMillis | null;
  /** 撞限流/耗尽标志，严格等于 remaining_ratio === 0（I7） */
  readonly exhausted: boolean;
  /** 读数质量，决定 UI 是否加「~」提示 */
  readonly quality: ReadingQuality;
  /** 溯源路径：上游原始字段，如 'five_hour.utilization'（fixture 走查与排障用） */
  readonly source_field: string;
}

/** 积分包细项（workbuddy 等积分制渠道）。 */
export interface CreditPackage {
  /** 包唯一标识 */
  readonly id: string;
  /** 包标签：'2026-10 套餐包' / '赠送包' */
  readonly label: string;
  /** 该包总点数 */
  readonly total: number;
  /** 该包可用剩余点数 */
  readonly remaining: number;
  /** 到期时间（毫秒）；永久包为 null */
  readonly expires_at: EpochMillis | null;
  /** 上游 expired=true：已过期，**不计入** remaining 与 total 分母 */
  readonly expired: boolean;
}

/** 积分池聚合读数。 */
export interface CreditsPool {
  /** 积分池单位，固定为 'credits' */
  readonly unit: 'credits';
  /** 可用总额（只计未过期包，或服务端总剩余） */
  readonly remaining: number;
  /** 上游总配额；无上限时为 null */
  readonly total: number | null;
  /** remaining/total；total 为 null 或 0 时为 null —— 此时**不画比例弧**，只描轨 */
  readonly remaining_ratio: number | null;
  /** 细分积分包（含已过期，供详情页置灰展示） */
  readonly packages: readonly CreditPackage[];
  /** 最近一个将到期包的截止时间；无到期为 null */
  readonly expires_at: EpochMillis | null;
  /** 溯源：上游字段路径，如 'summary.totalRemaining' */
  readonly source_field: string;
}
```

### 1.3 探活读数（联合体）

```ts
/** 窗口形态读数（claude / codex / gemini）。 */
export interface WindowsReading {
  readonly kind: 'windows';
  /** 配额窗口列表，**非空**（I4） */
  readonly windows: readonly QuotaWindow[];
  /** 额外用量金额（美分）；无额外计费为 null */
  readonly extra_usage_cents: number | null;
  /** 辅助积分余额（如 codex 赠送点数）；无为 null */
  readonly credits_balance: number | null;
  /** 可用重置券数量；无为 null */
  readonly reset_credits: number | null;
}

/** 积分池形态读数（workbuddy）。 */
export interface CreditsReading {
  readonly kind: 'credits';
  /** 积分池数据 */
  readonly pool: CreditsPool;
}

/**
 * 探活读数联合体。判别字段 kind 决定派生视觉形态（I5）：
 * 'windows' → dual_sliding_window（≥2 窗）/ single_periodic_window（1 窗）
 * 'credits' → credits_pool
 */
export type QuotaReading = WindowsReading | CreditsReading;

/** 派生视觉形态。fallback 由渠道 default_visual 提供（无读数时决定画哪种环）。 */
export declare function deriveVisualKind(
  reading: QuotaReading | null,
  fallback?: MetricVisualKind
): MetricVisualKind;

// 规范判定（实现必须逐条等价，单测见 U4）：
//   reading === null            → fallback（默认 'single_periodic_window'）
//   reading.kind === 'credits'  → 'credits_pool'
//   windows.length >= 2         → 'dual_sliding_window'
//   其余（1 个窗口）            → 'single_periodic_window'

/** 剩余比例色带（硬规则 6：<20% 红）。边界为左闭右开。 */
export declare function colorBand(ratio: number): Tone;

// 规范阈值（单测 U2 必测 0.199 / 0.2 / 0.499 / 0.5 四个边界）：
//   ratio < 0.20 → 'hot'
//   ratio < 0.50 → 'warn'
//   否则          → 'healthy'
```

### 1.4 诊断明细

```ts
/** 异常与状态补充明细（已脱敏，可安全写入日志与 UI）。 */
export interface StateDetail {
  /** 机器可识别原因 */
  readonly reason: UnavailableReason;
  /** 人类可读中文明文；**由驱动写死模板，禁止拼接响应体**（防泄漏） */
  readonly message: string;
  /** HTTP 响应状态码；无网络交互时为 null */
  readonly http_status: number | null;
  /** 上游错误码：'SUBSCRIPTION_REQUIRED' / 'region_mismatch' / 'invalid_grant' */
  readonly upstream_code: string | null;
  /** 引导用户处置的动作，决定卡片右下角按钮 */
  readonly auth_action: 'reauth' | 'refresh' | 'open_settings' | 'none';
  /** 停服时的迁移指引（仅 service_deprecated 非空） */
  readonly migration_hint: string | null;
}
```

### 1.5 账号快照

```ts
/** 账号身份信息（只存脱敏形态；完整明文只在 OS Keychain 条目内）。 */
export interface AccountIdentity {
  /** 脱敏标识符，如 'a***@corp.com'。**渲染层允许显示此字段，禁止显示全明文** */
  readonly real_identifier_masked: string | null;
  /** 组织或工作区名称 */
  readonly organization: string | null;
}

/**
 * 账号完整领域快照：写库与输入投影的唯一实体。
 *
 * 关键语义：reading 是「最近一次成功」的读数，离线时**刻意保留**——它就是「最后已知值」的来源；
 * 而 state 决定它能不能被当成当前值渲染。二者分离，是硬规则 1 与硬规则 2 能同时成立的原因。
 */
export interface AccountSnapshot {
  /** 本地账号 UUIDv4；删除后不复用 */
  readonly account_id: string;
  /** 渠道标识 */
  readonly provider: ProviderKind;
  /** 站点范围（仅 workbuddy 允许 cn/intl，I8） */
  readonly region: RegionScope;
  /** 用户设置的展示别名，**一级面板只显示这个** */
  readonly alias: string;
  /** 脱敏身份信息 */
  readonly identity: AccountIdentity;
  /** 套餐计划名称，如 'Max 5x' / 'Pro' / 'Team' */
  readonly plan_name: string | null;
  /** 视觉形态（= deriveVisualKind(reading, driver.default_visual)） */
  readonly visual_kind: MetricVisualKind;
  /** 最近一次成功读数；离线时保留以供历史槽展示，**不可清空** */
  readonly reading: QuotaReading | null;
  /** 读数观测时刻；从未成功为 null */
  readonly reading_observed_at: EpochMillis | null;
  /** 当前健康状态（必填，无默认值） */
  readonly state: AccountHealthState;
  /** 健康状态诊断 */
  readonly state_detail: StateDetail;
  /** 最近一次发起探测的时刻；从未发起为 null */
  readonly last_attempt_at: EpochMillis | null;
  /** 最近一次成功获取新鲜读数的时刻；从未成功为 null */
  readonly last_success_at: EpochMillis | null;
  /** 连续失败次数 ≥0；成功立即归零（I9） */
  readonly consecutive_failures: number;
  /** 冷却/退避到期时刻；非空 ⇒ 此刻前不发起请求 */
  readonly retry_at: EpochMillis | null;
  /** 驱动解析器版本，如 'claude.v1' */
  readonly schema_version: string;
  /** 用户暂停到此刻（正交字段，不是第 8 个状态）；无暂停为 null */
  readonly pause_until: EpochMillis | null;
  /** 用户隐藏（不计入菜单栏聚合与通知）；默认 false */
  readonly hidden: boolean;
  /** 乐观并发版本号：每次成功写入 +1 */
  readonly revision: number;
}
```

### 1.6 投影视图模型（UI 的唯一输入）

> 渲染层**只消费本节类型，禁止直接读 `AccountSnapshot`**。这样「百分比能不能出现」只在投影层判一次（`core/src/presentation/`），UI 无从绕过。

```ts
/** 单段环弧渲染规格（单位 px / 颜色字符串）。 */
export interface RingArc {
  /** 剩余比例 0..1 */
  readonly ratio: number;
  /** SVG stroke-dasharray 字符串，如 '86.48 139.49' */
  readonly dash: string;
  /** 弧端点前景色（语义色） */
  readonly cap_color: string;
  /** 轨道/底轨色（语义色的 15% 暗调，**禁止中性灰**） */
  readonly track_color: string;
  /** 是否开启光晕（ratio < 0.2 时开启，强化告警） */
  readonly glow: boolean;
}

/** 卡片环规格。mode==='value' 才允许出现 outer/inner 弧。 */
export interface CardRingView {
  /** value=有真实读数；unknown=读不到（只描虚线轨）；deprecated=停服（断点轨） */
  readonly mode: 'value' | 'unknown' | 'deprecated';
  /** 外环弧；unknown/deprecated 时为 null（非 Normal 无弧，D-05） */
  readonly outer: RingArc | null;
  /** 内环弧（双环专有）；单环/unknown 时为 null */
  readonly inner: RingArc | null;
  /** 环内中心文案：百分比 '62' / '—' / '?'（never_synced） */
  readonly center_text: string;
  /** 中心文案色调 */
  readonly center_tone: Tone;
}

/**
 * 主读数槽。非 normal 状态**严禁** kind==='percent'（硬规则 1 / I6）。
 */
export type PrimarySlotView =
  | { readonly kind: 'percent'; readonly text: string; readonly tone: Tone }
  | { readonly kind: 'absolute'; readonly text: string }
  | {
      readonly kind: 'status';
      readonly text: string;
      readonly tone: Tone;
      readonly glyph: string;
    };

/** 卡片可执行动作。 */
export interface CardActionView {
  readonly kind: 'none' | 'retry' | 'reauth' | 'migrate';
  readonly label: string | null;
}

/** 一级面板账号卡片视图。 */
export interface AccountCardView {
  readonly account_id: string;
  /** 展示别名（唯一身份文案） */
  readonly alias: string;
  /** 套餐名，可为空 */
  readonly plan_name: string | null;
  /** 视觉形态，决定画双环/单环/积分环 */
  readonly visual_kind: MetricVisualKind;
  /** 环渲染规格 */
  readonly ring: CardRingView;
  /** 主读数槽 */
  readonly primary_slot: PrimarySlotView;
  /** 历史槽：'最后 41% · 12:30'；无历史读数时为 null。中性色，**永不使用状态色** */
  readonly history_slot: { readonly text: string } | null;
  /** 复位倒计时文案：'恢 1h04m'；仅 normal 且有 resets_at 时非空 */
  readonly reset_text: string | null;
  /** 用户可执行动作 */
  readonly action: CardActionView;
  /** 是否整体降饱和（非 normal 为 true，防止抢戏） */
  readonly dimmed: boolean;
}

/** macOS 菜单栏视图。 */
export interface MenuBarView {
  /** 托盘数字：**只在 state==='normal' 的账号里取最小值**；无 Normal 账号时为 null */
  readonly text: string | null;
  /** 状态字形：none/stale/auth/rate/deprecated */
  readonly glyph: 'none' | 'stale' | 'auth' | 'rate' | 'deprecated';
  /** 托盘色调 */
  readonly tone: Tone;
  /** 悬停提示，如 'Claude · 工作主力 62%，14:35 重置' */
  readonly tooltip: string;
}

/** 渠道卡片组（一级面板的一个渠道分区）。 */
export interface ChannelGroup {
  readonly provider: ProviderKind;
  /** 渠道展示名：'Claude' / 'WorkBuddy' */
  readonly label: string;
  /** **当前页**的卡片，长度 ≤ 8（D-06） */
  readonly accounts: readonly AccountCardView[];
  /** 该渠道最紧张账号：'最少 9%'；无可用读数时为 null */
  readonly worst: { readonly account_id: string; readonly text: string; readonly tone: Tone } | null;
  /** 渠道内分页状态：index 从 0 起，count=0 表示该渠道无账号 */
  readonly page: { readonly index: number; readonly count: number };
}

/** 完整 HUD 视图模型：渲染层的唯一 props 根。 */
export interface HudViewModel {
  readonly menu_bar: MenuBarView;
  readonly channels: readonly ChannelGroup[];
  readonly footer: {
    /** 最近一次任意渠道成功刷新的时刻 */
    readonly last_refresh_at: EpochMillis | null;
    /** 异常账号数（state !== 'normal'） */
    readonly abnormal_count: number;
  };
  /** 全局暂停到此刻（正交外观，见 §4.5）；无暂停为 null */
  readonly pause_until: EpochMillis | null;
}
```
### 1.7 领域不变式 I1–I10（写库前与投影前各断言一次）

任何违反以下任一条的快照**不得落盘、不得输入投影**。实现见 `core/src/domain/invariants.ts`，抛 `InvariantViolation(error_code, detail)`。

| ID | 不变式 | 违反后果（若不拦） | 断言位置 |
| :--- | :--- | :--- | :--- |
| **I1** | `state === 'normal'` ⇔ `reading !== null ∧ reading_observed_at === last_success_at ∧ retry_at === null` | 「正常」但没有当前值 / 有冷却却还在刷新 | `assertInvariants` |
| **I2** | `reading === null` ⇒ `reading_observed_at === null ∧ last_success_at === null` | 伪造同步时间，界面出现「62% · 从未成功」 | 同上 |
| **I3** | 每个 `remaining_ratio ∈ [0,1]` 且非 NaN；格式化百分数 ∈ [0,100] | 环画到圈外 / 出现 `-3%` | 同上 |
| **I4** | `reading.kind === 'windows'` ⇒ `windows.length ≥ 1` 且 `id` 唯一 | 空读数被当成「0 个窗口 = 0%」 | 同上 |
| **I5** | `visual_kind` 与 `reading.kind` 严格对应（credits↔credits_pool；windows≥2↔dual；windows=1↔single） | 积分渠道画双环，中心却显示百分比 | 同上 |
| **I6** | `state !== 'normal'` ⇒ 投影的 `primary_slot.kind !== 'percent'`（连带 `ring.outer === null`） | 违反硬规则 1 与 2 | `assertCardViewInvariants` |
| **I7** | `exhausted === (remaining_ratio === 0)` | 空环与「耗尽」文案不一致 | `assertInvariants` |
| **I8** | `region !== 'global'` 仅允许出现在 `workbuddy` | CN 凭据被发往国际站（跨站泄漏） | 同上 |
| **I9** | `state === 'normal'` ⇔ `consecutive_failures === 0` | 退避把已恢复的账号继续拖慢 | 同上 |
| **I10** | 缺失数值一律 `null`；类型层禁止 `?? 0` / `unwrap_or(0)` / `Number(x)` 兜 0 | 硬规则 2 的根因 | CI 静态扫描 |

**相对当前 `core/src/domain/types.ts` 的三处增量**（必须补，否则 `hidden`/`pause_until` 语义无处落）：

| 字段 | 类型 | 来源 | 影响文件 |
| :--- | :--- | :--- | :--- |
| `pause_until` | `EpochMillis \| null` | FLOWS M-02（暂停是正交字段，不是第 8 状态） | `domain/types.ts`、`presentation/channels.ts`、`hud.spec.ts` |
| `hidden` | `boolean` | FLOWS §7.3（隐藏账号剔除出聚合与通知） | 同上 + `menu-bar.ts` |
| `revision` | `number` | `SnapshotStore` 乐观并发（§1.10） | `domain/types.ts`、`storage.rs` |

> 这三项为**必填**（非可选）。只给默认值的实现会让「暂停/隐藏/并发写」在类型层消失，评审不接受。

### 1.8 渠道驱动契约

驱动是**可回放纯函数**：不持有凭据、不发起真实网络、不读系统时钟，全部由调用方注入。

```ts
/** 鉴权方式（决定 UI 走哪个授权子流）。 */
export type AuthFlowType =
  | 'oauth_pkce'          // 系统浏览器 + 本地回环回调
  | 'device_code'         // 设备配对码（workbuddy，8 位码）
  | 'manual_token'        // 粘贴 token / API Key
  | 'session_cookie'      // 从已登录浏览器导入 cookie
  | 'cli_session_reuse'   // 复用本机 CLI 已登录凭据（Claude Code / Codex）
  | 'cli_command';        // 借 CLI 子进程取数（gemini agy）

/** 渠道能力声明：Rust 侧据此做白名单与子进程约束。 */
export interface DriverCapabilities {
  /** 是否支持 token 刷新（codex/workbuddy/gemini 为 false） */
  readonly can_refresh: boolean;
  /** 是否站点隔离（仅 workbuddy true） */
  readonly region_scoped: boolean;
  /** 允许访问的 origin 白名单（SSRF 最后一道闸，Rust 侧强制校验） */
  readonly allowed_origins: readonly string[];
  /** 允许 spawn 的可执行文件名（空数组 = 禁止子进程） */
  readonly cli_commands: readonly string[];
  /** 卡片最多展示的窗口数：claude/codex=2，workbuddy/gemini=1 */
  readonly max_windows_for_card: number;
}

/** 账号引用（最小身份，不含凭据）。 */
export interface AccountRef {
  readonly account_id: string;
  readonly provider: ProviderKind;
  readonly region: RegionScope;
}

/**
 * 凭据租约：**不含明文**。JS 侧只能拿到 lease_id，明文只在 Rust 堆里。
 */
export interface CredentialLease {
  /** 不透明句柄（60s 有效，单次 fetch 后作废） */
  readonly lease_id: string;
  /** 凭据指纹（HMAC-SHA256 前 8 字节 hex），用于检测外部轮换 */
  readonly revision: string;
  /** 凭据到期时刻；无到期语义为 null */
  readonly expires_at: EpochMillis | null;
  /** 该凭据的授权方式 */
  readonly flow: AuthFlowType;
  /** 脱敏身份提示，如 'a***@corp.com' */
  readonly subject_hint: string | null;
  /** 凭据绑定的站点 */
  readonly region: RegionScope;
  /** 非敏感附加头（ChatGPT-Account-Id / X-User-Id），**禁止**放 authorization/cookie */
  readonly extra_headers: Readonly<Record<string, string>>;
}

/** 请求规格：驱动只描述意图，真正发请求由 Rust 执行。 */
export interface HttpRequestSpec {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  /** 业务头（禁含 authorization / cookie / x-api-key，否则抛 CredentialLeakError） */
  readonly headers?: Readonly<Record<string, string>>;
  /** 鉴权方式：'lease' = 由 Rust 用租约注入凭据；其余表示用指定头 */
  readonly auth:
    | 'lease'
    | { readonly kind: 'bearer' | 'header' | 'cookie'; readonly header_name?: string };
  /** 请求体（仅 POST） */
  readonly body?: string;
  /** 单请求超时（毫秒），上限 15000 */
  readonly timeout_ms: number;
  /** 响应体上限（字节），上限 262144；超出截断并置 truncated */
  readonly max_body_bytes: number;
}

/** 响应（响应头已按白名单裁剪）。 */
export interface HttpReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body_text: string;
  /** 是否因超出 max_body_bytes 被截断 */
  readonly truncated: boolean;
  readonly duration_ms: number;
}

/** 租约绑定的 HTTP 端口：唯一能发请求的通道。 */
export interface AuthBoundHttp {
  request(spec: HttpRequestSpec): Promise<HttpReply>;
}

/** CLI 子进程桥（仅 capabilities.cli_commands 内的命令可执行）。 */
export interface CliBridge {
  run(
    cmd: string,
    args: readonly string[],
    timeout_ms?: number
  ): Promise<{ stdout: string; stderr: string; exit_code: number }>;
}

/** 时钟端口：驱动不读 Date.now()，一律用注入时钟（可回放测试）。 */
export interface Clock {
  now(): EpochMillis;
}

/** 一次探活的全部外部依赖。 */
export interface FetchContext {
  readonly account: AccountRef;
  readonly lease: CredentialLease;
  readonly http: AuthBoundHttp;
  /** 仅 gemini 使用（agy CLI 桥）；其他渠道不传 */
  readonly cli?: CliBridge;
  readonly clock: Clock;
  /** 取消信号（面板关闭 / 账号删除 / 应用退出） */
  readonly signal?: AbortSignal;
}

/** 驱动错误分类（唯一分类维度，映射到健康状态见 §2.7）。 */
export type DriverErrorClass =
  | 'network'
  | 'timeout'
  | 'http'
  | 'auth'
  | 'rate_limit'
  | 'deprecated'
  | 'schema';

/**
 * 统一错误载荷（纯数据，不是 Error 子类）。
 * 理由：驱动是纯函数，失败通过返回值表达；跨 WebView↔Rust 序列化时不丢 name/stack。
 * message 必须是驱动写死的模板（中文），**禁止拼接响应体**。
 */
export interface DriverErrorData {
  readonly class: DriverErrorClass;
  readonly message: string;
  readonly http_status: number | null;
  readonly upstream_code: string | null;
  readonly retry_after_secs: number | null;
  readonly migration_hint: string | null;
}

export type DriverError = DriverErrorData;

/** 探活结果。成功即携带新鲜读数与观测时刻；失败即携带纯数据错误。 */
export type FetchOutcome =
  | {
      readonly ok: true;
      readonly reading: QuotaReading;
      readonly observed_at: EpochMillis;
      readonly diagnostics: {
        /** 本次探活发起的 HTTP 请求数（≤3） */
        readonly requests: number;
        /** 字段漂移告警（只记字段名，不记取值） */
        readonly schema_warnings: readonly string[];
      };
    }
  | { readonly ok: false; readonly error: DriverError };

/** 刷新上下文（只有 can_refresh=true 的驱动会收到）。 */
export interface RefreshContext {
  readonly account: AccountRef;
  readonly lease: CredentialLease;
  readonly clock: Clock;
}

/** 凭据写回补丁：字段来源用 JSONPath 描述，由 Rust 在密文域执行。 */
export interface CredentialPatchSpec {
  readonly fields: readonly {
    /** 目标字段 */
    readonly target: 'access_token' | 'refresh_token' | 'expires_at' | 'scopes' | 'id_token';
    /** 响应体中的取值路径，如 'access_token' / 'expires_in' */
    readonly from: string;
    /** 变换规则 */
    readonly transform: 'identity' | 'epoch_ms_from_seconds' | 'epoch_ms_from_now';
  }[];
  /** 写回模式：replace 整体替换，merge 只并指定字段 */
  readonly store_mode: 'replace' | 'merge';
}

/** 刷新计划：驱动只产出「要发什么请求 + 成功后怎么写回」，不自己发。 */
export interface RefreshPlan {
  readonly request: HttpRequestSpec;
  readonly patch: CredentialPatchSpec;
}

export type RefreshOutcome =
  | { readonly ok: true; readonly plan: RefreshPlan }
  | { readonly ok: false; readonly unsupported: true }
  | { readonly ok: false; readonly error: DriverError };

/**
 * 渠道驱动（四个内置渠道 + 模板渠道实现的唯一接口）。
 *
 * 实现约束：
 * - fetch_snapshot 只读，不改服务端状态；单次 ≤3 请求、总预算 ≤20s；
 * - refresh_token 只产出计划，不自行发请求、不读 Keychain；
 * - 不得读系统时间（用 ctx.clock），不得自行重试（重试属调度器职责）。
 */
export interface ChannelDriver {
  readonly provider: BuiltinProviderKind;
  /** 解析器版本，如 'claude.v1'；上游格式变化时自增，进入 snapshot.schema_version */
  readonly schema_version: string;
  /** 支持的鉴权方式，**顺序即 UI 推荐顺序**，非空 */
  readonly supported_auth_flows: readonly AuthFlowType[];
  /** 调度参数（§3.3）；注册表构造期强校验 */
  readonly poll_policy: PollPolicy;
  /** 能力声明（白名单、子进程、卡片窗口上限） */
  readonly capabilities: DriverCapabilities;
  /** 无读数时的兜底视觉形态（决定画双环/单环/积分环） */
  readonly default_visual: MetricVisualKind;

  /** 一次只读探活：租约签名请求 → 解析 → 归一化读数 */
  fetch_snapshot(ctx: FetchContext): Promise<FetchOutcome>;

  /** 刷新 token 返回计划；无刷新能力时返回 { ok:false, unsupported:true } */
  refresh_token(ctx: RefreshContext): Promise<RefreshOutcome>;

  /** 可选：开始授权（设备码 / PKCE / 浏览器回调） */
  begin_auth?(provider: ProviderKind, region: RegionScope): Promise<AuthChallenge>;
  /** 可选：完成授权，交回凭据草稿 */
  complete_auth?(provider: ProviderKind, answer: AuthAnswer): Promise<CredentialDraft>;
}
```

### 1.9 授权会话（AuthFlow）

授权是**有状态的进行中会话**，与 `AccountHealthState` 解耦：授权失败不是健康状态，只是会话失败。

```ts
/** 授权会话阶段。 */
export type AuthFlowPhase =
  | 'idle'            // 未开始
  | 'awaiting_user'   // 已打开浏览器 / 已显示配对码，等用户
  | 'polling'         // 设备码轮询中（workbuddy）
  | 'exchanging'      // 用 code 换 token
  | 'verifying'       // 已拿到凭据，正在首刷验证
  | 'succeeded'       // 已入库且首刷成功
  | 'failed'          // 失败（原因见 failure）
  | 'cancelled'       // 用户取消
  | 'expired';        // 会话超时（设备码 900s / PKCE 600s）

/** 配对码 / 设备码挑战，直接渲染给用户。 */
export interface AuthChallenge {
  /** 设备码页面 URL（用户需在浏览器打开） */
  readonly verification_uri?: string;
  /** 8 位配对码，如 'K7QM-2XPD' */
  readonly user_code?: string;
  /** 挑战有效期（秒） */
  readonly expires_in?: number;
  /** 轮询间隔（秒），服务端下发，最小 5 */
  readonly interval?: number;
}

/** 用户回填（粘贴 code / token）。 */
export interface AuthAnswer {
  readonly code?: string;
  readonly token?: string;
}

/** 授权成功后的凭据草稿：交给 Rust 写 Keychain，JS 不落明文。 */
export interface CredentialDraft {
  /** 授权方式 */
  readonly flow: AuthFlowType;
  /** 站点 */
  readonly region: RegionScope;
  /** 上游给的访问令牌（仅在 IPC 单次调用内传递，不落 JS 变量） */
  readonly access_token: string;
  /** 刷新令牌；无刷新能力为 null */
  readonly refresh_token: string | null;
  /** 到期时刻 */
  readonly expires_at: EpochMillis | null;
  /** 脱敏主体 */
  readonly subject_masked: string | null;
  /** 非敏感附加头 */
  readonly extra_headers: Readonly<Record<string, string>>;
}

/** 进行中的授权会话状态（IPC 每次返回全量，UI 无本地状态机）。 */
export interface AuthFlow {
  readonly flow_id: string;
  readonly provider: ProviderKind;
  readonly type: AuthFlowType;
  readonly region: RegionScope;
  readonly phase: AuthFlowPhase;
  /** awaiting_user / polling 阶段非空 */
  readonly challenge: AuthChallenge | null;
  readonly started_at: EpochMillis;
  /** 会话硬超时时刻（到点即 expired，不再接受用户输入） */
  readonly expires_at: EpochMillis;
  /** 已尝试次数（含轮询次数），用于熔断异常轮询 */
  readonly attempts: number;
  /** 失败原因，仅 phase==='failed' 时非空 */
  readonly failure: { readonly code: string; readonly message: string } | null;
}
```

| 迁移 | 触发 | 副作用 | 备注 |
| :--- | :--- | :--- | :--- |
| `idle → awaiting_user` | 用户选渠道并点「继续」 | 生成 PKCE / 申请设备码；开系统浏览器 | 不写任何凭据 |
| `awaiting_user → polling` | 仅 `device_code` | 每 `interval` 秒轮询一次，`slow_down` 时 +5s | PKCE 直接跳 `exchanging` |
| `polling → exchanging` | 收到 `authorization_pending` 之外的 200 | 用 code 换 token（单次） | 失败即 `failed('device_denied')` |
| `exchanging → verifying` | 拿到 `CredentialDraft` | Rust 写 Keychain → 建账号（`never_synced`）→ 立即首刷一次 | **不在此时刷新 token**（硬规则 5） |
| `verifying → succeeded` | 首刷成功 | 账号转 `normal` | 首刷失败**不删账号**，转 `failed('first_fetch')`，账号留 `never_synced` |
| 任意 → `expired` | `now ≥ expires_at` | 清理浏览器回调监听端口 | 文案「授权已超时，请重试」 |
| 任意 → `cancelled` | 用户点「取消」/ 关面板 | 同上 | 幂等 |

### 1.10 轮询策略与快照存储

```ts
/** 退避参数（每渠道一份，来自 poll_policy.backoff）。 */
export interface BackoffPolicy {
  /** 首次失败的基础等待（秒），下限 30 */
  readonly base_secs: number;
  /** 指数底数，固定 2 */
  readonly factor: number;
  /** 单次等待上限（秒）；claude/codex/gemini 3600，workbuddy 1800 */
  readonly max_secs: number;
  /** 是否尊重服务端 Retry-After（恒为 true） */
  readonly respect_retry_after: true;
  /** Retry-After 钳制区间 [下限, 上限]，恒为 [5, 7200] */
  readonly retry_after_clamp: readonly [number, number];
}

/** 渠道轮询策略（驱动声明，调度器只读不猜）。 */
export interface PollPolicy {
  /** 常规间隔（秒） */
  readonly base_interval_secs: number;
  /** 收紧后的最短间隔（秒），注册表校验 ≥120 */
  readonly min_interval_secs: number;
  /** 放宽后的最长间隔（秒），注册表校验 ≤3600 */
  readonly max_interval_secs: number;
  /** 抖动比例（0.1 = ±10%），注册表校验 ∈[0,0.5] */
  readonly jitter_ratio: number;
  /** 复位前观察窗口（秒）：窗口将在此时长内复位且已耗尽 ⇒ 用 min 间隔 */
  readonly reset_watch_secs: number;
  /** 退避参数 */
  readonly backoff: BackoffPolicy;
  /** 面板关闭且 30min 无交互时的间隔（秒） */
  readonly idle_interval_secs: number;
  /** 兼容钩子：驱动可自带延迟计算；调度器优先用 backoff 纯函数，不依赖此方法 */
  next_delay_ms?(
    retry_after?: string | number | null,
    consecutive?: number,
    now?: number
  ): number;
}

/** 一次用量采样（写 usage_samples；只写 Normal + 探针成功）。 */
export interface UsageSample {
  readonly account_id: string;
  /** '5h' | '1w' | 'day' | 'credits'（展示用短标签） */
  readonly window_label: string;
  /** 采样时刻（毫秒），写入前向下取整到小时桶 */
  readonly sampled_at: EpochMillis;
  /** 剩余百分比 0..100；该窗口缺失时为 null（**不写 0**） */
  readonly remaining_pct: number | null;
  /** 积分制渠道的绝对值；百分比制为 null */
  readonly remaining_amt: number | null;
  readonly source: 'probe';
}

/** 采样查询。 */
export interface SampleQuery {
  readonly account_id: string;
  readonly window_label: string;
  /** 包含下界（毫秒） */
  readonly from: EpochMillis;
  /** 不包含上界（毫秒） */
  readonly to: EpochMillis;
}

/** 写入结果：乐观并发失败时不抛异常，返回现状供调用方重放。 */
export type SnapshotWriteResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly conflict: true; readonly current_revision: number };

/**
 * 快照存储端口（Rust 侧 SQLite 实现，TS 侧只依赖此接口）。
 *
 * 语义约束：
 * 1. 所有方法异步；不得在事务内做网络 IO；
 * 2. upsert 以 revision 做乐观并发：expected_revision 不匹配即返回 conflict，**不覆盖**；
 * 3. record_samples 幂等：同 (account, window, hour) 覆盖（INSERT OR REPLACE）；
 * 4. delete_account 级联删除 usage_samples 与 Keychain 条目（Keychain 由 Rust 负责）。
 */
export interface SnapshotStore {
  load_all(): Promise<readonly AccountSnapshot[]>;
  load(account_id: string): Promise<AccountSnapshot | null>;
  upsert(
    snapshot: AccountSnapshot,
    opts?: { readonly expected_revision?: number }
  ): Promise<SnapshotWriteResult>;
  record_samples(samples: readonly UsageSample[]): Promise<number>;
  load_samples(query: SampleQuery): Promise<readonly UsageSample[]>;
  prune_samples(before: EpochMillis, limit: number): Promise<number>;
  delete_account(account_id: string): Promise<void>;
  /** 事务：fn 内多次 upsert 原子提交；抛异常即整体回滚 */
  transaction<T>(fn: (tx: SnapshotStoreTx) => Promise<T>): Promise<T>;
}

/** 事务内的存储句柄（与 SnapshotStore 同构，但只有写方法）。 */
export interface SnapshotStoreTx {
  upsert(
    snapshot: AccountSnapshot,
    opts?: { readonly expected_revision?: number }
  ): Promise<SnapshotWriteResult>;
  record_samples(samples: readonly UsageSample[]): Promise<number>;
  delete_account(account_id: string): Promise<void>;
}
```

---

## 2. 渠道驱动的最小实现契约

### 2.0 通用铁律（四个内置渠道 + 模板渠道一律适用）

| # | 铁律 | 违反表现 | 校验手段 |
| :--- | :--- | :--- | :--- |
| 1 | 驱动是**纯函数**：不发真实网络、不读 `Date.now()`、不读 Keychain | 单测需要 mock 网络 ⇒ 不可回放 | `contract.spec.ts` 注入 `Clock`/`AuthBoundHttp` 桩 |
| 2 | 单次 `fetch_snapshot` 最多 **3 个 HTTP 请求**，总预算 **20s**；单请求超时 ≤10s | 一次探活打爆上游 | `diagnostics.requests ≤ 3` 断言 |
| 3 | `HttpRequestSpec.headers` **禁含** `authorization` / `cookie` / `x-api-key` | 令牌进 JS 堆（破硬规则 4） | `assertSafeHeaders` 抛 `CredentialLeakError` |
| 4 | `DriverError.message` 必须是**写死的中文模板**，禁止拼接响应体 | 上游 HTML 把 token 回显进 UI | fixture 走查 + 错误文案表比对 |
| 5 | 响应**先判 HTML 再判 JSON**（`content-type` 含 `text/html` 或以 `<` 开头） | 网关页被当 JSON 解析，整轮解析崩 | fixture `html_gateway.json` |
| 6 | 未知顶层字段 → 写 `schema_warnings`（只记字段名），**不抛异常** | 上游加字段就全线挂掉 | `schema_drift.json` |
| 7 | 所有比例 `clamp01`，越界规则见 §2.8；`exhausted` 严格等于 `ratio===0` | 环画到圈外 | I3 / I7 |
| 8 | 不写任何日志到磁盘；需要排障只返回 `diagnostics` | 日志泄漏 | 驱动层无文件 IO（静态扫描） |

### 2.1 凭据形态（Keychain 条目 JSON，**永不跨 IPC**）

```ts
/**
 * Keychain 条目值（v1）。只存在于 Rust 堆；IPC 只返回 CredentialLease。
 * 类型放在这里是为了让 Rust serde 与 TS 侧字段一一对应，不是给 JS 读的。
 */
export interface StoredCredentialV1 {
  /** 结构版本，固定 1；升级时新增 v2 并做迁移 */
  readonly v: 1;
  /** 授权方式 */
  readonly flow: AuthFlowType;
  /** 访问令牌（明文，仅 Rust） */
  readonly access_token: string;
  /** 刷新令牌；不可刷新渠道为 null */
  readonly refresh_token: string | null;
  /** 到期时刻（毫秒）；未知为 null（此时只在 401 时刷新） */
  readonly expires_at: EpochMillis | null;
  /** 授权范围，如 ['usage:read'] */
  readonly scopes: readonly string[];
  /** 绑定站点 */
  readonly region: RegionScope;
  /** 主体明文（email / 工号），仅在 Rust 内脱敏后输出 masked 形态 */
  readonly subject: string | null;
  /** 端点提示：旧接口退役后用于切换备用端点 */
  readonly endpoint_hint: 'primary' | 'fallback';
  /** 非敏感附加头（如 ChatGPT-Account-Id、X-User-Id） */
  readonly extra_headers: Readonly<Record<string, string>>;
}
```

| 字段 | claude | codex | workbuddy | gemini | custom.* |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `flow` | `cli_session_reuse` / `oauth_pkce` / `manual_token` | `oauth_pkce` / `device_code` / `manual_token` | `device_code` / `manual_token` | `cli_command` / `session_cookie` | `manual_token` / `session_cookie` |
| `refresh_token` | 必填（除 manual_token） | null | null | null | null |
| `expires_at` | 必填（除 manual_token） | null | null | null（cookie 会话） | null |
| `region` | 恒 `global` | 恒 `global` | **`cn` / `intl` 必填** | 恒 `global` | 恒 `global` |
| `extra_headers` | 无 | **`ChatGPT-Account-Id` 必填** | `X-User-Id` 必填，`X-Enterprise-Id` / `X-Domain` 可选 | 无 | 用户给定 |
| Keychain account 键 | `claude:<id>` | `codex:<id>` | `workbuddy:<id>:<region>` | `gemini:<id>` | `custom.<name>:<id>` |
| 条目来源 | HUD 自建，或只读引用 `Claude Code-credentials`（回退 `~/.claude/.credentials.json`） | `~/.codex/auth.json` 或 keyring `Codex Auth` | HUD 自建（设备码） | `agy` 登录态 / 浏览器 cookie | HUD 自建 |

> **引用型凭据**（Claude Code / Codex CLI 已有登录）：HUD 只读引用，不复制、不刷新写回；刷新交由 CLI 完成，HUD 只检测 `revision` 变化后重新取租约。

---

### 2.2 `claude` — 双滑动窗口

**凭据形态**：`cli_session_reuse`（推荐，读 Claude Code 条目）/ `oauth_pkce` / `manual_token`（无刷新能力）。

| 项 | 值 |
| :--- | :--- |
| 探活端点 | `GET https://api.anthropic.com/api/oauth/usage` |
| 必需头 | `anthropic-beta: oauth-2025-04-20`（业务头）；`Authorization` 由租约注入，**禁止出现在 spec 里** |
| 刷新端点 | `POST https://api.anthropic.com/api/oauth/token`，body `{"grant_type":"refresh_token"}`，`store_mode='merge'`，`expires_at ← expires_in`（`epoch_ms_from_now`） |
| 超时 / 上限 | 10 000 ms / 262 144 bytes |
| `allowed_origins` | `https://api.anthropic.com` |
| `can_refresh` | `true` |
| `schema_version` | `claude.v1` |
| 卡片形态 | `dual_sliding_window`（外环 5h、内环 1w，中心取二者 `min`） |

**归一化映射（字段 → 目标 → 缺省/异常）**

| 上游字段 | 目标字段 | 缺省 / 异常处理 |
| :--- | :--- | :--- |
| `five_hour.utilization`（0–100，已用） | `windows['five_hour'].remaining_ratio = clamp01(1 − u/100)` | 非数字 → 不产出该窗口 + `schema_warnings`；越界见 §2.8 |
| `five_hour.resets_at`（ISO8601） | `windows['five_hour'].resets_at` | `Date.parse` 失败 → `null`（**不猜**）；过去时刻保留不显示倒计时 |
| `five_hour` 存在 | 追加窗口 | `id='five_hour'`、`label='5 小时窗口'`、`duration_secs=18000`、`scope='account'`、`source_field='five_hour.utilization'` |
| `seven_day.*` | 追加窗口 | `id='seven_day'`、`label='周窗口'`、`duration_secs=604800` |
| `seven_day_opus.*` | 追加窗口 | `scope={model:'opus'}`、`id='seven_day_opus'`；**不进卡片主环**，仅详情页 |
| `extra_usage.amount_cents` | `reading.extra_usage_cents` | 缺失 → `null`；不动任何 ratio，详情页显示「额外用量 $4.20」 |
| 顶层未知键 | `diagnostics.schema_warnings` | 只记键名，例：`Unrecognized top-level field: "seven_day_sonnet"` |
| 一个窗口都没有 | **失败** | `driverError('parse_error', {message:'No valid quota windows could be extracted from response'})` |

**错误分类**

| 上游信号 | class | upstream_code | 中文文案（写死） |
| :--- | :--- | :--- | :--- |
| 401 | `auth` | `auth_expired` | 令牌已过期或被撤销 |
| 429（取 `Retry-After`） | `rate_limit` | `rate_limited` | Claude 接口限流 |
| `text/html` / 首字符 `<` | `schema` | `parse_error` | 收到网关页面而非数据 |
| 5xx | `http` | `HTTP_<status>` | Anthropic 服务异常 |
| 网络异常 / 超时 | `network` / `timeout` | — | 网络不可达 / 请求超时 |

**刷新特殊规则（写进 `refresh.ts` 注释与测试）**

1. 刷新前重读一次凭据指纹；`revision` 与租约不一致 ⇒ **放弃刷新**，重取租约后直接 fetch（本机 CLI 已轮换）；
2. 刷新成功立即写回 Keychain 并使旧租约失效（`lease_id` 单次有效）；
3. 刷新失败**绝不删除**旧凭据（用户手动开终端仍能登录）；
4. 同一 `(provider, account_id)` 单飞刷新：Claude refresh token 一次性使用，并发刷新会把用户登出。

---

### 2.3 `codex` — 模型级窗口

**凭据形态**：`oauth_pkce` / `device_code` / `manual_token`；凭据来自 `~/.codex/auth.json` 或 keyring `Codex Auth`，**无 refresh_token（`can_refresh=false`）**。

| 项 | 值 |
| :--- | :--- |
| 探活端点 | `GET https://chatgpt.com/backend-api/wham/usage` |
| 必需头 | `ChatGPT-Account-Id`（来自 `lease.extra_headers`）；缺失直接判 `auth_expired`，文案「请用 Codex CLI 重新登录」 |
| 刷新 | 不支持（`{ok:false, unsupported:true}`） |
| 超时 / 上限 | 10 000 ms / 262 144 bytes |
| `allowed_origins` | `https://chatgpt.com` |
| `schema_version` | `codex.v1` |
| 卡片形态 | `dual_sliding_window`（取**最紧张模型对**） |

**归一化映射**

| 上游字段 | 目标字段 | 缺省 / 异常处理 |
| :--- | :--- | :--- |
| `rate_limit.by_model[m].primary_window.used_percent` | `windows['model:<m>:primary'].remaining_ratio = clamp01(1 − p/100)` | 非数字 → 跳过该项；`by_model` 支持**对象与数组**两种形态（数组记 warning） |
| `rate_limit.by_model[m].secondary_window.used_percent` | `windows['model:<m>:secondary']` | 同上；`scope={model:m}` |
| `*.limit_window_seconds` | `duration_secs` + `label` | `18000→'5 小时窗口'`、`604800→'周窗口'`、其他按整日/整时/整分格式化为 `'N 天/小时/分钟窗口'`；缺失 → `null` + `label='配额窗口'`（**不假设时长**） |
| `*.reset_at`（Unix **秒**） | `resets_at = ×1000` | `0` / 缺失 / 非数字 → `null` |
| `rate_limit.primary_window` / `secondary_window`（无 `by_model` 时） | `windows['primary'/'secondary']`，`scope='account'` | 账号级退化两窗 |
| `credits.balance` | `reading.credits_balance` | 缺失 → `null`；不参与 ratio，卡片副行「credits 12.4k」 |
| `rate_limit_reset_credits.available_count` | `reading.reset_credits` | 缺失 → `null`；详情页「可用重置券 2 张」 |
| 所有窗口都为空 | **失败** | `driverError('parse_error')` |

**模型选择（`selectPrimaryWindows`，纯函数）**

1. 按 `scope.model` 分组；2. 每组 `pairWorst = min(primary, secondary)`；3. 取 `pairWorst` 最小者为主读数（最紧张模型）；4. 并列按模型名升序（避免卡片抖动）；5. 其余模型的窗口进 `extra`，只在详情页分行展示。

**错误分类**：401 → `auth`（`auth_expired`）；429 → `rate_limit`（含 `Retry-After`）；403 → `http`，`upstream_code='plan_mismatch'`，文案「当前订阅不含该功能」；HTML/非 JSON → `schema`。

> Codex 是最容易被自己的轮询打到 429 的渠道（同一账号 5h 窗高频）。因此 `poll_policy` 与 claude 相同但**必须**尊重 `Retry-After`，且近 24h 内出现过 429 时 `base×2`（见 §3.3 放宽触发）。

---

### 2.4 `workbuddy` — 积分池 + 双站点（**必选交付**）

**凭据形态**：`device_code`（8 位配对码，主路径）/ `manual_token`（企业只读 Key）。凭据**绑站点**，`region` 参与 `account_id` 生成。

| 项 | 值 |
| :--- | :--- |
| 探活端点 | `POST {host}/billing/meter/get-user-resource-summary`，`content-type: application/json`，body `{}` |
| `host` | `region='cn'` → `https://workbuddy.cn`（`codebuddy.cn` 同站）；`region='intl'` → `https://workbuddy.ai` |
| 必需头 | `X-User-Id`（必填）、`X-Enterprise-Id` / `X-Domain`（可选），均来自 `lease.extra_headers` |
| 刷新 | 不支持（`can_refresh=false`） |
| 超时 / 上限 | 10 000 ms / 262 144 bytes |
| `allowed_origins` | `https://workbuddy.cn`、`https://workbuddy.ai`、`https://codebuddy.cn` |
| `region_scoped` | `true` |
| `schema_version` | `workbuddy.v1` |
| 卡片形态 | `credits_pool`（积分环 48px + 中心绝对值「15.2k」） |

**站点一致性预检（第一步，先于任何网络请求）**

```
if (!regionRouter.isMatch(account.region, lease.region)) → auth / region_mismatch / 「该凭据属于另一站点，请重新授权」
```

错配检测的第二道：`401|403` **且** `content-type` 含 `text/html` 或 body 以 `<!doctype`/`<html`/`<div` 开头 ⇒ 同样归 `region_mismatch`（上游网关返回登录页 HTML 是这条渠道的已知形态，绝不能被当 JSON 解析）。

**归一化映射**

| 上游字段 | 目标字段 | 缺省 / 异常处理 |
| :--- | :--- | :--- |
| `summary.totalRemaining`（或 `data.summary.totalRemaining`） | `pool.remaining`（唯一事实源） | 缺失 → 由未过期 `packages[].remaining` 求和，`quality='derived'`，`source_field='packages.activeRemaining'` + warning |
| `summary.totalCapacity` | `pool.total` | 缺失 → 未过期包 `total` 求和；仍无 → `null` |
| 二者皆有且 `total > 0` | `pool.remaining_ratio = clamp01(remaining/total)` | `total === null` 或 `0` ⇒ **`remaining_ratio = null`**（环只描轨，不画比例） |
| `packages[i].id / name / label` | `CreditPackage.id / label` | 缺失 → `pkg_<i>` / `'积分包 #<i>'` |
| `packages[i].total` 或 `capacity` | `CreditPackage.total` | 都缺失 → `0`（唯一允许 0 的位置：**包自身的额度字段**，不是账号读数） |
| `packages[i].remaining` / `used` | `CreditPackage.remaining` | 有 `remaining` 用之；否则 `max(0, total − used)`；都无 → `total` |
| `packages[i].expired` / `expireAt` | `expired` | 显式 `expired` 优先；否则 `expireAt <= now` 判过期 |
| 过期包 | 保留在 `packages`，**不计入** `remaining`/`total` | 详情页置灰 + 「已过期」标签 |
| 未过期包最近的 `expireAt` | `pool.expires_at` | 无到期 → `null` |
| `usage[]` | 详情页 24h/30d 柱状 | 只做展示，不参与 ratio |
| `summary` 与 `packages` 都缺失 | **失败** | `driverError('parse_error', 'WorkBuddy payload contains neither valid summary nor packages')` |

**错误分类**：`401`（非 HTML）→ `auth` / `invalid_token` /「凭据已过期或无效，请重新登录」；`401|403` + HTML → `auth` / `region_mismatch`；`429` → `rate_limit` + `Retry-After`；其他非 2xx → `http`。

**设备码规格**：8 位码（`XXXX-XXXX`），有效期 900s，轮询间隔取服务端 `interval`（最小 5s），`slow_down` 时 +5s，用户取消即 `cancelled`。

---

### 2.5 `gemini` — 单周期 + 旧接口停服

**凭据形态**：`cli_command`（`agy` CLI 登录态，**首选**）/ `session_cookie`（浏览器导入）。无刷新能力。

| 通道 | 端点 / 命令 | 状态 | 处理 |
| :--- | :--- | :--- | :--- |
| CLI（首选） | `agy -p /usage --output-format json`（8s 超时，stdout ≤256KB） | 可用（Antigravity CLI ≥1.1.11） | `cli.run`，`diagnostics.requests = 0` |
| Cookie / Web | `GET https://gemini.google.com/usage`（cookie 鉴权） | 可用（需登录态） | 回退通道 |
| **旧配额接口** | `v1internal:retrieveUserQuota` | **已停服** | 见下方警告 |

> ### ⚠️ 已知会 403 的旧界面：不要实现、不要重试
> `v1internal:retrieveUserQuota` 自 **2026-06-18** 起对消费级账号停服，稳定返回 **403 `SUBSCRIPTION_REQUIRED`**（部分账号返回退役 HTML 页）。任何仍指向该端点的实现都会在首屏看到「渠道已停服」并在每次轮询白烧一次请求。
> **正确做法**：走 `agy` CLI 桥；命中 403 时**不重试**，转 `service_deprecated`，卡片给「迁移指南」入口，`retry_at = now + 24h`。
> 若某账号在未改动代码的情况下从 2xx 变为 404/403，判定为上游退役，而不是网络问题——否则会被退避机制无限重试成 429。

| 项 | 值 |
| :--- | :--- |
| `allowed_origins` | `https://cloudcode-pa.googleapis.com`、`https://gemini.google.com` |
| `cli_commands` | `['agy']` |
| `can_refresh` | `false` |
| `schema_version` | `gemini.v1` |
| 卡片形态 | `single_periodic_window`（单环 48px；详情 74px 单大环） |

**归一化映射（CLI 与 Cookie 两条通道共用同一套规则，只是根节点不同）**

| 上游字段（根可为 `quota` / `user_quota` / `data` / `data.userQuota`） | 目标字段 | 缺省 / 异常处理 |
| :--- | :--- | :--- |
| `remaining_ratio` / `remainingRatio` | `remaining_ratio` | 直接 clamp01 |
| `remaining` + `total`（`total>0`） | `remaining_ratio = clamp01(remaining/total)` | `total<=0` → 该来源不可用，继续尝试下一来源 |
| `used` + `limit`（`limit>0`） | `remaining_ratio = clamp01(1 − used/limit)` | 同上 |
| `used_percent` / `utilization`（已用 0–100） | `remaining_ratio = clamp01(1 − p/100)` | 越界见 §2.8 |
| 全部来源都拿不到比例 | **失败** | `driverError('parse_error', 'Unable to derive remaining_ratio from Gemini CLI output')` |
| `duration_secs` / `period_seconds` | `duration_secs`（默认 604800） | 缺失 → 604800 + `label='周窗口'`；3600×N 推算日窗 |
| 复位时间（`resets_at` / `reset_at`） | `resets_at` | 秒/毫秒/ISO 三种都接受；无法解析 → `null` |
| 空 body / 空 stdout | **失败** | `schema` / `empty_response` /「Gemini CLI 响应内容为空」 |
| 非 JSON | **失败** | `schema` / `parse_error` |

**停服识别（三条任一命中即 `deprecated`，且不再重试）**

| # | 命中条件 | upstream_code | migration_hint |
| :--- | :--- | :--- | :--- |
| 1 | HTTP 403 且 body 含 `subscription_required` / `retired` / `deprecated` | `SUBSCRIPTION_REQUIRED` | 安装 Antigravity CLI 1.1.11+ 并通过 `agy` 授权 |
| 2 | HTTP 404 且该账号曾在此端点 2xx | `endpoint_retired` | 切换至 Antigravity CLI 授权模式 |
| 3 | `text/html` 且含 `deprecated` / `no longer available` | `html_deprecated` | 同上 |

**卡片文案（唯一）**：主文案「渠道已停服」，副文案「接口已退役，等待更新」，数值区 `—`，环为断点轨道（`mode='deprecated'`），按钮「迁移指南」。

---

### 2.6 `custom.<name>` — 第 5 个首发位（模板渠道）

| 项 | 规则 |
| :--- | :--- |
| 凭据 | `manual_token`（自定义 Header 名 + 值）/ `session_cookie`（整条 Cookie 头） |
| 探针 | URL 由用户给定，必须 `https:`，且 origin 进 `allowed_origins`（运行时追加） |
| 字段映射 | 用户给定三条 JSONPath：`remaining_path`（必填）、`total_path`（可选）、`reset_path`（可选）；解析后走 §2.8 同一套 clamp/异常规则 |
| 形态 | 有 `remaining_ratio` ⇒ `single_periodic_window`；仅绝对值 ⇒ `credits_pool`（`total=null` 时只描轨） |
| 限制 | 不允许 `region`；不允许自定义健康状态与文案（硬规则 8） |
| 校验 | 保存前必须发一次探查请求：非 2xx 或映射解析失败即拒绝保存，提示具体缺失字段名（**不回显取值**） |

---

### 2.7 HTTP → `DriverErrorClass` → `AccountHealthState` 统一映射

这是**唯一**允许决定健康状态的表；驱动只产出 `DriverErrorClass`，状态由状态机（§3.5）按此表推进。

| HTTP / 事件 | class | upstream_code 示例 | → state | 是否重试 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 200 + 解析成功 | — | — | `normal` | — | 必须过 I1–I10 |
| 401（刷新失败或不可刷新） | `auth` | `auth_expired` / `invalid_token` | `auth_expired` | **否** | `retry_at=null`，停自动轮询 |
| 401 + `region_mismatch`（workbuddy） | `auth` | `region_mismatch` | `auth_expired` | 否 | 文案「该凭据属于另一站点，请重新授权」 |
| 403 + `SUBSCRIPTION_REQUIRED` / 退役 | `deprecated` | `SUBSCRIPTION_REQUIRED` | `service_deprecated` | 24h 一次 | 迁移入口常驻 |
| 403（计划不符，非退役） | `http` | `plan_mismatch` | `offline_stale` | 是 | 视为可恢复的上游拒绝 |
| 404（曾 2xx） | `deprecated` | `endpoint_retired` | `service_deprecated` | 24h 一次 | 端点退役 |
| 429 | `rate_limit` | `rate_limited` | `rate_limited` | 按 `retry_at` | 尊重 `Retry-After` |
| 5xx | `http` | `HTTP_500` | `offline_stale` | 是（退避） | |
| `text/html` 网关页 | `schema` | `parse_error` | `offline_stale`（`reason='gateway_html'`） | 是（退避） | reason 用 `gateway_html` 便于区分 |
| JSON 解析失败 / 结构漂移 | `schema` | `parse_error` / `schema_mismatch` | `parse_degraded` | 是（退避） | 保留最后读数 |
| 数值越界（见 §2.8） | `schema` | `value_out_of_range` | `parse_degraded` | 是（退避） | **不产出部分读数** |
| DNS / 连接重置 / 超时 | `network` / `timeout` | — | `offline_stale` | 是（退避） | |

### 2.8 数值越界的统一处理（裁决 D-11）

旧文档冲突：`ARCHITECTURE §5.2` 说越界 `clamped` 后照常展示；`FLOWS §1.2 G4` 说越界即 `ParseDegraded`。**裁决如下**，因为硬规则 2 不允许把垃圾数据渲染成 0%/100%：

| 偏差 | 处理 | 产物 |
| :--- | :--- | :--- |
| 比例偏差 ≤ 0.5（浮点噪声，如 `utilization=100.3`） | clamp 到 `[0,1]` | `quality='clamped'`，正常展示 |
| 比例偏差 > 0.5，或出现 `NaN` / `Infinity` / 负值 | **整次探活失败** | `driverError('value_out_of_range')` → `parse_degraded`；不写 `usage_samples`；卡片走「数据格式异常」+ 最后已知值 |

> 不做「部分窗口可信就展示部分」：卡片主环取的是最紧张窗口，若其中一个窗口被判越界，取哪一个都可能误导。整轮降级比展示一个可疑数字更安全。

### 2.9 每渠道汇总（实现方一张表看完）

| 渠道 | 端点 | 形态 | 刷新 | 超时 | 请求数 | `schema_version` | 已知坑 |
| :--- | :--- | :--- | :--- | ---: | ---: | :--- | :--- |
| claude | `GET api.anthropic.com/api/oauth/usage` | 双环 | 是 | 10s | 1 | `claude.v1` | 401 常来自本机 CLI 轮换竞态（先比 `revision`） |
| codex | `GET chatgpt.com/backend-api/wham/usage` | 双环（模型对） | 否 | 10s | 1 | `codex.v1` | 缺 `ChatGPT-Account-Id` 就是 401；窗口时长靠 `limit_window_seconds` 自描述 |
| workbuddy | `POST {cn\|intl}/billing/meter/get-user-resource-summary` | 积分环 | 否 | 10s | 1 | `workbuddy.v1` | 401 可能是 HTML 网关页（站点错配）；积分只以 `totalRemaining` 为准 |
| gemini | `agy -p /usage`（首选）/ `GET gemini.google.com/usage` | 单环 | 否 | 8s / 10s | 0 / 1 | `gemini.v1` | **旧接口 403 已停服**；空 stdout 必须判 `empty_response` |
| custom.* | 用户给定 | 单环/积分环 | 否 | 10s | 1 | `custom.v1` | 保存前必须试探一次 |

---

## 3. 调度器与熔断器

### 3.1 组件边界（三条死规矩）

1. **调度器不 import 任何具体驱动**（只用 `ChannelDriver` 接口）；策略一律从 `DriverRegistry.get(provider).poll_policy` 取。
   > 现状：`core/tests/layering.spec.ts` 曾因 `scheduler/poller.ts` 出现渠道字面量而变红。原因是按渠道名写分支（「gemini 慢一点」这类补丁）。**替代做法**：把差异放进各驱动的 `poll_policy`，调度器零渠道分支。
2. **单账号单飞**：同一 `account_id` 任意时刻最多 1 个在途请求；面板打开、手动刷新、心跳三路触发必须合并到同一个在途 Promise。
3. **失败只改自己**：`Promise.allSettled` 聚合，任一 rejection 只记日志，**绝不** `await` 全局锁、绝不取消同批其他账号。

```ts
/** 调度表中的账号（绝对时刻持久化，重启/唤醒后按 due_at 恢复）。 */
export interface ScheduledAccount {
  readonly account_id: string;
  readonly provider: ProviderKind;
  /** 下次应探测的绝对时刻（毫秒） */
  readonly due_at: EpochMillis;
  /** 最近一次实际发起时刻 */
  readonly last_attempt_at: EpochMillis | null;
  /** 最近一次成功时刻 */
  readonly last_success_at: EpochMillis | null;
  /** 是否有在途请求（幂等守卫 + 渠道串行守卫） */
  readonly in_flight: boolean;
  readonly state: AccountHealthState;
  readonly consecutive_failures: number;
  /** 冷却到期时刻；非空 ⇒ 此刻前不应被选中 */
  readonly retry_at: EpochMillis | null;
  /** 该账号所属渠道的策略（来自驱动，调度器只读） */
  readonly poll_policy: PollPolicy;
  /** 当前可比较的剩余比例（用于「最紧张 3 个」选择）；未知为 null */
  readonly remaining_ratio: number | null;
}

/** 一次 tick 的执行报告（用于可观测性与测试断言）。 */
export interface TickResult {
  /** 本批真正发起请求的账号 */
  readonly processedAccountIds: readonly string[];
  /** 因「同渠道已有在途」被跳过的账号 */
  readonly skippedDueToProviderInFlight: readonly string[];
  /** 因冷却未到期被跳过的账号 */
  readonly skippedDueToCooldown: readonly string[];
}

/** 探活执行器：由装配层把 driver.fetch_snapshot + 租约 + 存储 串起来。 */
export type FetchHandler = (
  account: ScheduledAccount,
  signal?: AbortSignal
) => Promise<FetchOutcome>;

/** 调度器端口（实现放 core/src/scheduler/poller.ts）。 */
export interface Scheduler {
  /** 注册/更新账号；幂等（同 id 覆盖，不叠加重试计数） */
  add_account(input: {
    readonly account_id: string;
    readonly provider: ProviderKind;
    readonly state?: AccountHealthState;
    readonly due_at?: EpochMillis;
    readonly poll_policy?: PollPolicy;
    readonly remaining_ratio?: number | null;
  }): ScheduledAccount;
  remove_account(account_id: string): boolean;
  snapshot(): readonly ScheduledAccount[];
  /**
   * 一次心跳：只处理 due_at <= now 且无在途 的账号。
   * 幂等 —— 重复调用（心跳抖动、双窗口）不会重复发同一账号的请求。
   */
  tick(now: EpochMillis): Promise<TickResult>;
  /** 面板打开：对「剩余最低的 3 个 normal 账号」即时刷新（受 last_attempt_at + 60s 防抖） */
  panel_opened(now: EpochMillis): Promise<TickResult>;
  /** 系统唤醒：分批补偿（见 §3.2 第 5 条），不并发全刷 */
  system_wake(now: EpochMillis): Promise<TickResult>;
  /** 用户手动重试：把 retry_at 提前到 now，但**不清空** consecutive_failures */
  retry_now(account_id: string, now: EpochMillis): void;
}
```

### 3.2 `tick` 伪代码（可直接照抄成实现）

```text
tick(now):
  # 1. 候选集：到期、无在途、不在冷却期、不是 auth_expired（停止自动轮询）
  candidates = [a for a in accounts
                if a.due_at <= now
                and not a.in_flight
                and a.state != 'auth_expired'
                and (a.retry_at == null or a.retry_at <= now)]

  # 2. 稳定排序：due_at 升序；并列按 account_id 升序（避免抖动导致重复挑选）
  sort(candidates, key=(due_at, account_id))

  # 3. 组批：全局上限 3，同渠道最多 1（D-02）
  batch = []; providers_in_batch = set(); skipped_provider = []; skipped_cooldown = []
  for a in candidates:
      if len(batch) >= CONCURRENCY_GLOBAL(3): break
      if a.provider in providers_in_batch or any_in_flight(a.provider):
          skipped_provider.append(a.account_id); continue
      batch.append(a); providers_in_batch.add(a.provider)

  # 4. 在途标记（在 await 之前完成，保证幂等）
  for a in batch:
      a.in_flight = true
      a.last_attempt_at = now

  # 5. 并发执行 + 按账号隔离熔断
  results = await allSettled([fetch_one(a, now) for a in batch])
  for r in results: if r.rejected: log_warn(redact(r.reason))   # 不重抛、不影响他人

  return TickResult(processed=batch.ids, skipped_provider, skipped_cooldown)

fetch_one(a, now):
  try:
    outcome = execute_fetch(a)                       # driver.fetch_snapshot + 租约
    if outcome.ok:
        reject_if_invariant_violated(outcome.reading) # I1–I10，违规即按 schema 失败处理
        a.reading = outcome.reading
        a.remaining_ratio = min_ratio(outcome.reading)
        a.state = 'normal'; a.consecutive_failures = 0; a.retry_at = null
        a.last_success_at = now
        store.record_samples(sample_from(a, now))     # 只写 Normal，桶=整点
        a.due_at = now + jitter(a.policy.base_interval_secs * 1000, a.policy.jitter_ratio)
    else:
        a.consecutive_failures += 1
        next_state = map_error_to_state(outcome.error)    # §2.7
        side_effects(a, next_state, outcome.error, now)   # §3.5 副作用列
        a.state = next_state
  finally:
    a.in_flight = false
```

**补充规则（每条都可测）**

| # | 规则 | 验收 |
| :--- | :--- | :--- |
| 1 | 全局并发 3；同渠道并发 1（D-02） | 4 个账号（2 claude + 2 codex）同时到期 ⇒ 一次 tick 只发 1 个 claude + 1 个 codex |
| 2 | tick 幂等 | 连续调用 2 次（同一 now）⇒ 第 2 次 `processedAccountIds` 为空 |
| 3 | 唤醒补偿按 200ms 分批、每批 ≤3、总预算 20s；超预算的账号保持 `due`，下一心跳继续 | 20 个账号唤醒：20s 内最多处理 9 个，其余 `due_at` 不变 |
| 4 | 面板打开只刷「最低 3 个 normal」，受 `last_attempt_at + 60s` 防抖 | 5s 内重复打开面板 ⇒ 只发 1 轮 |
| 5 | 失败只改自己 `due_at`，同批其他账号照常写入 | 隔离用例见 §3.7 |
| 6 | `auth_expired` 不进候选集；只有凭据 `revision` 变化或用户手动重试才回到调度 | 401 后 30 分钟内 0 次自动请求（30min 时仅 1 次只读探测） |
| 7 | 所有时刻基于绝对 `due_at`，不用 `setInterval` 累加 | 休眠 2h 唤醒后不应出现补偿式连发（走第 3 条） |

### 3.3 轮询参数（**以代码为准**，见 D-03）

| 渠道 | `base` | `min` | `max` | `idle` | `reset_watch` | `jitter` | 退避 `base/factor/max` | `stale_ttl` |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- | ---: |
| claude | 300s | 120s | 900s | 900s | 900s | ±10% | 60 / 2 / 3600 | 660s |
| codex | 300s | 120s | 900s | 900s | 900s | ±10% | 60 / 2 / 3600 | 660s |
| workbuddy | 600s | 120s | 1800s | 1200s | 60s | ±10% | 60 / 2 / 1800 | 1260s |
| gemini | 900s | 120s | 3600s | 1800s | 120s | ±10% | 60 / 2 / 3600 | 1860s |

> `stale_ttl = 2 × base + 60`（D-09）。注册表构造期强校验：`120 ≤ min ≤ base ≤ max ≤ 3600`、`jitter ∈ [0,0.5]`、`max_secs ≥ base_secs ≥ 30`，任一不满足**启动即失败**（`RegistryError`）。

**收紧（提速）触发**

| 渠道 | 条件 | 目标间隔 |
| :--- | :--- | :--- |
| claude / codex | 主窗口 `remaining_ratio === 0` 且 `resets_at − now ≤ reset_watch_secs` | `min`（120s） |
| workbuddy | `pool.remaining_ratio !== null && < 0.10` | `min`（120s） |
| gemini | 单窗 `remaining_ratio < 0.20` | 600s（不直接跳到 min，避免 CLI 8s 进程开销） |
| 任意 | 用户手动「立即刷新」 | 立即一次（60s 防抖） |

**放宽（降频）触发**

| 渠道 | 条件 | 目标间隔 |
| :--- | :--- | :--- |
| 任意 | 连续 6 次成功且读数变化绝对值 < 0.02 | `base × 1.5`（≤ `max`） |
| codex | 近 24h 出现 429 | `base × 2`（≤ `max`） |
| gemini | CLI 通道耗时 > 3s（连续 3 次） | `base × 2`（≤ `max`） |
| 任意 | 面板关闭且 30min 无交互 | `idle` |

**并发与配额约束**：`reset_watch` 同时最多 **4 个账号**享受提速（请求量封顶）；被隐藏账号不参与提速与通知。

### 3.4 指数退避与 `Retry-After`

```ts
/** 失败后的下次到期时刻（纯函数，便于单测）。 */
export declare function nextDueAfterFailure(
  policy: PollPolicy,
  consecutive: number,
  retryAfterSecs: number | null,
  now: EpochMillis,
  options?: { readonly recent429Count1m?: number }
): EpochMillis;

// 规范公式（实现必须逐条等价，单测 U12 覆盖 §3.4 两张表全部行）：
//   base = backoff.base_secs
//   若 recent429Count1m ≥ 3  →  base = base × 2^(recent429Count1m − 2)
//   local = min(base × factor^(max(0, consecutive − 1)), backoff.max_secs)
//   若 retryAfterSecs === null → due = now + local × 1000
//   否则 honored = clamp(retryAfterSecs, retry_after_clamp[0], retry_after_clamp[1])
//        due = now + max(honored, local) × 1000        // 服务端优先，但本地可更长

/** 抖动：±jitter_ratio，clamp 到 [0,0.5]，四舍五入到毫秒。 */
export declare function applyJitter(
  intervalMs: number,
  jitterRatio?: number,
  randomFn?: () => number
): number;
```

| 连续失败 `n` | 本地退避（`base=60, factor=2`） | 叠加 `Retry-After: 45` 后 | 说明 |
| ---: | ---: | ---: | :--- |
| 1 | 60s | 60s | 服务端更短 ⇒ 取本地（本地不可更短） |
| 2 | 120s | 120s | |
| 3 | 240s | 240s | 一分钟内第 3 次 429：基数翻倍 ⇒ 实际 480s |
| 4 | 480s | 480s | |
| 6 | 1920s | 1920s | |
| 7 | 3600s（封顶） | 3600s | workbuddy 封顶 1800s |

**`Retry-After` 解析表**

| 输入 | 结果 | 理由 |
| :--- | ---: | :--- |
| `"45"` | 45s | 纯秒数 |
| `"Wed, 21 Oct 2026 07:28:00 GMT"`（未来） | `date − now` 秒，钳到 ≤7200 | HTTP-date |
| 同一 header 但已过去 | 5s | 防紧密循环 |
| 缺失 / `""` / 非数字 | 60s | 默认一分钟 |
| `"1"` | 5s | 下限防刷 |
| `"99999"` | 7200s，状态仍 `rate_limited`，下轮继续 | 上限 |

### 3.5 熔断状态机（7 态 × 事件 → 目标状态）

行=当前状态，列=事件；`—` 表示不可能的输入（收到即视为程序错误并记 error 日志，**不改状态**）。

| 当前 \ 事件 | `probe_success` | `network_failure` / `ttl_expired` | `auth_401` | `rate_limited` | `service_deprecated` | `parse_degraded` | `user_reauth_ok` | `user_retry` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `never_synced` | `normal` | `never_synced` | `auth_expired` | `rate_limited` | `service_deprecated` | `parse_degraded` | — | `never_synced` |
| `normal` | `normal` | `offline_stale` | `auth_expired` | `rate_limited` | `service_deprecated` | `parse_degraded` | — | `normal` |
| `offline_stale` | `normal` | `offline_stale` | `auth_expired` | `rate_limited` | `service_deprecated` | `parse_degraded` | — | `offline_stale` |
| `auth_expired` | `normal`（仅当 `revision` 变化） | `auth_expired` | `auth_expired` | `auth_expired` | `service_deprecated` | `auth_expired` | `normal` | `auth_expired` |
| `rate_limited` | `normal` | `rate_limited` | `auth_expired` | `rate_limited` | `service_deprecated` | `parse_degraded` | — | `rate_limited` |
| `service_deprecated` | `normal` | `service_deprecated` | `service_deprecated` | `service_deprecated` | `service_deprecated` | `service_deprecated` | — | `service_deprecated` |
| `parse_degraded` | `normal` | `offline_stale` | `auth_expired` | `rate_limited` | `service_deprecated` | `parse_degraded` | — | `parse_degraded` |

**副作用（每次迁移必须落库并写 events，可回放）**

| 目标状态 | 必写副作用 | 恢复条件 | 禁止 |
| :--- | :--- | :--- | :--- |
| `normal` | `consecutive_failures=0`、`retry_at=null`、`last_success_at=now`、`reading_observed_at=last_success_at`、写 1 条 `usage_samples` | — | 不得在读数非法时进 normal |
| `offline_stale` | `consecutive_failures+=1`、`retry_at=nextDueAfterFailure(...)`、**保留 `reading` 与 `last_success_at`** | 下次成功 | 不得清空读数；不得把 reason 写成 `auth_401` |
| `auth_expired` | `retry_at=null`（**停止轮询**）、`auth_action='reauth'`、保留读数、发 1 次系统通知 | 凭据 `revision` 变化后成功 / 用户重新授权 | 不得自动 refresh 循环（30min 仅 1 次只读探测） |
| `rate_limited` | `retry_at = now + clamp(Retry-After)`、`consecutive_failures+=1`、`429_counter_1h += 1` | `now ≥ retry_at` 且成功 | 不得在这期间触发 token 刷新 |
| `service_deprecated` | `retry_at = now + 24h`（±30min 抖动）、`migration_hint` 落库、UI 常驻迁移入口 | 24h 探测成功 / `schema_version` 随升级变化后成功 | 不得高频重试 |
| `parse_degraded` | `retry_at = nextDueAfterFailure(...)`、保留读数、**不写 usage_samples** | 下次成功 | 不得把越界值 clamp 后当正常展示（D-11） |
| `never_synced` | `reading=null`、`last_success_at=null` | 首刷成功 | 不得填 `reading_observed_at=now` |

**与 `auth_expired` 的 30 分钟探测**：进入后每 30min 做 1 次**只读**探活（不 refresh）；若成功且读数合法 ⇒ `normal`。目的是外部 CLI 重新登录后能自愈，又不制造刷新循环。

### 3.6 token 刷新闸门（硬规则 5 的唯一实现）

```ts
export type RefreshGate =
  | 'skip'
  | 'refresh_before_fetch'
  | 'refresh_after_401'
  | 'forbidden';

export declare function evaluateRefreshGate(input: {
  readonly expires_at: EpochMillis | null;
  readonly now: EpochMillis;
  readonly can_refresh: boolean;
  readonly state: AccountHealthState;
  readonly already_refreshed_this_tick: boolean;
}): RefreshGate;
```

| 情形 | 闸门 | 动作 | 依据 |
| :--- | :--- | :--- | :--- |
| `can_refresh === false` | `forbidden` | 直接 fetch；401 即 `auth_expired` | codex/workbuddy/gemini 无刷新能力 |
| `state ∈ {rate_limited, service_deprecated}` | `forbidden` | 不刷新（刷也过不去） | 省配额 |
| `expires_at === null` | `skip` | 直接用；401 再刷新 | 过期时间未知 ≠ 已过期 |
| `expires_at − now > 60s` | `skip` | 直接用 | **硬规则 5：绝不提前刷新** |
| `0 < expires_at − now ≤ 60s` | `skip` | 仍直接用 | 60s 内仍可用就不动它（这是最常被写错的一条） |
| `expires_at ≤ now` | `refresh_before_fetch` | 先刷新再 fetch（各一次） | 已过期 = 不可用，不算「提前」 |
| fetch 返回 401 且本轮未刷新过 | `refresh_after_401` | 单飞刷新 → 重放 fetch **1 次** | 401 是唯一被动触发点 |
| 刷新返回 `invalid_grant` / 401 | — | `auth_expired`，不再重试 | 重试加重风控 |
| 刷新网络失败 | — | 状态不变，`retry_at=now+60`，**保留旧凭据** | 旧 token 可能仍有效 |
| 两个并发调用都要刷新 | — | 按 `(provider, account_id)` 单飞，后到者 await 前者 | Claude refresh token 一次性 |

### 3.7 隔离性验收用例（必须写成测试，不是承诺）

```
前置：4 个账号同时到期 —— claude:A, claude:B, codex:C, workbuddy:D
桩：A → 429(Retry-After: 45)，B → 401，C → 200，D → 200

断言（第 1 次 tick 之后）：
  1. A.state == 'rate_limited'，A.retry_at == now + 45s，A.reading 未变
  2. B.state == 'auth_expired'，B.retry_at == null（停止轮询）
  3. C.state == 'normal'，C.due_at == now + 300s ± 10%（抖动范围内）
  4. D.state == 'normal'，D.reading 已更新，写入了 1 条 usage_samples
  5. claude:B 未被本批处理（同渠道串行），其 due_at 仍为原值
第 2 次 tick（now + 60s）：
  6. 只有 B 到期，A 因 retry_at 未到被跳过，C/D 未到期
  7. 不发任何 claude:A 的请求（冷却期）
```

### 3.8 暂停与隐藏（正交，不是状态）

| 项 | 字段 | 行为 | 菜单栏 |
| :--- | :--- | :--- | :--- |
| 全局暂停 | `HudViewModel.pause_until`（存 `AppSettings.global_pause_until`） | 暂停期间不 tick、不评估通知；到期后 5s 内恢复 | 灰环 + 斜杠，**无数字**，优先级最高 |
| 单账号暂停 | `AccountSnapshot.pause_until` | 该账号不进候选集 | 从聚合剔除 |
| 隐藏 | `AccountSnapshot.hidden` | 不进聚合、不提速、不发通知；一级面板仍显示（半透明标记） | 从聚合剔除 |
| 到期 | `pause_until <= now` | 下个 tick 立即刷新，不等待 `T_base` | 恢复正常图标 |

### 3.9 事件与通知（去重键必须落库）

| 事件 | 触发 | 去重 | 文案模板（不含 token / 明文邮箱 / 组织名） |
| :--- | :--- | :--- | :--- |
| `quota.low` | 账号从 `>20%` 变 `≤20%` | 每账号每窗口每复位周期 1 次 | 「{别名} 剩余 {p}%，{1h04m} 后复位」 |
| `quota.exhausted` | `remaining_ratio === 0` | 每窗口每周期 1 次 | 「{别名} 已用尽，{3h} 后复位」 |
| `account.recovered` | 非 normal → normal | 每账号每次故障 1 次 | 「{别名} 已恢复（{13:02}）」 |
| `account.auth_expired` | 进入 `auth_expired` | 每账号每天 1 次 | 「{别名} 登录已失效，点击重新授权」 |
| `account.deprecated` | 进入 `service_deprecated` | 一次（不重复打扰） | 「{别名} 渠道已停服，查看迁移」 |

通知权限被拒 ⇒ 降级为面板内红点，**不再重复弹系统权限请求**（每年最多 1 次）。

---

## 4. UI 契约

> 渲染层（`ui/`）只消费 §1.6 的 `HudViewModel` 与本节组件 props；**不读 `AccountSnapshot`、不接触数值格式化**。所有「能不能显示百分比」的判断在投影层已完成（I6 兜底）。

### 4.1 宽度与布局锚（唯一权威）

| 界面 | 宽度 | 用途 |
| :--- | ---: | :--- |
| 主面板 `NSPanel` | **360pt** | 一级巡检、渠道分区、翻页 |
| 详情面板 | **400pt** | 窗口表、热力图、积分包列表 |
| 中途弹层（sheet） | 328pt | 确认、命名、配对码 |
| 窄弹层 | 300pt | 通知预览、单列表单 |

原型按 `1pt = 1 CSS px` 渲染（浏览器内不用 `pt` 单位，避免 4/3 放大导致评审数字不可迁移）。卡片列宽、98pt 行高、52/74pt 环、9.5pt 字号下限全部锚在 360pt 上；**禁止出现第二套宽度值**（旧稿 412px 已废弃）。

### 4.2 Level-1 网格（每渠道 8 个账号 / 页）

```ts
/** 网格排布（容量恒为 8，列数随容器变化，见 D-06）。 */
export interface GridSpec {
  /** 列数：2（360pt 面板）或 4（≥560pt 展开） */
  readonly columns: 2 | 4;
  /** 行数：4 或 2 */
  readonly rows: 4 | 2;
  /** 每页槽位总数，恒为 8 */
  readonly capacity: 8;
  /** 卡片行高（pt） */
  readonly row_height: 98;
  /** 列间距 / 行间距（pt） */
  readonly gap: 9;
}

/** 按容器宽度选排布；阈值以下用 2×4，以上用 4×2。 */
export declare function gridForWidth(containerWidthPt: number): GridSpec;
```

| 容器宽度 | 排布 | 单卡宽度（12pt 侧边距） | 用途 |
| :--- | :--- | ---: | :--- |
| `< 560pt`（默认 360pt） | **2 列 × 4 行** | `(W − 24 − 9) / 2` ⇒ 360pt 时 **163.5pt** | 主面板 |
| `≥ 560pt` | **4 列 × 2 行** | `(W − 24 − 27) / 4` | 展开窗口 / 外接屏 |

**分页状态机（每渠道独立，互不联动）**

| 项 | 规则 |
| :--- | :--- |
| 容量 | `pageSize = 8`，与宽度无关（D-06）。超过 8 个账号 ⇒ 渠道内翻页，**不跨渠道混排** |
| 页码 | `page.count = ceil(n / 8)`；`index` 从 0 起；切换渠道分组或删除账号后 `index = clamp(index, 0, count−1)` |
| 页码 UI | 分区标题右侧 `‹ 1/2 ›`（命中区 24×24pt）+ 键盘 `←/→`（焦点在分区内时）+ 触控板横滑 |
| 排序 | 组内按 `remaining_ratio` 升序，`null` 排最后；**稳定**（并列按 `account_id`），避免刷新时卡片跳动 |
| 页码持久化 | 内存态，重启归 0（不落库，避免「打开面板却看不到最紧张的账号」） |
| 空渠道 | 不渲染分区（不做空占位卡片） |
| 槽位不满 | 不渲染占位卡；剩余槽位留白，**不拉伸**已有卡片 |

**分区结构**：`渠道名（13pt/600）· 最紧张读数（11pt，如「最少 9%」）· 页码` + 卡片网格 + 9pt 底距。渠道顺序 = 注册表 `list()` 顺序（claude → codex → workbuddy → gemini → 字母序 custom）。

### 4.3 一级卡片解剖（固定 98pt，三行不换行）

```
┌──────────────────────────────────────────── 163.5 × 98 pt ────┐
│  ╭────╮  别名（13pt/600，middle 省略）              [action 24pt]│  ← 行 1（y 10–62，高 52）
│  │ 环 │  主读数 62%（17pt/700 tabular） 或 状态文案（12pt）      │
│  │52px│  套餐 · 复位「恢 1h04m」（11pt）                        │
│  ╰────╯  ─────────────────────────────────────────────         │
│  历史槽/副文案（11pt，中性色）              时间戳 12:30（10pt） │  ← 行 2（y 66–88，高 22）
└────────────────────────────────────────────────────────────────┘
```

| 元素 | 规格 | 硬约束 |
| :--- | :--- | :--- |
| 卡片容器 | 圆角 12pt，`background: rgba(28,32,42,.62)`，`backdrop-filter: blur(22px) saturate(180%)`，0.5pt 内发丝边 `rgba(255,255,255,.10)` | 非 normal 追加 `opacity .72` + `filter: saturate(.55)`（`dimmed`） |
| 环 | 52pt（双环）/ 48pt（单环/积分环），几何取 `ringGeometryFor(kind,'card')` | **非 normal 无弧**，只画虚线轨道 `1.8/2.6`，`rgba(152,162,179,.42)`（D-05） |
| 环内文字 | 13pt/700 tabular，单行，不换行 | 非 normal 为 `—`；`never_synced` 为 `?` |
| 别名 | 13pt/600，最多 1 行，`text-overflow: ellipsis`（只此处允许省略） | 不显示邮箱明文（只显示脱敏 `a***@c.com`，且仅在详情页） |
| 主读数 | `percent`：17pt/700 `tabular-nums` `white-space: nowrap`；`status`：12pt/600 | 非 normal 只能是 `status`（类型层保证） |
| 历史槽 | 11pt 中性色，格式 `最后 41% · 12:30` | **永不使用绿/黄/红**（防止被读成当前值）；不参与环 |
| 时间戳 | 10pt ≥9.5pt 下限，等宽数字 | 非 normal **必有** `{HH:mm} 最后同步`（第三行固定为时间戳） |
| 动作按钮 | 右侧 24×24pt 命中区，图标 + 文案仅一种（重试/重新授权/迁移） | 无动作时不渲染，不留空位 |

### 4.4 Level-2 详情（74pt 大环 + 真实标识 + 24h 热力图）

**头部（y 0–108）**：左侧 **74pt 环**，右侧三行标识。

| 行 | 内容 | 规格 |
| :--- | :--- | :--- |
| 1 | 别名（用户命名） | 15pt/700，单行 |
| 2 | **真实标识**：`identity.real_identifier_masked`（如 `a***@corp.com`）+ 组织 | 12pt，中性；**这是允许展示的上限**，全明文只在 Keychain |
| 3 | 套餐 · 站点 · 授权方式 · Keychain 项状态 | 11pt；站点仅 workbuddy 显示（`国内站` / `国际站`）；Keychain 只显示「已保存 / 缺失」 |

> 「真实标识」= 脱敏主体 + 组织 + 套餐，而不是占位符 `账号 1`。目的是让用户能区分同名账号（「工作主力」「备用」）。任何情况下**不渲染** `access_token`、cookie、完整邮箱（A03 断言）。

**环（详情态）**

```ts
/** 环几何的唯一来源：UI 必须调用它，禁止硬编码半径（D-12）。 */
export interface RingArcGeometry {
  readonly radius: number;
  readonly stroke_width: number;
  readonly circumference: number;
}
export interface RingGeometry {
  /** 容器直径：卡片 52/48，详情恒 74 */
  readonly size: number;
  readonly outer: RingArcGeometry;
  /** 双环独有；单环/积分环为 null */
  readonly inner: RingArcGeometry | null;
  /** 内外环间隙 */
  readonly gap: number | null;
}
export declare function ringGeometryFor(
  kind: MetricVisualKind,
  sizeVariant?: 'card' | 'detail'
): RingGeometry;
```

| 形态 | 直径 | 外环 | 内环 | 间隙 |
| :--- | ---: | :--- | :--- | ---: |
| 双环（claude/codex）· 卡片 | 52pt | r=22.6，描边 3.8 | r=16.4，描边 3.4 | 2.6 |
| 单环 / 积分环 · 卡片 | 48pt | r=20.3，描边 4.6 | — | — |
| 双环 · 详情 | **74pt** | r=32.2，描边 **5.4** | r=23.3，描边 4.9 | 3.8 |
| 单环 / 积分环 · 详情 | **74pt** | r=29.0，描边 **6.6** | — | — |

`stroke-dasharray = 2πr`，`stroke-dashoffset = dasharray × (1 − ratio)`；`ratio=0` 不画弧（空环）；`=1` 首尾相接。中心字 22pt/800 tabular（详情），副标签 10pt（「5h 剩余」「周配额剩余」「积分」）。

**窗口表（详情中部）**

| 列 | 内容 | 渲染条件 |
| :--- | :--- | :--- |
| 窗口 | `label`（`5 小时窗口` / `周窗口` / `model:xxx`） | 恒显示 |
| 剩余 | `62%` 或 `—` | 仅该窗口 `remaining_ratio` 存在时显示百分比 |
| 复位 | `14:35` / `2 天 3 小时` / `—` | `resets_at` 非空 |
| 已用 | `used / limit` | **仅 `amount.limit` 非空时整列渲染**；否则整列隐藏（不是显示 `—`，避免把反推值摆成实时值） |
| 来源 | `quality` 标记：`derived` 加 `~`，`clamped` 加 `†` | 非 exact 时 |

**24h 热力图（数据形态）**

```ts
/** 热力图档位：na 表示无采样，绝不用 0 值表达（D-08）。 */
export type HeatLevel = 'na' | 'l1' | 'l2' | 'l3' | 'l4';

/** 单个小时桶。 */
export interface HeatCell {
  /** 本地时区小时序号 0..23（跨 DST 时该日仅 23 桶，缺桶为 na） */
  readonly hour_index: number;
  /** 档位：na / l1(0–24.9%) / l2(25–49.9%) / l3(50–74.9%) / l4(75–100%) */
  readonly level: HeatLevel;
  /** 原始剩余百分比，仅用于 tooltip 与无障碍朗读；无采样为 null */
  readonly remaining_pct: number | null;
  /** 采样时刻（毫秒）；无采样为 null */
  readonly sampled_at: EpochMillis | null;
  /** 真实耗尽（Normal 且 0%）：l1 基础上的角标，不是新档位 */
  readonly exhausted_mark: boolean;
}

/** 24h 热力图模型：恒 24 格。 */
export interface HeatmapModel {
  readonly account_id: string;
  /** 对应窗口的短标签：'5h' / '1w' / 'day' / 'credits' */
  readonly window_label: string;
  readonly cells: readonly HeatCell[];
  /** 覆盖率：sampled / 24 */
  readonly coverage: { readonly sampled: number; readonly total: 24 };
  /** 空图原因：无采样 / 从未 normal；非空时整块显示说明文案而非空网格 */
  readonly empty_reason: 'no_samples' | 'never_normal' | null;
  /** 用户本地时区相对 UTC 的偏移（分钟），用于轴标签 */
  readonly local_offset_minutes: number;
}

/** 档位判定（纯函数，UI 与测试共用）。 */
export declare function heatLevel(remaining_pct: number | null): HeatLevel;
```

| 项 | 规则 |
| :--- | :--- |
| 网格 | 24 列 × 1 行，`gap 1.6pt`，格 9×18pt，圆角 2pt；横轴标签只标 `0 / 6 / 12 / 18` |
| 配色 | `na` 斜纹（`repeating-linear-gradient` 45°）+ 中性；`l1` 红、`l2` 橙黄、`l3` 黄绿、`l4` 绿（与环同色系，`#FF453A → #32D74B`） |
| 无数据 | 斜纹格，**不画 0%**；整块 `coverage.sampled === 0` 时显示「本地采样 · 数据从今天开始积累」 |
| 非 normal | 该账号热力图**停更**（不写采样），图仍展示历史格，顶部加「历史数据 · 当前离线」 |
| tooltip | `14:00 · 剩余 41%`；`na` 为 `14:00 · 无采样` |
| 无障碍 | 整图 `role="img"` + `aria-label="{window} 最近 24 小时剩余趋势，{sampled}/24 小时有采样"`；单格 `aria-label` 走 tooltip 文案 |

**积分包列表（workbuddy 专有区）**：每行 `包名 · 剩余/总量 · 到期日`；过期包置灰 + 「已过期」标签，排在最后；**不计入**顶部环比例。

**停服迁移区（仅 `service_deprecated`）**：`migration_hint` 全文 + 主按钮「打开迁移指南」（外链 `agy` 安装说明）+ 次按钮「忽略此渠道」。

**冷却条（环外，任何非 normal 状态可用）**：3pt 高、12 段刻度、左满右空、宽度 = 环直径；仅 `rate_limited`（`retry_at − now`）与 `never_synced`（等待时长）使用。**额度环永不复用时间量**。

### 4.5 状态组件清单（每个 `AccountHealthState` 一个组件 + 独立 props）

```ts
/** 所有状态卡片共享的外壳 props（只含身份与交互，不含任何读数）。 */
export interface CardChromeProps {
  readonly account_id: string;
  /** 展示别名 */
  readonly alias: string;
  readonly plan_name: string | null;
  readonly visual_kind: MetricVisualKind;
  /** 非 normal 时整体降饱和 */
  readonly dimmed: boolean;
  readonly on_open_detail: (account_id: string) => void;
}

/** 1) normal：唯一允许出现百分比的组件。 */
export interface QuotaNormalCardProps extends CardChromeProps {
  readonly state: 'normal';
  /** mode 被收紧为 value —— 编译器层面禁止画「未知环」 */
  readonly ring: CardRingView & { readonly mode: 'value' };
  /** 已格式化的百分比文本，如 '62%'（不含 '%' 之外的加工） */
  readonly percent_text: string;
  readonly tone: Tone;
  /** 复位倒计时，如 '恢 1h04m'；无复位为 null */
  readonly reset_text: string | null;
  /** 真实耗尽：中心 0% + 文案「额度已耗尽」 */
  readonly exhausted: boolean;
}

/** 2) offline_stale：状态文案 + 最后已知值 + 时间戳。 */
export interface QuotaStaleCardProps extends CardChromeProps {
  readonly state: 'offline_stale';
  readonly ring: CardRingView & { readonly mode: 'unknown' };
  /** '离线' */
  readonly status_text: string;
  /** '{HH:mm} 最后同步' */
  readonly synced_at_label: string;
  /** '最后 41%'；从未成功为 null（此时不显示数值） */
  readonly last_known_text: string | null;
  readonly on_retry: () => void;
}

/** 3) auth_expired：断开弧 + 重新授权入口。 */
export interface AuthExpiredCardProps extends CardChromeProps {
  readonly state: 'auth_expired';
  readonly ring: CardRingView & { readonly mode: 'unknown' };
  /** '登录已失效' */
  readonly status_text: string;
  /** '重新授权后可恢复' */
  readonly hint_text: string;
  readonly synced_at_label: string;
  readonly last_known_text: string | null;
  readonly on_reauth: () => void;
}

/** 4) rate_limited：冷却条在环外，环本身无弧。 */
export interface RateLimitedCardProps extends CardChromeProps {
  readonly state: 'rate_limited';
  readonly ring: CardRingView & { readonly mode: 'unknown' };
  /** '限流中' */
  readonly status_text: string;
  /** 冷却剩余秒数；到期后组件自行切回 normal 渲染 */
  readonly cooldown_secs: number;
  readonly synced_at_label: string;
  readonly last_known_text: string | null;
}

/** 5) service_deprecated：断点轨道 + 迁移入口常驻。 */
export interface DeprecatedCardProps extends CardChromeProps {
  readonly state: 'service_deprecated';
  readonly ring: CardRingView & { readonly mode: 'deprecated' };
  /** '渠道已停服' */
  readonly status_text: string;
  /** '接口已退役，等待更新' */
  readonly hint_text: string;
  readonly migration_hint: string | null;
  readonly on_open_migration: () => void;
}

/** 6) parse_degraded：最后已知值 + 断点标记（空心点），不画任何弧。 */
export interface DegradedCardProps extends CardChromeProps {
  readonly state: 'parse_degraded';
  readonly ring: CardRingView & { readonly mode: 'unknown' };
  /** '数据格式异常' */
  readonly status_text: string;
  readonly synced_at_label: string;
  readonly last_known_text: string | null;
  /** 断点标记是否显示（本渠道解析失败时 true） */
  readonly break_marker: boolean;
  readonly on_retry: () => void;
}

/** 7) never_synced：骨架环呼吸 1.6s，无任何数值。 */
export interface NeverSyncedCardProps extends CardChromeProps {
  readonly state: 'never_synced';
  readonly ring: CardRingView & { readonly mode: 'unknown' };
  /** '正在获取数据' */
  readonly status_text: string;
  /** '已等待 12s' */
  readonly waiting_label: string;
  /** 呼吸动画；prefers-reduced-motion 时为静态 40% 透明 */
  readonly breathe: boolean;
}

/** 卡片组件联合体：渲染层 switch(state) 穷尽即可，无默认分支。 */
export type QuotaCardProps =
  | QuotaNormalCardProps
  | QuotaStaleCardProps
  | AuthExpiredCardProps
  | RateLimitedCardProps
  | DeprecatedCardProps
  | DegradedCardProps
  | NeverSyncedCardProps;
```

| 状态 | 组件（`ui/src/components/`） | 环 | 数值区 | 必备元素 | 动作 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `normal` | `QuotaNormalCard` | 实心弧（剩余） | `62%` 17pt tabular | 复位倒计时、时间戳 `{HH:mm} 更新` | 无 |
| `normal` + 耗尽 | 同上（`exhausted=true`） | 空环（仅轨道） | `0%` 红 + 「额度已耗尽」 | `{HH:mm} 重置` | 无 |
| `offline_stale` | `QuotaStaleCard` | 虚线轨道，无弧 | `最后已知 41%`（灰） | `{HH:mm} 最后同步` | 立即重试 |
| `auth_expired` | `AuthExpiredCard` | 虚线轨道，无弧 | `—` | 副文案 + 时间戳 | 重新授权 |
| `rate_limited` | `RateLimitedCard` | 虚线轨道 + **环外冷却条** | 最后已知（灰）+ `{mm:ss}` | 时间戳另起一行 | 无（倒计时） |
| `service_deprecated` | `DeprecatedCard` | 断点轨道（两段 + 斜杠） | `—` | 迁移指引 | 迁移指南 |
| `parse_degraded` | `DegradedCard` | 虚线轨道 + 断点标记（空心点，环外同水平线） | 最后已知（灰） | 时间戳 | 立即重试 |
| `never_synced` | `NeverSyncedCard` | 骨架环（呼吸 1.6s） | `—` | `已等待 {mm:ss}` | 无 |

**共用小组件（非卡片）**

| 组件 | 职责 | 关键 props |
| :--- | :--- | :--- |
| `QuotaRing` | 唯一画环的地方；输入 `RingGeometry` + `RingArc[]` | `geometry`、`arcs: readonly (RingArc \| null)[]`、`center_text`、`center_tone`、`size_variant` |
| `CooldownBar` | 冷却/等待进度条（环外） | `remaining_secs`、`total_secs`、`segments: 12` |
| `DashedTrack` | 非 normal 的虚线轨道 | `diameter`、`mode: 'unknown' \| 'deprecated'` |
| `StatusPill` | 菜单栏与详情的小状态胶囊 | `tone`、`text`、`glyph` |
| `ChannelSection` | 一级分区（标题 + 页码 + 网格） | `group: ChannelGroup`、`grid: GridSpec`、`on_page: (delta) => void` |
| `AccountPager` | `‹ 1/2 ›` | `index`、`count`、`on_change` |
| `Heatmap24h` | 热力图 | `model: HeatmapModel` |
| `WindowTable` | 详情窗口表 | `windows: readonly QuotaWindow[]`、`max_rows` |
| `PackageList` | 积分包列表 | `packages: readonly CreditPackage[]` |
| `MigrationCallout` | 停服迁移块 | `hint`、`on_open`、`on_dismiss` |
| `PanelFooter` | `上次刷新 12:30 · 2 个账号异常` | `last_refresh_at`、`abnormal_count` |

### 4.6 文案词表（界面唯一来源，抄自 `FLOWS §1.3`）

| 状态 | 主文案（≤6 字） | 副文案（≤14 字） | 数值区 | 色调（`Tone`） |
| :--- | :--- | :--- | :--- | :--- |
| `normal` | （不显示状态词） | `{HH:mm} 更新` | `62%` 实色等宽 | 按 `colorBand`（healthy/warn/hot） |
| `normal`+耗尽 | `额度已耗尽` | `{HH:mm} 重置` | `0%` | `hot` |
| `offline_stale` | `离线` | `{HH:mm} 最后同步` | `最后已知 {p}%`（灰） | `neutral` |
| `auth_expired` | `登录已失效` | `重新授权后可恢复` | `—` | `warn`（琥珀） |
| `rate_limited` | `限流中` | `{HH:mm} 最后同步` + 倒计时另起一行 | `最后已知 {p}%` + 冷却条 | `warn`（琥珀） |
| `service_deprecated` | `渠道已停服` | `接口已退役，等待更新` | `—` | `purple`（灰紫） |
| `parse_degraded` | `数据格式异常` | `{HH:mm} 最后同步` | `最后已知 {p}%` + 断点标记 | `hot`（橙红） |
| `never_synced` | `正在获取数据` | `已等待 {mm:ss}` | `—` | `neutral` |

**规则**：主文案与副文案分两行，**禁止拼成一句**（避免「离线 0%」这种误读）；`auth_expired` 用 `warn` 而非 `hot`，`hot` 只留给「<20%」与「数据异常」（D-13，取代 `ARCHITECTURE §3.8` 的色值分配）；菜单栏空间不足时只显示图标变体，不显示状态词。

### 4.7 视觉令牌（硬规则 7 的可执行形式）

| 令牌 | 值 | 断言 |
| :--- | :--- | :--- |
| 材质 | `regular material`：`backdrop-filter: blur(28px) saturate(1.6)` + 底色 `rgba(28,32,42,.62)` | 面板与卡片各一档（面板 30px，卡片 22px） |
| 发丝边 | `0.5pt` = `0.5px @1x`，`inset 0 0 0 .5px rgba(255,255,255,.10)` | 截图边缘扫描 |
| 字号下限 | 辅助文本 **≥9.5pt**（实现取 10px@1x，允许 9.5） | `contrast-sweep.mjs` 扫描 `font-size < 9.5` 即失败 |
| 数字 | `font-variant-numeric: tabular-nums` + `font-feature-settings: 'tnum'` | 百分比/倒计时/积分必须命中 |
| 百分比不换行 | `white-space: nowrap` + 父级 `min-width: 0`，**禁止裸文本节点进 flex 中心盒** | 360pt 下 `scrollWidth ≤ clientWidth` |
| 动效 | `280ms cubic-bezier(0.16, 1, 0.3, 1)` | 所有位移/缩放 |
| Reduce Motion | `@media (prefers-reduced-motion: reduce)` ⇒ `0ms` + 仅透明度过渡；骨架环静态 40% | 断言无 `transform` 动画 |
| 圆角 | 卡片 12pt、弹层 16pt、热力格 2pt、按钮 8pt | — |
| 配色 | `healthy #30D158`、`warn #FFD60A`、`hot #FF453A`、`purple #BF5AF2`、`neutral #8E8E93`；底轨为同色 15% 暗调（**禁止中性灰**） | 对比度 ≥4.5:1（正文）/ ≥3:1（大字） |
| 外观 | **仅深色**（浅色壁纸下 regular material 的辅助字实测 1.84:1，浅色变体延后 v1.1） | 4.5:1 为材质硬门槛 |

### 4.8 无障碍

| 项 | 要求 |
| :--- | :--- |
| 语义 | 卡片是 `button`（`aria-haspopup="dialog"`），分区是 `section` + `aria-label="{渠道}，{n} 个账号"` |
| 环 | `role="img"`，`aria-label="{窗口} 剩余 {p}%（{状态}）"`；非 normal 为「{窗口} 未知，{状态}」 |
| 状态播报 | `aria-live="polite"` 的区域只播报**状态迁移**（恢复/失效/限流），不播报百分比跳动 |
| 焦点 | `:focus-visible` 2pt 环（`outline: 2px solid #0A84FF; outline-offset: 2px`），所有交互元素可 Tab 到 |
| 命中区 | ≥24×24pt（翻页、动作按钮）；卡片整块可点 |
| 对比度 | 正文 ≥4.5:1，大字（≥17pt/700）≥3:1；灰化「最后已知值」仍需 ≥4.5:1 |
| 色盲 | 非 normal 靠**形状**（虚线/断点）+ 文案区分，不依赖颜色 |

---

## 5. 测试矩阵

### 5.1 单元测试矩阵

「现状」列是**实测**（`npx vitest run`，16 个文件 / 222 条用例全绿）；「缺口」列是本节要求新增的用例。

| # | 测试文件 | 覆盖点 | 关键用例（输入 → 期望） | 现状 | 缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| U1 | `domain/format.spec.ts` | 百分比 / 绝对值 / 倒计时格式化 | `formatPercent(0.095)` → `'9'`（floor，D-14）；`formatPercent(0.999)` → `'99'`；`formatPercent(1)` → `'100'`；`formatPercent(0)` → `'0'`；`formatPercent(null)` → `null`；`formatPercent(NaN)` → `null`；`formatAbsolute(12400)` → `'12.4k'`；`formatCountdown(0)` → `'已复位'` | 24 条绿 | 8 条（floor 边界 + `0/1` 端点独占） |
| U2 | `domain/health.spec.ts` | 7 态 × 28 条迁移 | 表驱动跑 §3.5 矩阵全部 63 个格（含 `—` 格必须抛 `IllegalTransition` 或记 error 不改状态）；`auth_expired` + `probe_success` 但 `revision` 未变 → 仍 `auth_expired` | 32 条绿 | 31 条（矩阵全格覆盖） |
| U3 | `domain/invariants.spec.ts` | I1–I10 | `normal` 但 `reading=null` → 抛 `I1`；`reading=null` 且 `last_success_at=now` → 抛 `I2`；`ratio=1.2` → 抛 `I3`；`windows=[]` → 抛 `I4`；`visual_kind='credits_pool'` + `reading.kind='windows'` → 抛 `I5`；非 normal 但 `primary_slot.kind='percent'` → 抛 `I6`；`exhausted=true` 且 `ratio=0.5` → 抛 `I7`；`region='cn'` + `provider='claude'` → 抛 `I8`；`normal` + `consecutive_failures=1` → 抛 `I9` | 17 条绿 | 0（补 `pause_until`/`hidden` 相关的 2 条） |
| U4 | `domain/visual.spec.ts` | 形态派生 + 几何 | `deriveVisualKind(null,'dual')` → `'dual_sliding_window'`；`windows.len=1` → single；`credits` → credits_pool；`ringGeometryFor('dual','detail')` → `size=74, outer.r=32.2, inner.r=23.3, gap=3.8` | 9 条绿 | 0 |
| U5 | `domain/presentation.spec.ts` | 投影五状态表 | `normal` + `ratio=0.09` → `primary_slot.kind='percent'`、`tone='hot'`；`offline_stale` → `kind='status'`、`ring.outer===null`、`history_slot` 含「最后」；`reading=null` → `kind='status'` 且文本不含 `%` | 20 条绿 | 6 条（`dimmed`、`reset_text`、`action` 三态） |
| U6 | `drivers/contract.spec.ts` | 四驱动共用契约 | 每驱动：`supported_auth_flows` 非空；`poll_policy` 满足 `120≤min≤base≤max≤3600`；`allowed_origins` 全 `https:`；`assertSafeHeaders({authorization:'x'})` → 抛 `CredentialLeakError`；`fetch_snapshot` 在桩 HTTP 下不发真实网络 | 14 条绿 | 0 |
| U7 | `drivers/claude.spec.ts` | 归一化 + 错误 | `utilization=91` → `remaining_ratio=0.09`；缺 `seven_day` → 1 窗 + 单环；`html` body → `class='schema'`；`401` → `auth_expired`；`429 && Retry-After:'45'` → `retry_after_secs=45` | 8 条绿 | 4 条（越界 D-11、`seven_day_opus` 不进主环） |
| U8 | `drivers/codex.spec.ts` | 模型选择 | 两模型 `pairWorst` 0.2 / 0.7 → 主读数取 0.2；并列按模型名升序；缺 `limit_window_seconds` → `label='配额窗口'`、`duration_secs=null` | 9 条绿 | 3 条（`by_model` 数组形态、`credits_balance`） |
| U9 | `drivers/workbuddy.spec.ts` | 积分池 + 站点 | `totalRemaining=15200/totalCapacity=20000` → `ratio=0.76`；`total` 缺失 → `ratio=null`（**不是 0**）；过期包不计入；`account.region='cn'` + `lease.region='intl'` → `region_mismatch` | 13 条绿 | 3 条（401 HTML 站点错配、`packages_only` 推导） |
| U10 | `drivers/gemini.spec.ts` | 单周期 + 停服 | `403 SUBSCRIPTION_REQUIRED` → `class='deprecated'` + `migration_hint` 非空；空 stdout → `empty_response`；`remaining/total` → ratio；`windows.len===1` | 14 条绿 | 2 条（404 退役、HTML 退役页） |
| U11 | `drivers/registry.spec.ts` | 装配期校验 | 重复 provider → `RegistryError`；`custom.*` 注册 → `RegistryError`；`min=60` → `RegistryError`；`list()` 顺序 `claude,codex,workbuddy,gemini` | 16 条绿 | 0 |
| U12 | `scheduler/backoff.spec.ts` | 退避 + Retry-After | 见 §3.4 两张表逐行断言（含 `"99999"` → 7200、HTTP-date 过去 → 5、`n=3` 基数翻倍） | 14 条绿 | 0 |
| U13 | `scheduler/poller.spec.ts` | tick 语义 | 幂等（连调 2 次第二次空）；同渠道只发 1 个；失败只改自己 `due_at`；`auth_expired` 不进候选；§3.7 隔离用例 7 条断言 | 7 条绿 | 9 条（§3.7 全量、唤醒分批、面板 60s 防抖、`pause_until`） |
| U14 | `scheduler/breaker.spec.ts` | 熔断副作用 | `rate_limited` 写 `retry_at` 且 `reading` 未变；`auth_expired` 置 `retry_at=null`；`service_deprecated` `retry_at≈now+24h` | 4 条绿 | 5 条（`429_counter_1h`、退避不改读数、`parse_degraded` 不写采样） |
| U15 | `scheduler/refresh-gate.spec.ts` | 硬规则 5 | `expires−now=59s` → `skip`（**最关键一条**）；`=0` → `refresh_before_fetch`；`can_refresh=false` → `forbidden`；`rate_limited` → `forbidden`；`already_refreshed` → 不再刷新 | 16 条绿 | 0 |
| U16 | `layering.spec.ts` | 分层与零渠道分支 | `scheduler/**` 与 `presentation/**` 零渠道字面量；`presentation` 不 import `drivers`；`domain` 不 import 任何层 | 5 条绿 | 1 条（`ui/**` 不得 import `core/src/drivers`） |
| U17 | `tests/fixtures.matrix.spec.ts`（新） | fixture 矩阵完整性 | §5.2 表中 4×5=20 个文件全部存在；每个文件只有 `status/headers/body/meta` 四键；`body` 中 `access_token` 等键的值被替换为 `***` | ❌ 未写 | 全量 |
| U18 | `tests/heat.spec.ts`（新） | 热力图档位 | `heatLevel(null)='na'`、`0='l1'`、`24.9='l1'`、`25='l2'`、`74.9='l3'`、`75='l4'`、`100='l4'`；`cells.length===24` | ❌ 未写 | 全量 |

### 5.2 fixture 清单（每渠道 × 5 种响应）

**命名规范（唯一）**：`fixtures/<provider>/<kind>.json`，`kind ∈ {normal, 401, 429, 403, schema_drift}`；同 kind 的多形态用 `variant` 字段区分（如 workbuddy 的 HTML 版 401）。文件结构固定四键：

```json
{
  "meta": { "provider": "claude", "schema_version": "claude.v1", "variant": "base", "captured_at": "2026-10-30" },
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": { }
}
```

**矩阵与现状**

| 渠道 \ 类型 | `normal` | `401` | `429` | `403` | `schema_drift` | 现状缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| claude | ✅ `normal.json` | ✅ `401.json` | ✅ `429.json` | ❌ **缺** | ✅ `schema_drift.json`（另有 `single_window` / `html_gateway`） | 1 |
| codex | ✅ `normal.json` | ✅ `401.json` | ✅ `429.json` | ❌ **缺** | ❌ **缺**（另有 `model_scoped`） | 2 |
| workbuddy | ✅ `normal_cn.json` / `normal_intl.json` | ✅ `401_html.json`（HTML 变体） | ❌ **缺** | ❌ **缺** | ✅ `schema_drift.json`（另有 `packages_only`） | 2 |
| gemini | ✅ `normal.json` | ❌ **缺** | ❌ **缺** | ✅ `403_deprecated.json` | ❌ **缺**（另有 `empty`） | 3 |
| custom.* | ❌ **缺** | — | — | — | — | 1（模板样例） |

**合计需补 9 个文件**：`claude/403.json`（计划不符）、`codex/403.json`、`codex/schema_drift.json`、`workbuddy/429.json`、`workbuddy/403.json`、`gemini/401.json`、`gemini/429.json`、`gemini/schema_drift.json`、`custom/normal.json`。

**每个 fixture 必须体现的语义（不是随便放个 200）**

| 类型 | 必须包含 | 用来验证 |
| :--- | :--- | :--- |
| `normal` | 该渠道完整成功体（含所有可选字段） | 全字段映射不丢 |
| `401` | 401 + `www-authenticate` 头 + 空/错误体 | 判 `auth` 而不是 `schema`；不拼接体到 message |
| `429` | 429 + `retry-after: 45` | `retry_after_secs=45`；`rate_limited` 状态 |
| `403` | 403 + 上游错误码（`SUBSCRIPTION_REQUIRED` / `plan_mismatch`） | 正确分流到 `deprecated` 或 `offline_stale` |
| `schema_drift` | 未知字段 + 缺失关键字段 + 一个越界值（如 `utilization: 140`） | 漂移只 warning；越界走 D-11 判 `parse_degraded` |

**零明文（硬规则 4）**

| 断言 | 命令 | 通过标准 |
| :--- | :--- | :--- |
| token 形态零命中 | `grep -RInE '(sk-[A-Za-z0-9]{16,}\|oat[0-9]{2}-[A-Za-z0-9_-]{16,}\|eyJ[A-Za-z0-9_-]{20,}\.)' fixtures docs prototype core src-tauri ui` | 退出码 1（无匹配） |
| JSON 键值零明文 | `grep -RInE '"(access_token\|refresh_token\|id_token)"\s*:\s*"[^"*]{8,}"' fixtures` | 退出码 1 |
| 日志零 Bearer | `grep -RInE 'Bearer [A-Za-z0-9._~+/=-]{8,}' logs/ 2>/dev/null` | 退出码 1 |
| **基线实测** | 当前 `fixtures/**` 中 `access_token` 类键的取值全部为 `***` 或键不存在 | 已满足（19 个文件） |

### 5.3 UI 断言（可在 jsdom 内跑，不依赖截图）

| # | 断言 | 实现方式 | 失败即 |
| :--- | :--- | :--- | :--- |
| A01 | **百分比不换行**：360pt 下每张卡片 `scrollWidth ≤ clientWidth + 1`，`scrollHeight ≤ clientHeight + 1` | jsdom 无布局 ⇒ 用 `tests/nowrap.spec.tsx`：断言元素 `style.whiteSpace === 'nowrap'` + 文本节点无空格 + 父级 `min-width:0` | 换行/裁切 |
| A02 | **无溢出**：卡片根节点 `overflow !== 'visible'` 或子元素均 `nowrap` | 同上 + `detectOverflow()` 辅助（遍历子节点比较 `offsetWidth`） | 文字溢出卡片 |
| A03 | **非 normal 无弧**：`state !== 'normal'` 的卡片 DOM 中 `circle[data-arc]` 数量 = 0，`[data-track="dashed"]` 存在 | RTL 查询 | 离线仍画进度弧 |
| A04 | **非 normal 无百分比**：卡片文本匹配 `/\d+\s*%/` 仅允许出现在 `最后已知` 前缀之后，且该文本 `data-tone="neutral"` | 正则 + 属性断言 | 离线卡出现彩色 62% |
| A05 | **对比度 ≥4.5:1**：所有文本节点（含 `rgba` 前景）在 `rgba(28,32,42,.62)` 底上合成后 ≥4.5（大字 ≥3） | `tests/contrast-sweep.mjs`：把 `tokens.css` 的所有前景/背景组合跑 WCAG 公式 | 灰字糊在材质上 |
| A06 | **字号 ≥9.5pt**：`getComputedStyle` 全部 ≥9.5 | `contrast-sweep.mjs` 扫描 CSS 声明 | 8px 标注回归 |
| A07 | **tabular-nums**：所有百分比/倒计时节点 `fontVariantNumeric === 'tabular-nums'` | RTL | 数字跳动 |
| A08 | **Reduce Motion**：mock `matchMedia('(prefers-reduced-motion: reduce)')` 为 true ⇒ 所有元素 `transitionDuration` 为 `0s` | RTL | 前庭不适 |
| A09 | **翻页**：9 个账号 ⇒ 第 1 页 8 张、第 2 页 1 张；`index` 越界被 clamp；切换渠道不重置其他渠道页码 | RTL | 第 9 个账号看不到 |
| A10 | **热力图**：`coverage.sampled=0` ⇒ 24 个 `data-level="na"`，**无** `data-level="l1"`；有 1 个样本 ⇒ 恰好 1 个非 `na` | RTL | 缺数据被画成 0% |
| A11 | **详情标识**：详情页显示 `a***@c.com`，不显示任意 `@` 前 ≥3 字符的明文邮箱；不显示 `Bearer`/`sk-` | 正则扫描整个详情 DOM | 明文泄漏 |
| A12 | **状态组件穷尽**：`switch (state)` 无 `default` 分支，7 个组件全覆盖 | TS 编译（`never` 检查）+ 7 个 story 快照 | 新状态漏渲染 |

### 5.4 命令与当前可验证性（诚实标注）

| 命令 | 覆盖 | 当前状态（本轮实测） |
| :--- | :--- | :--- |
| `npm --prefix core run typecheck` | 全部 TS 类型 | ✅ 通过（`tsc --noEmit`，exit 0） |
| `npm --prefix core test` | U1–U16 | ✅ **16 文件 / 222 用例全绿**（2.3s） |
| `bash tests/security-scan.sh` | 零明文 | ⚠️ 脚本尚未创建（§5.2 的命令可直接作为其内容） |
| `node tests/contrast-sweep.mjs` | A05 / A06 | ❌ 不存在（依赖 `ui/` 落地） |
| `npx vitest run --root ui` | A01–A12 | ❌ `ui/` 为空目录 |
| `npx tauri build` | 壳层 | ❌ 仅 macOS；本容器（Linux）**无法执行**，不得声称已验证 |
| 本文件类型签名 | §1/§3/§4 的 `ts` 代码块 | ✅ 已抽取拼接为单文件过 `tsc --strict`：**17 个代码块 / 1035 行，exit 0**（脚本见 §6.5，可复跑） |

> 未验证项一律标注 ❌/⚠️，**不写「应该可以」**。

---

## 6. 文件与任务拆分

### 6.1 目录与文件职责（✅ 已合入 / ➕ 新增 / ✏️ 需改动）

```text
/opt/data/ai-hud
├── docs/
│   ├── SPEC.md                 ← 本文件：实现契约（P1 权威）
│   ├── ARCHITECTURE.md         P2 设计来源（需按 §0.3 回改 4 处）
│   ├── FLOWS.md                P3 交互与验收（需回改并发/退避 2 处）
│   ├── PROTOTYPE-SPEC.md       P4 视觉基线
│   ├── AUDIT.md / AUDIT-RESOLUTION.md   审计与修复记录
│   └── ARCHITECTURE.v0.md      只读历史
│
├── core/src/                                  TypeScript 领域内核（无 DOM / 无 Tauri）
│   ├── domain/
│   │   ├── types.ts            ✅ 实体 + 视图模型（§1.1–§1.6，✏️ 加 pause_until/hidden/revision）
│   │   ├── invariants.ts       ✅ I1–I10 断言（写库前 + 投影前各一次）
│   │   ├── health.ts           ✅ 7 态 × 28 迁移表 + 迁移判定纯函数
│   │   ├── visual.ts           ✅ deriveVisualKind / ringGeometryFor（几何唯一来源）
│   │   ├── format.ts           ✅ formatPercent/formatAbsolute/formatCountdown（✏️ floor，D-14）
│   │   ├── redact.ts           ✅ 日志与错误文案脱敏（sk-/oat/eyJ/邮箱）
│   │   └── index.ts            ✅ 桶导出
│   ├── drivers/
│   │   ├── driver.ts           ✅ ChannelDriver / AuthFlow / DriverError / PollPolicy / 退避纯函数
│   │   ├── registry.ts         ✅ 构造期强校验 + get/list/assert_ready
│   │   ├── index.ts            ✅ createDefaultRegistry（唯一装配点）
│   │   ├── claude/{driver,normalize,refresh,index}.ts      ✅
│   │   ├── codex/{driver,normalize,index}.ts               ✅
│   │   ├── workbuddy/{driver,region,normalize,index}.ts    ✅
│   │   ├── gemini/{driver,cli-normalize,cookie-normalize,index}.ts ✅
│   │   └── custom/{driver,normalize,index}.ts              ➕ 模板渠道（§2.6）
│   ├── scheduler/
│   │   ├── poller.ts           ✅ tick / panel_opened / system_wake（✏️ 补 cooldown、pause、分批唤醒）
│   │   ├── backoff.ts          ✅ nextDueAfterFailure / parseRetryAfter / applyJitter
│   │   ├── refresh.ts          ✅ evaluateRefreshGate + 按账号单飞刷新协调
│   │   └── index.ts            ➕ 桶导出
│   ├── presentation/                          唯一允许「数字→文案」的层
│   │   ├── card.ts             ✅ toCardView（五状态投影表，§4.5）
│   │   ├── channels.ts         ✅ toChannelGroups（分组/稳定排序/每渠道 8 张分页）
│   │   ├── menu-bar.ts         ✅ toMenuBarView（只在 normal 集合取最小值）
│   │   ├── detail.ts           ➕ toDetailView（窗口表 + 24h 热力图 + 包列表）
│   │   └── index.ts            ➕ 桶导出
│   ├── ports/                                 ➕ 端口接口（Rust 实现）
│   │   ├── http.ts             AuthBoundHttp 契约 + 错误规范化
│   │   ├── credential.ts       CredentialLease 申请/失效/指纹变更
│   │   ├── clock.ts            单调时钟（超时判定）与墙钟（展示）分离
│   │   ├── storage.ts          SnapshotStore 接口（§1.10）
│   │   ├── notifier.ts         通知端口（去重键由内核给）
│   │   └── cli.ts              CliBridge（白名单命令 + 超时）
│   └── bootstrap.ts            ✅ 纯依赖注入装配（零渠道字面量）
│
├── ui/                                        ➕ 渲染层（只消费 HudViewModel）
│   ├── index.html / vite.config.ts / package.json / tsconfig.json
│   ├── src/main.tsx            挂载 + 订阅视图模型 + 全局快捷键
│   ├── src/App.tsx             路由：面板 / 详情 / 设置（三处共用一份视图模型）
│   ├── src/lib/grid.ts         gridForWidth（2×4 / 4×2，§4.2）
│   ├── src/lib/heat.ts         heatLevel + 24 格填充（§4.4）
│   ├── src/lib/time.ts         本地 HH:mm、倒计时、DST 安全
│   ├── src/lib/ipc.ts          invoke 封装 + 视图模型订阅 + 错误降级
│   ├── src/lib/a11y.ts         aria-label 生成（环/热力图/状态）
│   ├── src/styles/tokens.css   颜色/字号/圆角/间距令牌（§4.7）
│   ├── src/styles/material.css regular material + 0.5pt 发丝边
│   ├── src/styles/motion.css   280ms 曲线 + prefers-reduced-motion 兜底
│   ├── src/components/QuotaRing.tsx     唯一画环处（几何由 core 给）
│   ├── src/components/DashedTrack.tsx   非 normal 虚线轨道（unknown / deprecated）
│   ├── src/components/CooldownBar.tsx   环外冷却/等待条（12 段）
│   ├── src/components/StatusPill.tsx    小状态胶囊（菜单栏/详情复用）
│   ├── src/components/cards/{QuotaNormalCard,QuotaStaleCard,AuthExpiredCard,RateLimitedCard,DeprecatedCard,DegradedCard,NeverSyncedCard}.tsx
│   ├── src/components/cards/index.tsx   穷尽 switch（无 default）
│   ├── src/components/panel/{ChannelSection,AccountPager,PanelHeader,PanelFooter}.tsx
│   ├── src/components/detail/{AccountDetail,DetailHeader,WindowTable,Heatmap24h,PackageList,MigrationCallout}.tsx
│   ├── src/components/settings/{ChannelPicker,OAuthFlow,DeviceCodeFlow,ManualTokenFlow,CookieFlow,KeychainStatus}.tsx
│   ├── stories/seven-states.stories.tsx 7 态卡片（含 dimmed/exhausted 变体）
│   └── tests/setup.ts          RTL + matchMedia/ResizeObserver 桩
│
├── src-tauri/                                 ➕ macOS 壳
│   ├── Cargo.toml / tauri.conf.json / build.rs / capabilities/default.json
│   ├── src/main.rs             启动、单实例锁、菜单栏注册
│   ├── src/tray.rs             NSStatusItem（图标 + 数字 + tooltip，§FLOWS 1.5）
│   ├── src/panel.rs            NSPanel（360pt，无边框，regular material）
│   ├── src/keychain.rs         SecItem CRUD、引用型只读、zeroize、锁屏清缓存
│   ├── src/http.rs             租约签名请求、origin 白名单、body 裁剪、响应头白名单
│   ├── src/cli.rs              子进程桥（白名单、8s、stdout 上限）
│   ├── src/storage.rs          SQLite（WAL）、snapshot/usage_samples、事务、剪枝
│   ├── src/notify.rs           UNUserNotificationCenter + 去重键
│   ├── src/lifecycle.rs        唤醒/锁屏/退出/单实例
│   ├── src/ipc.rs              IPC 命令（与 §8.4 一一对应）
│   ├── src/scheduler_bridge.rs 60s 心跳驱动 TS tick + 系统事件
│   └── migrations/001_init.sql accounts / usage_samples / events / custom_probe
│
├── fixtures/                                  已脱敏样本（✏️ 补 9 个，见 §5.2）
│   ├── claude/{normal,single_window,401,429,403*,html_gateway,schema_drift}.json
│   ├── codex/{normal,model_scoped,401,429,403*,schema_drift*}.json
│   ├── workbuddy/{normal_cn,normal_intl,packages_only,401_html,429*,403*,schema_drift}.json
│   ├── gemini/{normal,empty,403_deprecated,401*,429*,schema_drift*}.json
│   └── custom/normal*.json
│
├── tests/                                     ➕ 跨层验收
│   ├── security-scan.sh        零明文扫描（§5.2 三条 grep）
│   ├── contrast-sweep.mjs      对比度 ≥4.5 / 字号 ≥9.5
│   ├── fixtures.matrix.spec.ts 20 个 fixture 存在性 + 四键结构
│   ├── nowrap.spec.tsx         A01/A02/A03/A04（不换行、无溢出、无弧、无假百分比）
│   ├── heat.spec.ts            U18 档位边界
│   └── e2e/panel.smoke.spec.ts tauri-driver 冒烟（**仅 macOS**）
│
└── scripts/
    ├── capture-fixture.ts      采集 + 脱敏（命中明文退出码 2）
    └── check-doc.mjs           文档一致性（枚举覆盖、无明文、D 表引用有效）
```

### 6.2 对已合入代码的变更清单（5 项，全部来自 §0.3 裁决）

| # | 文件 | 变更 | 对应裁决 | 影响测试 |
| :--- | :--- | :--- | :--- | :--- |
| C1 | `core/src/domain/types.ts` | `AccountSnapshot` 增 `pause_until`、`hidden`、`revision`（必填）；`HudViewModel` 增 `pause_until` | FLOWS M-02 / §7.3、§1.10 乐观并发 | 实测影响：5 个测试文件共 **19 处** snapshot 构造（`invariants` 9 / `breaker` 7 / `presentation` 1 / `claude` 1 / `codex` 1）+ `scheduler/poller.ts` 的默认值，需同步补字段 |
| C2 | `core/src/domain/format.ts` | `Math.round` → `Math.floor`（`ratio===1` 时仍为 `100`） | D-14 | `format.spec.ts` 8 条 |
| C3 | `core/src/drivers/*/normalize.ts`（4 个） | 越界 >0.5 返回错误而非 clamp | D-11 | 各驱动 spec 各 +2 条；`schema_drift` fixture 需含越界值 |
| C4 | `core/src/presentation/card.ts` | `auth_expired` 的 `center_tone`/`tone` 由 `hot` 改 `warn` | D-13 | `presentation.spec.ts` 1 条 |
| C5 | `core/tests/layering.spec.ts` | 增 `ui/**` 不得 import `core/src/drivers` | 分层 | 1 条 |

> 变更全部是「小改 + 可测」，不触碰驱动端点与归一化主体；`poller.ts` 的渠道字面量已在并行分支修掉（本轮实测 `layering.spec.ts` 5/5 绿）。

### 6.3 可独立提交的切片（看板并行执行顺序）

依赖列写 `—` 表示可立即开工。同一行内的文件集合即一次提交的边界（避免跨切片改同一文件）。

| ID | 标题 | 文件 | 依赖 | 验收（必须真跑） |
| :--- | :--- | :--- | :--- | :--- |
| **S01** | 领域类型增量与不变式对齐 | `core/src/domain/{types,invariants}.ts`、`core/tests/domain/invariants.spec.ts` | — | `tsc --noEmit` 绿；`invariants.spec.ts` 新增 `pause_until/hidden/revision` 3 条并全绿；`AccountSnapshot` 无 `?` 可选额度字段 |
| **S02** | 格式化取整与色带边界 | `core/src/domain/format.ts`、`core/tests/domain/format.spec.ts` | — | `formatPercent(0.999)==='99'`、`(1)==='100'`、`(0)==='0'`；`colorBand(0.199)==='hot'`、`(0.2)==='warn'`、`(0.499)==='warn'`、`(0.5)==='healthy'` |
| **S03** | 越界判定 D-11 | `core/src/drivers/{claude,codex,workbuddy,gemini}/normalize.ts`、四个 `*.spec.ts` | S02 | 各驱动 1 条越界用例：`utilization=140` ⇒ `class='schema'` + `upstream_code='value_out_of_range'`；`utilization=100.3` ⇒ `quality='clamped'` 且成功 |
| **S04** | 模板渠道 `custom.*` | `core/src/drivers/custom/{driver,normalize,index}.ts`、`core/tests/drivers/custom.spec.ts`、`fixtures/custom/normal.json` | — | 注册后可 `registry.get('custom.demo')`；JSONPath 缺 `remaining_path` ⇒ 保存被拒；`list()` 排在四个内置之后 |
| **S05** | 端口层接口 | `core/src/ports/*.ts`、`core/src/index.ts` | — | 纯类型文件，`tsc` 绿；`core` 不 import `src-tauri`（grep 为 0） |
| **S06** | 调度器补齐 | `core/src/scheduler/{poller,backoff,refresh,index}.ts`、`core/tests/scheduler/*.spec.ts` | S01 | §3.7 隔离用例 7 条断言全绿；唤醒 200ms 分批 + 20s 预算；`pause_until` 不进候选；`panel_opened` 60s 防抖 |
| **S07** | 投影补齐 | `core/src/presentation/{card,channels,menu-bar,detail,index}.ts`、`core/tests/domain/presentation.spec.ts` | S01 | 非 normal ⇒ `primary_slot.kind!=='percent'` 全枚举；`dimmed=true`；每渠道 8 张分页 + `index` clamp；菜单栏无 Normal 时 `text===null` |
| **S08** | fixture 矩阵补齐 | `fixtures/**`（9 个新文件）+ `tests/fixtures.matrix.spec.ts` | — | 20 个文件齐全；四键结构；`tests/security-scan.sh` 退出码 0 |
| **S09** | UI 视觉基元 | `ui/{index.html,vite.config.ts,package.json,tsconfig.json}`、`ui/src/styles/*`、`ui/src/components/{QuotaRing,DashedTrack,CooldownBar,StatusPill}.tsx` | — | 3 种形态 × 2 尺寸渲染出正确 `dasharray`（对 `ringGeometryFor` 断言）；`<9.5px` 字号 0 处；Reduce Motion 下 `transition-duration:0s` |
| **S10** | 七张状态卡 | `ui/src/components/cards/*.tsx`、`ui/stories/seven-states.stories.tsx` | S09、S07 | 每态 1 个 story；非 normal 卡 DOM 内 `circle[data-arc]` 数 0；`switch` 无 `default`；A01/A03/A04 绿 |
| **S11** | 一级面板 | `ui/src/components/panel/*.tsx`、`ui/src/lib/{grid,time}.ts`、`ui/src/App.tsx` | S10 | 360pt 下 2×4；≥560pt 下 4×2；9 个账号分 2 页；A02/A09 绿 |
| **S12** | 二级详情 | `ui/src/components/detail/*.tsx`、`ui/src/lib/{heat,a11y}.ts` | S10 | 74pt 环；脱敏标识可见、明文邮箱 0 处；`coverage.sampled=0` ⇒ 24 格全 `na`；A10/A11 绿 |
| **S13** | 设置与四条授权流 | `ui/src/components/settings/*.tsx` | S10 | OAuth/设备码/Token/Cookie 四流各 1 条交互测试；Keychain 只显示「已保存/缺失」；配对码超时转 `expired` |
| **S14** | macOS 壳 | `src-tauri/**` | S05 | **仅 macOS**：`npx tauri build` 成功；Keychain 冒烟（写入→读取→删除）；`http.rs` 对非白名单 origin 拒绝（单测可在 Linux 跑 Rust 部分） |
| **S15** | 跨层验收脚本 | `tests/{security-scan.sh,contrast-sweep.mjs,nowrap.spec.tsx,heat.spec.ts}` | S08、S11 | `bash tests/security-scan.sh` exit 0；`node tests/contrast-sweep.mjs` 报告 0 处 <4.5；A01/A05/A06/A08 绿 |
| **S16** | 文档回改（按 D 表） | `docs/ARCHITECTURE.md`（§3.7/§3.8/§5.2/§6.2）、`docs/FLOWS.md`（§1.6）、`docs/PROTOTYPE-SPEC.md`（网格容量） | — | 被点名的表格与 §0.3 一致；`node scripts/check-doc.mjs` 通过；不再出现「2×2=4 张/页」「渠道内并发 2」 |

**并行批次建议**

| 批次 | 切片 | 说明 |
| :--- | :--- | :--- |
| 第 1 批（4 路） | S01、S02、S05、S08 | 互不碰同一文件；S01/S02 都要改 `domain/`，但**不同文件** |
| 第 2 批（3 路） | S03、S04、S06 | S03 依赖 S02 的 floor 语义（只读依赖，可并行开工、后合并） |
| 第 3 批（2 路） | S07、S09 | S07 完成后 S10 才能对齐 props |
| 第 4 批（4 路） | S10、S11、S12、S13 | `ui/` 内文件不重叠，可四路并行 |
| 第 5 批（2 路） | S14、S15 | S14 需 macOS；S15 依赖 S11 |
| 随时 | S16 | 纯文档，可与任一批并行 |

**冲突热点（并行时必须遵守）**

| 文件 | 冲突方 | 规则 |
| :--- | :--- | :--- |
| `core/src/domain/types.ts` | S01 独占 | 其他切片只读，不改此文件 |
| `core/src/presentation/card.ts` | S07 独占 | S10 只消费 props，不改投影 |
| `fixtures/**` | S08 独占 | 其他切片需要新 fixture 时在 S08 里加，不各自新建 |
| `ui/src/styles/tokens.css` | S09 独占 | S10–S13 只引用变量，不新增硬编码色值 |

### 6.4 完成定义（DoD，逐条可查）

1. `npm --prefix core run typecheck` 退出 0；
2. `npm --prefix core test` 全绿，且**用例数只增不减**（当前基线 222）；
3. `bash tests/security-scan.sh` 退出 0（零明文）；
4. `scheduler/**`、`presentation/**`、`ui/**` 无渠道字面量（`layering.spec.ts`）；
5. 每个非 normal 状态在 `ui/stories` 有对应 story，且 A03/A04 断言通过；
6. 切片内新增/修改的类型与 §1 签名一致（不做「差不多」的局部类型）；
7. macOS-only 项（S14）在 Linux 上只能标「未验证」，不得声称通过。

### 6.5 本文件类型签名的自检脚本（复制即用）

```bash
# 抽取 SPEC.md 中所有 ```ts 代码块 → 单文件 → strict 类型检查
cd /opt/data/ai-hud
python3 - <<'PY'
import re, pathlib
src = pathlib.Path('docs/SPEC.md').read_text(encoding='utf-8')
blocks = re.findall(r'```ts\n(.*?)```', src, re.S)
pathlib.Path('/tmp/spec-types.ts').write_text('\n\n'.join(blocks), encoding='utf-8')
print(f'blocks={len(blocks)} lines={sum(b.count(chr(10)) for b in blocks)}')
PY
npx --prefix core tsc --noEmit --strict --target ES2022 --module ESNext \
    --moduleResolution bundler --skipLibCheck /tmp/spec-types.ts && echo "SPEC TYPES OK"
```

> 该脚本是本文件「类型签名可复制进 .ts」这一承诺的唯一验收方式；改完类型必须重跑。

---

## 7. 附录

### 7.1 术语表

| 术语 | 含义 |
| :--- | :--- |
| 剩余（remaining） | 环与百分比编码的对象；`1 − 已用`。满环 = 健康 |
| 最后已知值 | 最近一次**成功**读数，非 normal 时以灰字 + 时间戳展示，**不进环、不用语义色** |
| 布局点（pt） | AppKit 逻辑点；原型 1pt = 1 CSS px |
| 单飞（single-flight） | 同一账号/同一刷新任务同时只有一个在途调用，其余复用其结果 |
| 引用型凭据 | 由外部 CLI 维护、HUD 只读引用的 Keychain 条目（不复制、不写回） |
| 熔断 | 单账号/单渠道连续失败后停止或降频探测，**不影响**其他账号 |
| 模板渠道 | `custom.<name>`，用户给定 URL 与字段映射的第 5 个首发位 |

### 7.2 开放问题（本文件已裁决，留档）

| # | 问题 | 状态 |
| :--- | :--- | :--- |
| Q1 | 「五个首发渠道」但只列出四个 | **已裁决 D-01**：4 内置 + `custom` 模板位 |
| Q2 | 浅色外观 | 延后 v1.1（浅色壁纸下 regular material 辅助字实测 1.84:1，低于 4.5:1 硬门槛） |
| Q3 | 非 macOS 平台 | 不在本轮范围；`core/` 已做到平台无关（Linux 容器可全量跑测试） |
| Q4 | 30 天采样后的长期趋势 | 不在 v1；`usage_samples` 已按 30 天剪枝，扩展时只加聚合表不改领域模型 |

### 7.3 变更记录

| 版本 | 日期 | 变更 |
| :--- | :--- | :--- |
| v1.0 | 2026-10-31 | 首版：类型契约、四渠道映射、调度与熔断、UI 契约、测试矩阵、16 个切片、14 条裁决 |

## 8. 实现状态（2026-10-31 实测，非估算）

> 命令：`bash scripts/verify.sh`（7 项）+ `./node_modules/.bin/vitest run --root core`
> 结果：**288 个用例 / 19 个 spec 文件全绿**；tsc core + ui 退出 0；文档一致性 31 项通过。

| 切片 | 内容 | 状态 | 证据 |
| :--- | :--- | :--- | :--- |
| S01 | `pause_until` / `hidden` / `revision` 字段与不变式 I11–I13 | ✅ | `account-flags.spec.ts` 14 例 + `poller.spec.ts` 暂停 2 例 |
| S02 | `formatPercent` 向下取整（99.9% ≠ 100%） | ✅ | `format.spec.ts`「向下取整，绝不把未耗尽读成满额」4 条断言 |
| S03 | 越界判定（超过 total 1% 即报错，不裁剪冒充 100%） | ✅ 自定义渠道覆盖；内置渠道以 `quality='clamped'` 记录 | `custom.spec.ts` c06/c07 |
| S04 | 自定义渠道适配器（配置驱动，JSONPath 子集） | ✅ | `core/src/drivers/custom/*` + 注册表 `register/unregister` |
| S05–S07 | 四渠道驱动 / 刷新闸门 / 熔断 | ✅ | `tests/drivers/*.spec.ts`、`tests/scheduler/*.spec.ts` |
| S08 | fixture 矩阵 20 例 | ✅ | `fixtures/custom/matrix.json` + `custom-fixtures.spec.ts` |
| S09–S15 | 投影 / 渲染层 / 壳层 | ✅（壳层未编译） | `ui/dist/*.js`、`scripts/check-rust-shell.py` |
| S16 | 文档一致性自检 | ✅ | `scripts/check-doc.py` 31 项 |

### 8.1 自定义渠道：抽象适配的实证

四个内置渠道与自定义渠道共用**同一个** `ChannelDriver` 契约，差异被压缩成两处配置：

```ts
{
  name: 'demo',                       // → provider 'custom.demo'
  base_url: 'https://gw.example.com/api',
  endpoint_path: '/usage',
  auth: { kind: 'header', header_name: 'x-api-key' },
  json: { remaining: '$.data.remaining', total: '$.data.total', resets_at: '$.data.expires_at' },
  visual: 'credits_pool'              // 或 'single_periodic_window'
}
```

- **数据格式不同** → `json.*` 字段路径（只读 JSONPath 子集：`.a` 与 `[0]`，禁止函数/通配/过滤器）；
- **展示方式不同** → `visual`（双环 / 单环 / 积分池），几何仍由 `core/src/domain/visual.ts` 唯一决定；
- **安全边界不因「自定义」放宽**：https 强制、白名单只含用户填的那一个 origin、header 名不得覆盖 `authorization/cookie/host`、401/403/404/429/5xx/HTML/网络异常七类与内置渠道同表分类。

端到端证据：`ui/src/dev-mock.ts` 注入 `custom.demo` 后，浏览器实测 **10 张卡片 / 28 个环形节点**，该卡环弧 `dasharray 53.57/127.55 = 42%`，与 `4,200 / 10,000` 一致，0 横向溢出 —— **UI 未为自定义渠道改一行代码**。

### 8.2 仍未验证（能力边界，不是遗漏）

| 项 | 原因 | 解除条件 |
| :--- | :--- | :--- |
| `cargo build` / `tauri build` | 容器无 rustc、非 macOS | 在 Mac 上按 `docs/BUILD-macOS.md` 执行 |
| 真实端点联调 | 本机无任何渠道登录态 | 有账号的机器跑 `tools/quota_probe.py` |
| NSPanel 非激活面板 / 唤醒事件 | 需 AppKit 原生类替换 | macOS 实机阶段 |
| 浅色外观材质对比度 | 需实机截图取样 | v1.1 |
