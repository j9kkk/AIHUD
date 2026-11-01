import Foundation

// Fetch 渠道：授权与额度读取。

enum Fetch {
    static func one(_ m: Meta) async -> Reading {
        let base = Reading(provider: m.provider, label: m.label, plan: m.plan, status: .unreadable(""), fetchedAt: Date())
        guard var cred = Vault.load(m.provider) else {
            var r = base; r.status = .reauth("钥匙串里没有凭据"); return r
        }
        let refresh: (Cred) async throws -> Cred
        let usage: (Cred) async throws -> (bars: [Bar], plan: String?)
        switch m.provider {
        case "claude": refresh = Claude.refresh; usage = Claude.usage
        case "codex": refresh = Codex.refresh; usage = Codex.usage
        default: refresh = WorkBuddy.refresh; usage = WorkBuddy.usage
        }
        var r = base
        do {
            if let exp = cred.expiresAt, exp < Date().timeIntervalSince1970 + 60 {
                cred = try await refresh(cred)
            }
            let out: (bars: [Bar], plan: String?)
            do {
                out = try await usage(cred)
            } catch let e as HTTPError where e.status == 401 {
                cred = try await refresh(cred)
                out = try await usage(cred)
            }
            r.status = .ok(out.bars)
            r.plan = out.plan ?? m.plan
        } catch let e as HTTPError {
            switch e.status {
            case 401, 403, 400: r.status = .reauth("需重新授权")
            case 429: r.status = .limited("限流中")
            default: r.status = .unreadable("读不到（\(e.status <= 0 ? e.body : "HTTP \(e.status)")）")
            }
            Log.line("FETCH \(m.provider) -> \(e.status) \(e.status == 429 || e.status <= 0 ? e.body.prefix(120) : "")")
        } catch {
            r.status = .unreadable("读不到")
        }
        r.fetchedAt = Date()
        return r
    }
}
