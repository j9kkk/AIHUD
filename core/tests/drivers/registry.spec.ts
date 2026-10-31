import { describe, it, expect } from 'vitest';
import {
  DriverRegistry,
  RegistryError,
  UnsupportedProviderError,
} from '../../src/drivers/registry.js';
import {
  createDefaultRegistry,
} from '../../src/drivers/index.js';
import { createWorkBuddyDriver } from '../../src/drivers/workbuddy/driver.js';
import { createGeminiDriver } from '../../src/drivers/gemini/driver.js';
import type {
  ChannelDriver,
  PollPolicy,
  DriverCapabilities,
} from '../../src/drivers/driver.js';

function createMockDriver(
  provider: 'claude' | 'codex' | 'workbuddy' | 'gemini',
  overrides?: Partial<ChannelDriver>
): ChannelDriver {
  const poll_policy: PollPolicy = {
    base_interval_secs: 300,
    min_interval_secs: 120,
    max_interval_secs: 1800,
    jitter_ratio: 0.1,
    reset_watch_secs: 60,
    backoff: {
      base_secs: 60,
      factor: 2,
      max_secs: 1800,
      respect_retry_after: true,
      retry_after_clamp: [5, 7200],
    },
    idle_interval_secs: 600,
  };

  const capabilities: DriverCapabilities = {
    can_refresh: true,
    region_scoped: false,
    allowed_origins: ['https://api.example.com'],
    cli_commands: [],
    max_windows_for_card: 2,
  };

  return {
    provider,
    schema_version: `${provider}.v1`,
    supported_auth_flows: ['manual_token'],
    poll_policy,
    capabilities,
    default_visual: 'dual_sliding_window',
    fetch_snapshot: async () => ({
      ok: false,
      error: {
        class: 'network',
        message: 'mock',
        http_status: null,
        upstream_code: null,
        retry_after_secs: null,
        migration_hint: null,
      },
    }),
    refresh_token: async () => ({ ok: false, unsupported: true }),
    ...overrides,
  };
}

describe('DriverRegistry', () => {
  describe('Constructor Validation & 4-Driver Registration', () => {
    it('successfully registers all 4 drivers', () => {
      const claude = createMockDriver('claude');
      const codex = createMockDriver('codex');
      const workbuddy = createWorkBuddyDriver();
      const gemini = createGeminiDriver();

      const registry = new DriverRegistry([claude, codex, workbuddy, gemini]);
      expect(registry.get('claude').provider).toBe('claude');
      expect(registry.get('codex').provider).toBe('codex');
      expect(registry.get('workbuddy').provider).toBe('workbuddy');
      expect(registry.get('gemini').provider).toBe('gemini');
    });

    it('rejects non-array drivers parameter', () => {
      expect(() => new DriverRegistry(null as any)).toThrowError(RegistryError);
      expect(() => new DriverRegistry('invalid' as any)).toThrowError(RegistryError);
    });

    it('rejects duplicate driver registrations', () => {
      const claude1 = createMockDriver('claude');
      const claude2 = createMockDriver('claude');

      expect(() => new DriverRegistry([claude1, claude2])).toThrowError(
        /Duplicate driver registration/
      );
    });

    it('accepts a valid custom.* provider (S04 解禁)', () => {
      const customDriver = createMockDriver('claude', {
        provider: 'custom.my_plugin' as any,
        capabilities: {
          ...createMockDriver('claude').capabilities,
          allowed_origins: ['https://gw.example.com'],
        },
      });

      expect(() => new DriverRegistry([customDriver])).not.toThrow();
    });

    it('rejects custom.* with an invalid name or missing origin', () => {
      const badName = createMockDriver('claude', { provider: 'custom.Bad Name' as any });
      expect(() => new DriverRegistry([badName])).toThrowError(/Custom provider name invalid/);

      const noOrigin = createMockDriver('claude', {
        provider: 'custom.noop' as any,
        capabilities: { ...createMockDriver('claude').capabilities, allowed_origins: [] },
      });
      expect(() => new DriverRegistry([noOrigin])).toThrowError(/must declare at least one allowed origin/);
    });

    it('rejects drivers with missing or invalid methods', () => {
      const noFetch = createMockDriver('claude', {
        fetch_snapshot: undefined as any,
      });
      expect(() => new DriverRegistry([noFetch])).toThrowError(
        /must implement fetch_snapshot/
      );

      const noRefresh = createMockDriver('claude', {
        refresh_token: undefined as any,
      });
      expect(() => new DriverRegistry([noRefresh])).toThrowError(
        /must implement refresh_token/
      );
    });

    it('rejects empty supported_auth_flows', () => {
      const emptyFlows = createMockDriver('claude', {
        supported_auth_flows: [],
      });
      expect(() => new DriverRegistry([emptyFlows])).toThrowError(
        /supported_auth_flows must be a non-empty array/
      );
    });

    it('rejects poll_policy violating 120 <= min <= base <= max <= 3600', () => {
      // min < 120
      const lowMin = createMockDriver('claude', {
        poll_policy: {
          ...createMockDriver('claude').poll_policy,
          min_interval_secs: 60,
        },
      });
      expect(() => new DriverRegistry([lowMin])).toThrowError(
        /poll_policy intervals invalid/
      );

      // min > base
      const minGtBase = createMockDriver('claude', {
        poll_policy: {
          ...createMockDriver('claude').poll_policy,
          min_interval_secs: 400,
          base_interval_secs: 300,
        },
      });
      expect(() => new DriverRegistry([minGtBase])).toThrowError(
        /poll_policy intervals invalid/
      );

      // base > max
      const baseGtMax = createMockDriver('claude', {
        poll_policy: {
          ...createMockDriver('claude').poll_policy,
          base_interval_secs: 2000,
          max_interval_secs: 1800,
        },
      });
      expect(() => new DriverRegistry([baseGtMax])).toThrowError(
        /poll_policy intervals invalid/
      );

      // max > 3600
      const maxOver = createMockDriver('claude', {
        poll_policy: {
          ...createMockDriver('claude').poll_policy,
          max_interval_secs: 5000,
        },
      });
      expect(() => new DriverRegistry([maxOver])).toThrowError(
        /poll_policy intervals invalid/
      );
    });

    it('rejects poll_policy with invalid jitter_ratio', () => {
      const highJitter = createMockDriver('claude', {
        poll_policy: {
          ...createMockDriver('claude').poll_policy,
          jitter_ratio: 0.6,
        },
      });
      expect(() => new DriverRegistry([highJitter])).toThrowError(
        /jitter_ratio must be in \[0, 0.5\]/
      );
    });

    it('rejects backoff violating max_secs >= base_secs >= 30', () => {
      const lowBase = createMockDriver('claude', {
        poll_policy: {
          ...createMockDriver('claude').poll_policy,
          backoff: {
            base_secs: 10,
            factor: 2,
            max_secs: 100,
            respect_retry_after: true,
            retry_after_clamp: [5, 7200],
          },
        },
      });
      expect(() => new DriverRegistry([lowBase])).toThrowError(/backoff invalid/);

      const baseGtMax = createMockDriver('claude', {
        poll_policy: {
          ...createMockDriver('claude').poll_policy,
          backoff: {
            base_secs: 120,
            factor: 2,
            max_secs: 60,
            respect_retry_after: true,
            retry_after_clamp: [5, 7200],
          },
        },
      });
      expect(() => new DriverRegistry([baseGtMax])).toThrowError(/backoff invalid/);
    });

    it('rejects non-https allowed_origins', () => {
      const httpOrigin = createMockDriver('claude', {
        capabilities: {
          ...createMockDriver('claude').capabilities,
          allowed_origins: ['http://api.insecure.com'],
        },
      });
      expect(() => new DriverRegistry([httpOrigin])).toThrowError(
        /must only contain https:/
      );
    });
  });

  describe('list() Stable Ordering', () => {
    it('returns drivers in strict canonical order [claude, codex, workbuddy, gemini]', () => {
      const claude = createMockDriver('claude');
      const codex = createMockDriver('codex');
      const workbuddy = createWorkBuddyDriver();
      const gemini = createGeminiDriver();

      // Pass in reverse / mixed order
      const registry = new DriverRegistry([gemini, workbuddy, codex, claude]);
      const list = registry.list();

      expect(list.map((d) => d.provider)).toEqual([
        'claude',
        'codex',
        'workbuddy',
        'gemini',
      ]);

      // Check default_visual mapping
      const wbSummary = list.find((d) => d.provider === 'workbuddy')!;
      expect(wbSummary.default_visual).toBe('credits_pool');

      const geminiSummary = list.find((d) => d.provider === 'gemini')!;
      expect(geminiSummary.default_visual).toBe('single_periodic_window');

      const claudeSummary = list.find((d) => d.provider === 'claude')!;
      expect(claudeSummary.default_visual).toBe('dual_sliding_window');
    });
  });

  describe('get() and UnsupportedProviderError', () => {
    it('returns requested driver when registered', () => {
      const wb = createWorkBuddyDriver();
      const registry = new DriverRegistry([wb]);
      expect(registry.get('workbuddy')).toBe(wb);
    });

    it('throws UnsupportedProviderError when provider is not registered', () => {
      const registry = new DriverRegistry([createWorkBuddyDriver()]);
      expect(() => registry.get('gemini')).toThrowError(UnsupportedProviderError);
      expect(() => registry.get('custom.not_installed' as any)).toThrowError(
        UnsupportedProviderError
      );
    });
  });

  describe('assert_ready()', () => {
    it('returns warnings for missing fixtures without throwing', () => {
      const claude = createMockDriver('claude');
      const registry = new DriverRegistry([claude]);

      const warnings = registry.assert_ready({
        fixtureChecker: (provider) => provider !== 'claude',
      });

      expect(warnings.length).toBe(1);
      expect(warnings[0]!.provider).toBe('claude');
      expect(warnings[0]!.code).toBe('missing_fixture');
    });
  });

  describe('createDefaultRegistry Assembly', () => {
    it('assembles workbuddy and gemini by default', () => {
      const registry = createDefaultRegistry();
      expect(registry.get('workbuddy').provider).toBe('workbuddy');
      expect(registry.get('gemini').provider).toBe('gemini');
    });

    it('assembles all 4 drivers when custom drivers are provided', () => {
      const claude = createMockDriver('claude');
      const codex = createMockDriver('codex');
      const registry = createDefaultRegistry({ claude, codex });

      const list = registry.list();
      expect(list.map((d) => d.provider)).toEqual([
        'claude',
        'codex',
        'workbuddy',
        'gemini',
      ]);
    });
  });
});
