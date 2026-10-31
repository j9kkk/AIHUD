import type {
  AccountSnapshot,
  AccountCardView,
  CardRingView,
  PrimarySlotView,
  CardActionView,
  RingArc,
  Tone,
  QuotaWindow,
} from '../domain/types.js';
import {
  colorBand,
  formatPercent,
  formatAbsolute,
  formatCountdown,
} from '../domain/format.js';
import { assertCardViewInvariants } from '../domain/invariants.js';

const TONE_COLORS: Record<Tone, string> = {
  healthy: '#30D158',
  warn: '#FFD60A',
  hot: '#FF453A',
  purple: '#BF5AF2',
  neutral: '#8E8E93',
};

const TONE_TRACK_COLORS: Record<Tone, string> = {
  healthy: 'rgba(48, 209, 88, 0.2)',
  warn: 'rgba(255, 214, 10, 0.2)',
  hot: 'rgba(255, 69, 58, 0.2)',
  purple: 'rgba(191, 90, 242, 0.2)',
  neutral: 'rgba(142, 142, 147, 0.2)',
};

function formatHistoryTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function createRingArc(ratio: number, circumference: number): RingArc {
  const clamped = Math.max(0, Math.min(1, ratio));
  const tone = colorBand(clamped);
  const arcLength = +(clamped * circumference).toFixed(2);
  return {
    ratio: clamped,
    dash: `${arcLength} ${circumference.toFixed(2)}`,
    cap_color: TONE_COLORS[tone],
    track_color: TONE_TRACK_COLORS[tone],
    glow: clamped < 0.20,
  };
}

/**
 * 投影层：将账号快照 (AccountSnapshot) 映射为卡片视图模型 (AccountCardView)
 * 契约规范：docs/ARCHITECTURE.md 第 3.8 章
 *
 * 硬规则约束：
 * 1. 只有 state === 'normal' 展示百分比；非 normal 状态 primary_slot.kind 严禁为 'percent'。
 * 2. 禁止把读不到渲染成 0%/100%；reading === null 时输出状态槽，绝不出现 0 或 100。
 * 6. 环编码剩余，使用 colorBand 映射健康色阶。
 */
export function toCardView(
  snapshot: AccountSnapshot,
  now: number = Date.now()
): AccountCardView {
  const account_id = snapshot.account_id;
  const alias = snapshot.alias;
  const plan_name = snapshot.plan_name;
  const visual_kind = snapshot.visual_kind;

  // 1. reading === null 分支：绝不出 0 或 100，输出状态槽
  if (snapshot.reading === null) {
    const view: AccountCardView = {
      account_id,
      alias,
      plan_name,
      visual_kind,
      ring: {
        mode: 'unknown',
        outer: null,
        inner: null,
        center_text: '?',
        center_tone: 'neutral',
      },
      primary_slot: {
        kind: 'status',
        text: '尚未同步',
        tone: 'neutral',
        glyph: '?',
      },
      history_slot: null,
      reset_text: null,
      action: {
        kind: 'retry',
        label: '立即重试',
      },
      dimmed: true,
    };
    assertCardViewInvariants(view, snapshot.state);
    return view;
  }

  // 2. 存在 reading 的情况
  const reading = snapshot.reading;
  let primaryRatio: number | null = null;
  let primaryWindow: QuotaWindow | null = null;
  let outerRatio: number | null = null;
  let innerRatio: number | null = null;
  let resetsAt: number | null = null;

  if (reading.kind === 'windows') {
    const windows = reading.windows;
    const firstW = windows[0];
    if (firstW !== undefined) {
      let minW: QuotaWindow = firstW;
      for (let i = 1; i < windows.length; i++) {
        const currentW = windows[i];
        if (currentW !== undefined && currentW.remaining_ratio < minW.remaining_ratio) {
          minW = currentW;
        }
      }
      primaryWindow = minW;
      primaryRatio = minW.remaining_ratio;
      resetsAt = minW.resets_at;

      outerRatio = firstW.remaining_ratio;
      const secondW = windows[1];
      if (secondW !== undefined) {
        innerRatio = secondW.remaining_ratio;
      }
    }
  } else if (reading.kind === 'credits') {
    primaryRatio = reading.pool.remaining_ratio;
    outerRatio = primaryRatio;
    resetsAt = reading.pool.expires_at;
  }

  // 3. 正常态 (normal) 投影
  if (snapshot.state === 'normal') {
    let ring: CardRingView;
    let primary_slot: PrimarySlotView;

    if (reading.kind === 'credits' && primaryRatio === null) {
      // 积分池无总额，不画环比例，显示绝对值
      ring = {
        mode: 'value',
        outer: null,
        inner: null,
        center_text: '—',
        center_tone: 'neutral',
      };
      primary_slot = {
        kind: 'absolute',
        text: formatAbsolute(reading.pool.remaining) ?? '0',
      };
    } else {
      const ratio = primaryRatio ?? 0;
      const pct = formatPercent(ratio) ?? '0';
      const tone = colorBand(ratio);

      let outerArc: RingArc | null = null;
      let innerArc: RingArc | null = null;

      if (visual_kind === 'dual_sliding_window') {
        outerArc = createRingArc(outerRatio ?? ratio, 142.0);
        innerArc = createRingArc(innerRatio ?? ratio, 103.0);
      } else {
        outerArc = createRingArc(outerRatio ?? ratio, 127.6);
        innerArc = null;
      }

      ring = {
        mode: 'value',
        outer: outerArc,
        inner: innerArc,
        center_text: `${pct}%`,
        center_tone: tone,
      };

      primary_slot = {
        kind: 'percent',
        text: `${pct}%`,
        tone,
      };
    }

    let reset_text: string | null = null;
    if (resetsAt !== null && resetsAt > now) {
      const cd = formatCountdown(resetsAt, now);
      if (cd && cd !== '已复位') {
        reset_text = `恢 ${cd}`;
      }
    }

    const view: AccountCardView = {
      account_id,
      alias,
      plan_name,
      visual_kind,
      ring,
      primary_slot,
      history_slot: null,
      reset_text,
      action: {
        kind: 'none',
        label: null,
      },
      dimmed: false,
    };
    assertCardViewInvariants(view, snapshot.state);
    return view;
  }

  // 4. 非正常态 (state !== 'normal') 投影
  // 必须降饱和，严禁 primary_slot.kind === 'percent'
  let historyValueText = '—';
  if (primaryRatio !== null) {
    historyValueText = `${formatPercent(primaryRatio)}%`;
  } else if (reading.kind === 'credits') {
    historyValueText = formatAbsolute(reading.pool.remaining) ?? '—';
  }

  const observedAt = snapshot.reading_observed_at ?? snapshot.last_success_at;
  const timeStr = observedAt !== null ? formatHistoryTime(observedAt) : '';
  const historyText = timeStr ? `最后 ${historyValueText} · ${timeStr}` : `最后 ${historyValueText}`;
  const history_slot = { text: historyText };

  let ringMode: 'unknown' | 'deprecated' = 'unknown';
  let centerText = '?';
  let centerTone: Tone = 'neutral';
  let primary_slot: PrimarySlotView;
  let action: CardActionView;

  switch (snapshot.state) {
    case 'offline_stale':
      ringMode = 'unknown';
      centerText = '?';
      centerTone = 'neutral';
      primary_slot = {
        kind: 'status',
        text: '离线',
        tone: 'neutral',
        glyph: '?',
      };
      action = {
        kind: 'retry',
        label: '立即重试',
      };
      break;

    case 'auth_expired':
      ringMode = 'unknown';
      centerText = '!';
      centerTone = 'hot';
      primary_slot = {
        kind: 'status',
        text: '凭据失效',
        tone: 'hot',
        glyph: '!',
      };
      action = {
        kind: 'reauth',
        label: '重新授权',
      };
      break;

    case 'rate_limited': {
      ringMode = 'unknown';
      centerText = '⏱';
      centerTone = 'warn';
      let statusText = '限流中';
      if (snapshot.retry_at !== null && snapshot.retry_at > now) {
        const cd = formatCountdown(snapshot.retry_at, now);
        if (cd && cd !== '已复位') {
          statusText = `限流 ${cd}`;
        }
      }
      primary_slot = {
        kind: 'status',
        text: statusText,
        tone: 'warn',
        glyph: '⏱',
      };
      action = {
        kind: 'none',
        label: null,
      };
      break;
    }

    case 'service_deprecated':
      ringMode = 'deprecated';
      centerText = '—';
      centerTone = 'purple';
      primary_slot = {
        kind: 'status',
        text: '接口已停服',
        tone: 'purple',
        glyph: '—',
      };
      action = {
        kind: 'migrate',
        label: '迁移指南',
      };
      break;

    case 'parse_degraded':
      ringMode = 'unknown';
      centerText = '—';
      centerTone = 'warn';
      primary_slot = {
        kind: 'status',
        text: '数据格式异常',
        tone: 'warn',
        glyph: '⚠',
      };
      action = {
        kind: 'retry',
        label: '立即重试',
      };
      break;

    case 'never_synced':
    default:
      ringMode = 'unknown';
      centerText = '?';
      centerTone = 'neutral';
      primary_slot = {
        kind: 'status',
        text: '尚未同步',
        tone: 'neutral',
        glyph: '?',
      };
      action = {
        kind: 'retry',
        label: '立即重试',
      };
      break;
  }

  const view: AccountCardView = {
    account_id,
    alias,
    plan_name,
    visual_kind,
    ring: {
      mode: ringMode,
      outer: null,
      inner: null,
      center_text: centerText,
      center_tone: centerTone,
    },
    primary_slot,
    history_slot,
    reset_text: null,
    action,
    dimmed: true,
  };

  assertCardViewInvariants(view, snapshot.state);
  return view;
}
