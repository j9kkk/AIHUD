/**
 * AI HUD 驱动注册表 (Driver Registry)
 * 契约规范：docs/ARCHITECTURE.md 第 4.5 节
 *
 * 核心要求：
 * 1. 构造期强校验（不通过直接抛出 RegistryError）：
 *    - 驱动必须为合法对象且实现完整 ChannelDriver 接口；
 *    - provider 唯一，且禁止以 custom.* 注册（内置位必须显式实现）；
 *    - supported_auth_flows 必须为非空数组；
 *    - 轮询策略必须满足：120 <= min <= base <= max <= 3600，且 jitter_ratio ∈ [0, 0.5]；
 *    - 退避策略必须满足：backoff.max_secs >= backoff.base_secs >= 30；
 *    - 域名白名单 allowed_origins 必须全部为 https: 开头。
 * 2. get(provider):
 *    - 查询已注册驱动；若未注册抛出 UnsupportedProviderError。
 * 3. list():
 *    - UI「添加账号」列表的唯一数据源，返回稳定排序：
 *      claude -> codex -> workbuddy -> gemini（首发四渠道有序，其余字母序）。
 * 4. assert_ready():
 *    - 巡检各驱动可用性与 fixture 样本完整性，缺失降级为 RegistryWarning 而非直接崩溃。
 */

import type {
  ProviderKind,
  BuiltinProviderKind,
  MetricVisualKind,
} from '../domain/types.js';
import type {
  ChannelDriver,
  DriverCapabilities,
  PollPolicy,
  AuthFlowType,
} from './driver.js';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export class UnsupportedProviderError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`Unsupported provider: ${provider}`);
    this.name = 'UnsupportedProviderError';
    this.provider = provider;
  }
}

export interface DriverSummary {
  readonly provider: ProviderKind;
  readonly schema_version: string;
  readonly supported_auth_flows: readonly AuthFlowType[];
  readonly capabilities: DriverCapabilities;
  readonly default_visual: MetricVisualKind;
  readonly poll_policy: PollPolicy;
}

export interface RegistryWarning {
  readonly provider: ProviderKind;
  readonly code: string;
  readonly message: string;
}

export interface AssertReadyOptions {
  /** 自定义样本检测器（用于跨平台或测试环境注入） */
  readonly fixtureChecker?: (provider: ProviderKind) => boolean;
}

const BUILTIN_ORDER: readonly BuiltinProviderKind[] = [
  'claude',
  'codex',
  'workbuddy',
  'gemini',
];

export class DriverRegistry {
  private readonly drivers = new Map<ProviderKind, ChannelDriver>();

  constructor(drivers: readonly ChannelDriver[]) {
    if (!Array.isArray(drivers)) {
      throw new RegistryError('Drivers must be provided as an array');
    }

    for (const driver of drivers) {
      this.validateDriver(driver);

      if (this.drivers.has(driver.provider)) {
        throw new RegistryError(`Duplicate driver registration for provider: "${driver.provider}"`);
      }

      this.drivers.set(driver.provider, driver);
    }
  }

  private validateDriver(driver: ChannelDriver): void {
    if (!driver || typeof driver !== 'object') {
      throw new RegistryError('Each driver must be a valid ChannelDriver object');
    }

    // 1. 基础字段与 provider 校验
    if (!driver.provider || typeof driver.provider !== 'string') {
      throw new RegistryError('Driver missing required property: provider');
    }

    // custom.<name> 是合法 provider，但必须满足命名与白名单约束（S04）
    if (driver.provider.startsWith('custom.')) {
      const name = driver.provider.slice('custom.'.length);
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
        throw new RegistryError(
          `Custom provider name invalid: "${driver.provider}" (expect custom.<a-z0-9_-{1,32}>)`
        );
      }
      if (!Array.isArray(driver.capabilities?.allowed_origins) || driver.capabilities.allowed_origins.length === 0) {
        throw new RegistryError(
          `Custom provider "${driver.provider}" must declare at least one allowed origin`
        );
      }
    }

    // 2. 核心方法校验
    if (typeof driver.fetch_snapshot !== 'function') {
      throw new RegistryError(`Driver "${driver.provider}" must implement fetch_snapshot(ctx)`);
    }

    if (typeof driver.refresh_token !== 'function') {
      throw new RegistryError(`Driver "${driver.provider}" must implement refresh_token(ctx)`);
    }

    // 3. supported_auth_flows 非空数组
    if (!Array.isArray(driver.supported_auth_flows) || driver.supported_auth_flows.length === 0) {
      throw new RegistryError(`Driver "${driver.provider}" supported_auth_flows must be a non-empty array`);
    }

    // 4. poll_policy 校验：120 <= min <= base <= max <= 3600，jitter_ratio ∈ [0, 0.5]
    if (!driver.poll_policy || typeof driver.poll_policy !== 'object') {
      throw new RegistryError(`Driver "${driver.provider}" missing poll_policy`);
    }

    const {
      min_interval_secs,
      base_interval_secs,
      max_interval_secs,
      jitter_ratio,
      backoff,
    } = driver.poll_policy;

    if (
      typeof min_interval_secs !== 'number' ||
      typeof base_interval_secs !== 'number' ||
      typeof max_interval_secs !== 'number' ||
      min_interval_secs < 120 ||
      min_interval_secs > base_interval_secs ||
      base_interval_secs > max_interval_secs ||
      max_interval_secs > 3600
    ) {
      throw new RegistryError(
        `Driver "${driver.provider}" poll_policy intervals invalid: must satisfy 120 <= min (${min_interval_secs}) <= base (${base_interval_secs}) <= max (${max_interval_secs}) <= 3600`
      );
    }

    if (
      typeof jitter_ratio !== 'number' ||
      Number.isNaN(jitter_ratio) ||
      jitter_ratio < 0 ||
      jitter_ratio > 0.5
    ) {
      throw new RegistryError(
        `Driver "${driver.provider}" poll_policy jitter_ratio must be in [0, 0.5], got: ${jitter_ratio}`
      );
    }

    // 5. backoff 校验：max_secs >= base_secs >= 30
    if (!backoff || typeof backoff !== 'object') {
      throw new RegistryError(`Driver "${driver.provider}" missing poll_policy.backoff`);
    }

    if (
      typeof backoff.base_secs !== 'number' ||
      typeof backoff.max_secs !== 'number' ||
      backoff.base_secs < 30 ||
      backoff.max_secs < backoff.base_secs
    ) {
      throw new RegistryError(
        `Driver "${driver.provider}" backoff invalid: must satisfy max_secs (${backoff.max_secs}) >= base_secs (${backoff.base_secs}) >= 30`
      );
    }

    // 6. capabilities 校验：allowed_origins 必须全为 https:
    if (!driver.capabilities || typeof driver.capabilities !== 'object') {
      throw new RegistryError(`Driver "${driver.provider}" missing capabilities`);
    }

    if (Array.isArray(driver.capabilities.allowed_origins)) {
      for (const origin of driver.capabilities.allowed_origins) {
        if (!origin.startsWith('https://')) {
          throw new RegistryError(
            `Driver "${driver.provider}" allowed_origins must only contain https: origins, found: "${origin}"`
          );
        }
      }
    }
  }

  /**
   * 运行时注册（自定义渠道装配用）。校验规则与构造期完全一致，
   * 重名抛 RegistryError，避免 UI 列表出现两个同名渠道。
   */
  register(driver: ChannelDriver): void {
    this.validateDriver(driver);
    if (this.drivers.has(driver.provider)) {
      throw new RegistryError(`Duplicate driver registration for provider: "${driver.provider}"`);
    }
    this.drivers.set(driver.provider, driver);
  }

  /**
   * 注销驱动（用户删除自定义渠道）。内置位不允许注销。
   */
  unregister(provider: ProviderKind): boolean {
    if (!provider.startsWith('custom.')) return false;
    return this.drivers.delete(provider);
  }

  /**
   * 根据 provider 查询对应驱动
   */
  get(provider: ProviderKind): ChannelDriver {
    const driver = this.drivers.get(provider);
    if (!driver) {
      throw new UnsupportedProviderError(provider);
    }
    return driver;
  }

  /**
   * 返回所有已注册驱动的摘要信息，保持稳定排序（UI 渠道列表唯一数据源）
   */
  list(): readonly DriverSummary[] {
    const sorted = Array.from(this.drivers.values()).sort((a, b) => {
      const idxA = BUILTIN_ORDER.indexOf(a.provider as BuiltinProviderKind);
      const idxB = BUILTIN_ORDER.indexOf(b.provider as BuiltinProviderKind);

      if (idxA !== -1 && idxB !== -1) {
        return idxA - idxB;
      }
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.provider.localeCompare(b.provider);
    });

    return sorted.map((d) => ({
      provider: d.provider,
      schema_version: d.schema_version,
      supported_auth_flows: d.supported_auth_flows,
      capabilities: d.capabilities,
      default_visual: d.default_visual ?? this.resolveDefaultVisual(d.provider),
      poll_policy: d.poll_policy,
    }));
  }

  /**
   * 巡检驱动准备状态（缺失 fixture 等仅返回警告而不崩溃）
   */
  assert_ready(options?: AssertReadyOptions): readonly RegistryWarning[] {
    const warnings: RegistryWarning[] = [];

    for (const [provider] of this.drivers) {
      if (options?.fixtureChecker) {
        const ok = options.fixtureChecker(provider);
        if (!ok) {
          warnings.push({
            provider,
            code: 'missing_fixture',
            message: `渠道 ${provider} 缺少有效测试样本，暂不可用`,
          });
        }
      }
    }

    return warnings;
  }

  private resolveDefaultVisual(provider: ProviderKind): MetricVisualKind {
    switch (provider) {
      case 'workbuddy':
        return 'credits_pool';
      case 'gemini':
        return 'single_periodic_window';
      case 'claude':
      case 'codex':
      default:
        return 'dual_sliding_window';
    }
  }
}
