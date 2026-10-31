/**
 * AI HUD 凭据抽象端口 (Credential Port)
 * 契约规范：docs/ARCHITECTURE.md 第 4 章、第 7 章 Keychain 边界、第 8.4 节 IPC
 *
 * 凭据明文只存在于 OS Keychain 与 Rust 密文域；
 * TS 领域内核与驱动仅持有不透明 CredentialLease 句柄。
 */

import type { EpochMillis, RegionScope } from '../domain/types.js';
import type { HttpRequestSpec } from './http.js';

export type AuthFlowType =
  | 'oauth_pkce'
  | 'device_code'
  | 'manual_token'
  | 'session_cookie'
  | 'cli_session_reuse'
  | 'cli_command';

export interface CredentialLease {
  readonly lease_id: string;
  readonly revision: string;
  readonly expires_at: EpochMillis | null;
  readonly flow: AuthFlowType;
  readonly subject_hint: string | null;
  readonly region: RegionScope;
  readonly extra_headers: Readonly<Record<string, string>>;
}

export interface CredentialPatchField {
  readonly target: 'access_token' | 'refresh_token' | 'expires_at' | 'scopes' | 'id_token';
  readonly from: string;
  readonly transform: 'identity' | 'epoch_ms_from_seconds' | 'epoch_ms_from_now';
}

export interface CredentialPatchSpec {
  readonly fields: readonly CredentialPatchField[];
  readonly store_mode: 'replace' | 'merge';
}

export interface RefreshPlan {
  readonly request: HttpRequestSpec;
  readonly patch: CredentialPatchSpec;
}

export interface RefreshExecutionResult {
  readonly ok: boolean;
  readonly revision: string;
  readonly expires_at: EpochMillis | null;
}

export interface CredentialStore {
  lease(accountId: string): Promise<CredentialLease>;
  executeRefresh(accountId: string, plan: RefreshPlan): Promise<RefreshExecutionResult>;
  revoke(accountId: string): Promise<{ readonly deleted: boolean }>;
}
