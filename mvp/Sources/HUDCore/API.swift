import Foundation

// 公开数据模型（MVP A / MVP B 共用）

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

public enum HUD {
    public static var keychainService: String = "app.aihud.slice"

    public static func accounts() -> [AccountMeta] {
        Store.all().map { AccountMeta(provider: $0.provider, label: $0.label, plan: $0.plan) }
    }

    public static func login(_ provider: String) async throws {
        switch provider {
        case "claude": try await Claude.login()
        case "codex": try await Codex.login()
        case "workbuddy": try await WorkBuddy.login()
        default: throw HTTPError(status: -9, body: "未知渠道 \(provider)")
        }
    }

    /// 三渠道并发取数；单账号失败不影响其他账号
    public static func refreshAll() async -> [AccountReading] {
        let metas = Store.all()
        guard !metas.isEmpty else { return [] }
        return await withTaskGroup(of: (Int, AccountReading).self) { group in
            for (i, m) in metas.enumerated() {
                group.addTask {
                    let r = await Fetch.one(m)
                    let meta = AccountMeta(provider: m.provider, label: m.label, plan: r.plan ?? m.plan)
                    let state: AccountState
                    switch r.status {
                    case let .ok(bars):
                        state = .ok(bars.map {
                            QuotaWindow(label: $0.label, remaining: $0.remaining,
                                        valueText: $0.valueText, resetText: $0.resetText,
                                        resetAt: $0.resetAt, isExpiry: $0.isExpiry)
                        })
                    case let .reauth(x): state = .reauth(x)
                    case let .limited(x): state = .limited(x)
                    case let .unreadable(x): state = .unreadable(x)
                    }
                    return (i, AccountReading(meta: meta, state: state, fetchedAt: r.fetchedAt))
                }
            }
            var out: [(Int, AccountReading)] = []
            for await x in group { out.append(x) }
            return out.sorted { $0.0 < $1.0 }.map(\.1)
        }
    }

    /// 演示数据（不读钥匙串、不联网）：重置时间按“当前时刻 + 偏移”生成，避免出现已过期时间
    public static func demo() -> [AccountReading] {
        let cal = Calendar.current
        let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN")
        func at(_ minutesAhead: Int) -> Date { Date().addingTimeInterval(Double(minutesAhead) * 60) }
        func atDays(_ n: Int) -> Date { Date().addingTimeInterval(Double(n) * 86400) }
        func today(_ minutesAhead: Int) -> String {
            let d = at(minutesAhead)
            f.dateFormat = cal.isDateInToday(d) ? "HH:mm" : "M月d日 HH:mm"
            return (cal.isDateInToday(d) ? "今天 " : "") + f.string(from: d)
        }
        func days(_ n: Int) -> String {
            let d = Date().addingTimeInterval(Double(n) * 86400)
            f.dateFormat = "M月d日 HH:mm"
            return f.string(from: d)
        }
        func dayOnly(_ n: Int) -> String {
            let d = Date().addingTimeInterval(Double(n) * 86400)
            f.dateFormat = "M月d日"
            return f.string(from: d)
        }
        return [
            AccountReading(meta: AccountMeta(provider: "claude", label: "Claude", plan: "Pro"), state: .ok([
                QuotaWindow(label: "5 小时", remaining: 0.52, valueText: "52%", resetText: today(146), resetAt: at(146)),
                QuotaWindow(label: "本周", remaining: 0.82, valueText: "82%", resetText: dayOnly(6), resetAt: atDays(6)),
            ])),
            AccountReading(meta: AccountMeta(provider: "codex", label: "Codex", plan: "Free"), state: .ok([
                QuotaWindow(label: "本周", remaining: 1.0, valueText: "100%", resetText: dayOnly(26), resetAt: atDays(26)),
            ])),
            AccountReading(meta: AccountMeta(provider: "workbuddy", label: "WorkBuddy", plan: "高级版"), state: .ok([
                QuotaWindow(label: "积分", remaining: 0.12, valueText: "1,579 / 13,326", resetText: dayOnly(8) + " 到期"),
            ])),
        ]
    }

    /// 异常状态演示：在 3 个账号后追加一个需要重新授权的账号
    public static func demoIssue() -> [AccountReading] {
        demo() + [AccountReading(meta: AccountMeta(provider: "claude", label: "客户 A 交付", plan: "Pro"),
                                 state: .reauth("需重新授权"))]
    }
}

/// 对外日志（只写方法/主机/状态码/耗时，绝不写凭据）
public enum HUDLog {
    public static func line(_ s: String) { Log.line(s) }
}
