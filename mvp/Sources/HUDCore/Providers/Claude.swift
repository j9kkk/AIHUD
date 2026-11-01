import Foundation

// Claude 渠道：授权与额度读取。

enum Claude {
    static let clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    static let redirect = "http://localhost:54545/callback"
    static let scope = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
    static let token = "https://platform.claude.com/v1/oauth/token"
    static let axios = [
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent": "axios/1.15.2",
    ]

    static func login() async throws {
        let pk = PKCE()
        var c = URLComponents(string: "https://claude.ai/oauth/authorize")!
        c.queryItems = [
            .init(name: "code", value: "true"), .init(name: "client_id", value: clientID),
            .init(name: "response_type", value: "code"), .init(name: "redirect_uri", value: redirect),
            .init(name: "scope", value: scope), .init(name: "code_challenge", value: pk.challenge),
            .init(name: "code_challenge_method", value: "S256"), .init(name: "state", value: pk.state),
        ]
        let cb = try Callback(port: 54545, path: "/callback")
        openBrowser(c.url!)
        let code = try await cb.wait(state: pk.state)
        let body: [String: Any] = ["grant_type": "authorization_code", "code": code, "redirect_uri": redirect,
                                   "client_id": clientID, "code_verifier": pk.verifier, "state": pk.state]
        let (_, data) = try await HTTP.send("POST", token, headers: axios, body: try JSONSerialization.data(withJSONObject: body))
        let d = HTTP.json(data)
        guard let access = d["access_token"] as? String else { throw HTTPError(status: -4, body: "换取凭据：缺少 access_token") }
        let cred = Cred(access: access, refresh: d["refresh_token"] as? String,
                        expiresAt: num(d["expires_in"]).map { Date().timeIntervalSince1970 + $0 })
        try Vault.save("claude", cred)
        let acct = d["account"] as? [String: Any]
        let email = acct?["email_address"] as? String
        Store.upsert(Meta(provider: "claude", label: email.map(mask) ?? "Claude", plan: nil))
        Log.line("AUTH claude ok")
    }

    static func refresh(_ c: Cred) async throws -> Cred {
        guard let rt = c.refresh else { throw HTTPError(status: 401, body: "无 refresh_token") }
        let body: [String: Any] = ["grant_type": "refresh_token", "refresh_token": rt, "client_id": clientID, "scope": scope]
        // 续期网络失败不重试：refresh token 一次性，重放会变成 invalid_grant
        let (_, data) = try await HTTP.send("POST", token, headers: axios, body: try JSONSerialization.data(withJSONObject: body))
        let d = HTTP.json(data)
        guard let access = d["access_token"] as? String else { throw HTTPError(status: -4, body: "续期：缺少 access_token") }
        var n = c
        n.access = access
        if let r = d["refresh_token"] as? String, !r.isEmpty { n.refresh = r }
        n.expiresAt = num(d["expires_in"]).map { Date().timeIntervalSince1970 + $0 }
        try Vault.save("claude", n)
        Log.line("AUTH claude refreshed")
        return n
    }

    static func usage(_ c: Cred) async throws -> (bars: [Bar], plan: String?) {
        let h = ["Authorization": "Bearer \(c.access)", "anthropic-beta": "oauth-2025-04-20",
                 "Accept": "application/json", "User-Agent": "claude-cli/2.1.0 (external, cli)"]
        let (_, data) = try await HTTP.send("GET", "https://api.anthropic.com/api/oauth/usage", headers: h)
        let d = HTTP.json(data)
        var bars: [Bar] = []
        for (key, label) in [("five_hour", "5 小时"), ("seven_day", "本周")] {
            guard let w = d[key] as? [String: Any], let used = num(w["utilization"]) else { continue }
            let r = min(1, max(0, 1 - used / 100))
            let at = isoDate(w["resets_at"])
            bars.append(Bar(label: label, remaining: r, valueText: pct(r), resetText: resetText(at), resetAt: at))
        }
        var plan: String?
        if let (_, pd) = try? await HTTP.send("GET", "https://api.anthropic.com/api/oauth/profile", headers: h) {
            let a = HTTP.json(pd)["account"] as? [String: Any]
            if a?["has_claude_max"] as? Bool == true { plan = "MAX" } else if a?["has_claude_pro"] as? Bool == true { plan = "PRO" }
        }
        if bars.isEmpty { throw HTTPError(status: -5, body: "响应里没有 five_hour / seven_day") }
        return (bars, plan)
    }
}

// MARK: - Codex
