import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCodexDriver,
  formatWindowDuration,
  normalizeCodexResponse,
  selectPrimaryWindows,
} from '../../src/drivers/codex/index.js';
import type {
  AuthBoundHttp,
  CredentialLease,
  FetchContext,
  HttpReply,
  HttpRequestSpec,
} from '../../src/drivers/driver.js';
import { deriveVisualKind } from '../../src/domain/visual.js';
import { assertInvariants } from '../../src/domain/invariants.js';
import type { AccountSnapshot, QuotaWindow } from '../../src/domain/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../fixtures/codex');

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
      account_id: 'acc_codex_test',
      provider: 'codex',
      region: 'global',
    },
    lease: {
      lease_id: 'lease_codex_123',
      revision: 'rev_codex123',
      expires_at: 1761830400000,
      flow: 'cli_session_reuse',
      subject_hint: 'user@openai.com',
      region: 'global',
      extra_headers: {
        'ChatGPT-Account-Id': 'org-test-chatgpt-123',
      },
      ...leaseOverride,
    },
    http,
    clock: {
      now: () => 1761800000000,
    },
  };
}

describe('Codex Driver (ARCHITECTURE.md §5.3)', () => {
  const driver = createCodexDriver();

  it('normal.json: account-level windows fallback when by_model is absent', async () => {
    const fixture = loadFixture('normal');
    const { http, calls } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 100,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('https://chatgpt.com/backend-api/wham/usage');
    expect(calls[0]?.headers?.['ChatGPT-Account-Id']).toBe('org-test-chatgpt-123');

    expect(outcome.reading.kind).toBe('windows');
    if (outcome.reading.kind !== 'windows') return;

    const reading = outcome.reading;
    expect(reading.windows.length).toBe(2);

    const pw = reading.windows.find((w) => w.id === 'primary')!;
    expect(pw).toBeDefined();
    expect(pw.label).toBe('5 小时窗口');
    expect(pw.duration_secs).toBe(18000);
    expect(pw.remaining_ratio).toBe(0.7);
    expect(pw.resets_at).toBe(1761830400 * 1000);

    const sw = reading.windows.find((w) => w.id === 'secondary')!;
    expect(sw).toBeDefined();
    expect(sw.label).toBe('周窗口');
    expect(sw.duration_secs).toBe(604800);
    expect(sw.remaining_ratio).toBe(0.8);

    expect(reading.credits_balance).toBe(15000);
    expect(reading.reset_credits).toBe(2);

    expect(deriveVisualKind(reading)).toBe('dual_sliding_window');

    // Assert domain invariants with normal snapshot
    const snapshot: AccountSnapshot = {
      account_id: 'acc_codex_test',
      provider: 'codex',
      region: 'global',
      alias: 'Codex Dev',
      identity: {
        real_identifier_masked: 'u***@openai.com',
        organization: null,
      },
      plan_name: 'Team',
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
      schema_version: 'codex.v1',
    };
    expect(() => assertInvariants(snapshot)).not.toThrow();
  });

  it('model_scoped.json: selects tightest model windows as primary reading, others into extra', async () => {
    const fixture = loadFixture('model_scoped');
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

    const reading = outcome.reading;

    // gpt-5-codex pairWorst = min(1 - 0.85, 1 - 0.60) = 0.15
    // gpt-4.5-codex pairWorst = min(1 - 0.20, 1 - 0.15) = 0.80
    // gpt-5-codex is the tightest model window
    expect(reading.windows[0]?.id).toBe('model:gpt-5-codex:primary');
    expect(reading.windows[0]?.remaining_ratio).toBe(0.15);
    expect(reading.windows[1]?.id).toBe('model:gpt-5-codex:secondary');
    expect(reading.windows[1]?.remaining_ratio).toBe(0.4);

    // Remaining model windows go to extra
    const codexReading = outcome.reading as any;
    expect(codexReading.extra).toBeDefined();
    expect(codexReading.extra.length).toBe(2);
    expect(codexReading.extra[0].id).toBe('model:gpt-4.5-codex:primary');
    expect(codexReading.extra[1].id).toBe('model:gpt-4.5-codex:secondary');

    // Total windows includes primary + extra
    expect(reading.windows.length).toBe(4);
    expect(reading.credits_balance).toBe(12000);
    expect(reading.reset_credits).toBe(1);
  });

  it('selectPrimaryWindows: breaks ties using alphabetical order of model name', () => {
    const windows: QuotaWindow[] = [
      {
        id: 'model:zeta-model:primary',
        label: '5 小时窗口',
        scope: { model: 'zeta-model' },
        duration_secs: 18000,
        remaining_ratio: 0.5,
        amount: null,
        resets_at: null,
        exhausted: false,
        quality: 'exact',
        source_field: 'test',
      },
      {
        id: 'model:alpha-model:primary',
        label: '5 小时窗口',
        scope: { model: 'alpha-model' },
        duration_secs: 18000,
        remaining_ratio: 0.5,
        amount: null,
        resets_at: null,
        exhausted: false,
        quality: 'exact',
        source_field: 'test',
      },
    ];

    const selected = selectPrimaryWindows(windows);
    // Both have pairWorst = 0.5, 'alpha-model' < 'zeta-model'
    expect(selected.model).toBe('alpha-model');
    expect(selected.primary[0]?.id).toBe('model:alpha-model:primary');
    expect(selected.extra[0]?.id).toBe('model:zeta-model:primary');
  });

  it('formatWindowDuration handles standard and arbitrary durations', () => {
    expect(formatWindowDuration(18000)).toBe('5 小时窗口');
    expect(formatWindowDuration(604800)).toBe('周窗口');
    expect(formatWindowDuration(10800)).toBe('3 小时窗口');
    expect(formatWindowDuration(86400)).toBe('1 天窗口');
    expect(formatWindowDuration(120)).toBe('2 分钟窗口');
    expect(formatWindowDuration(45)).toBe('45 秒窗口');
    expect(formatWindowDuration(null)).toBe('配额窗口');
  });

  it('missing ChatGPT-Account-Id returns auth_expired without network call (§4.5)', async () => {
    const { http, calls } = createFakeHttp({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body_text: '{}',
      truncated: false,
      duration_ms: 10,
    });

    const ctx = createMockContext(http, { extra_headers: {} });
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.class).toBe('auth');
    expect(outcome.error.upstream_code).toBe('missing_chatgpt_account_id');
    expect(outcome.error.message).toContain('请用 Codex CLI 重新登录');
    // Ensure no HTTP request was made
    expect(calls.length).toBe(0);
  });

  it('401.json: returns DriverError("auth_expired")', async () => {
    const fixture = loadFixture('401');
    const { http } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 40,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.class).toBe('auth');
    expect(outcome.error.http_status).toBe(401);
  });

  it('429.json: parses Retry-After and returns rate_limited error', async () => {
    const fixture = loadFixture('429');
    const { http } = createFakeHttp({
      status: fixture.status,
      headers: fixture.headers,
      body_text: JSON.stringify(fixture.body),
      truncated: false,
      duration_ms: 45,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.class).toBe('rate_limit');
    expect(outcome.error.http_status).toBe(429);
    expect(outcome.error.retry_after_secs).toBe(30);
    expect(driver.poll_policy.next_delay_ms!('30')).toBe(30000);
  });

  it('HTML response: returns DriverError("parse_error")', async () => {
    const { http } = createFakeHttp({
      status: 504,
      headers: { 'content-type': 'text/html' },
      body_text: '<html>Gateway Timeout</html>',
      truncated: false,
      duration_ms: 100,
    });

    const ctx = createMockContext(http);
    const outcome = await driver.fetch_snapshot(ctx);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.class).toBe('schema');
    expect(outcome.error.upstream_code).toBe('parse_error');
  });

  it('refresh_token returns unsupported: true for Codex', async () => {
    const outcome = await driver.refresh_token({
      account: {
        account_id: 'acc_codex',
        provider: 'codex',
        region: 'global',
      },
      lease: {
        lease_id: 'lease_cx',
        revision: 'rev_cx',
        expires_at: null,
        flow: 'cli_session_reuse',
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
});
