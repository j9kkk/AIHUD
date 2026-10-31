#!/usr/bin/env node
// 组装打包用前端目录：ui/prod/{index.html, styles.css, dist/*.js}
//
// 为什么不直接把 ui/ 当 frontendDist：
//   ui/ 里混着 dev 工具页（index.html 带调试工具栏）、TS 源码、tsconfig，
//   Tauri 会把整个目录塞进 .app/Contents/Resources —— 既多赘又暴露源码。
// 打包只取三样东西：app.html（改名 index.html）、styles.css、编译后的 dist/。

import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = path.join(root, 'ui');
const prod = path.join(ui, 'prod');

async function main() {
  if (!existsSync(path.join(ui, 'dist', 'main.js'))) {
    throw new Error('ui/dist/main.js 不存在，请先运行 tsc -p ui');
  }
  if (!existsSync(path.join(ui, 'app.html'))) {
    throw new Error('ui/app.html 不存在（打包入口）');
  }

  await rm(prod, { recursive: true, force: true });
  await mkdir(path.join(prod, 'dist'), { recursive: true });

  await cp(path.join(ui, 'app.html'), path.join(prod, 'index.html'));
  await cp(path.join(ui, 'styles.css'), path.join(prod, 'styles.css'));

  const files = await readdir(path.join(ui, 'dist'));
  let copied = 0;
  let bytes = 0;
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const from = path.join(ui, 'dist', f);
    await cp(from, path.join(prod, 'dist', f));
    bytes += (await stat(from)).size;
    copied++;
  }

  console.log(`assembled ui/prod: index.html + styles.css + ${copied} js (${(bytes / 1024).toFixed(1)} KiB)`);
}

main().catch((e) => {
  console.error('assemble-ui 失败:', e.message);
  process.exit(1);
});
