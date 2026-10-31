import { describe, it, expect } from 'vitest';
import {
  parseRetryAfter,
  parseRetryAfterMs,
  clampRetryAfter,
  nextDueAfterFailure,
  applyJitter,
  type PollPolicy,
} from '../../src/scheduler/backoff.js';

describe('Retry-After parser & Exponential Backoff (docs/ARCHITECTURE.md §6.3)', () => {
  const TEST_POLICY: PollPolicy = {
    base_interval_secs: 300,
    min_interval_secs: 120,
    max_interval_secs: 900,
    idle_interval_secs: 900,
    jitter_ratio: 0.1,
    reset_watch_secs: 900,
    backoff: {
      base_secs: 60,
      factor: 2,
      max_secs: 3600,
      respect_retry_after: true,
      retry_after_clamp: [5, 7200],
    },
  };

  describe('parseRetryAfter & parseRetryAfterMs', () => {
    it('parses pure numeric string "45" as 45 seconds', () => {
      expect(parseRetryAfter('45')).toBe(45);
    });

    // 硬性验收 3: Retry-After: "50" 与 HTTP-date 两种都能解析为毫秒
    it('hard requirement 3: parses "50" to milliseconds (50,000 ms)', () => {
      const ms = parseRetryAfterMs('50');
      expect(ms).toBe(50_000);
    });

    it('hard requirement 3: parses HTTP-date to milliseconds', () => {
      // 构造基准时刻与 120s 后的 HTTP-date
      const baseTime = Date.parse('2026-10-31T10:00:00.000Z');
      const httpDateStr = 'Sat, 31 Oct 2026 10:02:00 GMT'; // 120s 之后

      const ms = parseRetryAfterMs(httpDateStr, baseTime);
      expect(ms).toBe(120_000); // 120s = 120,000ms
    });

    it('parses HTTP-date within 50s delta as 50,000 ms', () => {
      const baseTime = Date.parse('2026-10-21T07:27:10.000Z');
      const httpDateStr = 'Wed, 21 Oct 2026 07:28:00 GMT'; // 50s 之后

      const ms = parseRetryAfterMs(httpDateStr, baseTime);
      expect(ms).toBe(50_000);
      expect(parseRetryAfter(httpDateStr, baseTime)).toBe(50);
    });

    it('past HTTP-date resolves to 5 seconds (5,000 ms)', () => {
      const baseTime = Date.parse('2026-10-31T12:00:00.000Z');
      const pastDateStr = 'Sat, 31 Oct 2026 11:59:00 GMT'; // 过去 60s

      expect(parseRetryAfter(pastDateStr, baseTime)).toBe(5);
      expect(parseRetryAfterMs(pastDateStr, baseTime)).toBe(5_000);
    });

    it('missing / empty / invalid non-numeric header defaults to 60 seconds (60,000 ms)', () => {
      expect(parseRetryAfter(null)).toBe(60);
      expect(parseRetryAfter(undefined)).toBe(60);
      expect(parseRetryAfter('')).toBe(60);
      expect(parseRetryAfter('   ')).toBe(60);
      expect(parseRetryAfter('invalid-date-or-number')).toBe(60);

      expect(parseRetryAfterMs(null)).toBe(60_000);
      expect(parseRetryAfterMs('')).toBe(60_000);
    });

    it('clamps values below 5s to 5s to prevent tight polling loops', () => {
      expect(parseRetryAfter('0')).toBe(5);
      expect(parseRetryAfter('2')).toBe(5);
      expect(parseRetryAfter('4')).toBe(5);
      expect(parseRetryAfterMs('2')).toBe(5_000);
    });

    it('clamps values above 7200s to 7200s', () => {
      expect(parseRetryAfter('8000')).toBe(7200);
      expect(parseRetryAfter('999999')).toBe(7200);
      expect(parseRetryAfterMs('10000')).toBe(7_200_000);
    });
  });

  describe('clampRetryAfter', () => {
    it('clamps correctly with custom limits', () => {
      expect(clampRetryAfter(3, 10, 100)).toBe(10);
      expect(clampRetryAfter(50, 10, 100)).toBe(50);
      expect(clampRetryAfter(200, 10, 100)).toBe(100);
    });
  });

  describe('nextDueAfterFailure (exponential backoff)', () => {
    const NOW = 1_000_000;

    it('calculates local exponential backoff when retryAfterSecs is null', () => {
      // consecutive = 1: base = 60s
      expect(nextDueAfterFailure(TEST_POLICY, 1, null, NOW)).toBe(NOW + 60 * 1000);

      // consecutive = 2: base * 2^1 = 120s
      expect(nextDueAfterFailure(TEST_POLICY, 2, null, NOW)).toBe(NOW + 120 * 1000);

      // consecutive = 3: base * 2^2 = 240s
      expect(nextDueAfterFailure(TEST_POLICY, 3, null, NOW)).toBe(NOW + 240 * 1000);

      // consecutive = 4: base * 2^3 = 480s
      expect(nextDueAfterFailure(TEST_POLICY, 4, null, NOW)).toBe(NOW + 480 * 1000);

      // consecutive = 10: 60 * 2^9 = 30720s > max_secs (3600s), caps at 3600s
      expect(nextDueAfterFailure(TEST_POLICY, 10, null, NOW)).toBe(NOW + 3600 * 1000);
    });

    it('honors server Retry-After clamped to policy range', () => {
      // Retry-After 100s > local backoff 60s (consecutive=1) => honors 100s
      expect(nextDueAfterFailure(TEST_POLICY, 1, 100, NOW)).toBe(NOW + 100 * 1000);

      // Retry-After 30s < local backoff 120s (consecutive=2) => local backoff is larger
      expect(nextDueAfterFailure(TEST_POLICY, 2, 30, NOW)).toBe(NOW + 120 * 1000);
    });

    it('server Retry-After is clamped within [5, 7200]', () => {
      // Retry-After 2s clamped to 5s, local 60s => max(5, 60) = 60s
      expect(nextDueAfterFailure(TEST_POLICY, 1, 2, NOW)).toBe(NOW + 60 * 1000);

      // Retry-After 10000s clamped to 7200s, local 60s => 7200s
      expect(nextDueAfterFailure(TEST_POLICY, 1, 10000, NOW)).toBe(NOW + 7200 * 1000);
    });

    it('doubles local backoff base for 3rd and subsequent 429 within 1 minute (base * 2^(n-2))', () => {
      // 3rd 429 in 1 minute: n = 3 => base * 2^(3-2) = base * 2 = 120s
      const due3rd = nextDueAfterFailure(TEST_POLICY, 1, null, NOW, { recent429Count1m: 3 });
      expect(due3rd).toBe(NOW + 120 * 1000);

      // 4th 429 in 1 minute: n = 4 => base * 2^(4-2) = base * 4 = 240s
      const due4th = nextDueAfterFailure(TEST_POLICY, 1, null, NOW, { recent429Count1m: 4 });
      expect(due4th).toBe(NOW + 240 * 1000);
    });
  });

  describe('applyJitter', () => {
    it('applies ±10% jitter correctly', () => {
      const baseMs = 100_000;
      // random = 0.5 => factor = 1 + (0.5*2 - 1)*0.1 = 1.0 => 100,000
      expect(applyJitter(baseMs, 0.1, () => 0.5)).toBe(100_000);

      // random = 0.0 => factor = 1 + (-1)*0.1 = 0.9 => 90,000
      expect(applyJitter(baseMs, 0.1, () => 0.0)).toBe(90_000);

      // random = 1.0 => factor = 1 + (1)*0.1 = 1.1 => 110,000
      expect(applyJitter(baseMs, 0.1, () => 1.0)).toBe(110_000);
    });
  });
});
