import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WorkBuddyDriver,
  createWorkBuddyDriver,
  WORKBUDDY_CAPABILITIES,
  WORKBUDDY_POLL_POLICY,
} from '../../src/drivers/workbuddy/driver.js';
import {
  WorkBuddyRegionRouter,
  defaultRegionRouter,
} from '../../src/drivers/workbuddy/region.js';
import { normalizeWorkBuddy } from '../../src/drivers/workbuddy/normalize.js';
import type {
  FetchContext,
  HttpRequestSpec,
  HttpReply,
} from '../../src/drivers/driver.js';

function loadFixture(filename: string): any {
  const filePath = resolve(__dirname, `../../../fixtures/workbuddy/${filename}`);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

describe('WorkBuddy Driver & Region Routing', () => {
  describe('RegionRouter', () => {
    const router = new WorkBuddyRegionRouter();

    it('resolves correct base host according to region', () => {
      expect(router.resolve('cn')).toBe('https://workbuddy.cn');
      expect(router.resolve('global')).toBe('https://workbuddy.ai');
      expect(router.resolve('intl')).toBe('https://workbuddy.ai');
    });

    it('detects region from domain or url', () => {
      expect(router.detectRegion('https://workbuddy.cn/api')).toBe('cn');
      expect(router.detectRegion('codebuddy.cn')).toBe('cn');
      expect(router.detectRegion('https://workbuddy.ai/dashboard')).toBe('global');
      expect(router.detectRegion('test.workbuddy.cn:443')).toBe('cn');
    });

    it('evaluates region compatibility correctly', () => {
      expect(router.isMatch('cn', 'cn')).toBe(true);
      expect(router.isMatch('cn', 'global')).toBe(false);
      expect(router.isMatch('cn', 'intl')).toBe(false);
      expect(router.isMatch('global', 'global')).toBe(true);
      expect(router.isMatch('global', 'intl')).toBe(true);
      expect(router.isMatch('intl', 'global')).toBe(true);
      expect(router.isMatch('global', 'cn')).toBe(false);
    });
  });

  describe('normalizeWorkBuddy', () => {
    it('normalizes normal_cn fixture with full summary and packages', () => {
      const fixture = loadFixture('normal_cn.json');
      const payload = JSON.parse(fixture.body);
      const outcome = normalizeWorkBuddy(payload);

      expect(outcome.reading.kind).toBe('credits');
      expect(outcome.reading.pool.unit).toBe('credits');
      expect(outcome.reading.pool.total).toBe(20000);
      expect(outcome.reading.pool.remaining).toBe(15200);
      expect(outcome.reading.pool.remaining_ratio).toBeCloseTo(0.76, 2);
      expect(outcome.reading.pool.packages.length).toBe(2);
      expect(outcome.reading.pool.expires_at).toBe(1767225600000);
    });

    it('normalizes normal_intl fixture correctly', () => {
      const fixture = loadFixture('normal_intl.json');
      const payload = JSON.parse(fixture.body);
      const outcome = normalizeWorkBuddy(payload);

      expect(outcome.reading.pool.total).toBe(50000);
      expect(outcome.reading.pool.remaining).toBe(42000);
      expect(outcome.reading.pool.remaining_ratio).toBeCloseTo(0.84, 2);
      expect(outcome.reading.pool.packages.length).toBe(1);
    });

    it('normalizes packages_only fixture and excludes expired packages from total and remaining', () => {
      const fixture = loadFixture('packages_only.json');
      const payload = JSON.parse(fixture.body);
      const outcome = normalizeWorkBuddy(payload, 1720000000000);

      // pkg_active: total 10000, remaining 8000, expired false
      // pkg_expired: total 5000, remaining 5000, expired true (must be excluded from total)
      expect(outcome.reading.pool.total).toBe(10000);
      expect(outcome.reading.pool.remaining).toBe(8000);
      expect(outcome.reading.pool.remaining_ratio).toBeCloseTo(0.8, 2);

      // Both packages kept in pool.packages for detailed inspection
      expect(outcome.reading.pool.packages.length).toBe(2);
      const expiredPkg = outcome.reading.pool.packages.find((p) => p.id === 'pkg_expired');
      expect(expiredPkg?.expired).toBe(true);
    });

    it('sets remaining_ratio to null (never 0) when total is missing or 0', () => {
      const rawWithoutTotal = {
        summary: {
          totalRemaining: 500,
        },
      };
      const outcome = normalizeWorkBuddy(rawWithoutTotal);
      expect(outcome.reading.pool.remaining).toBe(500);
      expect(outcome.reading.pool.total).toBeNull();
      expect(outcome.reading.pool.remaining_ratio).toBeNull();

      const rawWithZeroTotal = {
        summary: {
          totalCapacity: 0,
          totalRemaining: 0,
        },
      };
      const outcomeZero = normalizeWorkBuddy(rawWithZeroTotal);
      expect(outcomeZero.reading.pool.total).toBe(0);
      expect(outcomeZero.reading.pool.remaining_ratio).toBeNull();
    });

    it('rejects schema_drift fixture with missing critical structures', () => {
      const fixture = loadFixture('schema_drift.json');
      const payload = JSON.parse(fixture.body);
      expect(() => normalizeWorkBuddy(payload)).toThrowError(
        /neither valid summary nor packages/
      );
    });
  });

  describe('WorkBuddyDriver fetch_snapshot', () => {
    const driver = createWorkBuddyDriver();

    it('aborts early with region_mismatch when account and lease regions conflict', async () => {
      let httpCalled = false;
      const ctx: FetchContext = {
        account: {
          account_id: 'acc_wb_1',
          provider: 'workbuddy',
          region: 'cn',
        },
        lease: {
          lease_id: 'lease_wb_1',
          revision: 'rev_1',
          expires_at: null,
          flow: 'device_code',
          subject_hint: 'user@example.com',
          region: 'global', // mismatch!
          extra_headers: {},
        },
        http: {
          request: async () => {
            httpCalled = true;
            throw new Error('HTTP should not be called on region mismatch');
          },
        },
        cli: { run: async () => ({ exit_code: 0, stdout: '', stderr: '' }) },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(httpCalled).toBe(false);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.class).toBe('auth');
        expect(outcome.error.upstream_code).toBe('region_mismatch');
        expect(outcome.error.message).toContain('另一站点');
      }
    });

    it('identifies 401 HTML response as auth error with region_mismatch', async () => {
      const fixture401 = loadFixture('401_html.json');
      const ctx: FetchContext = {
        account: {
          account_id: 'acc_wb_2',
          provider: 'workbuddy',
          region: 'cn',
        },
        lease: {
          lease_id: 'lease_wb_2',
          revision: 'rev_2',
          expires_at: null,
          flow: 'manual_token',
          subject_hint: null,
          region: 'cn',
          extra_headers: {},
        },
        http: {
          request: async (spec: HttpRequestSpec): Promise<HttpReply> => {
            expect(spec.url).toContain('workbuddy.cn');
            return {
              status: fixture401.status,
              headers: fixture401.headers,
              body_text: fixture401.body,
              truncated: false,
              duration_ms: 50,
            };
          },
        },
        cli: { run: async () => ({ exit_code: 0, stdout: '', stderr: '' }) },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.class).toBe('auth');
        expect(outcome.error.upstream_code).toBe('region_mismatch');
        expect(outcome.error.message).toContain('另一站点');
      }
    });

    it('successfully processes normal_cn response', async () => {
      const fixture = loadFixture('normal_cn.json');
      const ctx: FetchContext = {
        account: {
          account_id: 'acc_wb_3',
          provider: 'workbuddy',
          region: 'cn',
        },
        lease: {
          lease_id: 'lease_wb_3',
          revision: 'rev_3',
          expires_at: null,
          flow: 'device_code',
          subject_hint: null,
          region: 'cn',
          extra_headers: { 'X-User-Id': 'u_123' },
        },
        http: {
          request: async (): Promise<HttpReply> => ({
            status: 200,
            headers: fixture.headers,
            body_text: fixture.body,
            truncated: false,
            duration_ms: 80,
          }),
        },
        cli: { run: async () => ({ exit_code: 0, stdout: '', stderr: '' }) },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(outcome.ok).toBe(true);
      if (outcome.ok && outcome.reading.kind === 'credits') {
        expect(outcome.reading.pool.remaining).toBe(15200);
        expect(outcome.reading.pool.total).toBe(20000);
        expect(outcome.reading.pool.remaining_ratio).toBeCloseTo(0.76, 2);
      }
    });

    it('handles 429 rate limit with retry-after header', async () => {
      const ctx: FetchContext = {
        account: {
          account_id: 'acc_wb_4',
          provider: 'workbuddy',
          region: 'cn',
        },
        lease: {
          lease_id: 'lease_wb_4',
          revision: 'rev_4',
          expires_at: null,
          flow: 'device_code',
          subject_hint: null,
          region: 'cn',
          extra_headers: {},
        },
        http: {
          request: async (): Promise<HttpReply> => ({
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '60' },
            body_text: JSON.stringify({ error: 'Too Many Requests' }),
            truncated: false,
            duration_ms: 20,
          }),
        },
        cli: { run: async () => ({ exit_code: 0, stdout: '', stderr: '' }) },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.class).toBe('rate_limit');
        expect(outcome.error.retry_after_secs).toBe(60);
      }
    });

    it('returns unsupported for refresh_token', async () => {
      const outcome = await driver.refresh_token({
        account: {
          account_id: 'acc_wb_5',
          provider: 'workbuddy',
          region: 'cn',
        },
        lease: {
          lease_id: 'lease_wb_5',
          revision: 'rev_5',
          expires_at: null,
          flow: 'device_code',
          subject_hint: null,
          region: 'cn',
          extra_headers: {},
        },
        clock: { now: () => 1761830400000 },
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok && 'unsupported' in outcome) {
        expect(outcome.unsupported).toBe(true);
      }
    });
  });
});
