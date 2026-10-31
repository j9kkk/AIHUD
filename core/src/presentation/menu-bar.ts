import type {
  AccountSnapshot,
  MenuBarView,
  Tone,
} from '../domain/types.js';
import { colorBand, formatPercent } from '../domain/format.js';

/**
 * 提取单个快照的剩余比例 (0..1)
 * 用于排序与最小值比较；无可用比例时返回 null
 */
export function getSnapshotRemainingRatio(
  snapshot: AccountSnapshot
): number | null {
  if (snapshot.reading === null) {
    return null;
  }
  if (snapshot.reading.kind === 'windows') {
    const windows = snapshot.reading.windows;
    if (windows.length === 0) {
      return null;
    }
    let min: number | null = null;
    for (const w of windows) {
      if (typeof w.remaining_ratio === 'number' && !Number.isNaN(w.remaining_ratio)) {
        if (min === null || w.remaining_ratio < min) {
          min = w.remaining_ratio;
        }
      }
    }
    return min;
  }
  if (snapshot.reading.kind === 'credits') {
    return snapshot.reading.pool.remaining_ratio;
  }
  return null;
}

/**
 * 投影层：将账号快照数组映射为 macOS 菜单栏托盘视图模型 (MenuBarView)
 * 契约规范：docs/ARCHITECTURE.md 第 3.7 / 3.8 章
 *
 * 关键约束：
 * 1. 菜单栏取最小值时只在 state === 'normal' 的账号里取。
 * 2. 没有任何 Normal 账号时 text = null，托盘显示状态字形。
 * 3. 菜单栏文案长度必须严格 <= 12 字符。
 * 4. 零渠道分支，不出现具体渠道名称字面量。
 */
export function toMenuBarView(
  snapshots: readonly AccountSnapshot[]
): MenuBarView {
  if (snapshots.length === 0) {
    return {
      text: null,
      glyph: 'none',
      tone: 'neutral',
      tooltip: '未添加渠道',
    };
  }

  const normalSnapshots = snapshots.filter((s) => s.state === 'normal');

  // 无 Normal 账号时：text 必须为 null，绝不冒充当前值
  if (normalSnapshots.length === 0) {
    let glyph: 'none' | 'stale' | 'auth' | 'rate' | 'deprecated' = 'stale';
    let tone: Tone = 'neutral';

    if (snapshots.some((s) => s.state === 'auth_expired')) {
      glyph = 'auth';
      tone = 'hot';
    } else if (snapshots.some((s) => s.state === 'rate_limited')) {
      glyph = 'rate';
      tone = 'warn';
    } else if (snapshots.some((s) => s.state === 'service_deprecated')) {
      glyph = 'deprecated';
      tone = 'purple';
    } else if (snapshots.every((s) => s.state === 'never_synced')) {
      glyph = 'stale';
      tone = 'neutral';
    }

    const firstSnap = snapshots[0];
    const tooltip = snapshots.length === 1 && firstSnap !== undefined
      ? `${firstSnap.alias} 异常`
      : `${snapshots.length} 个账号异常`;

    return {
      text: null,
      glyph,
      tone,
      tooltip,
    };
  }

  // 存在 Normal 账号：只在 state === 'normal' 的账号中寻找最小剩余
  let minRatio: number | null = null;
  let minSnapshot: AccountSnapshot | null = null;

  for (const s of normalSnapshots) {
    const ratio = getSnapshotRemainingRatio(s);
    if (ratio !== null) {
      if (minRatio === null || ratio < minRatio) {
        minRatio = ratio;
        minSnapshot = s;
      }
    }
  }

  if (minRatio === null || minSnapshot === null) {
    const abnormalCount = snapshots.length - normalSnapshots.length;
    const tooltip = abnormalCount > 0
      ? `全部正常账号无百分比 · ${abnormalCount} 个账号异常`
      : '全部正常账号无百分比';

    return {
      text: null,
      glyph: 'none',
      tone: 'healthy',
      tooltip,
    };
  }

  const pct = formatPercent(minRatio) ?? '0';
  const text = `${pct}%`;
  const safeText = text.length <= 12 ? text : text.slice(0, 12);
  const tone = colorBand(minRatio);
  const abnormalCount = snapshots.length - normalSnapshots.length;

  let tooltip = `${minSnapshot.alias} ${safeText}`;
  if (abnormalCount > 0) {
    tooltip += ` · ${abnormalCount} 个账号异常`;
  }

  return {
    text: safeText,
    glyph: 'none',
    tone,
    tooltip,
  };
}
