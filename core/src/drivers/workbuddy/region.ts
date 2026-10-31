/**
 * WorkBuddy 站点路由与区域解析 (Region Routing)
 * 契约规范：docs/ARCHITECTURE.md 第 5.4 节
 *
 * 核心规则：
 * 1. region ∈ {cn, global, intl}；
 * 2. 域名决定 region：
 *    - workbuddy.cn / codebuddy.cn -> cn（国内站）
 *    - workbuddy.ai -> global / intl（国际站）
 * 3. region 决定目标基址：
 *    - cn -> https://workbuddy.cn
 *    - global / intl -> https://workbuddy.ai
 * 4. 账号 region 与凭据 region 必须严格匹配，错配直接触发 region_mismatch。
 */

import type { RegionScope } from '../../domain/types.js';

export const WORKBUDDY_CN_HOSTS = ['https://workbuddy.cn', 'https://codebuddy.cn'] as const;
export const WORKBUDDY_INTL_HOSTS = ['https://workbuddy.ai'] as const;

export const WORKBUDDY_DEFAULT_CN_HOST = 'https://workbuddy.cn';
export const WORKBUDDY_DEFAULT_INTL_HOST = 'https://workbuddy.ai';

export interface RegionRouter {
  /** 根据 region 解析请求的主机基址 */
  resolve(region: RegionScope): string;
  /** 根据域名或 URL 自动推断所属站点 region */
  detectRegion(domainOrUrl: string): RegionScope;
  /** 判断账号站点与凭据站点是否兼容匹配 */
  isMatch(accountRegion: RegionScope, leaseRegion: RegionScope): boolean;
}

export class WorkBuddyRegionRouter implements RegionRouter {
  /**
   * 将 region 解析为目标服务基地址
   */
  resolve(region: RegionScope): string {
    if (region === 'cn') {
      return WORKBUDDY_DEFAULT_CN_HOST;
    }
    if (region === 'global' || region === 'intl') {
      return WORKBUDDY_DEFAULT_INTL_HOST;
    }
    throw new Error(`Unknown region scope for workbuddy: ${region}`);
  }

  /**
   * 根据域名或完整 URL 判定站点 region
   */
  detectRegion(domainOrUrl: string): RegionScope {
    const raw = domainOrUrl.trim().toLowerCase();
    // 提取 hostname
    let host = raw;
    try {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        host = new URL(raw).hostname;
      } else {
        // 去除 path 和 port
        host = raw.split('/')[0]?.split(':')[0] ?? raw;
      }
    } catch {
      host = raw.split('/')[0]?.split(':')[0] ?? raw;
    }

    if (host.includes('workbuddy.cn') || host.includes('codebuddy.cn')) {
      return 'cn';
    }
    if (host.includes('workbuddy.ai')) {
      return 'global';
    }

    // 默认兜底按域名后缀分析
    if (host.endsWith('.cn')) {
      return 'cn';
    }

    return 'global';
  }

  /**
   * 检查两端 region 是否一致（intl 与 global 均视为国际站）
   */
  isMatch(accountRegion: RegionScope, leaseRegion: RegionScope): boolean {
    if (accountRegion === 'cn') {
      return leaseRegion === 'cn';
    }
    // 国际站支持 'global' 或 'intl'
    return leaseRegion === 'global' || leaseRegion === 'intl';
  }
}

export const defaultRegionRouter = new WorkBuddyRegionRouter();
