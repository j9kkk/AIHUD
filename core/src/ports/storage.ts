/**
 * AI HUD 存储抽象端口 (Storage Port)
 * 契约规范：docs/ARCHITECTURE.md 第 6.1 节、第 8.4 节 IPC (store.load / store.save)
 *
 * 用于持久化账号快照与调度状态，供进程重启或休眠唤醒后以绝对时刻恢复。
 */

import type { AccountSnapshot } from '../domain/types.js';

export interface StoragePort {
  /**
   * 加载全部已持久化的账号快照
   */
  loadSnapshots(): Promise<readonly AccountSnapshot[]>;

  /**
   * 持久化全量账号快照
   */
  saveSnapshots(snapshots: readonly AccountSnapshot[]): Promise<void>;

  /**
   * 加载持久化的调度器状态（due_at, last_attempt_at 等）
   */
  loadSchedulerState?(): Promise<unknown>;

  /**
   * 保存调度器状态
   */
  saveSchedulerState?(state: unknown): Promise<void>;
}
