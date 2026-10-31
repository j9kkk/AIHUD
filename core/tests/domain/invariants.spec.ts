import { describe, it, expect } from 'vitest';
import {
  assertInvariants,
  assertCardViewInvariants,
  InvariantViolation,
} from '../../src/domain/invariants.js';
import type {
  AccountSnapshot,
  AccountCardView,
  WindowsReading,
  CreditsReading,
} from '../../src/domain/types.js';

function createValidNormalSnapshot(): AccountSnapshot {
  const reading: WindowsReading = {
    kind: 'windows',
    windows: [
      {
        id: 'five_hour',
        label: '5 小时窗口',
        scope: 'account',
        duration_secs: 18000,
        remaining_ratio: 0.09,
        amount: { unit: 'percent', used: 91, limit: 100 },
        resets_at: 1761800000000,
        exhausted: false,
        quality: 'exact',
        source_field: 'five_hour.utilization',
      },
      {
        id: 'seven_day',
        label: '周窗口',
        scope: 'account',
        duration_secs: 604800,
        remaining_ratio: 0.41,
        amount: { unit: 'percent', used: 59, limit: 100 },
        resets_at: 1762200000000,
        exhausted: false,
        quality: 'exact',
        source_field: 'seven_day.utilization',
      },
    ],
    extra_usage_cents: null,
    credits_balance: null,
    reset_credits: null,
  };

  return {
    account_id: 'acc-1',
    provider: 'claude',
    region: 'global',
    alias: 'Claude 工作主力',
    identity: {
      real_identifier_masked: 'a***@corp.com',
      organization: 'Corp',
    },
    plan_name: 'Max 5x',
    visual_kind: 'dual_sliding_window',
    reading,
    reading_observed_at: 1761790000000,
    state: 'normal',
    state_detail: {
      reason: 'network',
      message: 'OK',
      http_status: 200,
      upstream_code: null,
      auth_action: 'none',
      migration_hint: null,
    },
    last_attempt_at: 1761790000000,
    last_success_at: 1761790000000,
    consecutive_failures: 0,
    retry_at: null,
    schema_version: 'claude.v1',
  };
}

describe('assertInvariants', () => {
  it('passes on a valid normal snapshot', () => {
    const snap = createValidNormalSnapshot();
    expect(() => assertInvariants(snap)).not.toThrow();
  });

  // I1
  it('I1: throws when normal state has null reading', () => {
    const snap = {
      ...createValidNormalSnapshot(),
      reading: null,
      reading_observed_at: null,
      last_success_at: null,
    };
    expect(() => assertInvariants(snap)).toThrowError(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I1');
    }
  });

  it('I1: throws when normal state has reading_observed_at !== last_success_at', () => {
    const snap = {
      ...createValidNormalSnapshot(),
      reading_observed_at: 1761790000000,
      last_success_at: 1761790005000,
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I1');
    }
  });

  it('I1: throws when normal state has non-null retry_at', () => {
    const snap = {
      ...createValidNormalSnapshot(),
      retry_at: 1761799999000,
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
  });

  it('I1: throws when non-normal state satisfies all normal conditions', () => {
    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      state: 'offline_stale',
      consecutive_failures: 1, // satisfies I9 if failures > 0, but retry_at is null & times match
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I1');
    }
  });

  // I2
  it('I2: throws when reading === null but last_success_at !== null', () => {
    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      state: 'never_synced',
      consecutive_failures: 1,
      reading: null,
      reading_observed_at: null,
      last_success_at: 1761790000000,
      retry_at: 1761800000000,
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I2');
    }
  });

  // I3
  it('I3: throws when window remaining_ratio is out of bounds (< 0, > 1, or NaN)', () => {
    const base = createValidNormalSnapshot();
    const reading = base.reading as WindowsReading;

    const snapNeg: AccountSnapshot = {
      ...base,
      reading: {
        ...reading,
        windows: [{ ...reading.windows[0]!, remaining_ratio: -0.05 }],
      },
    };
    expect(() => assertInvariants(snapNeg)).toThrow(InvariantViolation);

    const snapOver: AccountSnapshot = {
      ...base,
      reading: {
        ...reading,
        windows: [{ ...reading.windows[0]!, remaining_ratio: 1.05 }],
      },
    };
    expect(() => assertInvariants(snapOver)).toThrow(InvariantViolation);

    const snapNaN: AccountSnapshot = {
      ...base,
      reading: {
        ...reading,
        windows: [{ ...reading.windows[0]!, remaining_ratio: NaN }],
      },
    };
    expect(() => assertInvariants(snapNaN)).toThrow(InvariantViolation);
  });

  it('I3: throws when credits pool remaining_ratio is out of bounds', () => {
    const poolReading: CreditsReading = {
      kind: 'credits',
      pool: {
        unit: 'credits',
        remaining: 15200,
        total: 20000,
        remaining_ratio: 1.2, // out of bounds
        packages: [],
        expires_at: null,
        source_field: 'summary.totalRemaining',
      },
    };

    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      provider: 'workbuddy',
      visual_kind: 'credits_pool',
      reading: poolReading,
    };

    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I3');
    }
  });

  // I4
  it('I4: throws when windows array is empty or has duplicate IDs', () => {
    const base = createValidNormalSnapshot();
    const reading = base.reading as WindowsReading;

    const snapEmpty: AccountSnapshot = {
      ...base,
      reading: {
        ...reading,
        windows: [],
      },
    };
    expect(() => assertInvariants(snapEmpty)).toThrow(InvariantViolation);

    const snapDup: AccountSnapshot = {
      ...base,
      reading: {
        ...reading,
        windows: [
          reading.windows[0]!,
          { ...reading.windows[1]!, id: reading.windows[0]!.id },
        ],
      },
    };
    expect(() => assertInvariants(snapDup)).toThrow(InvariantViolation);
    try {
      assertInvariants(snapDup);
    } catch (e: any) {
      expect(e.error_code).toBe('I4');
    }
  });

  // I5
  it('I5: throws when visual_kind does not correspond to reading kind', () => {
    const base = createValidNormalSnapshot();
    // 2 windows requires dual_sliding_window, give single_periodic_window
    const snapMismatchedWindows: AccountSnapshot = {
      ...base,
      visual_kind: 'single_periodic_window',
    };
    expect(() => assertInvariants(snapMismatchedWindows)).toThrow(InvariantViolation);

    // windows with credits_pool
    const snapWrongKind: AccountSnapshot = {
      ...base,
      visual_kind: 'credits_pool',
    };
    expect(() => assertInvariants(snapWrongKind)).toThrow(InvariantViolation);
    try {
      assertInvariants(snapWrongKind);
    } catch (e: any) {
      expect(e.error_code).toBe('I5');
    }
  });

  // I6
  it('I6: throws when state !== normal but projected card primary_slot is percent', () => {
    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      state: 'offline_stale',
      consecutive_failures: 2,
      retry_at: 1761800000000,
    };

    const invalidCardView: AccountCardView = {
      account_id: 'acc-1',
      alias: 'Claude 工作主力',
      plan_name: 'Max 5x',
      visual_kind: 'dual_sliding_window',
      ring: {
        mode: 'unknown',
        outer: null,
        inner: null,
        center_text: '?',
        center_tone: 'neutral',
      },
      // VIOLATION of I6: offline state with primary_slot.kind === 'percent'
      primary_slot: { kind: 'percent', text: '9%', tone: 'hot' },
      history_slot: { text: '最后 41% · 12:30' },
      reset_text: null,
      action: { kind: 'retry', label: '立即重试' },
      dimmed: true,
    };

    expect(() => assertInvariants(snap, invalidCardView)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap, invalidCardView);
    } catch (e: any) {
      expect(e.error_code).toBe('I6');
    }

    expect(() => assertCardViewInvariants(invalidCardView, 'offline_stale')).toThrow(
      InvariantViolation
    );
  });

  // I7
  it('I7: throws when exhausted !== (remaining_ratio === 0)', () => {
    const base = createValidNormalSnapshot();
    const reading = base.reading as WindowsReading;

    // ratio > 0 but exhausted === true
    const snapFakeExhausted: AccountSnapshot = {
      ...base,
      reading: {
        ...reading,
        windows: [
          { ...reading.windows[0]!, remaining_ratio: 0.1, exhausted: true },
          reading.windows[1]!,
        ],
      },
    };
    expect(() => assertInvariants(snapFakeExhausted)).toThrow(InvariantViolation);

    // ratio === 0 but exhausted === false
    const snapZeroNotExhausted: AccountSnapshot = {
      ...base,
      reading: {
        ...reading,
        windows: [
          { ...reading.windows[0]!, remaining_ratio: 0, exhausted: false },
          reading.windows[1]!,
        ],
      },
    };
    expect(() => assertInvariants(snapZeroNotExhausted)).toThrow(InvariantViolation);
    try {
      assertInvariants(snapZeroNotExhausted);
    } catch (e: any) {
      expect(e.error_code).toBe('I7');
    }
  });

  // I8
  it('I8: throws when region !== global for non-workbuddy provider', () => {
    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      provider: 'claude',
      region: 'cn', // forbidden for claude
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I8');
    }
  });

  it('I8: allows region === cn or intl for workbuddy', () => {
    const poolReading: CreditsReading = {
      kind: 'credits',
      pool: {
        unit: 'credits',
        remaining: 15200,
        total: 20000,
        remaining_ratio: 0.76,
        packages: [],
        expires_at: null,
        source_field: 'summary.totalRemaining',
      },
    };

    const snapCn: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      provider: 'workbuddy',
      region: 'cn',
      visual_kind: 'credits_pool',
      reading: poolReading,
    };
    expect(() => assertInvariants(snapCn)).not.toThrow();

    const snapIntl: AccountSnapshot = {
      ...snapCn,
      region: 'intl',
    };
    expect(() => assertInvariants(snapIntl)).not.toThrow();
  });

  // I9
  it('I9: throws when normal state has consecutive_failures > 0', () => {
    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      consecutive_failures: 1,
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I9');
    }
  });

  it('I9: throws when non-normal state has consecutive_failures === 0', () => {
    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      state: 'rate_limited',
      retry_at: 1761800000000,
      consecutive_failures: 0, // violation
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I9');
    }
  });

  // I10
  it('I10: throws when NaN or invalid number is used', () => {
    const snap: AccountSnapshot = {
      ...createValidNormalSnapshot(),
      consecutive_failures: NaN,
    };
    expect(() => assertInvariants(snap)).toThrow(InvariantViolation);
    try {
      assertInvariants(snap);
    } catch (e: any) {
      expect(e.error_code).toBe('I10');
    }
  });
});
