/**
 * 自定义渠道驱动测试（SPEC S04 + S08 的 fixture 矩阵）
 *
 * 覆盖三组契约：
 *   A. 配置校验：https 强制、路径表达式白名单、header 注入防护；
 *   B. 归一化边界：0 / 越界 / 缺失 / 负数 / 字符串数字 / 秒级时间戳 / ISO 时间；
 *   C. HTTP 分类：401 / 403 / 404 / 429(Retry-After) / 5xx / 非 JSON / 网络异常。
 */

import { describe, expect, it } from 'vitest';
import {
  createCustomDriver,
  CustomConfigError,
  createDefaultRegistry,
  DriverRegistry,
} from '../../src/drivers/index.js';
import type { CustomChannelConfig } from '../../src/drivers/index.js';
import { readPath, validateCustomConfig } from '../../src/drivers/custom/config.js';
import { parseResetAt } from '../../src/drivers/custom/normalize.js';
import type { FetchContext, HttpRequestSpec, HttpReply } from '../../src/drivers/driver.js';
import type { CreditsReading, WindowsReading } from '../../src/domain/types.js';

const BASE: CustomChannelConfig = {
  name: 'demo',
  label: '内部网关',
  base_url: 'https://gw.example.com/api/v1',
  endpoint_path: '/usage',
  auth: { kind: 'bearer' },
  json: { remaining: '$.data.remaining', total: '$.data.total' },
  visual: 'credits_pool',
};

function ctxWith(
  reply: Partial<HttpReply> | Error,
  seen?: HttpRequestSpec[]
): FetchContext {
  return {
    account: { account_id: 'acc-1', provider: 'custom.demo', region: 'global' },
    lease: {
      lease_id: 'l1',
      revision: 'rev1',
      expires_at: null,
      flow: 'manual_token',
    },
    http: {
      async request(spec: HttpRequestSpec): Promise<HttpReply> {
        seen?.push(spec);
        if (reply instanceof Error) throw reply;
        return {
          status: 200,
          headers: {},
          body_text: '{}',
          truncated: false,
          duration_ms: 10,
          ...reply,
        };
      },
    },
    clock: { now: () => 1_700_000_000_000 },
  } as unknown as FetchContext;
}

function pool(reading: unknown): CreditsReading {
  return reading as CreditsReading;
}

describe('S04 自定义渠道：配置校验', () => {
  it('接受合法配置，且 provider 为 custom.<name>', () => {
    expect(validateCustomConfig(BASE)).toHaveLength(0);
    const d = createCustomDriver(BASE);
    expect(d.provider).toBe('custom.demo');
    expect(d.default_visual).toBe('credits_pool');
    expect(d.capabilities.allowed_origins).toEqual(['https://gw.example.com']);
  });

  it('拒绝 http 明文地址（安全红线）', () => {
    const issues = validateCustomConfig({ ...BASE, base_url: 'http://gw.example.com' });
    expect(issues.map((i) => i.field)).toContain('base_url');
  });

  it('拒绝可执行/非法路径表达式', () => {
    for (const bad of ['data.remaining', '$.a..b', '$..*', '$.a[?(@.x)]', '$.a()']) {
      const issues = validateCustomConfig({
        ...BASE,
        json: { remaining: bad, total: '$.data.total' },
      });
      expect(issues.some((i) => i.field === 'json.remaining')).toBe(true);
    }
  });

  it('拒绝覆盖受保护 header 与非法 header 名', () => {
    for (const hn of ['authorization', 'Cookie', 'bad header', 'x']) {
      const issues = validateCustomConfig({
        ...BASE,
        auth: { kind: 'header', header_name: hn },
      });
      expect(issues.some((i) => i.field === 'auth.header_name')).toBe(true);
    }
    expect(
      validateCustomConfig({ ...BASE, auth: { kind: 'header', header_name: 'x-api-key' } })
    ).toHaveLength(0);
  });

  it('构造期对非法配置抛 CustomConfigError（不是静默失败）', () => {
    expect(() => createCustomDriver({ ...BASE, endpoint_path: 'usage' })).toThrowError(
      CustomConfigError
    );
  });

  it('解析 JSONPath 子集：对象、数组下标、越界返回 undefined', () => {
    const payload = { data: { items: [{ remaining: 12 }, { remaining: 34 }] } };
    expect(readPath(payload, '$.data.items[1].remaining')).toBe(34);
    expect(readPath(payload, '$.data.items[5].remaining')).toBeUndefined();
    expect(readPath(payload, '$.data.missing.deep')).toBeUndefined();
    expect(readPath(null, '$.a.b')).toBeUndefined();
  });
});

describe('S04 自定义渠道：归一化边界', () => {
  async function run(payload: unknown, cfg: CustomChannelConfig = BASE) {
    const ctx = ctxWith({ status: 200, body_text: JSON.stringify(payload) });
    return createCustomDriver(cfg).fetch_snapshot(ctx);
  }

  it('正常：remaining/total 换算成比例，exhausted 仅在 0 时为真', async () => {
    const ok = await run({ data: { remaining: 250, total: 1000 } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(pool(ok.reading).pool.remaining_ratio).toBeCloseTo(0.25, 6);
    expect(pool(ok.reading).pool.remaining).toBe(250);
  });

  it('完全耗尽：ratio=0 且这是唯一允许 0% 的来源', async () => {
    const ok = await run({ data: { remaining: 0, total: 1000 } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(pool(ok.reading).pool.remaining_ratio).toBe(0);
  });

  it('满额：ratio=1', async () => {
    const ok = await run({ data: { remaining: 1000, total: 1000 } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(pool(ok.reading).pool.remaining_ratio).toBe(1);
  });

  it('total 缺失 ⇒ schema 错误，绝不渲染成 0% / 100%', async () => {
    const r = await run({ data: { remaining: 250 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.class).toBe('schema');
  });

  it('total=0 ⇒ schema 错误（不除零）', async () => {
    const r = await run({ data: { remaining: 0, total: 0 } });
    expect(r.ok).toBe(false);
  });

  it('remaining 超出 total 1% 以上 ⇒ 越界错误', async () => {
    const r = await run({ data: { remaining: 1200, total: 1000 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('越界');
  });

  it('remaining 略超 total（容差内）⇒ 裁剪为 100%', async () => {
    const ok = await run({ data: { remaining: 1003, total: 1000 } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(pool(ok.reading).pool.remaining_ratio).toBe(1);
  });

  it('remaining 为字符串数字 ⇒ 判为脏数据（不做隐式转换）', async () => {
    const r = await run({ data: { remaining: '250', total: 1000 } });
    expect(r.ok).toBe(false);
  });

  it('剩余为负数 ⇒ 判为上游异常', async () => {
    const r = await run({ data: { remaining: -5, total: 1000 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('负数');
  });

  it('resets_at 秒级 / 毫秒级 / ISO 三种写法都归一到毫秒', () => {
    expect(parseResetAt(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseResetAt(1_700_000_000_123)).toBe(1_700_000_000_123);
    expect(parseResetAt('2026-11-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(parseResetAt('not-a-date')).toBeNull();
    expect(parseResetAt(0)).toBeNull();
  });

  it('visual=single_periodic_window 时产出窗口形态读数', async () => {
    const cfg: CustomChannelConfig = { ...BASE, visual: 'single_periodic_window' };
    const ok = await run({ data: { remaining: 40, total: 100 } }, cfg);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const w = ok.reading as WindowsReading;
    expect(w.kind).toBe('windows');
    expect(w.windows).toHaveLength(1);
    expect(w.windows[0]?.remaining_ratio).toBeCloseTo(0.4, 6);
    expect(w.windows[0]?.amount?.limit).toBe(100);
  });
});

describe('S04 自定义渠道：HTTP 分类', () => {
  it('401 ⇒ auth_expired', async () => {
    const r = await createCustomDriver(BASE).fetch_snapshot(ctxWith({ status: 401 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.class).toBe('auth');
  });

  it('403 ⇒ auth（自定义网关无停服语义）', async () => {
    const r = await createCustomDriver(BASE).fetch_snapshot(ctxWith({ status: 403 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.http_status).toBe(403);
  });

  it('404 ⇒ service_deprecated（提示检查 endpoint_path）', async () => {
    const r = await createCustomDriver(BASE).fetch_snapshot(ctxWith({ status: 404 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.class).toBe('deprecated');
  });

  it('429 ⇒ rate_limited 且保留 Retry-After', async () => {
    const r = await createCustomDriver(BASE).fetch_snapshot(
      ctxWith({ status: 429, headers: { 'retry-after': '42' } })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.class).toBe('rate_limit');
    expect(r.error.retry_after_secs).toBe(42);
  });

  it('500 ⇒ http 类错误，带上状态码', async () => {
    const r = await createCustomDriver(BASE).fetch_snapshot(ctxWith({ status: 500 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.http_status).toBe(500);
  });

  it('HTML 登录页 ⇒ parse_degraded（不当作 0%）', async () => {
    const r = await createCustomDriver(BASE).fetch_snapshot(
      ctxWith({ status: 200, body_text: '<html>login</html>' })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.class).toBe('schema');
  });

  it('网络异常 ⇒ unreachable', async () => {
    const r = await createCustomDriver(BASE).fetch_snapshot(ctxWith(new Error('ECONNREFUSED')));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.class).toBe('network');
  });

  it('请求规格：URL 拼接、超时 ≤15s、body 上限 ≤256KiB、鉴权按配置注入', async () => {
    const seen: HttpRequestSpec[] = [];
    await createCustomDriver(BASE).fetch_snapshot(
      ctxWith({ status: 200, body_text: '{"data":{"remaining":1,"total":2}}' }, seen)
    );
    expect(seen).toHaveLength(1);
    const spec = seen[0]!;
    expect(spec.url).toBe('https://gw.example.com/api/v1/usage');
    expect(spec.timeout_ms).toBeLessThanOrEqual(15000);
    expect(spec.max_body_bytes).toBeLessThanOrEqual(262144);
    expect(spec.auth).toEqual({ kind: 'bearer' });
  });

  it('header 鉴权：只注入配置指定的那一个头', async () => {
    const seen: HttpRequestSpec[] = [];
    const cfg: CustomChannelConfig = { ...BASE, auth: { kind: 'header', header_name: 'x-api-key' } };
    await createCustomDriver(cfg).fetch_snapshot(
      ctxWith({ status: 200, body_text: '{"data":{"remaining":1,"total":2}}' }, seen)
    );
    expect(seen[0]!.auth).toEqual({ kind: 'header', header_name: 'x-api-key' });
  });

  it('refresh_token 明确 unsupported，不伪造刷新流程', async () => {
    const r = await createCustomDriver(BASE).refresh_token({} as never);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect('unsupported' in r && r.unsupported).toBe(true);
  });
});

describe('S04 自定义渠道：注册表集成', () => {
  it('createDefaultRegistry 含四个内置 + 自定义渠道，顺序稳定', () => {
    const reg = createDefaultRegistry({ customs: [BASE] });
    const list = reg.list().map((d) => d.provider);
    expect(list).toEqual(['claude', 'codex', 'workbuddy', 'gemini', 'custom.demo']);
  });

  it('运行时 register / unregister：重名报错，内置位不可注销', () => {
    const reg = new DriverRegistry([]);
    const d1 = createCustomDriver(BASE);
    reg.register(d1);
    expect(reg.get('custom.demo' as never)).toBe(d1);

    expect(() => reg.register(createCustomDriver(BASE))).toThrowError(/Duplicate/);
    expect(reg.unregister('custom.demo' as never)).toBe(true);
    expect(reg.unregister('claude' as never)).toBe(false);
    expect(() => reg.get('custom.demo' as never)).toThrowError(/Unsupported provider/);
  });
});
