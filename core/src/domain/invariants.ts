/**
 * AI HUD 领域不变式断言 (Invariants I1–I10)
 * 契约规范：docs/ARCHITECTURE.md 第 0 章与第 1 章
 *
 * 任何违反 I1–I10 的快照均不得落盘、不得输入投影。
 * 违规时抛出 InvariantViolation(error_code, detail)。
 */

import type {
  EpochMillis,
  AccountSnapshot,
  AccountCardView,
  AccountHealthState,
  MetricVisualKind,
} from './types.js';

export class InvariantViolation extends Error {
  readonly error_code: string;
  readonly detail: string;

  constructor(error_code: string, detail: string) {
    super(`[${error_code}] Invariant violation: ${detail}`);
    this.name = 'InvariantViolation';
    this.error_code = error_code;
    this.detail = detail;
  }
}

/**
 * 校验领域快照是否满足全局不变式 I1–I10。
 * 若提供了投影产物 cardView，则一并检验 I6。
 *
 * @param snapshot 待检验的账号快照
 * @param cardView 可选的卡片视图模型，用于校验 I6
 * @throws {InvariantViolation} 遇到任何一条不变式违反时抛出
 */
export function assertInvariants(
  snapshot: AccountSnapshot,
  cardView?: AccountCardView | null
): void {
  // ----------------------------------------------------
  // I1: state === 'normal' ⇔ reading !== null ∧ reading_observed_at === last_success_at ∧ retry_at === null
  // ----------------------------------------------------
  const meetsNormalCondition =
    snapshot.reading !== null &&
    snapshot.reading_observed_at !== null &&
    snapshot.last_success_at !== null &&
    snapshot.reading_observed_at === snapshot.last_success_at &&
    snapshot.retry_at === null;

  if (snapshot.state === 'normal') {
    if (!meetsNormalCondition) {
      throw new InvariantViolation(
        'I1',
        `state === 'normal' requires reading !== null, reading_observed_at === last_success_at, and retry_at === null`
      );
    }
  } else {
    if (meetsNormalCondition) {
      throw new InvariantViolation(
        'I1',
        `state !== 'normal' must not satisfy all normal conditions (reading !== null, reading_observed_at === last_success_at, retry_at === null)`
      );
    }
  }

  // ----------------------------------------------------
  // I2: reading === null ⇒ reading_observed_at === null ∧ last_success_at === null
  // ----------------------------------------------------
  if (snapshot.reading === null) {
    if (snapshot.reading_observed_at !== null || snapshot.last_success_at !== null) {
      throw new InvariantViolation(
        'I2',
        `reading === null implies reading_observed_at === null and last_success_at === null`
      );
    }
  }

  // ----------------------------------------------------
  // I3: 每个 remaining_ratio ∈ [0,1] 且非 NaN；百分数格式化结果 ∈ [0,100]
  // ----------------------------------------------------
  if (snapshot.reading !== null) {
    if (snapshot.reading.kind === 'windows') {
      for (const w of snapshot.reading.windows) {
        if (
          typeof w.remaining_ratio !== 'number' ||
          Number.isNaN(w.remaining_ratio) ||
          w.remaining_ratio < 0 ||
          w.remaining_ratio > 1
        ) {
          throw new InvariantViolation(
            'I3',
            `Window "${w.id}" remaining_ratio ${w.remaining_ratio} must be in [0, 1] and not NaN`
          );
        }
      }
    } else if (snapshot.reading.kind === 'credits') {
      const ratio = snapshot.reading.pool.remaining_ratio;
      if (ratio !== null) {
        if (
          typeof ratio !== 'number' ||
          Number.isNaN(ratio) ||
          ratio < 0 ||
          ratio > 1
        ) {
          throw new InvariantViolation(
            'I3',
            `Credits pool remaining_ratio ${ratio} must be in [0, 1] and not NaN`
          );
        }
      }
    }
  }

  // ----------------------------------------------------
  // I4: reading.kind === 'windows' ⇒ windows.length ≥ 1 且 id 唯一
  // ----------------------------------------------------
  if (snapshot.reading !== null && snapshot.reading.kind === 'windows') {
    if (snapshot.reading.windows.length < 1) {
      throw new InvariantViolation(
        'I4',
        `reading.kind === 'windows' requires windows.length >= 1`
      );
    }
    const seenIds = new Set<string>();
    for (const w of snapshot.reading.windows) {
      if (!w.id || seenIds.has(w.id)) {
        throw new InvariantViolation(
          'I4',
          `Window id "${w.id}" must be non-empty and unique within snapshot`
        );
      }
      seenIds.add(w.id);
    }
  }

  // ----------------------------------------------------
  // I5: visual_kind 与 reading.kind 严格对应（见 3.2）
  // ----------------------------------------------------
  if (snapshot.reading !== null) {
    if (snapshot.reading.kind === 'credits') {
      if (snapshot.visual_kind !== 'credits_pool') {
        throw new InvariantViolation(
          'I5',
          `reading.kind === 'credits' requires visual_kind === 'credits_pool', got '${snapshot.visual_kind}'`
        );
      }
    } else if (snapshot.reading.kind === 'windows') {
      const expectedKind: MetricVisualKind =
        snapshot.reading.windows.length >= 2 ? 'dual_sliding_window' : 'single_periodic_window';
      if (snapshot.visual_kind !== expectedKind) {
        throw new InvariantViolation(
          'I5',
          `reading.kind === 'windows' with ${snapshot.reading.windows.length} window(s) requires visual_kind === '${expectedKind}', got '${snapshot.visual_kind}'`
        );
      }
    }
  }

  // ----------------------------------------------------
  // I6: state !== 'normal' ⇒ 投影的 primary_slot.kind !== 'percent'
  // ----------------------------------------------------
  if (cardView !== undefined && cardView !== null) {
    assertCardViewInvariants(cardView, snapshot.state);
  }

  // ----------------------------------------------------
  // I7: exhausted === (remaining_ratio === 0)
  // ----------------------------------------------------
  if (snapshot.reading !== null && snapshot.reading.kind === 'windows') {
    for (const w of snapshot.reading.windows) {
      const expectedExhausted = w.remaining_ratio === 0;
      if (w.exhausted !== expectedExhausted) {
        throw new InvariantViolation(
          'I7',
          `Window "${w.id}" exhausted (${w.exhausted}) must strictly equal remaining_ratio === 0 (${expectedExhausted})`
        );
      }
    }
  }

  // ----------------------------------------------------
  // I8: region !== 'global' 仅允许出现在 workbuddy
  // ----------------------------------------------------
  if (snapshot.region !== 'global' && snapshot.provider !== 'workbuddy') {
    throw new InvariantViolation(
      'I8',
      `region !== 'global' ('${snapshot.region}') is only allowed for provider 'workbuddy', got '${snapshot.provider}'`
    );
  }

  // ----------------------------------------------------
  // I10: 缺失数值一律 null，禁止 0 兜底（类型层 number | null，不使用 ?? 0）
  // ----------------------------------------------------
  if (
    typeof snapshot.consecutive_failures !== 'number' ||
    Number.isNaN(snapshot.consecutive_failures) ||
    snapshot.consecutive_failures < 0
  ) {
    throw new InvariantViolation(
      'I10',
      `consecutive_failures must be non-negative integer number, not NaN or undefined`
    );
  }

  // ----------------------------------------------------
  // I9: state === 'normal' ⇔ consecutive_failures === 0
  // ----------------------------------------------------
  if (snapshot.state === 'normal') {
    if (snapshot.consecutive_failures !== 0) {
      throw new InvariantViolation(
        'I9',
        `state === 'normal' requires consecutive_failures === 0, got ${snapshot.consecutive_failures}`
      );
    }
  } else {
    if (snapshot.consecutive_failures === 0) {
      throw new InvariantViolation(
        'I9',
        `state !== 'normal' requires consecutive_failures > 0, got 0`
      );
    }
  }

  if (snapshot.reading === null) {
    if (snapshot.reading_observed_at !== null || snapshot.last_success_at !== null) {
      throw new InvariantViolation(
        'I10',
        `Missing reading must have null timestamps, never 0 or fake dates`
      );
    }
  } else if (snapshot.reading.kind === 'windows') {
    for (const w of snapshot.reading.windows) {
      if (w.amount !== null) {
        if (
          w.amount.used !== null &&
          (typeof w.amount.used !== 'number' || Number.isNaN(w.amount.used))
        ) {
          throw new InvariantViolation(
            'I10',
            `Window "${w.id}" amount.used must be number or null, not NaN`
          );
        }
        if (
          w.amount.limit !== null &&
          (typeof w.amount.limit !== 'number' || Number.isNaN(w.amount.limit))
        ) {
          throw new InvariantViolation(
            'I10',
            `Window "${w.id}" amount.limit must be number or null, not NaN`
          );
        }
      }
      if (
        w.duration_secs !== null &&
        (typeof w.duration_secs !== 'number' || Number.isNaN(w.duration_secs) || w.duration_secs <= 0)
      ) {
        throw new InvariantViolation(
          'I10',
          `Window "${w.id}" duration_secs must be positive number or null`
        );
      }
    }
  } else if (snapshot.reading.kind === 'credits') {
    const pool = snapshot.reading.pool;
    if (typeof pool.remaining !== 'number' || Number.isNaN(pool.remaining)) {
      throw new InvariantViolation(
        'I10',
        `Credits pool remaining must be a valid number`
      );
    }
    if (
      pool.total !== null &&
      (typeof pool.total !== 'number' || Number.isNaN(pool.total))
    ) {
      throw new InvariantViolation(
        'I10',
        `Credits pool total must be number or null, not NaN`
      );
    }
    if (
      pool.remaining_ratio !== null &&
      (typeof pool.remaining_ratio !== 'number' || Number.isNaN(pool.remaining_ratio))
    ) {
      throw new InvariantViolation(
        'I10',
        `Credits pool remaining_ratio must be number or null, not NaN`
      );
    }
  }
}

/**
 * 校验投影卡片模型的不变式约束（对应硬规则 1 与 I6）。
 *
 * @param cardView 卡片视图模型
 * @param state 关联账号当前的健康状态
 */
export function assertCardViewInvariants(
  cardView: AccountCardView,
  state: AccountHealthState
): void {
  if (state !== 'normal' && cardView.primary_slot.kind === 'percent') {
    throw new InvariantViolation(
      'I6',
      `state !== 'normal' ('${state}') strictly forbids primary_slot.kind === 'percent'`
    );
  }
}


// ==========================================
// 账号级边界：暂停 / 隐藏 / 版本号（SPEC S01）
// ==========================================

/**
 * I11｜暂停到期判定。
 * 只看「是否仍在暂停」这一件事：过去时刻必须等价于 null，
 * 否则 UI 会显示一个永远不会结束的暂停角标。
 */
export function effectivePauseUntil(
  pauseUntil: EpochMillis | null | undefined,
  now: EpochMillis
): EpochMillis | null {
  if (pauseUntil === null || pauseUntil === undefined) return null;
  if (!Number.isFinite(pauseUntil)) return null;
  return pauseUntil > now ? pauseUntil : null;
}

/**
 * I12｜被隐藏的账号不进入任何可见集合。
 * 通知与轮询不受影响——隐藏只影响展示，不影响数据。
 */
export function isVisible(account: {
  readonly hidden?: boolean | undefined;
  readonly pause_until?: EpochMillis | null | undefined;
}, now: EpochMillis): boolean {
  if (account.hidden === true) return false;
  // 暂停中的账号仍可见（用户主动静默，但要能看到"已暂停"角标）
  void effectivePauseUntil(account.pause_until, now);
  return true;
}

export interface AccountFlagIssue {
  readonly field: 'pause_until' | 'hidden' | 'revision';
  readonly message: string;
}

/** 写库前的账号级校验：返回全部问题，空数组表示合法 */
export function validateAccountFlags(account: {
  readonly pause_until?: EpochMillis | null | undefined;
  readonly hidden?: boolean | undefined;
  readonly revision?: number | undefined;
}): readonly AccountFlagIssue[] {
  const issues: AccountFlagIssue[] = [];

  if (account.pause_until !== undefined && account.pause_until !== null) {
    if (!Number.isFinite(account.pause_until)) {
      issues.push({ field: 'pause_until', message: '暂停时刻必须是有限毫秒时间戳或 null' });
    } else if (account.pause_until > Date.now() + 365 * 24 * 3600 * 1000) {
      issues.push({ field: 'pause_until', message: '暂停时刻超过一年，疑似单位错误（秒 vs 毫秒）' });
    }
  }

  if (account.hidden !== undefined && typeof account.hidden !== 'boolean') {
    issues.push({ field: 'hidden', message: 'hidden 必须是布尔值' });
  }

  if (account.revision !== undefined) {
    if (!Number.isInteger(account.revision) || account.revision < 0) {
      issues.push({ field: 'revision', message: 'revision 必须是非负整数' });
    }
  }

  return issues;
}

/** I13｜乐观并发：写入必须携带更大的 revision */
export function nextRevision(current: number | undefined): number {
  return (current ?? 0) + 1;
}

export function assertRevisionMonotonic(
  current: number | undefined,
  incoming: number | undefined
): boolean {
  if (incoming === undefined) return true;
  return incoming > (current ?? 0);
}
