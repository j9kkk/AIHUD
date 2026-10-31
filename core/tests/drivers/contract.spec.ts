import { describe, expect, it } from 'vitest';
import {
  assertSafeHeaders,
  computeNextDelayMs,
  CredentialLeakError,
  DriverError,
  driverError,
  parseRetryAfter,
} from '../../src/drivers/driver.js';
import { createClaudeDriver } from '../../src/drivers/claude/index.js';
import { createCodexDriver } from '../../src/drivers/codex/index.js';

describe('Channel Driver Contract (ARCHITECTURE.md §4 & §5)', () => {
  const claude = createClaudeDriver();
  const codex = createCodexDriver();
  const drivers = [claude, codex];

  it('all drivers conform to basic metadata & capabilities constraints', () => {
    for (const d of drivers) {
      expect(typeof d.provider).toBe('string');
      expect(typeof d.schema_version).toBe('string');
      expect(d.schema_version.length).toBeGreaterThan(0);

      // supported_auth_flows 非空，且包含 manual_token 离线兜底
      expect(Array.isArray(d.supported_auth_flows)).toBe(true);
      expect(d.supported_auth_flows.length).toBeGreaterThan(0);
      expect(d.supported_auth_flows).toContain('manual_token');

      // 域名白名单全为 https://
      expect(d.capabilities.allowed_origins.length).toBeGreaterThan(0);
      for (const origin of d.capabilities.allowed_origins) {
        expect(origin.startsWith('https://')).toBe(true);
      }

      // 卡片窗口上限 <= 2
      expect(d.capabilities.max_windows_for_card).toBeLessThanOrEqual(2);
    }
  });

  it('poll policy satisfies 120 <= min <= base <= max <= 3600 & jitter constraints', () => {
    for (const d of drivers) {
      const p = d.poll_policy;
      expect(p.min_interval_secs).toBeGreaterThanOrEqual(120);
      expect(p.base_interval_secs).toBeGreaterThanOrEqual(p.min_interval_secs);
      expect(p.max_interval_secs).toBeGreaterThanOrEqual(p.base_interval_secs);
      expect(p.max_interval_secs).toBeLessThanOrEqual(3600);

      expect(p.jitter_ratio).toBeGreaterThanOrEqual(0);
      expect(p.jitter_ratio).toBeLessThanOrEqual(0.5);

      expect(p.backoff.max_secs).toBeGreaterThanOrEqual(p.backoff.base_secs);
      expect(p.backoff.base_secs).toBeGreaterThanOrEqual(30);
      expect(p.backoff.respect_retry_after).toBe(true);
      expect(p.backoff.retry_after_clamp[0]).toBeGreaterThanOrEqual(1);
      expect(p.backoff.retry_after_clamp[1]).toBeLessThanOrEqual(86400);
    }
  });

  describe('Retry-After parsing & PollPolicy.next_delay_ms (§6.3)', () => {
    it('parses pure numeric seconds correctly', () => {
      expect(parseRetryAfter('45')).toBe(45);
      expect(parseRetryAfter(45)).toBe(45);
    });

    it('parses HTTP-date in the future', () => {
      const baseNow = Date.parse('Wed, 21 Oct 2026 07:27:00 GMT');
      const targetDate = 'Wed, 21 Oct 2026 07:28:00 GMT';
      expect(parseRetryAfter(targetDate, baseNow)).toBe(60);
    });

    it('clamps negative / past HTTP-date to 5 seconds', () => {
      const baseNow = Date.parse('Wed, 21 Oct 2026 07:28:10 GMT');
      const targetDate = 'Wed, 21 Oct 2026 07:28:00 GMT';
      expect(parseRetryAfter(targetDate, baseNow)).toBe(5);
    });

    it('clamps seconds < 5 to 5', () => {
      expect(parseRetryAfter('2')).toBe(5);
      expect(parseRetryAfter(1)).toBe(5);
    });

    it('clamps seconds > 7200 to 7200', () => {
      expect(parseRetryAfter('10000')).toBe(7200);
    });

    it('defaults to 60 for missing, empty, or invalid input', () => {
      expect(parseRetryAfter(null)).toBe(60);
      expect(parseRetryAfter(undefined)).toBe(60);
      expect(parseRetryAfter('')).toBe(60);
      expect(parseRetryAfter('invalid-string')).toBe(60);
    });

    it('driver.poll_policy.next_delay_ms computes millisecond delays', () => {
      for (const d of drivers) {
        const policy = d.poll_policy;
        expect(typeof policy.next_delay_ms).toBe('function');

        // 45s -> 45000ms
        expect(policy.next_delay_ms!('45')).toBe(45000);

        // Clamped < 5s -> 5000ms
        expect(policy.next_delay_ms!('2')).toBe(5000);

        // Clamped > 7200s -> 7200000ms
        expect(policy.next_delay_ms!('8000')).toBe(7200000);

        // HTTP-date future
        const now = Date.parse('Wed, 21 Oct 2026 07:27:00 GMT');
        expect(
          policy.next_delay_ms!(
            'Wed, 21 Oct 2026 07:28:00 GMT',
            1,
            now
          )
        ).toBe(60000);

        // HTTP-date past
        const nowPast = Date.parse('Wed, 21 Oct 2026 07:28:10 GMT');
        expect(
          policy.next_delay_ms!(
            'Wed, 21 Oct 2026 07:28:00 GMT',
            1,
            nowPast
          )
        ).toBe(5000);

        // Consecutive failures >= 3 uses backoff
        expect(policy.next_delay_ms!('45', 3)).toBe(120000);
      }
    });
  });

  describe('driverError 工厂与分类（纯数据载荷）', () => {
    it('按错误码推导 class / http_status / 默认文案', () => {
      const e1 = driverError('auth_expired');
      expect(e1.class).toBe('auth');
      expect(e1.upstream_code).toBe('auth_expired');
      expect(e1.http_status).toBe(401);

      const e2 = driverError('parse_error');
      expect(e2.class).toBe('schema');
      expect(e2.upstream_code).toBe('parse_error');
      expect(e2.http_status).toBeNull();
    });

    it('支持 retry_after_secs 与自定义文案（429）', () => {
      const e = driverError('rate_limited', {
        retry_after_secs: 45,
        message: 'Too many requests',
      });
      expect(e.class).toBe('rate_limit');
      expect(e.http_status).toBe(429);
      expect(e.retry_after_secs).toBe(45);
      expect(e.message).toBe('Too many requests');
    });

    it('支持直接传入完整载荷（停服）', () => {
      const e = driverError({
        class: 'deprecated',
        http_status: 403,
        upstream_code: 'SUBSCRIPTION_REQUIRED',
        migration_hint: 'Upgrade to v2',
      });
      expect(e.class).toBe('deprecated');
      expect(e.http_status).toBe(403);
      expect(e.upstream_code).toBe('SUBSCRIPTION_REQUIRED');
      expect(e.migration_hint).toBe('Upgrade to v2');
    });

    it('载荷是纯数据（可结构化克隆，不含 Error 实例）', () => {
      const e = driverError('timeout');
      expect(e instanceof Error).toBe(false);
      const clone = JSON.parse(JSON.stringify(e));
      expect(clone.class).toBe('timeout');
      expect(Object.keys(clone).sort()).toEqual(
        ['class', 'http_status', 'message', 'migration_hint', 'retry_after_secs', 'upstream_code'].sort()
      );
    });
  });

  describe('Credential Leak Protection (§7.2)', () => {
    it('throws CredentialLeakError when authorization, cookie, or x-api-key is in headers', () => {
      expect(() => {
        assertSafeHeaders({ Authorization: 'Bearer test' });
      }).toThrow(CredentialLeakError);

      expect(() => {
        assertSafeHeaders({ cookie: 'session=123' });
      }).toThrow(CredentialLeakError);

      expect(() => {
        assertSafeHeaders({ 'x-api-key': 'secret' });
      }).toThrow(CredentialLeakError);

      // Safe headers do not throw
      expect(() => {
        assertSafeHeaders({
          'content-type': 'application/json',
          'ChatGPT-Account-Id': 'acc_123',
        });
      }).not.toThrow();
    });
  });
});
