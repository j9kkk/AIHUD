import type {
  AccountSnapshot,
  HudViewModel,
  ProviderKind,
} from './domain/types.js';
import { toMenuBarView } from './presentation/menu-bar.js';
import { toChannelGroups } from './presentation/channels.js';

export interface DriverRegistryPort {
  get(provider: ProviderKind): unknown;
  list(): readonly unknown[];
  assert_ready?(): readonly unknown[];
}

export interface PollerPort {
  tick(): Promise<void> | void;
  start?(): void;
  stop?(): void;
}

export type IpcHandler = (payload?: unknown) => Promise<unknown> | unknown;

export interface IpcPort {
  on(event: string, handler: IpcHandler): void;
  emit?(event: string, payload?: unknown): void;
  send(command: string, payload?: unknown): Promise<unknown> | unknown;
}

export interface StoragePort {
  loadSnapshots(): Promise<readonly AccountSnapshot[]> | readonly AccountSnapshot[];
  saveSnapshots?(snapshots: readonly AccountSnapshot[]): Promise<void> | void;
}

export interface BootstrapDeps {
  readonly registry: DriverRegistryPort;
  readonly poller: PollerPort;
  readonly ipc: IpcPort;
  readonly storage?: StoragePort;
  readonly now?: () => number;
}

export interface AppKernel {
  readonly deps: BootstrapDeps;
  readonly tick: () => Promise<void>;
  readonly getViewModel: () => Promise<HudViewModel>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

/**
 * 核心内核装配函数 (Bootstrap Assembly)
 * 契约规范：docs/ARCHITECTURE.md 第 8.2 / 8.4 章
 *
 * 核心原则：
 * 1. 严格依赖注入（DI），不 new 任何具体渠道驱动或调度器实现。
 * 2. 组装 DriverRegistry + Poller + IPC 绑定。
 * 3. 注册 core.tick、system.wake 等系统级事件，将最新视图模型推送到托盘 (tray.set_view)。
 */
export function bootstrap(deps: BootstrapDeps): AppKernel {
  const nowFn = deps.now ?? (() => Date.now());

  async function getSnapshots(): Promise<readonly AccountSnapshot[]> {
    if (deps.storage) {
      return await deps.storage.loadSnapshots();
    }
    return [];
  }

  async function getViewModel(): Promise<HudViewModel> {
    const snapshots = await getSnapshots();
    const now = nowFn();
    const menu_bar = toMenuBarView(snapshots);
    const channels = toChannelGroups(snapshots, { now });

    let lastRefresh: number | null = null;
    let abnormalCount = 0;
    for (const s of snapshots) {
      if (s.state !== 'normal') {
        abnormalCount++;
      }
      if (s.last_success_at !== null) {
        if (lastRefresh === null || s.last_success_at > lastRefresh) {
          lastRefresh = s.last_success_at;
        }
      }
    }

    return {
      menu_bar,
      channels,
      footer: {
        last_refresh_at: lastRefresh,
        abnormal_count: abnormalCount,
      },
    };
  }

  async function tick(): Promise<void> {
    await deps.poller.tick();
    const vm = await getViewModel();
    await deps.ipc.send('tray.set_view', vm.menu_bar);
  }

  // 绑定系统事件与 IPC 响应
  deps.ipc.on('core.tick', async () => {
    await tick();
  });

  deps.ipc.on('system.wake', async () => {
    await tick();
  });

  deps.ipc.on('get_view_model', async () => {
    return await getViewModel();
  });

  return {
    deps,
    tick,
    getViewModel,
    start: async () => {
      if (deps.poller.start) {
        deps.poller.start();
      }
      // 启动时初始化托盘视图
      const vm = await getViewModel();
      await deps.ipc.send('tray.set_view', vm.menu_bar);
    },
    stop: async () => {
      if (deps.poller.stop) {
        deps.poller.stop();
      }
    },
  };
}
