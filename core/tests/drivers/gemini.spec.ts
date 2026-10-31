import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GeminiDriver,
  createGeminiDriver,
  GEMINI_CAPABILITIES,
  GEMINI_POLL_POLICY,
} from '../../src/drivers/gemini/driver.js';
import { normalizeGeminiCli } from '../../src/drivers/gemini/cli-normalize.js';
import { normalizeGeminiCookie } from '../../src/drivers/gemini/cookie-normalize.js';
import type {
  FetchContext,
  HttpRequestSpec,
  HttpReply,
} from '../../src/drivers/driver.js';

function loadFixture(filename: string): any {
  const filePath = resolve(__dirname, `../../../fixtures/gemini/${filename}`);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

describe('Gemini Driver & Normalization', () => {
  describe('normalizeGeminiCli', () => {
    it('normalizes normal CLI JSON payload to single periodic window', () => {
      const fixture = loadFixture('normal.json');
      const outcome = normalizeGeminiCli(fixture.body);

      expect(outcome.reading.kind).toBe('windows');
      expect(outcome.reading.windows.length).toBe(1);

      const window = outcome.reading.windows[0]!;
      expect(window.id).toBe('weekly');
      expect(window.label).toBe('周窗口');
      expect(window.duration_secs).toBe(604800);
      expect(window.remaining_ratio).toBe(0.75);
      expect(window.exhausted).toBe(false);
      expect(window.resets_at).toBe(1762348800000);
      expect(window.quality).toBe('exact');
    });

    it('normalizes daily window correctly when period is daily', () => {
      const dailyJson = JSON.stringify({
        period: 'daily',
        duration_secs: 86400,
        remaining_ratio: 0.4,
        resets_at: 1761900000000,
      });

      const outcome = normalizeGeminiCli(dailyJson);
      expect(outcome.reading.windows.length).toBe(1);
      const window = outcome.reading.windows[0]!;
      expect(window.id).toBe('daily');
      expect(window.label).toBe('日窗口');
      expect(window.duration_secs).toBe(86400);
      expect(window.remaining_ratio).toBe(0.4);
    });

    it('sets exhausted to true when remaining_ratio is 0', () => {
      const exhaustedJson = JSON.stringify({
        remaining_ratio: 0,
        period_seconds: 604800,
      });

      const outcome = normalizeGeminiCli(exhaustedJson);
      const window = outcome.reading.windows[0]!;
      expect(window.remaining_ratio).toBe(0);
      expect(window.exhausted).toBe(true);
    });

    it('clamps remaining_ratio to [0, 1]', () => {
      const overflowJson = JSON.stringify({
        remaining_ratio: 1.5,
      });
      const outcome = normalizeGeminiCli(overflowJson);
      expect(outcome.reading.windows[0]!.remaining_ratio).toBe(1);

      const underflowJson = JSON.stringify({
        remaining_ratio: -0.2,
      });
      const outcomeUnder = normalizeGeminiCli(underflowJson);
      expect(outcomeUnder.reading.windows[0]!.remaining_ratio).toBe(0);
      expect(outcomeUnder.reading.windows[0]!.exhausted).toBe(true);
    });

    it('throws empty_response error on empty CLI stdout', () => {
      expect(() => normalizeGeminiCli('')).toThrowError(/empty/);
      expect(() => normalizeGeminiCli('   \n  ')).toThrowError(/empty/);
    });

    it('throws parse_error on invalid JSON output', () => {
      expect(() => normalizeGeminiCli('Not a JSON string')).toThrowError(/not valid JSON/);
    });
  });

  describe('normalizeGeminiCookie', () => {
    it('normalizes cookie GraphQL payload correctly', () => {
      const cookiePayload = JSON.stringify({
        data: {
          userQuota: {
            remaining_ratio: 0.82,
            period_seconds: 604800,
            resets_at: 1762348800000,
          },
        },
      });

      const outcome = normalizeGeminiCookie(cookiePayload);
      expect(outcome.reading.kind).toBe('windows');
      expect(outcome.reading.windows.length).toBe(1);
      expect(outcome.reading.windows[0]!.remaining_ratio).toBeCloseTo(0.82, 2);
    });

    it('throws error on empty body', () => {
      expect(() => normalizeGeminiCookie('')).toThrowError(/empty/);
    });
  });

  describe('GeminiDriver fetch_snapshot', () => {
    const driver = createGeminiDriver();

    it('prioritizes agy CLI bridge and completes with 0 HTTP requests', async () => {
      let httpCalled = false;
      const fixture = loadFixture('normal.json');

      const ctx: FetchContext = {
        account: {
          account_id: 'acc_gem_1',
          provider: 'gemini',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_gem_1',
          revision: 'rev_1',
          expires_at: null,
          flow: 'cli_command',
          subject_hint: null,
          region: 'global',
          extra_headers: {},
        },
        http: {
          request: async () => {
            httpCalled = true;
            throw new Error('HTTP should not be called when CLI succeeds');
          },
        },
        cli: {
          run: async (cmd, args) => {
            expect(cmd).toBe('agy');
            expect(args).toEqual(['-p', '/usage', '--output-format', 'json']);
            return {
              exit_code: 0,
              stdout: fixture.body,
              stderr: '',
            };
          },
        },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(httpCalled).toBe(false);
      expect(outcome.ok).toBe(true);
      if (outcome.ok && outcome.reading.kind === 'windows') {
        expect(outcome.diagnostics.requests).toBe(0);
        expect(outcome.reading.windows[0]!.remaining_ratio).toBe(0.75);
      }
    });

    it('returns schema empty_response error when CLI stdout is empty', async () => {
      const ctx: FetchContext = {
        account: {
          account_id: 'acc_gem_2',
          provider: 'gemini',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_gem_2',
          revision: 'rev_2',
          expires_at: null,
          flow: 'cli_command',
          subject_hint: null,
          region: 'global',
          extra_headers: {},
        },
        http: {
          request: async () => ({
            status: 200,
            headers: {},
            body_text: '',
            truncated: false,
            duration_ms: 10,
          }),
        },
        cli: {
          run: async () => ({
            exit_code: 0,
            stdout: '',
            stderr: '',
          }),
        },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.class).toBe('schema');
        expect(outcome.error.upstream_code).toBe('empty_response');
      }
    });

    it('identifies 403 SUBSCRIPTION_REQUIRED as deprecated (service_deprecated) with migration hint', async () => {
      const fixture403 = loadFixture('403_deprecated.json');

      const ctx: FetchContext = {
        account: {
          account_id: 'acc_gem_3',
          provider: 'gemini',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_gem_3',
          revision: 'rev_3',
          expires_at: null,
          flow: 'session_cookie',
          subject_hint: null,
          region: 'global',
          extra_headers: {},
        },
        http: {
          request: async (): Promise<HttpReply> => ({
            status: fixture403.status,
            headers: fixture403.headers,
            body_text: fixture403.body,
            truncated: false,
            duration_ms: 100,
          }),
        },
        cli: { run: async () => ({ exit_code: 1, stdout: '', stderr: 'CLI unavailable' }) },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.class).toBe('deprecated');
        expect(outcome.error.http_status).toBe(403);
        expect(outcome.error.upstream_code).toBe('SUBSCRIPTION_REQUIRED');
        expect(outcome.error.migration_hint).toBeTruthy();
        expect(outcome.error.message).toContain('停服');
      }
    });

    it('identifies 404 endpoint as deprecated', async () => {
      const ctx: FetchContext = {
        account: {
          account_id: 'acc_gem_4',
          provider: 'gemini',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_gem_4',
          revision: 'rev_4',
          expires_at: null,
          flow: 'session_cookie',
          subject_hint: null,
          region: 'global',
          extra_headers: {},
        },
        http: {
          request: async (): Promise<HttpReply> => ({
            status: 404,
            headers: { 'content-type': 'application/json' },
            body_text: JSON.stringify({ error: 'Endpoint Not Found' }),
            truncated: false,
            duration_ms: 80,
          }),
        },
        cli: { run: async () => ({ exit_code: 1, stdout: '', stderr: '' }) },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.class).toBe('deprecated');
        expect(outcome.error.http_status).toBe(404);
      }
    });

    it('identifies empty HTTP response as schema empty_response error', async () => {
      const fixtureEmpty = loadFixture('empty.json');

      const ctx: FetchContext = {
        account: {
          account_id: 'acc_gem_5',
          provider: 'gemini',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_gem_5',
          revision: 'rev_5',
          expires_at: null,
          flow: 'session_cookie',
          subject_hint: null,
          region: 'global',
          extra_headers: {},
        },
        http: {
          request: async (): Promise<HttpReply> => ({
            status: fixtureEmpty.status,
            headers: fixtureEmpty.headers,
            body_text: fixtureEmpty.body,
            truncated: false,
            duration_ms: 30,
          }),
        },
        cli: { run: async () => ({ exit_code: 1, stdout: '', stderr: '' }) },
        clock: { now: () => 1761830400000 },
        signal: new AbortController().signal,
      };

      const outcome = await driver.fetch_snapshot(ctx);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.class).toBe('schema');
        expect(outcome.error.upstream_code).toBe('empty_response');
      }
    });

    it('returns unsupported for refresh_token', async () => {
      const outcome = await driver.refresh_token({
        account: {
          account_id: 'acc_gem_6',
          provider: 'gemini',
          region: 'global',
        },
        lease: {
          lease_id: 'lease_gem_6',
          revision: 'rev_6',
          expires_at: null,
          flow: 'session_cookie',
          subject_hint: null,
          region: 'global',
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
