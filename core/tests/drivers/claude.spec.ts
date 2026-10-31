import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClaudeDriver, normalizeClaudeResponse } from '../../src/drivers/claude/index.js';
import type {
  AuthBoundHttp,
  CredentialLease,
  FetchContext,
  HttpReply,
  HttpRequestSpec,
} from '../../src/drivers/driver.js';
import { deriveVisualKind } from '../../src/domain/visual.js';
import { assertInvariants } from '../../src/domain/invariants.js';
import type { AccountSnapshot } from '../../src/domain/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../fixtures/claude');

function loadFixture(name: string): {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  meta: { schema_version: string };
} {
  const file = path.join(FIXTURES_DIR, `${name}.json`);
  const content = fs.readFileSync(file, 'utf8');
  return JSON.parse(content);
}

function createFakeHttp(reply: HttpReply): { http: AuthBoundHttp; calls: HttpRequestSpec[] } {
  const calls: HttpRequestSpec[] = [];
  const http: AuthBoundHttp = {
    async request(spec: HttpRequestSpec): Promise<HttpReply> {
      calls.push(spec);
      return reply;
    },
  };
  return { http, calls };
}

function createMockContext(
  http: AuthBoundHttp,
  leaseOverride?: Partial<CredentialLease>
): FetchContext {
  return {
    account: {
      account_id: 'acc_claude_test',
      provider: 'claude',
      region: 'global',
    },
    lease: {
      lease_id: 'lease_claude_123',
      revision: 'rev_abc123',
      expires_at: 1761830400000,
      flow: 'oauth_pkce',
      subject_hint: 'c***@corp.com',
      region: 'global',
      extra_headers: {},
      ...leaseOverride,
    },
    http,
    clock: {
      now: () => 1761800000000,
    },
  };
}

describe('Claude Driver (ARCHITECTURE.md §5.2)', () => {
  const driver = createClaudeDriver();

  it('normal.json: dual sliding window normalization with remaining_ratio = 1 - used_ratio', async () => {
    const fixture = loadFixture('normal');
    const { http, calls } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 120,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect(calls[0]?.headers?.['anthropic-beta']).toBe('oauth-2025-04-20');

    expect(outcome.reading.kind).toBe('windows');
    if (outcome.reading.kind !== 'windows') return;
    const reading = outcome.reading;
    expect(reading.windows.length).toBe(3);

    // 5h window: utilization 25.0 -> remaining_ratio = 0.75
    const w5h = reading.windows.find((w) => w.id === 'five_hour')!;
    expect(w5h).toBeDefined();
    expect(w5h.label).toBe('5 小时窗口');
    expect(w5h.duration_secs).toBe(18000);
    expect(w5h.remaining_ratio).toBe(0.75);
    expect(w5h.exhausted).toBe(false);
    expect(w5h.amount).toBeNull();
    expect(w5h.resets_at).toBe(Date.parse('2026-10-31T15:00:00.000Z'));
    expect(w5h.quality).toBe('exact');

    // 7d window: utilization 40.0 -> remaining_ratio = 0.60
    const w7d = reading.windows.find((w) => w.id === 'seven_day')!;
    expect(w7d).toBeDefined();
    expect(w7d.label).toBe('周窗口');
    expect(w7d.duration_secs).toBe(604800);
    expect(w7d.remaining_ratio).toBe(0.6);

    // Opus window
    const wOpus = reading.windows.find((w) => w.id === 'seven_day_opus')!;
    expect(wOpus).toBeDefined();
    expect(wOpus.scope).toEqual({ model: 'opus' });
    expect(wOpus.remaining_ratio).toBe(0.9);

    // Extra usage
    expect(reading.extra_usage_cents).toBe(350);

    // Visual kind derivation: 3 windows >= 2 -> dual_sliding_window
    expect(deriveVisualKind(reading)).toBe('dual_sliding_window');

    // Assert domain invariants with normal snapshot
    const snapshot: AccountSnapshot = {
      account_id: 'acc_claude_test',
      provider: 'claude',
      region: 'global',
      alias: 'Claude Pro',
      identity: {
        real_identifier_masked: 'c***@corp.com',
        organization: null,
      },
      plan_name: 'Pro',
      visual_kind: 'dual_sliding_window',
      reading,
      reading_observed_at: 1761800000000,
      state: 'normal',
      state_detail: {
        reason: 'never_fetched',
        message: 'Healthy',
        http_status: 200,
        upstream_code: null,
        auth_action: 'none',
        migration_hint: null,
      },
      last_attempt_at: 1761800000000,
      last_success_at: 1761800000000,
      consecutive_failures: 0,
      retry_at: null,
      schema_version: 'claude.v1',
    };
    expect(() => assertInvariants(snapshot)).not.toThrow();
  });

  it('single_window.json: missing window is not filled with 0; derives single_periodic_window', async () => {
    const fixture = loadFixture('single_window');
    const { http } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 80,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reading.kind).toBe('windows');
    if (outcome.reading.kind !== 'windows') return;

    expect(outcome.reading.windows.length).toBe(1);
    expect(outcome.reading.windows[0]?.id).toBe('five_hour');
    expect(outcome.reading.windows.find((w) => w.id === 'seven_day')).toBeUndefined();

    // 严禁将缺失的 7d 窗口补 0
    expect(outcome.reading.windows.length).toBe(1);
    expect(deriveVisualKind(outcome.reading)).toBe('single_periodic_window');
  });

  it('401.json: returns DriverError("auth_expired")', async () => {
    const fixture = loadFixture('401');
    const { http } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 50,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.class).toBe('auth');
    expect(outcome.error.http_status).toBe(401);
    expect(outcome.error.upstream_code).toBe('auth_expired');
  });

  it('429.json: parses Retry-After and returns rate_limited error', async () => {
    const fixture = loadFixture('429');
    const { http } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 60,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.class).toBe('rate_limit');
    expect(outcome.error.http_status).toBe(429);
    expect(outcome.error.retry_after_secs).toBe(45);
    expect(driver.poll_policy.next_delay_ms!('45')).toBe(45000);
  });

  it('html_gateway.json: returns DriverError("parse_error")', async () => {
    const fixture = loadFixture('html_gateway');
    const { http } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: typeof fixture.body === 'string' ? fixture.body : JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 95,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.class).toBe('schema');
    expect(outcome.error.upstream_code).toBe('parse_error');
  });

  it('schema_drift.json: returns snapshot with non-empty warnings and does not throw', async () => {
    const fixture = loadFixture('schema_drift');
    const { http } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 110,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reading.kind).toBe('windows');
    if (outcome.reading.kind !== 'windows') return;

    expect(outcome.reading.windows.length).toBe(2);
    expect(outcome.diagnostics.schema_warnings.length).toBeGreaterThan(0);
    expect(
      outcome.diagnostics.schema_warnings.some((w) => w.includes('beta_tier'))
    ).toBe(true);
  });

  describe('refresh_token plan creation', () => {
    it('returns unsupported for manual_token flow', async () => {
      const outcome = await driver.refresh_token({
        account: {
          account_id: 'acc_manual',
          provider: 'claude',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_man',
          revision: 'rev_1',
          expires_at: null,
          flow: 'manual_token',
          subject_hint: null,
          region: 'global',
          extra_headers: {},
        },
        clock: { now: () => 1000 },
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect('unsupported' in outcome && outcome.unsupported).toBe(true);
    });

    it('returns valid RefreshPlan for oauth_pkce flow', async () => {
      const outcome = await driver.refresh_token({
        account: {
          account_id: 'acc_oauth',
          provider: 'claude',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_oa',
          revision: 'rev_oa',
          expires_at: 1000,
          flow: 'oauth_pkce',
          subject_hint: 'c***@corp.com',
          region: 'global',
          extra_headers: {},
        },
        clock: { now: () => 1000 },
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(outcome.plan.request.url).toBe('https://api.anthropic.com/api/oauth/token');
      expect(outcome.plan.request.method).toBe('POST');
      expect(outcome.plan.patch.store_mode).toBe('merge');
      expect(outcome.plan.patch.fields.some((f) => f.target === 'access_token')).toBe(true);
      expect(outcome.plan.patch.fields.some((f) => f.target === 'refresh_token')).toBe(true);
      expect(outcome.plan.patch.fields.some((f) => f.target === 'expires_at')).toBe(true);
    });
  });
});
