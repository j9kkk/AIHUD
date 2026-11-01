import Foundation

// 领域模型：账号元信息、额度窗口、账号状态、读取结果。
// 约定：非 normal 状态没有百分比，`remaining` 只在 .ok 里有意义。

public struct AccountMeta: Sendable {
    public var provider: String      // claude / codex / workbuddy
    public var label: String         // 脱敏邮箱或昵称
    public var plan: String?
    public init(provider: String, label: String, plan: String?) {
        self.provider = provider; self.label = label; self.plan = plan
    }
    public var providerName: String {
        switch provider {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "workbuddy": return "WorkBuddy"
        default: return provider
        }
    }
}

public struct QuotaWindow: Sendable {
    public var label: String         // 「5 小时」「本周」「积分」
    public var remaining: Double     // 0...1
    public var valueText: String     // 「52%」或「1,579 / 13,326」
    public var resetText: String?    // 「今天 02:30」「11月9日 到期」
    public var resetAt: Date?        // 重置时刻；能拿到就用它算倒计时，不要解析字符串
    public var isExpiry: Bool        // 积分类：resetAt 表示「到期」而不是「重置」
    public init(label: String, remaining: Double, valueText: String,
                resetText: String?, resetAt: Date? = nil, isExpiry: Bool = false) {
        self.label = label; self.remaining = remaining
        self.valueText = valueText; self.resetText = resetText
        self.resetAt = resetAt; self.isExpiry = isExpiry
    }
    public var isLow: Bool { remaining < 0.2 }
}

public enum AccountState: Sendable {
    case ok([QuotaWindow])
    case reauth(String)
    case limited(String)
    case unreadable(String)
}

public struct AccountReading: Sendable {
    public var meta: AccountMeta
    public var state: AccountState
    public var fetchedAt: Date
    public init(meta: AccountMeta, state: AccountState, fetchedAt: Date = Date()) {
        self.meta = meta; self.state = state; self.fetchedAt = fetchedAt
    }
    /// 该账号最紧张的窗口（用于圆环/模块主数值）
    public var tightest: QuotaWindow? {
        if case let .ok(ws) = state { return ws.min { $0.remaining < $1.remaining } }
        return nil
    }
    public var needsAttention: Bool {
        switch state {
        case .reauth, .limited: return true
        case let .ok(ws): return ws.contains { $0.isLow }
        case .unreadable: return false
        }
    }
    /// 积分制账号（无重置时间）
    public var isCredits: Bool {
        if case let .ok(ws) = state { return ws.allSatisfy { $0.resetText == nil } }
        return false
    }
}

// 对外接口：登录 / 取数 / 账号列表
