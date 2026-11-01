import Foundation

// 本地存储：账号元信息与最后一次读数（不含密钥）。

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
