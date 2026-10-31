/**
 * AI HUD HTTP 传输抽象端口 (HTTP Transport Port)
 * 契约规范：docs/ARCHITECTURE.md 第 4.2 节、第 8.4 节
 *
 * 驱动不直接发起真实网络请求，必须通过调用方注入的 HttpTransport 客户端。
 * 跨 IPC 时由 Rust 壳校验 allowed_origins 白名单与 headers 禁写。
 */

export type AuthSpec =
  | 'lease'
  | {
      readonly kind: 'bearer' | 'header' | 'cookie' | 'bearer_refresh';
      readonly header_name?: string;
    };

export interface HttpRequestSpec {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly auth: AuthSpec;
  readonly body?: string;
  readonly timeout_ms: number;
  readonly max_body_bytes: number;
}

export interface HttpReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body_text: string;
  readonly truncated: boolean;
  readonly duration_ms: number;
}

export interface HttpTransport {
  request(spec: HttpRequestSpec): Promise<HttpReply>;
}

export type AuthBoundHttp = HttpTransport;
