/**
 * AI HUD 系统通知抽象端口 (Notifier Port)
 * 契约规范：docs/ARCHITECTURE.md 第 6.6 节、第 8.4 节 IPC (notify.post)
 *
 * 投递前内容已由领域层完成脱敏（零 token、零邮箱明文、零组织名）。
 */

export interface NotificationPayload {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface NotificationResult {
  readonly delivered: boolean;
}

export interface Notifier {
  post(payload: NotificationPayload): Promise<NotificationResult>;
}
