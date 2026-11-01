import Foundation

// WorkBuddy 渠道：授权与额度读取。

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
