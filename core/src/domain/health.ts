/**
 * AI HUD 账号健康状态机 (AccountHealthState Machine)
 * 契约规范：docs/FLOWS.md（第 12 章 状态机与 28 条迁移表）与 docs/ARCHITECTURE.md（第 3.5 节）
 *
 * 包含 7 个 AccountHealthState、28 条严格定义的确定性状态迁移（T01–T28）。
 */

import type { AccountHealthState, UnavailableReason } from './types.js';

/**
 * 触发状态迁移的事件类型
 */
export type HealthEventType =
  | 'credential_saved'   // 凭据保存成功 (T01)
  | 'probe_success'       // 探测/探活成功 (T02, T05, T12, T16, T18, T21, T24)
  | 'network_failure'    // 网络失败/DNS/超时 (T03, T06, T22)
  | 'ttl_expired'        // 读数过期超过 stale_ttl (T06)
  | 'auth_401'           // 401/403 鉴权失败且刷新失败 (T04, T07, T13, T19, T23, T25)
  | 'manual_refresh_401' // 用户手动刷新触发 401 (T11)
  | 'rate_limited'       // 收到 429 或限流 (T08, T14, T17)
  | 'service_deprecated' // 403 停服或端点退役 (T09, T20, T26)
  | 'parse_degraded'     // schema 解析失败或数据越界 (T10)
  | 'reauth_success'     // 用户重新授权成功 (T15)
  | 'user_delete'        // 用户删除账号 (T27)
  | 'user_toggle_hide';  // 用户隐藏或取消隐藏账号 (T28)

/**
 * 健康事件对象（支持纯字符串字面量或带 payload 对象）
 */
export type HealthEvent =
  | HealthEventType
  | { readonly type: HealthEventType; readonly payload?: unknown };

/**
 * 状态迁移条目契约定义
 */
export interface HealthTransitionRule {
  /** 迁移 ID，严格对应 docs/FLOWS.md 第 12.2 节的 T01–T28 */
  readonly id: string;
  /** 起始状态（null 表示无账号，'*' 表示任意状态） */
  readonly from: AccountHealthState | null | '*';
  /** 触发事件 */
  readonly event: HealthEventType;
  /** 目标状态（null 表示已删除，'CURRENT' 表示保持原状态不变） */
  readonly to: AccountHealthState | null | 'CURRENT';
  /** 迁移语义描述 */
  readonly description: string;
}

/**
 * 28 条确定性状态迁移规则表（docs/FLOWS.md §12.2）
 */
export const HEALTH_TRANSITIONS: readonly HealthTransitionRule[] = [
  {
    id: 'T01',
    from: null,
    event: 'credential_saved',
    to: 'never_synced',
    description: '凭据保存成功，进入首次未同步态',
  },
  {
    id: 'T02',
    from: 'never_synced',
    event: 'probe_success',
    to: 'normal',
    description: '首刷成功且解析通过，进入健康正常态',
  },
  {
    id: 'T03',
    from: 'never_synced',
    event: 'network_failure',
    to: 'never_synced',
    description: '首刷网络失败，保持未同步态待重试',
  },
  {
    id: 'T04',
    from: 'never_synced',
    event: 'auth_401',
    to: 'auth_expired',
    description: '首刷 401 且刷新失败，进入凭据失效态',
  },
  {
    id: 'T05',
    from: 'normal',
    event: 'probe_success',
    to: 'normal',
    description: '周期刷新成功，保持健康态',
  },
  {
    id: 'T06',
    from: 'normal',
    event: 'network_failure',
    to: 'offline_stale',
    description: '连续网络失败或数据过期，降级为离线陈旧态',
  },
  {
    id: 'T06_TTL',
    from: 'normal',
    event: 'ttl_expired',
    to: 'offline_stale',
    description: '数据超过 stale_ttl 未刷新，降级为离线陈旧态',
  },
  {
    id: 'T07',
    from: 'normal',
    event: 'auth_401',
    to: 'auth_expired',
    description: '刷新遇 401 且 refresh 失败，进入凭据失效态',
  },
  {
    id: 'T08',
    from: 'normal',
    event: 'rate_limited',
    to: 'rate_limited',
    description: '收到 429 / 命中限流，进入限流熔断态',
  },
  {
    id: 'T09',
    from: 'normal',
    event: 'service_deprecated',
    to: 'service_deprecated',
    description: '收到 403 停服语义，进入接口退役态',
  },
  {
    id: 'T10',
    from: 'normal',
    event: 'parse_degraded',
    to: 'parse_degraded',
    description: '上游 schema 异常或数值越界，进入解析降级态',
  },
  {
    id: 'T11',
    from: 'normal',
    event: 'manual_refresh_401',
    to: 'auth_expired',
    description: '手动刷新触发 401，进入凭据失效态',
  },
  {
    id: 'T12',
    from: 'offline_stale',
    event: 'probe_success',
    to: 'normal',
    description: '离线后重新刷新成功，恢复健康态',
  },
  {
    id: 'T13',
    from: 'offline_stale',
    event: 'auth_401',
    to: 'auth_expired',
    description: '网络恢复后检测到凭据已失效',
  },
  {
    id: 'T14',
    from: 'offline_stale',
    event: 'rate_limited',
    to: 'rate_limited',
    description: '连通后遭遇 429 限流',
  },
  {
    id: 'T15',
    from: 'auth_expired',
    event: 'reauth_success',
    to: 'never_synced',
    description: '用户重新授权成功，进入未同步准备首刷',
  },
  {
    id: 'T16',
    from: 'auth_expired',
    event: 'probe_success',
    to: 'normal',
    description: '静默探测成功（上游已恢复或误判），恢复健康态',
  },
  {
    id: 'T17',
    from: 'auth_expired',
    event: 'rate_limited',
    to: 'rate_limited',
    description: '探测收到 429 限流',
  },
  {
    id: 'T18',
    from: 'rate_limited',
    event: 'probe_success',
    to: 'normal',
    description: '退避冷却到期且探测成功，恢复健康态',
  },
  {
    id: 'T19',
    from: 'rate_limited',
    event: 'auth_401',
    to: 'auth_expired',
    description: '冷却到期探测遇 401 凭据失效',
  },
  {
    id: 'T20',
    from: 'rate_limited',
    event: 'service_deprecated',
    to: 'service_deprecated',
    description: '冷却到期探测发现渠道已停服',
  },
  {
    id: 'T21',
    from: 'service_deprecated',
    event: 'probe_success',
    to: 'normal',
    description: '兜底探测成功（服务恢复或客户端更新），恢复健康态',
  },
  {
    id: 'T22',
    from: 'service_deprecated',
    event: 'network_failure',
    to: 'service_deprecated',
    description: '停服态探测遇网络失败，保持停服态',
  },
  {
    id: 'T23',
    from: 'service_deprecated',
    event: 'auth_401',
    to: 'auth_expired',
    description: '停服态探测凭据失效，优先判定凭据失效',
  },
  {
    id: 'T24',
    from: 'parse_degraded',
    event: 'probe_success',
    to: 'normal',
    description: '数据格式恢复正常，恢复健康态',
  },
  {
    id: 'T25',
    from: 'parse_degraded',
    event: 'auth_401',
    to: 'auth_expired',
    description: '解析降级重试收到 401 凭据失效',
  },
  {
    id: 'T26',
    from: 'parse_degraded',
    event: 'service_deprecated',
    to: 'service_deprecated',
    description: '解析降级重试收到 403 停服',
  },
  {
    id: 'T27',
    from: '*',
    event: 'user_delete',
    to: null,
    description: '用户删除账号，实体移除',
  },
  {
    id: 'T28',
    from: '*',
    event: 'user_toggle_hide',
    to: 'CURRENT',
    description: '用户切换隐藏状态，健康状态保持不变',
  },
];

/**
 * 迁移入参接口
 */
export interface HealthTransitionInput {
  readonly current: AccountHealthState | null;
  readonly event: HealthEvent;
}

/**
 * 查询匹配的状态迁移规则
 *
 * @param current 当前健康状态
 * @param event 触发事件
 * @returns 匹配的规则或 null
 */
export function findTransition(
  current: AccountHealthState | null,
  event: HealthEvent
): HealthTransitionRule | null {
  const eventType: HealthEventType =
    typeof event === 'string' ? event : event.type;

  for (const rule of HEALTH_TRANSITIONS) {
    if (rule.event !== eventType) {
      continue;
    }
    if (rule.from === '*' || rule.from === current) {
      return rule;
    }
  }

  return null;
}

/**
 * 计算下一健康状态 nextState。
 * 支持两种调用形态：
 * 1. `nextState({ current, event })`
 * 2. `nextState(current, event)`
 *
 * 若无定义规则匹配，返回原状态 current。
 *
 * @param inputOrCurrent 迁移入参对象或当前状态
 * @param maybeEvent 当首参为当前状态时的触发事件
 * @returns 下一健康状态（或 null 表示已被删除）
 */
export function nextState(
  inputOrCurrent: HealthTransitionInput | AccountHealthState | null,
  maybeEvent?: HealthEvent
): AccountHealthState | null {
  let current: AccountHealthState | null;
  let event: HealthEvent;

  if (
    inputOrCurrent !== null &&
    typeof inputOrCurrent === 'object' &&
    'current' in inputOrCurrent &&
    'event' in inputOrCurrent
  ) {
    current = inputOrCurrent.current;
    event = inputOrCurrent.event;
  } else {
    current = inputOrCurrent as AccountHealthState | null;
    if (maybeEvent === undefined) {
      return current;
    }
    event = maybeEvent;
  }

  const rule = findTransition(current, event);
  if (!rule) {
    return current;
  }

  if (rule.to === 'CURRENT') {
    return current;
  }

  return rule.to;
}

/**
 * 将不可用诊断原因映射到对应的目标健康状态（docs/ARCHITECTURE.md §3.5 单向函数）
 *
 * @param reason 不可用原因
 * @returns 对应的 AccountHealthState
 */
export function reasonToState(reason: UnavailableReason): AccountHealthState {
  switch (reason) {
    case 'never_fetched':
      return 'never_synced';
    case 'network':
    case 'timeout':
    case 'http_5xx':
    case 'gateway_html':
      return 'offline_stale';
    case 'schema_drift':
      return 'parse_degraded';
    case 'auth_401':
      return 'auth_expired';
    case 'rate_limited':
      return 'rate_limited';
    case 'deprecated':
      return 'service_deprecated';
  }
}
