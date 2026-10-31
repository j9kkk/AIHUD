#!/usr/bin/env node
/**
 * 令牌级对比度与字号扫描（不依赖浏览器）。
 *
 * 口径说明：这里检查的是 **CSS 令牌声明层**——把 styles.css 里声明的
 * 文本色与卡片底色配对后计算 WCAG 对比度，并检查所有 font-size 声明
 * 是否低于 9.5px。渲染态（材质叠加、壁纸透出）的对比度必须在 macOS
 * 实机复测，脚本会明确打印这条限制。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (['node_modules', 'dist', 'target', '.worktrees', '.git'].includes(name)) continue;
      walk(p, out);
    } else if (/\.(css|html)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, 'ui'));
const css = files.map((f) => readFileSync(f, 'utf8')).join('\n');

const vars = {};
for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) vars[m[1]] = m[2].trim();

function toRgb(value) {
  if (!value) return null;
  const v = value.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = v.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  m = v.match(/var\(--([a-z0-9-]+)\)/i);
  if (m) return toRgb(vars[m[1]]);
  return null;
}

const lum = (c) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const ratio = (a, b) => {
  const L1 = lum(a), L2 = lum(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};

// 语义配对：文本令牌 × 两个最常用底色
const panel = toRgb(vars['panel-bg'] || vars['bg'] || '#0b0e14') || { r: 11, g: 14, b: 20, a: 1 };
const card = toRgb(vars['card-fill'] || 'rgba(255,255,255,0.06)');
const cardBg = card
  ? {
      r: panel.r + (255 - panel.r) * card.a,
      g: panel.g + (255 - panel.g) * card.a,
      b: panel.b + (255 - panel.b) * card.a,
      a: 1,
    }
  : panel;

const textTokens = Object.keys(vars).filter((k) =>
  /(fg|text|label|muted|dim|gray|ink)/.test(k) && !/bg|fill|shadow|border/.test(k)
);

const rows = [];
let fail = 0;
for (const k of textTokens) {
  const c = toRgb(vars[k]);
  if (!c || c.a < 0.5) continue;
  const r1 = ratio(c, panel);
  const r2 = ratio(c, cardBg);
  const worst = Math.min(r1, r2);
  const ok = worst >= 4.5;
  if (!ok) fail++;
  rows.push({ token: `--${k}`, worst: +worst.toFixed(2), ok });
}

// 字号下限
const tooSmall = [];
for (const m of css.matchAll(/font-size\s*:\s*([0-9.]+)(px|pt|rem)/gi)) {
  let px = parseFloat(m[1]);
  if (m[2] === 'pt') px *= 4 / 3;
  if (m[2] === 'rem') px *= 16;
  if (px < 9.5) tooSmall.push(`${m[0]} (${px.toFixed(1)}px)`);
}

console.log('令牌对比度（最差方向：面板 / 卡片底）');
for (const r of rows.sort((a, b) => a.worst - b.worst).slice(0, 12)) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.token.padEnd(22)} ${String(r.worst).padStart(5)}:1`);
}
console.log(`\n低于 4.5:1 的文本令牌：${fail} 个`);
console.log(`低于 9.5px 的字号声明：${tooSmall.length} 处${tooSmall.length ? ' → ' + tooSmall.slice(0, 5).join(', ') : ''}`);
console.log('\n注意：本脚本只审计 CSS 令牌层。材质叠加、壁纸透出、Increase Contrast 下的真实对比度');
console.log('      必须在 macOS 实机用截图取样复测（见 docs/VERIFY.md「未验证项」）。');

process.exit(fail === 0 && tooSmall.length === 0 ? 0 : 1);
