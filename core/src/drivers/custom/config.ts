/**
 * 自定义渠道配置 (Custom Channel Config)
 * 契约规范：docs/ARCHITECTURE.md §4.6「可扩展渠道」+ docs/SPEC.md S04
 *
 * 设计目标：让用户在**不写代码**的前提下接入自建网关或未被内置支持的厂商。
 * 差异只有两处——「数据格式不同」和「展示方式不同」——因此配置也只描述这两件事：
 *   1. 数据格式：endpoint + 字段路径（JSONPath 子集）；
 *   2. 展示方式：visual 形态（双环 / 单环 / 积分池）。
 *
 * 安全约束（与内置驱动同标准）：
 *   - base_url 必须 https:，且 origin 自动成为该渠道的唯一白名单；
 *   - 不提供任意 header 注入，只允许 bearer 或单一 header 名；
 *   - 路径表达式只允许 `$.a.b[0].c` 这类只读取值，禁止函数、通配、脚本。
 */

import type { MetricVisualKind, ProviderKind } from '../../domain/types.js';

/** 渠道名：用于拼 provider `custom.<name>`，限制在 DNS label 同级字符集 */
export const CUSTOM_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** 允许的 JSONPath 子集：$ 开头，点号取属性，方括号取数组下标 */
export const CUSTOM_PATH_RE = /^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d{1,3}\])+$/;

export type CustomAuthKind = 'bearer' | 'header';

export interface CustomChannelConfig {
  /** 渠道短名，如 'demo' → provider 'custom.demo' */
  readonly name: string;
  /** 一级界面展示名（可中文），如 '内部网关' */
  readonly label: string;
  /** 必须 https，可带路径前缀，如 'https://gw.example.com/api' */
  readonly base_url: string;
  /** 端点路径，以 / 开头 */
  readonly endpoint_path: string;
  /** 默认 GET；少数网关需要 POST 空体 */
  readonly method?: 'GET' | 'POST';
  /** 鉴权方式：bearer 走 Authorization，header 走自定义头（如 x-api-key） */
  readonly auth: {
    readonly kind: CustomAuthKind;
    /** kind='header' 时必填，如 'x-api-key' */
    readonly header_name?: string;
  };
  /** 字段路径映射：只描述「剩余」与「总量」如何取 */
  readonly json: {
    /** 剩余额度路径，必填 */
    readonly remaining: string;
    /** 总量路径；缺失时整条读数作废（绝不猜 0/100） */
    readonly total: string;
    /** 复位时间路径，可选；支持 epoch 秒 / 毫秒 / ISO8601 */
    readonly resets_at?: string;
    /** 窗口标识，默认 'rolling'；用于跨次比对与通知去重 */
    readonly window_id?: string;
  };
  /** 展示形态，默认 credits_pool（积分池：单环 + 绝对值） */
  readonly visual?: MetricVisualKind;
  /** 数值单位，默认 'credits'；仅影响绝对值后缀文案 */
  readonly unit?: 'credits' | 'tokens' | 'requests';
}

export interface CustomConfigIssue {
  readonly field: string;
  readonly message: string;
}

/** provider 标识：内置位一律小写，自定义渠道加 `custom.` 前缀防止撞名 */
export function providerOfCustom(cfg: Pick<CustomChannelConfig, 'name'>): ProviderKind {
  return `custom.${cfg.name}` as ProviderKind;
}

/** 从 base_url 推导白名单 origin（scheme + host + port） */
export function originOf(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * 配置校验：返回全部问题（而非抛第一个），便于设置界面一次性提示。
 * 空数组 = 合法配置。
 */
export function validateCustomConfig(cfg: CustomChannelConfig): readonly CustomConfigIssue[] {
  const issues: CustomConfigIssue[] = [];

  if (!CUSTOM_NAME_RE.test(cfg.name ?? '')) {
    issues.push({
      field: 'name',
      message: '渠道名只能是小写字母/数字/下划线/短横线，1–32 位，且以字母或数字开头',
    });
  }

  if (!cfg.label || cfg.label.trim().length === 0) {
    issues.push({ field: 'label', message: '展示名不能为空' });
  } else if (cfg.label.length > 20) {
    issues.push({ field: 'label', message: '展示名不超过 20 个字符（菜单栏空间有限）' });
  }

  if (!originOf(cfg.base_url ?? '')) {
    issues.push({ field: 'base_url', message: '必须是 https:// 开头的合法地址（明文 http 一律拒绝）' });
  }

  if (!cfg.endpoint_path || !cfg.endpoint_path.startsWith('/')) {
    issues.push({ field: 'endpoint_path', message: '端点路径必须以 / 开头' });
  } else if (cfg.endpoint_path.length > 256) {
    issues.push({ field: 'endpoint_path', message: '端点路径不超过 256 字符' });
  }

  if (cfg.method !== undefined && cfg.method !== 'GET' && cfg.method !== 'POST') {
    issues.push({ field: 'method', message: '仅支持 GET 或 POST' });
  }

  if (!cfg.auth || (cfg.auth.kind !== 'bearer' && cfg.auth.kind !== 'header')) {
    issues.push({ field: 'auth.kind', message: '鉴权方式只能是 bearer 或 header' });
  } else if (cfg.auth.kind === 'header') {
    const hn = cfg.auth.header_name ?? '';
    if (!/^[A-Za-z0-9-]{2,64}$/.test(hn)) {
      issues.push({
        field: 'auth.header_name',
        message: '自定义 header 名只能包含字母/数字/短横线（如 x-api-key）',
      });
    }
    if (/^(authorization|cookie|host|content-length)$/i.test(hn)) {
      issues.push({ field: 'auth.header_name', message: '不允许覆盖受保护的系统 header' });
    }
  }

  if (!cfg.json || !CUSTOM_PATH_RE.test(cfg.json.remaining ?? '')) {
    issues.push({ field: 'json.remaining', message: '剩余额度路径必须是 $.a.b 或 $.a[0].b 形式' });
  }
  if (!cfg.json || !CUSTOM_PATH_RE.test(cfg.json.total ?? '')) {
    issues.push({ field: 'json.total', message: '总量路径必须是 $.a.b 或 $.a[0].b 形式' });
  }
  if (cfg.json?.resets_at !== undefined && !CUSTOM_PATH_RE.test(cfg.json.resets_at)) {
    issues.push({ field: 'json.resets_at', message: '复位时间路径格式不合法' });
  }
  if (cfg.json?.window_id !== undefined && !/^[a-z0-9_.:-]{1,48}$/i.test(cfg.json.window_id)) {
    issues.push({ field: 'json.window_id', message: '窗口标识只能包含字母/数字/下划线/点/冒号' });
  }

  return issues;
}

/**
 * JSONPath 子集求值：只读、无副作用、越界返回 undefined。
 * 支持 `$.data.items[2].remaining`，不支持通配、过滤器、函数。
 */
export function readPath(root: unknown, path: string): unknown {
  if (!CUSTOM_PATH_RE.test(path)) return undefined;

  const tokens: (string | number)[] = [];
  const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d{1,3})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(Number(m[2]));
  }

  let cur: unknown = root;
  for (const t of tokens) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (typeof t === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[t];
    } else {
      if (Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[t];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}
