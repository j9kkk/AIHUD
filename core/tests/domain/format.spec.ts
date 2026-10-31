import { describe, it, expect } from 'vitest';
import {
  formatPercent,
  formatAbsolute,
  formatCountdown,
  colorBand,
} from '../../src/domain/format.js';
import {
  redactEmail,
  redactToken,
  redactUrl,
} from '../../src/domain/redact.js';

describe('formatPercent', () => {
  it('formats normal ratios to bare number string without spaces or %', () => {
    expect(formatPercent(0.09)).toBe('9');
    expect(formatPercent(0.5)).toBe('50');
    expect(formatPercent(1)).toBe('100');
    expect(formatPercent(0)).toBe('0');
    expect(formatPercent(0.41)).toBe('41');
  });

  it('向下取整，绝不把未耗尽读成满额（D-02 裁决）', () => {
    expect(formatPercent(0.094)).toBe('9');
    expect(formatPercent(0.096)).toBe('9');   // floor 而非 round
    expect(formatPercent(0.999)).toBe('99');  // 99.9% 不允许显示成 100%
    expect(formatPercent(1)).toBe('100');     // 真正的满额才是 100
    expect(formatPercent(0)).toBe('0');       // 真正的耗尽才是 0
  });

  it('clamps out-of-bounds ratios (< 0 to 0, > 1 to 100)', () => {
    expect(formatPercent(-0.1)).toBe('0');
    expect(formatPercent(-5)).toBe('0');
    expect(formatPercent(1.05)).toBe('100');
    expect(formatPercent(2.5)).toBe('100');
  });

  it('returns null for missing or invalid values, never 0', () => {
    expect(formatPercent(null)).toBeNull();
    expect(formatPercent(undefined)).toBeNull();
    expect(formatPercent(NaN)).toBeNull();
  });

  it('ensures no whitespace in output', () => {
    const res = formatPercent(0.25);
    expect(res).not.toBeNull();
    expect(res).toBe('25');
    expect(res).not.toMatch(/\s/);
  });
});

describe('formatAbsolute', () => {
  it('formats values under 1000 as integers', () => {
    expect(formatAbsolute(0)).toBe('0');
    expect(formatAbsolute(500)).toBe('500');
    expect(formatAbsolute(999)).toBe('999');
  });

  it('formats thousands with k suffix and strips trailing .0', () => {
    expect(formatAbsolute(1000)).toBe('1k');
    expect(formatAbsolute(12400)).toBe('12.4k');
    expect(formatAbsolute(15200)).toBe('15.2k');
    expect(formatAbsolute(20000)).toBe('20k');
    expect(formatAbsolute(999900)).toBe('999.9k');
  });

  it('formats millions with M suffix and strips trailing .0', () => {
    expect(formatAbsolute(1000000)).toBe('1M');
    expect(formatAbsolute(1500000)).toBe('1.5M');
    expect(formatAbsolute(2000000)).toBe('2M');
  });

  it('handles negative values correctly', () => {
    expect(formatAbsolute(-12400)).toBe('-12.4k');
  });

  it('returns null for null, undefined, and NaN', () => {
    expect(formatAbsolute(null)).toBeNull();
    expect(formatAbsolute(undefined)).toBeNull();
    expect(formatAbsolute(NaN)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('returns "已复位" for negative or zero duration', () => {
    expect(formatCountdown(0)).toBe('已复位');
    expect(formatCountdown(-1)).toBe('已复位');
    expect(formatCountdown(-3600)).toBe('已复位');
  });

  it('formats seconds (< 60s)', () => {
    expect(formatCountdown(45)).toBe('45s');
    expect(formatCountdown(1)).toBe('1s');
  });

  it('formats minutes (< 3600s)', () => {
    expect(formatCountdown(60)).toBe('1m');
    expect(formatCountdown(120)).toBe('2m');
    expect(formatCountdown(125)).toBe('2m05s');
  });

  it('formats hours with padded minutes (< 86400s)', () => {
    // 1h04m = 3600 + 4*60 = 3840s
    expect(formatCountdown(3840)).toBe('1h04m');
    // 2h = 7200s
    expect(formatCountdown(7200)).toBe('2h00m');
  });

  it('formats days (>= 86400s)', () => {
    // 3d = 3 * 86400 = 259200s
    expect(formatCountdown(259200)).toBe('3d');
    // 1d 1h = 86400 + 3600 = 90000s
    expect(formatCountdown(90000)).toBe('1d1h');
  });

  it('calculates diff from absolute epoch millis and now', () => {
    const now = 1000000000000;
    const target = now + 45000; // +45s
    expect(formatCountdown(target, now)).toBe('45s');

    const past = now - 5000; // in past
    expect(formatCountdown(past, now)).toBe('已复位');
  });

  it('returns null for null / undefined / NaN', () => {
    expect(formatCountdown(null)).toBeNull();
    expect(formatCountdown(undefined)).toBeNull();
    expect(formatCountdown(NaN)).toBeNull();
  });
});

describe('colorBand', () => {
  it('returns hot (< 0.20)', () => {
    expect(colorBand(0)).toBe('hot');
    expect(colorBand(0.09)).toBe('hot');
    expect(colorBand(0.19)).toBe('hot');
  });

  it('returns warn (0.20 ~ 0.4999)', () => {
    expect(colorBand(0.20)).toBe('warn');
    expect(colorBand(0.41)).toBe('warn');
    expect(colorBand(0.49)).toBe('warn');
  });

  it('returns healthy (>= 0.50)', () => {
    expect(colorBand(0.50)).toBe('healthy');
    expect(colorBand(0.76)).toBe('healthy');
    expect(colorBand(1.0)).toBe('healthy');
  });

  it('returns neutral for null / undefined / NaN', () => {
    expect(colorBand(null)).toBe('neutral');
    expect(colorBand(undefined)).toBe('neutral');
    expect(colorBand(NaN)).toBe('neutral');
  });
});

describe('redact (redactEmail, redactToken, redactUrl)', () => {
  it('redactEmail keeps first char and domain, replaces username rest with ***', () => {
    expect(redactEmail('alice@corp.com')).toBe('a***@corp.com');
    expect(redactEmail('bob.smith@company.org')).toBe('b***@company.org');
    expect(redactEmail('u@domain.cn')).toBe('u***@domain.cn');
    expect(redactEmail(null)).toBeNull();
    expect(redactEmail('')).toBe('');
    expect(redactEmail('invalid-string')).toBe('***');
  });

  it('redactToken guarantees no token substring is leaked', () => {
    const rawToken = ['sk', 'ant', 'TESTFIXTURE', 'NOTAREALSECRET'].join('-');
    const redacted = redactToken(rawToken);
    expect(redacted).not.toBeNull();
    expect(redacted).not.toContain(rawToken);
    
    expect(redacted).toBe(`<redacted:${rawToken.length}>`);

    const bearer = redactToken('Bearer sk-12345678');
    expect(bearer).not.toContain('sk-12345678');
    expect(bearer).toBe('Bearer <redacted:11>');

    expect(redactToken(null)).toBeNull();
    expect(redactToken('')).toBe('');
  });

  it('redactUrl strips userinfo and masks query params to ensure no token leak', () => {
    const url = 'https://user:password@api.anthropic.com/v1/usage?token=sk-12345678&scope=read#frag';
    const clean = redactUrl(url);
    expect(clean).not.toBeNull();
    expect(clean).not.toContain('password');
    expect(clean).not.toContain('sk-12345678');
    expect(clean).toContain('token=%3Credacted%3E'); // or masked query
    expect(clean).not.toContain('#frag');

    expect(redactUrl(null)).toBeNull();
    expect(redactUrl('')).toBe('');
  });
});
