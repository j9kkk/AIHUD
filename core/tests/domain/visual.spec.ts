import { describe, it, expect } from 'vitest';
import { deriveVisualKind, ringGeometryFor } from '../../src/domain/visual.js';
import type { WindowsReading, CreditsReading } from '../../src/domain/types.js';

describe('deriveVisualKind', () => {
  it('returns fallback when reading is null', () => {
    expect(deriveVisualKind(null)).toBe('single_periodic_window');
    expect(deriveVisualKind(null, 'dual_sliding_window')).toBe('dual_sliding_window');
    expect(deriveVisualKind(null, 'credits_pool')).toBe('credits_pool');
  });

  it('returns credits_pool for credits reading', () => {
    const creditsReading: CreditsReading = {
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
    expect(deriveVisualKind(creditsReading)).toBe('credits_pool');
  });

  it('returns dual_sliding_window when windows.length >= 2', () => {
    const dualReading: WindowsReading = {
      kind: 'windows',
      windows: [
        {
          id: 'w1',
          label: '5h',
          scope: 'account',
          duration_secs: 18000,
          remaining_ratio: 0.1,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w1',
        },
        {
          id: 'w2',
          label: '7d',
          scope: 'account',
          duration_secs: 604800,
          remaining_ratio: 0.5,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'w2',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    };
    expect(deriveVisualKind(dualReading)).toBe('dual_sliding_window');

    // 3 windows also dual_sliding_window
    const threeReading: WindowsReading = {
      ...dualReading,
      windows: [...dualReading.windows, { ...dualReading.windows[0]!, id: 'w3' }],
    };
    expect(deriveVisualKind(threeReading)).toBe('dual_sliding_window');
  });

  it('returns single_periodic_window when windows.length < 2 (e.g. 1 window or degraded)', () => {
    const singleReading: WindowsReading = {
      kind: 'windows',
      windows: [
        {
          id: 'w1',
          label: 'Weekly',
          scope: 'account',
          duration_secs: 604800,
          remaining_ratio: 0.4,
          amount: null,
          resets_at: null,
          exhausted: false,
          quality: 'exact',
          source_field: 'weekly',
        },
      ],
      extra_usage_cents: null,
      credits_balance: null,
      reset_credits: null,
    };
    expect(deriveVisualKind(singleReading)).toBe('single_periodic_window');
  });
});

describe('ringGeometryFor', () => {
  describe('card size (default)', () => {
    it('dual_sliding_window has 52px diameter with outer r=22.6+3.8px, inner r=16.4+3.4px, gap=2.6px', () => {
      const geo = ringGeometryFor('dual_sliding_window');
      expect(geo.size).toBe(52);
      expect(geo.outer.radius).toBe(22.6);
      expect(geo.outer.stroke_width).toBe(3.8);
      expect(geo.inner).not.toBeNull();
      expect(geo.inner!.radius).toBe(16.4);
      expect(geo.inner!.stroke_width).toBe(3.4);
      expect(geo.gap).toBe(2.6);
    });

    it('single_periodic_window has 48px diameter with outer r=20.3+4.6px and null inner/gap', () => {
      const geo = ringGeometryFor('single_periodic_window');
      expect(geo.size).toBe(48);
      expect(geo.outer.radius).toBe(20.3);
      expect(geo.outer.stroke_width).toBe(4.6);
      expect(geo.inner).toBeNull();
      expect(geo.gap).toBeNull();
    });

    it('credits_pool has 48px diameter with outer r=20.3+4.6px and null inner/gap', () => {
      const geo = ringGeometryFor('credits_pool');
      expect(geo.size).toBe(48);
      expect(geo.outer.radius).toBe(20.3);
      expect(geo.outer.stroke_width).toBe(4.6);
      expect(geo.inner).toBeNull();
      expect(geo.gap).toBeNull();
    });
  });

  describe('detail size', () => {
    it('dual_sliding_window detail has 74px diameter, outer r=32.2+5.4px, inner r=23.3+4.9px', () => {
      const geo = ringGeometryFor('dual_sliding_window', 'detail');
      expect(geo.size).toBe(74);
      expect(geo.outer.radius).toBe(32.2);
      expect(geo.outer.stroke_width).toBe(5.4);
      expect(geo.inner).not.toBeNull();
      expect(geo.inner!.radius).toBe(23.3);
      expect(geo.inner!.stroke_width).toBe(4.9);
      expect(geo.gap).toBe(3.8);
    });

    it('single_periodic_window & credits_pool detail have 74px diameter with outer r=29.0+6.6px', () => {
      const geo1 = ringGeometryFor('single_periodic_window', 'detail');
      expect(geo1.size).toBe(74);
      expect(geo1.outer.radius).toBe(29.0);
      expect(geo1.outer.stroke_width).toBe(6.6);
      expect(geo1.inner).toBeNull();

      const geo2 = ringGeometryFor('credits_pool', 'detail');
      expect(geo2.size).toBe(74);
      expect(geo2.outer.radius).toBe(29.0);
      expect(geo2.outer.stroke_width).toBe(6.6);
      expect(geo2.inner).toBeNull();
    });
  });
});
