/**
 * WorkBuddy 响应数据归一化 (Data Normalization)
 * 契约规范：docs/ARCHITECTURE.md 第 5.4 节
 *
 * 核心规则：
 * 1. 积分池形态 (credits_pool)：
 *    - totalRemaining 为剩余额度唯一事实源；若缺失则从未过期 packages 累加求和。
 *    - totalCapacity 为总额度事实源；若缺失且 packages 存在，则由未过期 packages 的 total 累加（过期包不计入 total）。
 *    - total 与 remaining 均已知且 total > 0 时给出 ratio = clamp01(remaining / total)；
 *      若 total 未知（null）或 total === 0，ratio 必须为 null（严格禁止 0 兜底）。
 * 2. 过期积分包 (expired === true 或 expireAt <= now)：
 *    - 保留在 packages 列表中供详情页展示；
 *    - 严格排除在 total 与 remaining 计算之外。
 * 3. pool.expires_at 取未过期且带有有效 expireAt 的积分包中最近的截止时间；无则为 null。
 */

import type {
  CreditsPool,
  CreditPackage,
  CreditsReading,
  EpochMillis,
} from '../../domain/types.js';

export interface RawPackage {
  readonly id?: string | number;
  readonly name?: string;
  readonly label?: string;
  readonly total?: number;
  readonly capacity?: number;
  readonly used?: number;
  readonly remaining?: number;
  readonly expireAt?: number | string;
  readonly expires_at?: number | string;
  readonly expired?: boolean;
}

export interface RawWorkBuddyPayload {
  readonly code?: number;
  readonly msg?: string;
  readonly data?: RawWorkBuddyPayload;
  readonly summary?: {
    readonly totalCapacity?: number;
    readonly totalRemaining?: number;
    readonly totalUsed?: number;
  };
  readonly packages?: readonly RawPackage[];
  readonly usage?: readonly unknown[];
}

export interface NormalizeOutcome {
  readonly reading: CreditsReading;
  readonly warnings: readonly string[];
}

function clamp01(val: number): number {
  if (Number.isNaN(val)) return 0;
  if (val <= 0) return 0;
  if (val >= 1) return 1;
  return val;
}

function parseEpoch(val: unknown): EpochMillis | null {
  if (val == null) return null;
  if (typeof val === 'number' && !Number.isNaN(val) && val > 0) {
    return val;
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * 归一化 WorkBuddy API 返回载荷
 */
export function normalizeWorkBuddy(
  raw: unknown,
  now: EpochMillis = Date.now()
): NormalizeOutcome {
  if (!raw || typeof raw !== 'object') {
    throw new Error('WorkBuddy response must be a non-null object');
  }

  const warnings: string[] = [];
  const payload = raw as RawWorkBuddyPayload;
  // 兼顾包裹在 data 中的常见 API 格式
  const effectivePayload: RawWorkBuddyPayload =
    payload.data && typeof payload.data === 'object' && ('summary' in payload.data || 'packages' in payload.data)
      ? payload.data
      : payload;

  const summary = effectivePayload.summary;
  const rawPackages = effectivePayload.packages;

  if (!summary && (!Array.isArray(rawPackages) || rawPackages.length === 0)) {
    throw new Error('WorkBuddy payload contains neither valid summary nor packages');
  }

  // 1. 处理 packages 列表
  const packages: CreditPackage[] = [];
  let packagesActiveRemaining = 0;
  let packagesActiveTotal = 0;
  let hasValidPackage = false;
  let earliestExpireAt: EpochMillis | null = null;

  if (Array.isArray(rawPackages)) {
    for (let i = 0; i < rawPackages.length; i++) {
      const p = rawPackages[i];
      if (!p || typeof p !== 'object') {
        warnings.push(`Ignored invalid package item at index ${i}`);
        continue;
      }

      const id = String(p.id ?? `pkg_${i + 1}`);
      const label = String(p.label ?? p.name ?? `积分包 #${i + 1}`);
      const total = typeof p.total === 'number' ? p.total : typeof p.capacity === 'number' ? p.capacity : 0;
      const expireAt = parseEpoch(p.expireAt ?? p.expires_at);

      // 判断过期状态：若上游已给出明确 expired 字段则遵从，否则根据当前时间比对
      const isExpired =
        typeof p.expired === 'boolean'
          ? p.expired
          : Boolean(expireAt !== null && expireAt <= now);

      let remaining = 0;
      if (typeof p.remaining === 'number') {
        remaining = p.remaining;
      } else if (typeof p.used === 'number') {
        remaining = Math.max(0, total - p.used);
      } else {
        remaining = total;
      }

      packages.push({
        id,
        label,
        total,
        remaining,
        expires_at: expireAt,
        expired: isExpired,
      });

      hasValidPackage = true;

      // 过期积分包不计入 total 与 remaining
      if (!isExpired) {
        packagesActiveTotal += total;
        packagesActiveRemaining += remaining;

        if (expireAt !== null) {
          if (earliestExpireAt === null || expireAt < earliestExpireAt) {
            earliestExpireAt = expireAt;
          }
        }
      }
    }
  }

  // 2. 推导 remaining
  let remaining: number | null = null;
  let sourceField = 'summary.totalRemaining';

  if (summary && typeof summary.totalRemaining === 'number') {
    remaining = summary.totalRemaining;
  } else if (hasValidPackage) {
    remaining = packagesActiveRemaining;
    sourceField = 'packages.activeRemaining';
    warnings.push('totalRemaining missing from summary, derived from active packages');
  }

  if (remaining === null) {
    throw new Error('Cannot determine remaining credits from WorkBuddy response');
  }

  // 3. 推导 total
  let total: number | null = null;
  if (summary && typeof summary.totalCapacity === 'number') {
    total = summary.totalCapacity;
  } else if (hasValidPackage && packagesActiveTotal > 0) {
    total = packagesActiveTotal;
    warnings.push('totalCapacity missing from summary, derived from active packages (excluding expired)');
  }

  // 4. 计算 remaining_ratio（必须在 total 明确大于 0 时计算，禁止 0 兜底）
  let remainingRatio: number | null = null;
  if (total !== null && total > 0) {
    remainingRatio = clamp01(remaining / total);
  } else {
    // total 未知或为 0 时，ratio 必须保持 null
    remainingRatio = null;
  }

  const pool: CreditsPool = {
    unit: 'credits',
    remaining,
    total,
    remaining_ratio: remainingRatio,
    packages,
    expires_at: earliestExpireAt,
    source_field: sourceField,
  };

  const reading: CreditsReading = {
    kind: 'credits',
    pool,
  };

  return { reading, warnings };
}
