import Foundation
import CryptoKit

// MARK: - 日志：只记方法 / 主机 / 路径 / 状态码 / 耗时，绝不记头和体

enum Log {
    static let url: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("AIHUD-slice.log")
    }()
    private static let lock = NSLock()

    static func line(_ s: String) {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        let text = "\(f.string(from: Date())) \(s)\n"
        lock.lock(); defer { lock.unlock() }
        if let h = try? FileHandle(forWritingTo: url) {
            h.seekToEndOfFile(); h.write(Data(text.utf8)); try? h.close()
        } else {
            try? Data(text.utf8).write(to: url)
        }
        FileHandle.standardError.write(Data(text.utf8))
    }
}

// MARK: - HTTP（白名单 + 系统代理）

struct HTTPError: Error, CustomStringConvertible {
    var status: Int
    var body: String
    var retryAfter: Double?
    var description: String { "HTTP \(status)" }
}

enum HTTP {
    static let allowed: Set<String> = [
        "api.anthropic.com", "claude.ai", "platform.claude.com",
        "auth.openai.com", "chatgpt.com",
        "copilot.tencent.com",
    ]
    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 25
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    static func send(_ method: String, _ urlString: String, headers: [String: String] = [:],
                     body: Data? = nil) async throws -> (Int, Data) {
        guard let url = URL(string: urlString), url.scheme == "https", let host = url.host,
              allowed.contains(host) else { throw HTTPError(status: -1, body: "blocked \(urlString)") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let t0 = Date()
        do {
            let (data, resp) = try await session.data(for: req)
            let http = resp as! HTTPURLResponse
            Log.line("HTTP \(method) \(host)\(url.path) -> \(http.statusCode) (\(Int(Date().timeIntervalSince(t0) * 1000))ms)")
            if http.statusCode >= 400 {
                let ra = (http.value(forHTTPHeaderField: "Retry-After")).flatMap(Double.init)
                throw HTTPError(status: http.statusCode, body: String(data: data.prefix(300), encoding: .utf8) ?? "", retryAfter: ra)
            }
            return (http.statusCode, data)
        } catch let e as HTTPError {
            throw e
        } catch {
            Log.line("HTTP \(method) \(host)\(url.path) -> transport error: \(error.localizedDescription)")
            throw HTTPError(status: 0, body: error.localizedDescription)
        }
    }

    static func json(_ data: Data) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}

func num(_ v: Any?) -> Double? {
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    if let s = v as? String { return Double(s) }
    return nil
}

func isoDate(_ v: Any?) -> Date? {
    guard let s = v as? String else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
}

func jwtPayload(_ token: String) -> [String: Any] {
    let parts = token.split(separator: ".")
    guard parts.count >= 2 else { return [:] }
    var b = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while b.count % 4 != 0 { b += "=" }
    guard let d = Data(base64Encoded: b) else { return [:] }
    return HTTP.json(d)
}

func mask(_ s: String) -> String {
    if let at = s.firstIndex(of: "@") { return String(s.prefix(1)) + "***" + s[at...] }
    return s.count > 6 ? String(s.prefix(3)) + "***" + String(s.suffix(2)) : s
}

extension Data {
    var b64url: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    static func random(_ n: Int) -> Data { Data((0..<n).map { _ in UInt8.random(in: 0...255) }) }
}

struct PKCE {
    let verifier = Data.random(32).b64url
    let state = Data.random(24).b64url
    var challenge: String { Data(SHA256.hash(data: Data(verifier.utf8))).b64url }
}

// MARK: - 凭据（钥匙串）与账号元数据（文件，不含凭据）

struct Cred: Codable {
    var access: String
    var refresh: String?
    var expiresAt: Double?          // epoch 秒
    var refreshExpiresAt: Double?
    var extra: [String: String] = [:]
}

struct Meta: Codable {
    var provider: String
    var label: String
    var plan: String?
}

/// 切片阶段：通过 /usr/bin/security 读写。条目的访问控制信任的是系统自带的 security 工具，
/// 所以每次重新编译（ad-hoc 签名变化）都不会弹「输入钥匙串密码」。正式版再换 Security.framework。
enum Vault {
    static let service = "app.aihud.slice"

    @discardableResult
    private static func run(_ args: [String]) -> (Int32, String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        p.arguments = args
        let out = Pipe(); p.standardOutput = out; p.standardError = Pipe()
        do { try p.run() } catch { return (-1, "") }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    static func save(_ provider: String, _ c: Cred) throws {
        let b64 = try JSONEncoder().encode(c).base64EncodedString()
        let (st, _) = run(["add-generic-password", "-U", "-s", service, "-a", provider, "-l", "AI HUD (\(provider))", "-w", b64])
        guard st == 0, load(provider)?.access == c.access else {
            throw HTTPError(status: -2, body: "钥匙串写入失败（\(st)）")
        }
    }

    static func load(_ provider: String) -> Cred? {
        let (st, out) = run(["find-generic-password", "-s", service, "-a", provider, "-w"])
        guard st == 0, let d = Data(base64Encoded: out.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        return try? JSONDecoder().decode(Cred.self, from: d)
    }
}

enum Store {
    static let url: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/AIHUDSlice")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("accounts.json")
    }()

    static func all() -> [Meta] {
        guard let d = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Meta].self, from: d)) ?? []
    }

    static func upsert(_ m: Meta) {
        var list = all().filter { $0.provider != m.provider }
        list.append(m)
        let order = ["claude", "codex", "workbuddy"]
        list.sort { (order.firstIndex(of: $0.provider) ?? 9) < (order.firstIndex(of: $1.provider) ?? 9) }
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? enc.encode(list).write(to: url)
    }
}
