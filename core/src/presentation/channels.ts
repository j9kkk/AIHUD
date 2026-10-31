import type {
  AccountSnapshot,
  AccountCardView,
  ChannelGroup,
  ProviderKind,
  Tone,
} from '../domain/types.js';
import { colorBand, formatPercent } from '../domain/format.js';
import { toCardView } from './card.js';
import { getSnapshotRemainingRatio } from './menu-bar.js';

export interface ChannelGroupOptions {
  /** 每页卡片数量，默认 8（2 行 × 4 格） */
  readonly pageSize?: number;
  /** 每渠道选中的页码（0-indexed） */
  readonly pages?: Record<string, number>;
  /** 当前基准时间戳（毫秒） */
  readonly now?: number;
  /** 可选的渠道展示名称映射 */
  readonly providerLabels?: Record<string, string>;
}

/**
 * 格式化渠道展示标签（纯算法规则，零渠道硬编码）
 */
export function formatChannelLabel(
  provider: string,
  providerLabels?: Record<string, string>
): string {
  if (providerLabels && providerLabels[provider]) {
    return providerLabels[provider];
  }
  if (provider.startsWith('custom.')) {
    const name = provider.slice(7);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * 投影层：将账号快照数组按渠道分组、组内按剩余比例升序排序、每渠道分页
 * 契约规范：docs/ARCHITECTURE.md 第 3.7 章
 *
 * 关键约束：
 * 1. 按渠道 (provider) 分组。
 * 2. 组内剩余升序排序，null（无读数或未提供比例）排在最后。
 * 3. 每渠道独立分页，默认 8 卡/页（2 行 × 4 格）。
 * 4. 计算渠道内 worst 读数（仅在存在有效数值时产出）。
 * 5. 零具体渠道分支与字面量。
 */
export function toChannelGroups(
  snapshots: readonly AccountSnapshot[],
  options?: ChannelGroupOptions
): ChannelGroup[] {
  const pageSize = options?.pageSize ?? 8;
  const now = options?.now ?? Date.now();
  const pageMap = options?.pages ?? {};

  // 0. 隐藏账号不进入任何可见分组（I12）；轮询与通知不受影响
  const visible = snapshots.filter((s) => s.hidden !== true);

  // 1. 按 provider 归类
  const groupsMap = new Map<ProviderKind, AccountSnapshot[]>();
  for (const s of visible) {
    let list = groupsMap.get(s.provider);
    if (!list) {
      list = [];
      groupsMap.set(s.provider, list);
    }
    list.push(s);
  }

  const result: ChannelGroup[] = [];

  for (const [provider, rawGroup] of groupsMap.entries()) {
    // 2. 组内排序：剩余升序，null 排在最后
    const sortedSnapshots = [...rawGroup].sort((a, b) => {
      const ratioA = getSnapshotRemainingRatio(a);
      const ratioB = getSnapshotRemainingRatio(b);
      if (ratioA === null && ratioB === null) return 0;
      if (ratioA === null) return 1; // null 排最后
      if (ratioB === null) return -1; // null 排最后
      return ratioA - ratioB;
    });

    // 3. 映射卡片视图
    const allCards: AccountCardView[] = sortedSnapshots.map((snap) =>
      toCardView(snap, now)
    );

    // 4. 计算 worst（最紧张的账号）
    let worst: { readonly account_id: string; readonly text: string; readonly tone: Tone } | null = null;
    const firstSnap = sortedSnapshots[0];
    if (firstSnap !== undefined) {
      const firstRatio = getSnapshotRemainingRatio(firstSnap);
      if (firstRatio !== null) {
        const pct = formatPercent(firstRatio) ?? '0';
        worst = {
          account_id: firstSnap.account_id,
          text: `最少 ${pct}%`,
          tone: colorBand(firstRatio),
        };
      }
    }

    // 5. 分页处理（每渠道 2 行 × 4 格 = 8 / 页）
    const total = allCards.length;
    const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
    const requestedPage = pageMap[provider] ?? 0;
    const pageIndex = pageCount > 0 ? Math.max(0, Math.min(requestedPage, pageCount - 1)) : 0;
    const startIndex = pageIndex * pageSize;
    const pagedCards = allCards.slice(startIndex, startIndex + pageSize);

    result.push({
      provider,
      label: formatChannelLabel(provider, options?.providerLabels),
      accounts: pagedCards,
      worst,
      page: {
        index: pageIndex,
        count: pageCount,
      },
    });
  }

  return result;
}

export const groupChannels = toChannelGroups;
