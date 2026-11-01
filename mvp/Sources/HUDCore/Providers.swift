import Foundation
import Network
import AppKit

// MARK: - 统一读数

struct Bar: Identifiable {
    var id: String { label }
    var label: String           // 「5 小时」「本周」「积分」
    var remaining: Double       // 0...1
    var valueText: String       // 「13%」或「1,750 / 13,328」
    var resetText: String?      // 「18:53」「周二 08:00」
    var resetAt: Date? = nil    // 原始时刻，界面用它算倒计时
    var isExpiry = false        // 积分类：resetAt 是「到期」而非「重置」
}

enum Status {
    case ok([Bar])
    case reauth(String)
    case limited(String)
    case unreadable(String)
}

struct Reading {
    var provider: String
    var label: String
    var plan: String?
    var status: Status
    var fetchedAt: Date
}

func resetText(_ d: Date?) -> String? {
    guard let d else { return nil }
    let cal = Calendar.current
    let f = DateFormatter()
    f.locale = Locale(identifier: "zh_CN")
    if cal.isDateInToday(d) { f.dateFormat = "HH:mm" }
    else if d.timeIntervalSinceNow < 6 * 86400 { f.dateFormat = "EEE HH:mm" }
    else { f.dateFormat = "MM-dd HH:mm" }
    return f.string(from: d)
}

func pct(_ r: Double) -> String { "\(Int((r * 100).rounded()))%" }

// MARK: - 本机回调（Claude 54545 / Codex 1455）

final class Callback {
    private let listener: NWListener
    private let path: String
    init(port: UInt16, path: String) throws {
        let p = NWParameters.tcp
        p.allowLocalEndpointReuse = true
        listener = try NWListener(using: p, on: NWEndpoint.Port(rawValue: port)!)
        self.path = path
    }

    func wait(state: String, timeout: TimeInterval = 1200) async throws -> String {
        try await withCheckedThrowingContinuation { cont in
            let lock = NSLock()
            var done = false
            func finish(_ r: Result<String, Error>) {
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                listener.cancel()
                cont.resume(with: r)
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                finish(.failure(HTTPError(status: -3, body: "等待浏览器回调超时")))
            }
            listener.stateUpdateHandler = { s in
                if case let .failed(e) = s { finish(.failure(HTTPError(status: -3, body: "端口被占用：\(e)"))) }
            }
            listener.newConnectionHandler = { [path] conn in
                conn.start(queue: .global())
                conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, _ in
                    let req = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                    let target = req.split(separator: "\r\n").first?.split(separator: " ").dropFirst().first.map(String.init) ?? ""
                    let comps = URLComponents(string: "http://localhost" + target)
                    let q = Dictionary((comps?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
                    let ok = comps?.path == path && q["code"] != nil && q["state"] == state
                    let msg = ok ? "授权完成，可以关闭此页。" : "未收到有效授权（\(q["error"] ?? "缺少 code 或 state 不匹配")）。"
                    let body = "<!doctype html><meta charset=utf-8><title>AI HUD</title><body style='font:15px -apple-system;display:grid;place-items:center;height:96vh'><p>\(msg)</p>"
                    let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
                    conn.send(content: Data(resp.utf8), completion: .contentProcessed { _ in conn.cancel() })
                    guard comps?.path == path else { return }   // favicon 等无关请求
                    if ok { finish(.success(q["code"]!)) }
                    else { finish(.failure(HTTPError(status: -3, body: msg))) }
                }
            }
            listener.start(queue: .global())
        }
    }
}

func openBrowser(_ url: URL) {
    Log.line("AUTH open browser \(url.host ?? "")\(url.path)")
    NSWorkspace.shared.open(url)
}

// MARK: - Claude

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

enum WorkBuddy {
    static let api = "https://copilot.tencent.com"
    static let ua = "WorkBuddy/5.9.3"

    static func ms(_ v: Any?) -> Double? { num(v).map { $0 > 4_000_000_000 ? $0 / 1000 : $0 } }

    static func apply(_ p: [String: Any], to c: inout Cred) {
        if let a = p["accessToken"] as? String { c.access = a }
        if let r = p["refreshToken"] as? String, !r.isEmpty { c.refresh = r }
        let now = Date().timeIntervalSince1970
        c.expiresAt = ms(p["expiresAt"]) ?? num(p["expiresIn"]).map { now + $0 } ?? c.expiresAt
        c.refreshExpiresAt = ms(p["refreshExpiresAt"]) ?? num(p["refreshExpiresIn"]).map { now + $0 } ?? c.refreshExpiresAt
        if let dom = p["domain"] as? String, !dom.isEmpty { c.extra["domain"] = dom }
    }

    static func login() async throws {
        let (_, sd) = try await HTTP.send("POST", "\(api)/v2/plugin/auth/state?platform=workbuddy", headers: [
            "User-Agent": ua, "Content-Type": "application/json", "X-No-Authorization": "true",
            "X-No-User-Id": "true", "X-No-Enterprise-Id": "true", "X-No-Department-Info": "true",
        ], body: Data("{}".utf8))
        guard let data = HTTP.json(sd)["data"] as? [String: Any], let state = data["state"] as? String,
              let authURL = (data["authUrl"] as? String).flatMap(URL.init(string:)) else {
            throw HTTPError(status: -4, body: "发起登录失败")
        }
        openBrowser(authURL)
        var cred: Cred?
        let deadline = Date().addingTimeInterval(1200)
        while Date() < deadline, cred == nil {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            guard let (_, td) = try? await HTTP.send("GET", "\(api)/v2/plugin/auth/token?state=\(state)", headers: ["User-Agent": ua]) else { continue }
            let j = HTTP.json(td)
            if (j["code"] as? Int) == 0, let p = j["data"] as? [String: Any], p["accessToken"] != nil {
                var c = Cred(access: "")
                apply(p, to: &c)
                cred = c
            }
        }
        guard var c = cred else { throw HTTPError(status: -3, body: "20 分钟内未完成登录") }
        let domain = c.extra["domain"] ?? "copilot.tencent.com"
        var account: [String: Any]?
        for _ in 0..<10 where account == nil {
            if let (_, ad) = try? await HTTP.send("GET", "\(api)/v2/plugin/login/account?state=\(state)", headers: [
                "User-Agent": ua, "Authorization": "Bearer \(c.access)", "X-Domain": domain,
                "X-No-User-Id": "true", "X-No-Enterprise-Id": "true",
            ]), let a = HTTP.json(ad)["data"] as? [String: Any], a["uid"] != nil {
                account = a
            } else {
                try await Task.sleep(nanoseconds: 1_200_000_000)
            }
        }
        guard let account, let uid = account["uid"] as? String else { throw HTTPError(status: -4, body: "读取账号失败") }
        c.extra["uid"] = uid
        if let e = account["enterpriseId"] as? String, !e.isEmpty { c.extra["enterprise"] = e }
        try Vault.save("workbuddy", c)
        let nick = (account["nickname"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        Store.upsert(Meta(provider: "workbuddy", label: nick ?? mask(uid), plan: nil))
        Log.line("AUTH workbuddy ok")
    }

    static func headers(_ c: Cred) -> [String: String] {
        var h = ["User-Agent": ua, "Content-Type": "application/json", "Accept": "application/json",
                 "Authorization": "Bearer \(c.access)", "X-Domain": c.extra["domain"] ?? "copilot.tencent.com",
                 "X-Product": "SaaS", "X-IDE-Type": "WorkBuddy"]
        if let u = c.extra["uid"] { h["X-User-Id"] = u }
        if let e = c.extra["enterprise"] { h["X-Enterprise-Id"] = e; h["X-Tenant-Id"] = e }
        return h
    }

    static func refresh(_ c: Cred) async throws -> Cred {
        guard let rt = c.refresh else { throw HTTPError(status: 401, body: "无 refresh_token") }
        var h = headers(c)
        h["X-Refresh-Token"] = rt
        h["X-Auth-Refresh-Source"] = "plugin"
        let (_, data) = try await HTTP.send("POST", "\(api)/v2/plugin/auth/token/refresh", headers: h, body: Data("{}".utf8))
        let j = HTTP.json(data)
        guard (j["code"] as? Int) == 0, let p = j["data"] as? [String: Any] else {
            throw HTTPError(status: 401, body: "续期失败 code=\(j["code"] ?? "?")")
        }
        var n = c
        apply(p, to: &n)
        try Vault.save("workbuddy", n)
        Log.line("AUTH workbuddy refreshed")
        return n
    }

    static func usage(_ c: Cred) async throws -> (bars: [Bar], plan: String?) {
        let (_, data) = try await HTTP.send("POST", "\(api)/billing/meter/get-user-resource-summary", headers: headers(c), body: Data("{}".utf8))
        let j = HTTP.json(data)
        guard (j["code"] as? Int) == 0, let d = j["data"] as? [String: Any] else {
            let code = j["code"] as? Int ?? -1
            throw HTTPError(status: [11001, 11002, 401].contains(code) ? 401 : -5, body: "code=\(code)")
        }
        var total = 0.0, remain = 0.0
        var end: Date?
        for p in (d["Packages"] as? [[String: Any]]) ?? [] {
            if let unit = p["CapacityUnit"] as? String, unit != "credits" { continue }
            total += num(p["CycleTotalCapacity"]) ?? 0
            remain += num(p["CycleRemainCapacity"]) ?? 0
            if let s = p["CycleEndTime"] as? String {
                let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"; f.timeZone = TimeZone(identifier: "Asia/Shanghai")
                if let e = f.date(from: s), e > Date(), end == nil || e < end! { end = e }
            }
        }
        guard total > 0 else { throw HTTPError(status: -5, body: "没有积分包") }
        let nf = NumberFormatter(); nf.numberStyle = .decimal; nf.maximumFractionDigits = 0
        let txt = "\(nf.string(from: NSNumber(value: remain))!) / \(nf.string(from: NSNumber(value: total))!)"
        let plan = (d["SubscriptionPackageName"] as? String) ?? ((d["IsPaidUser"] as? Bool) == true ? "付费" : nil)
        return ([Bar(label: "积分", remaining: remain / total, valueText: txt,
                     resetText: end.map { "\(resetText($0) ?? "") 到期" }, resetAt: end, isExpiry: true)], plan)
    }
}

// MARK: - 取数：过期就先续期一次；401 时续期一次再试一次

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
