import { describe, it, expect } from 'vitest';
import {
  nextState,
  findTransition,
  reasonToState,
  HEALTH_TRANSITIONS,
} from '../../src/domain/health.js';
import type { AccountHealthState, UnavailableReason } from '../../src/domain/types.js';

describe('health state machine (28 transitions from FLOWS.md §12)', () => {
  it('has at least 28 defined transition rules', () => {
    expect(HEALTH_TRANSITIONS.length).toBeGreaterThanOrEqual(28);
  });

  // T01: (null) + credential_saved -> never_synced
  it('T01: null -> credential_saved -> never_synced', () => {
    expect(nextState(null, 'credential_saved')).toBe('never_synced');
  });

  // T02: never_synced + probe_success -> normal
  it('T02: never_synced -> probe_success -> normal', () => {
    expect(nextState('never_synced', 'probe_success')).toBe('normal');
  });

  // T03: never_synced + network_failure -> never_synced
  it('T03: never_synced -> network_failure -> never_synced', () => {
    expect(nextState('never_synced', 'network_failure')).toBe('never_synced');
  });

  // T04: never_synced + auth_401 -> auth_expired
  it('T04: never_synced -> auth_401 -> auth_expired', () => {
    expect(nextState('never_synced', 'auth_401')).toBe('auth_expired');
  });

  // T05: normal + probe_success -> normal
  it('T05: normal -> probe_success -> normal', () => {
    expect(nextState('normal', 'probe_success')).toBe('normal');
  });

  // T06: normal + network_failure / ttl_expired -> offline_stale
  it('T06: normal -> network_failure or ttl_expired -> offline_stale', () => {
    expect(nextState('normal', 'network_failure')).toBe('offline_stale');
    expect(nextState('normal', 'ttl_expired')).toBe('offline_stale');
  });

  // T07: normal + auth_401 -> auth_expired
  it('T07: normal -> auth_401 -> auth_expired', () => {
    expect(nextState('normal', 'auth_401')).toBe('auth_expired');
  });

  // T08: normal + rate_limited -> rate_limited
  it('T08: normal -> rate_limited -> rate_limited', () => {
    expect(nextState('normal', 'rate_limited')).toBe('rate_limited');
  });

  // T09: normal + service_deprecated -> service_deprecated
  it('T09: normal -> service_deprecated -> service_deprecated', () => {
    expect(nextState('normal', 'service_deprecated')).toBe('service_deprecated');
  });

  // T10: normal + parse_degraded -> parse_degraded
  it('T10: normal -> parse_degraded -> parse_degraded', () => {
    expect(nextState('normal', 'parse_degraded')).toBe('parse_degraded');
  });

  // T11: normal + manual_refresh_401 -> auth_expired
  it('T11: normal -> manual_refresh_401 -> auth_expired', () => {
    expect(nextState('normal', 'manual_refresh_401')).toBe('auth_expired');
  });

  // T12: offline_stale + probe_success -> normal
  it('T12: offline_stale -> probe_success -> normal', () => {
    expect(nextState('offline_stale', 'probe_success')).toBe('normal');
  });

  // T13: offline_stale + auth_401 -> auth_expired
  it('T13: offline_stale -> auth_401 -> auth_expired', () => {
    expect(nextState('offline_stale', 'auth_401')).toBe('auth_expired');
  });

  // T14: offline_stale + rate_limited -> rate_limited
  it('T14: offline_stale -> rate_limited -> rate_limited', () => {
    expect(nextState('offline_stale', 'rate_limited')).toBe('rate_limited');
  });

  // T15: auth_expired + reauth_success -> never_synced
  it('T15: auth_expired -> reauth_success -> never_synced', () => {
    expect(nextState('auth_expired', 'reauth_success')).toBe('never_synced');
  });

  // T16: auth_expired + probe_success -> normal
  it('T16: auth_expired -> probe_success -> normal', () => {
    expect(nextState('auth_expired', 'probe_success')).toBe('normal');
  });

  // T17: auth_expired + rate_limited -> rate_limited
  it('T17: auth_expired -> rate_limited -> rate_limited', () => {
    expect(nextState('auth_expired', 'rate_limited')).toBe('rate_limited');
  });

  // T18: rate_limited + probe_success -> normal
  it('T18: rate_limited -> probe_success -> normal', () => {
    expect(nextState('rate_limited', 'probe_success')).toBe('normal');
  });

  // T19: rate_limited + auth_401 -> auth_expired
  it('T19: rate_limited -> auth_401 -> auth_expired', () => {
    expect(nextState('rate_limited', 'auth_401')).toBe('auth_expired');
  });

  // T20: rate_limited + service_deprecated -> service_deprecated
  it('T20: rate_limited -> service_deprecated -> service_deprecated', () => {
    expect(nextState('rate_limited', 'service_deprecated')).toBe('service_deprecated');
  });

  // T21: service_deprecated + probe_success -> normal
  it('T21: service_deprecated -> probe_success -> normal', () => {
    expect(nextState('service_deprecated', 'probe_success')).toBe('normal');
  });

  // T22: service_deprecated + network_failure -> service_deprecated
  it('T22: service_deprecated -> network_failure -> service_deprecated', () => {
    expect(nextState('service_deprecated', 'network_failure')).toBe('service_deprecated');
  });

  // T23: service_deprecated + auth_401 -> auth_expired
  it('T23: service_deprecated -> auth_401 -> auth_expired', () => {
    expect(nextState('service_deprecated', 'auth_401')).toBe('auth_expired');
  });

  // T24: parse_degraded + probe_success -> normal
  it('T24: parse_degraded -> probe_success -> normal', () => {
    expect(nextState('parse_degraded', 'probe_success')).toBe('normal');
  });

  // T25: parse_degraded + auth_401 -> auth_expired
  it('T25: parse_degraded -> auth_401 -> auth_expired', () => {
    expect(nextState('parse_degraded', 'auth_401')).toBe('auth_expired');
  });

  // T26: parse_degraded + service_deprecated -> service_deprecated
  it('T26: parse_degraded -> service_deprecated -> service_deprecated', () => {
    expect(nextState('parse_degraded', 'service_deprecated')).toBe('service_deprecated');
  });

  // T27: * + user_delete -> null
  it('T27: any state -> user_delete -> null', () => {
    const states: (AccountHealthState | null)[] = [
      'never_synced',
      'normal',
      'offline_stale',
      'auth_expired',
      'rate_limited',
      'service_deprecated',
      'parse_degraded',
      null,
    ];
    for (const s of states) {
      expect(nextState(s, 'user_delete')).toBeNull();
    }
  });

  // T28: * + user_toggle_hide -> same state
  it('T28: any state -> user_toggle_hide -> current state', () => {
    const states: AccountHealthState[] = [
      'never_synced',
      'normal',
      'offline_stale',
      'auth_expired',
      'rate_limited',
      'service_deprecated',
      'parse_degraded',
    ];
    for (const s of states) {
      expect(nextState(s, 'user_toggle_hide')).toBe(s);
    }
  });

  it('supports calling nextState with input object { current, event }', () => {
    expect(
      nextState({ current: 'never_synced', event: 'probe_success' })
    ).toBe('normal');
    expect(
      nextState({ current: 'normal', event: { type: 'rate_limited' } })
    ).toBe('rate_limited');
  });

  it('returns current state when event has no matched transition', () => {
    expect(nextState('rate_limited', 'network_failure')).toBe('rate_limited');
  });
});

describe('reasonToState mapping (docs/ARCHITECTURE.md §3.5)', () => {
  it('correctly maps all UnavailableReason variants to their target health state', () => {
    expect(reasonToState('never_fetched')).toBe('never_synced');
    expect(reasonToState('network')).toBe('offline_stale');
    expect(reasonToState('timeout')).toBe('offline_stale');
    expect(reasonToState('http_5xx')).toBe('offline_stale');
    expect(reasonToState('gateway_html')).toBe('offline_stale');
    expect(reasonToState('schema_drift')).toBe('parse_degraded');
    expect(reasonToState('auth_401')).toBe('auth_expired');
    expect(reasonToState('rate_limited')).toBe('rate_limited');
    expect(reasonToState('deprecated')).toBe('service_deprecated');
  });
});
