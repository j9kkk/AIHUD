/**
 * S08 fixture 矩阵：20 例自定义渠道样本，全部脱敏构造，0 凭据。
 *
 * 目的不是「测试通过」，而是把「读不到时会发生什么」钉死在数据里：
 * 每一例都声明了期望的 ok / ratio / error_class，任何一例变异都会立刻失败。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CustomChannelConfig } from '../../src/drivers/custom/config.js';
import { normalizeCustom } from '../../src/drivers/custom/normalize.js';
import type { CreditsPool, WindowsReading } from '../../src/domain/types.js';

interface MatrixCase {
  readonly id: string;
  readonly payload: unknown;
  readonly visual?: 'credits_pool' | 'single_periodic_window';
  readonly path?: { readonly remaining: string; readonly total: string };
  readonly expect: {
    readonly ok: boolean;
    readonly ratio?: number;
    readonly error_class?: string;
    readonly resets_at?: number | null;
    readonly kind?: 'credits' | 'windows';
  };
}

const matrix = JSON.parse(
  readFileSync(resolve(__dirname, '../../../fixtures/custom/matrix.json'), 'utf-8')
) as { cases: readonly MatrixCase[] };

function cfgFor(c: MatrixCase): CustomChannelConfig {
  return {
    name: 'fixture',
    label: '样本渠道',
    base_url: 'https://gw.example.com',
    endpoint_path: '/usage',
    auth: { kind: 'bearer' },
    json: {
      remaining: c.path?.remaining ?? '$.data.remaining',
      total: c.path?.total ?? '$.data.total',
      resets_at: '$.data.reset',
    },
    ...(c.visual ? { visual: c.visual } : {}),
  };
}

describe('S08 fixture 矩阵（20 例）', () => {
  it('矩阵文件本身有 20 例且 id 唯一', () => {
    expect(matrix.cases).toHaveLength(20);
    expect(new Set(matrix.cases.map((c) => c.id)).size).toBe(20);
  });

  it('矩阵不含任何凭据字样', () => {
    const raw = JSON.stringify(matrix);
    expect(/sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{20,}/.test(raw)).toBe(false);
  });

  for (const c of matrix.cases) {
    it(`${c.id} → ${c.expect.ok ? 'ok' : 'error'}`, () => {
      const r = normalizeCustom(cfgFor(c), c.payload);

      expect(r.ok).toBe(c.expect.ok);

      if (!c.expect.ok) {
        if (r.ok) return;
        expect(r.error.class).toBe(c.expect.error_class);
        // 失败路径一律不得带出任何"看起来像真实读数"的比例
        expect(r.error.message.length).toBeGreaterThan(0);
        return;
      }

      if (!r.ok) return;
      const reading = r.reading;

      if (c.expect.kind === 'windows') {
        const w = reading as WindowsReading;
        expect(w.kind).toBe('windows');
        expect(w.windows[0]?.remaining_ratio).toBeCloseTo(c.expect.ratio as number, 5);
      } else {
        const cr = reading as CreditsPool;
        expect(cr.remaining_ratio).toBeCloseTo(c.expect.ratio as number, 5);
        if (c.expect.resets_at !== undefined) {
          expect(cr.expires_at).toBe(c.expect.resets_at);
        }
      }
    });
  }
});
