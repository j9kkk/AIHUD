import Foundation
import CryptoKit

// 授权：PKCE、凭据结构、钥匙串读写。
// 凭据只存在 App 自己的钥匙串项里（service=app.aihud.desktop）。

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
