import Foundation

// 取数入口：live() 走真实凭据，demo()/demoIssue() 供界面验收。

public enum HUD {
    public static var keychainService: String = "app.aihud.desktop"

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


// 日志：只写方法/域名/状态码/耗时，不写 token 片段。
public enum HUDLog {
    public static func line(_ s: String) { Log.line(s) }
}
