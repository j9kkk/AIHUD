/**
 * AI HUD 时钟抽象端口 (Clock Port)
 * 契约规范：docs/ARCHITECTURE.md 第 4.2 节、第 8.4 节
 *
 * 领域内核与驱动不直接调用 Date.now() / setTimeout，统一由 Clock 注入，
 * 支持测试环境使用确定性假时钟（FakeTimers）。
 */

import type { EpochMillis } from '../domain/types.js';

export interface Clock {
  /**
   * 获取当前绝对毫秒时间戳（Unix 纪元 UTC 毫秒）
   */
  now(): EpochMillis;
}
