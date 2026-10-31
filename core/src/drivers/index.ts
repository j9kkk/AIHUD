/**
 * AI HUD 驱动唯一装配点 (Driver Assembly Point)
 * 契约规范：docs/ARCHITECTURE.md 第 4.5 节装配表
 *
 * 核心职责：
 * 1. 统一暴露 ChannelDriver、DriverRegistry、WorkBuddyDriver、GeminiDriver 及对应类型；
 * 2. 导出驱动构造工厂与默认注册表组装入口。
 */

export * from './driver.js';
export * from './registry.js';
export * from './claude/index.js';
export * from './codex/index.js';
export * from './workbuddy/index.js';
export * from './gemini/index.js';
export * from './custom/config.js';
export * from './custom/normalize.js';
export { CustomChannelDriver, CustomConfigError, createCustomDriver, CUSTOM_POLL_POLICY } from './custom/driver.js';

import type { ChannelDriver } from './driver.js';
import { DriverRegistry } from './registry.js';
import { createClaudeDriver } from './claude/index.js';
import { createCodexDriver } from './codex/index.js';
import { createWorkBuddyDriver } from './workbuddy/driver.js';
import { createGeminiDriver } from './gemini/driver.js';
import { createCustomDriver } from './custom/driver.js';
import type { CustomChannelConfig } from './custom/config.js';

export interface DriverAssemblyOptions {
  /** 显式指定全部驱动列表（包含测试环境或第三方插件驱动） */
  readonly drivers?: readonly ChannelDriver[];
  /** 自定义 workbuddy 驱动实例 */
  readonly workbuddy?: ChannelDriver;
  /** 自定义 gemini 驱动实例 */
  readonly gemini?: ChannelDriver;
  /** 自定义 claude 驱动实例 */
  readonly claude?: ChannelDriver;
  /** 自定义 codex 驱动实例 */
  readonly codex?: ChannelDriver;
  /** 用户配置的自定义渠道（S04）；每个配置项独立成一个驱动 */
  readonly customs?: readonly CustomChannelConfig[];
}

/**
 * 创建并装配驱动注册表
 *
 * @param options 装配选项，支持传入显式驱动列表或按渠道注入
 * @returns 构造完成并经严格校验的 DriverRegistry
 */
export function createDefaultRegistry(options?: DriverAssemblyOptions): DriverRegistry {
  if (options?.drivers) {
    return new DriverRegistry(options.drivers);
  }

  // 顺序即 list() 之外的兜底顺序；DriverRegistry.list() 内部仍按内置顺序稳定排序
  const list: ChannelDriver[] = [
    options?.claude ?? createClaudeDriver(),
    options?.codex ?? createCodexDriver(),
    options?.workbuddy ?? createWorkBuddyDriver(),
    options?.gemini ?? createGeminiDriver(),
  ];

  for (const cfg of options?.customs ?? []) {
    list.push(createCustomDriver(cfg));
  }

  return new DriverRegistry(list);
}
