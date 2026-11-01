import Foundation

// 基础设施：日志、白名单 HTTP、解析辅助、脱敏。

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
