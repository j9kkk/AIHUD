/**
 * Codex 渠道读数归一化与模型选择 (Codex Response Normalization & Model Selection)
 * 契约规范：docs/ARCHITECTURE.md（第 5.3 节 codex 模型级窗口）
 */

import type { QuotaWindow, WindowsReading, ReadingQuality } from '../../domain/types.js';

export interface CodexWindowsReading extends WindowsReading {
  readonly primary_windows?: readonly QuotaWindow[];
  readonly extra_windows?: readonly QuotaWindow[];
  readonly extra?: readonly QuotaWindow[];
}

export interface CodexNormalizedOutcome {
  readonly reading: CodexWindowsReading;
  readonly warnings: readonly string[];
}

export interface SelectedModelWindows {
  readonly primary: readonly QuotaWindow[];
  readonly extra: readonly QuotaWindow[];
  readonly model?: string;
  readonly pairWorst?: number;
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'rate_limit',
  'credits',
  'rate_limit_reset_credits',
]);

function clamp01(ratio: number): { ratio: number; clamped: boolean } {
  if (ratio < 0) {
    return { ratio: 0, clamped: true };
  }
  if (ratio > 1) {
    return { ratio: 1, clamped: true };
  }
  return { ratio: +ratio.toFixed(4), clamped: false };
}

/**
 * 格式化窗口时长中文标签。
 * 18000 -> '5 小时窗口'；604800 -> '周窗口'；其余自适应换算。
 */
export function formatWindowDuration(duration_secs: number | null): string {
  if (duration_secs === null) return '配额窗口';
  if (duration_secs === 18000) return '5 小时窗口';
  if (duration_secs === 604800) return '周窗口';
  if (duration_secs % 86400 === 0) return `${duration_secs / 86400} 天窗口`;
  if (duration_secs % 3600 === 0) return `${duration_secs / 3600} 小时窗口`;
  if (duration_secs % 60 === 0) return `${duration_secs / 60} 分钟窗口`;
  return `${duration_secs} 秒窗口`;
}

function parseUnixResetAt(raw: unknown): number | null {
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw <= 0) {
    return null;
  }
  return raw * 1000;
}

/**
 * 模型选择纯函数 (ARCHITECTURE.md §5.3)：
 * 1. 按 scope.model 分组；
 * 2. 每组计算 pairWorst = min(primary.remaining_ratio, secondary.remaining_ratio)；
 * 3. 取 pairWorst 最小的一组（最紧张模型）为主读数 primary；
 * 4. 并列时按模型名升序排序；
 * 5. 其余模型级窗口进入 extra。
 */
export function selectPrimaryWindows(
  windows: readonly QuotaWindow[]
): SelectedModelWindows {
  const modelMap = new Map<string, QuotaWindow[]>();

  for (const w of windows) {
    if (typeof w.scope === 'object' && 'model' in w.scope && w.scope.model) {
      const m = w.scope.model;
      const list = modelMap.get(m) ?? [];
      list.push(w);
      modelMap.set(m, list);
    }
  }

  // 若无模型级窗口，全量为 primary，extra 为空
  if (modelMap.size === 0) {
    return {
      primary: windows,
      extra: [],
    };
  }

  const modelEvaluations: {
    model: string;
    windows: QuotaWindow[];
    pairWorst: number;
  }[] = [];

  for (const [model, mWindows] of modelMap.entries()) {
    const pairWorst = mWindows.reduce(
      (min, cur) => Math.min(min, cur.remaining_ratio),
      1.0
    );
    modelEvaluations.push({
      model,
      windows: mWindows,
      pairWorst,
    });
  }

  // 排序：pairWorst 升序（最紧张居首）；若相同则按模型名字母序
  modelEvaluations.sort((a, b) => {
    if (Math.abs(a.pairWorst - b.pairWorst) > 0.0001) {
      return a.pairWorst - b.pairWorst;
    }
    return a.model.localeCompare(b.model);
  });

  const best = modelEvaluations[0];
  if (!best) {
    return { primary: windows, extra: [] };
  }

  const primary = best.windows;
  const extra: QuotaWindow[] = [];
  for (let i = 1; i < modelEvaluations.length; i++) {
    const entry = modelEvaluations[i];
    if (entry) {
      extra.push(...entry.windows);
    }
  }

  return {
    primary,
    extra,
    model: best.model,
    pairWorst: best.pairWorst,
  };
}

/**
 * 归一化单个 raw window 对象。
 */
function normalizeSingleRawWindow(
  raw: unknown,
  id: string,
  scope: QuotaWindow['scope'],
  sourceField: string
): QuotaWindow | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.used_percent !== 'number' || Number.isNaN(rec.used_percent)) {
    return null;
  }

  const { ratio, clamped } = clamp01(1 - rec.used_percent / 100);
  const duration_secs =
    typeof rec.limit_window_seconds === 'number' && rec.limit_window_seconds > 0
      ? rec.limit_window_seconds
      : null;
  const resets_at = parseUnixResetAt(rec.reset_at);
  const label = formatWindowDuration(duration_secs);
  const quality: ReadingQuality = clamped ? 'clamped' : 'exact';

  return {
    id,
    label,
    scope,
    duration_secs,
    remaining_ratio: ratio,
    amount: null,
    resets_at,
    exhausted: ratio === 0,
    quality,
    source_field: sourceField,
  };
}

/**
 * 归一化 Codex usage API 响应。
 */
export function normalizeCodexResponse(data: unknown): CodexNormalizedOutcome | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }

  const record = data as Record<string, unknown>;
  const warnings: string[] = [];

  for (const key of Object.keys(record)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`Unrecognized top-level field in codex response: "${key}"`);
    }
  }

  const rawRateLimit = record.rate_limit as Record<string, unknown> | undefined;
  if (!rawRateLimit || typeof rawRateLimit !== 'object') {
    return null;
  }

  const rawByModel = rawRateLimit.by_model;
  const modelWindows: QuotaWindow[] = [];

  if (rawByModel) {
    if (Array.isArray(rawByModel)) {
      warnings.push('codex: by_model is array format');
      for (const item of rawByModel) {
        if (typeof item === 'object' && item !== null && typeof item.model === 'string') {
          const m = item.model;
          const pw = normalizeSingleRawWindow(
            item.primary_window,
            `model:${m}:primary`,
            { model: m },
            `rate_limit.by_model.${m}.primary_window.used_percent`
          );
          const sw = normalizeSingleRawWindow(
            item.secondary_window,
            `model:${m}:secondary`,
            { model: m },
            `rate_limit.by_model.${m}.secondary_window.used_percent`
          );
          if (pw) modelWindows.push(pw);
          if (sw) modelWindows.push(sw);
        }
      }
    } else if (typeof rawByModel === 'object') {
      for (const [model, item] of Object.entries(rawByModel as Record<string, unknown>)) {
        if (typeof item === 'object' && item !== null) {
          const mObj = item as Record<string, unknown>;
          const pw = normalizeSingleRawWindow(
            mObj.primary_window,
            `model:${model}:primary`,
            { model },
            `rate_limit.by_model.${model}.primary_window.used_percent`
          );
          const sw = normalizeSingleRawWindow(
            mObj.secondary_window,
            `model:${model}:secondary`,
            { model },
            `rate_limit.by_model.${model}.secondary_window.used_percent`
          );
          if (pw) modelWindows.push(pw);
          if (sw) modelWindows.push(sw);
        }
      }
    }
  }

  let finalWindows: QuotaWindow[];
  let primaryWindows: readonly QuotaWindow[];
  let extraWindows: readonly QuotaWindow[];

  if (modelWindows.length > 0) {
    const selected = selectPrimaryWindows(modelWindows);
    primaryWindows = selected.primary;
    extraWindows = selected.extra;
    finalWindows = [...primaryWindows, ...extraWindows];
  } else {
    // 退化为账号级全局两窗
    const pw = normalizeSingleRawWindow(
      rawRateLimit.primary_window,
      'primary',
      'account',
      'rate_limit.primary_window.used_percent'
    );
    const sw = normalizeSingleRawWindow(
      rawRateLimit.secondary_window,
      'secondary',
      'account',
      'rate_limit.secondary_window.used_percent'
    );

    const accountWindows: QuotaWindow[] = [];
    if (pw) accountWindows.push(pw);
    if (sw) accountWindows.push(sw);

    primaryWindows = accountWindows;
    extraWindows = [];
    finalWindows = accountWindows;
  }

  if (finalWindows.length === 0) {
    return null;
  }

  // credits 与 重置券
  let credits_balance: number | null = null;
  if (record.credits && typeof record.credits === 'object') {
    const rawCredits = record.credits as Record<string, unknown>;
    if (typeof rawCredits.balance === 'number' && !Number.isNaN(rawCredits.balance)) {
      credits_balance = rawCredits.balance;
    }
  }

  let reset_credits: number | null = null;
  if (
    record.rate_limit_reset_credits &&
    typeof record.rate_limit_reset_credits === 'object'
  ) {
    const rawResets = record.rate_limit_reset_credits as Record<string, unknown>;
    if (
      typeof rawResets.available_count === 'number' &&
      !Number.isNaN(rawResets.available_count)
    ) {
      reset_credits = rawResets.available_count;
    }
  }

  const reading: CodexWindowsReading = {
    kind: 'windows',
    windows: finalWindows,
    extra_usage_cents: null,
    credits_balance,
    reset_credits,
    primary_windows: primaryWindows,
    extra_windows: extraWindows,
    extra: extraWindows,
  };

  return {
    reading,
    warnings,
  };
}
