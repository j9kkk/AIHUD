import Foundation

// Codex 渠道：授权与额度读取。

enum Codex {
    static let clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
    static let redirect = "http://localhost:1455/auth/callback"
    static let token = "https://auth.openai.com/oauth/token"

    static func form(_ kv: [(String, String)]) -> Data {
        var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
        return Data(kv.map { "\($0)=\($1.addingPercentEncoding(withAllowedCharacters: allowed)!)" }.joined(separator: "&").utf8)
    }

    static func apply(_ d: [String: Any], to c: inout Cred) {
        if let a = d["access_token"] as? String { c.access = a }
        if let r = d["refresh_token"] as? String, !r.isEmpty { c.refresh = r }
        c.expiresAt = num(d["expires_in"]).map { Date().timeIntervalSince1970 + $0 }
            ?? num(jwtPayload(c.access)["exp"])
        if let idt = d["id_token"] as? String,
           let auth = jwtPayload(idt)["https://api.openai.com/auth"] as? [String: Any] {
            if let id = auth["chatgpt_account_id"] as? String { c.extra["account_id"] = id }
            if let p = auth["chatgpt_plan_type"] as? String { c.extra["plan"] = p.uppercased() }
        }
    }

    static func login() async throws {
        let pk = PKCE()
        var c = URLComponents(string: "https://auth.openai.com/oauth/authorize")!
        c.queryItems = [
            .init(name: "response_type", value: "code"), .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirect), .init(name: "scope", value: "openid profile email offline_access"),
            .init(name: "code_challenge", value: pk.challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "id_token_add_organizations", value: "true"), .init(name: "codex_cli_simplified_flow", value: "true"),
            .init(name: "state", value: pk.state), .init(name: "originator", value: "codex_cli_rs"),
        ]
        let cb = try Callback(port: 1455, path: "/auth/callback")
        openBrowser(c.url!)
        let code = try await cb.wait(state: pk.state)
        let (_, data) = try await HTTP.send("POST", token, headers: ["Content-Type": "application/x-www-form-urlencoded"],
                                            body: form([("grant_type", "authorization_code"), ("code", code),
                                                        ("redirect_uri", redirect), ("client_id", clientID),
                                                        ("code_verifier", pk.verifier)]))
        let d = HTTP.json(data)
        guard d["access_token"] is String else { throw HTTPError(status: -4, body: "换取凭据：缺少 access_token") }
        var cred = Cred(access: "")
        apply(d, to: &cred)
        try Vault.save("codex", cred)
        let email = (d["id_token"] as? String).flatMap { jwtPayload($0)["email"] as? String }
        Store.upsert(Meta(provider: "codex", label: email.map(mask) ?? "Codex", plan: cred.extra["plan"]))
        Log.line("AUTH codex ok")
    }

    static func refresh(_ c: Cred) async throws -> Cred {
        guard let rt = c.refresh else { throw HTTPError(status: 401, body: "无 refresh_token") }
        let (_, data) = try await HTTP.send("POST", token, headers: ["Content-Type": "application/x-www-form-urlencoded"],
                                            body: form([("grant_type", "refresh_token"), ("refresh_token", rt),
                                                        ("client_id", clientID), ("scope", "openid profile email")]))
        var n = c
        apply(HTTP.json(data), to: &n)
        try Vault.save("codex", n)
        Log.line("AUTH codex refreshed")
        return n
    }

    static func usage(_ c: Cred) async throws -> (bars: [Bar], plan: String?) {
        var h = ["Authorization": "Bearer \(c.access)", "Accept": "application/json", "User-Agent": "AIHUD"]
        if let id = c.extra["account_id"] { h["ChatGPT-Account-Id"] = id }
        let (_, data) = try await HTTP.send("GET", "https://chatgpt.com/backend-api/wham/usage", headers: h)
        let d = HTTP.json(data)
        var bars: [Bar] = []
        let rl = d["rate_limit"] as? [String: Any]
        for key in ["primary_window", "secondary_window"] {
            guard let w = rl?[key] as? [String: Any], let used = num(w["used_percent"]) else { continue }
            let secs = num(w["limit_window_seconds"]) ?? 0
            let label = secs >= 6 * 86400 ? "本周" : secs > 0 ? "\(Int((secs / 3600).rounded())) 小时" : "窗口"
            var reset: Date?
            if let e = num(w["reset_at"]), e > 0 { reset = Date(timeIntervalSince1970: e) }
            else if let a = num(w["reset_after_seconds"]) { reset = Date().addingTimeInterval(a) }
            let r = min(1, max(0, 1 - used / 100))
            bars.append(Bar(label: label, remaining: r, valueText: pct(r), resetText: resetText(reset), resetAt: reset))
        }
        if bars.isEmpty { throw HTTPError(status: -5, body: "响应里没有 rate_limit 窗口") }
        return (bars, (d["plan_type"] as? String)?.uppercased() ?? c.extra["plan"])
    }
}

// MARK: - WorkBuddy（国内站）
