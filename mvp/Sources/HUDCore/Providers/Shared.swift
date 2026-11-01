import Foundation

// 三渠道公共类型与工具：状态、读数、回调监听、打开浏览器。

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
