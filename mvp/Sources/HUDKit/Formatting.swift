import Foundation
import HUDCore

// 重置时间的统一文案：只从 Date 算，绝不去解析已经格式化的字符串
// 返回 (倒计时, 具体时刻)；拿不到时刻时倒计时退化成字符串本身

public func resetPair(_ w: QuotaWindow, now: Date = Date()) -> (countdown: String, detail: String) {
    let cal = Calendar.current
    let f = DateFormatter()
    f.locale = Locale(identifier: "zh_CN")

    guard let d = w.resetAt else {
        // 老数据只有字符串：保留原样，不做假倒计时
        return (w.resetText ?? "—", "")
    }
    if w.isExpiry {
        f.dateFormat = "M月d日"
        return ("到期", f.string(from: d) + " 到期")
    }
    f.dateFormat = cal.isDateInToday(d) ? "'今天' HH:mm" : "M月d日 HH:mm"
    let detail = f.string(from: d)

    let diff = d.timeIntervalSince(now)
    if diff <= 0 { return ("待刷新", detail) }
    let days = Int(diff) / 86400
    if days >= 1 { return ("\(days) 天", detail) }
    let h = Int(diff) / 3600, m = (Int(diff) % 3600) / 60
    if h > 0 { return ("\(h) 小时 \(m) 分", detail) }
    return ("\(max(1, m)) 分钟", detail)
}

/// 详情页副标题：「今天 02:30 重置」/「11月7日 13:00 重置」/「11月9日 到期」
public func moduleMeta(_ w: QuotaWindow) -> String {
    if w.label == "积分" {
        guard let t = w.resetText, !t.isEmpty else { return "积分" }
        return "积分 · " + t
    }
    // 模块里的小字只给到日：今天的给时刻，其余给「M月d日」，与原型一致
    guard let d = w.resetAt else {
        guard let t = w.resetText, !t.isEmpty else { return w.label }
        return "\(w.label) · \(t)"
    }
    let df = DateFormatter(); df.locale = Locale(identifier: "zh_CN")
    df.dateFormat = Calendar.current.isDateInToday(d) ? "'今天' HH:mm" : "M月d日"
    return "\(w.label) · \(df.string(from: d))"
}



/// 列表行的副标题：积分给数量，其余给窗口 + 重置时刻
public func listMeta(_ w: QuotaWindow) -> String {
    if w.label == "积分" { return "积分 · \(w.valueText)" }
    let (_, detail) = resetPair(w)
    return detail.isEmpty ? w.label : "\(w.label) · \(detail)"
}

/// 圆环格子的第二行：「5 小时 · 02:30」「本周 · 11/27」
public func gridMeta(_ w: QuotaWindow) -> String {
    if w.label == "积分" {
        let first = w.valueText.components(separatedBy: " / ").first ?? w.valueText
        return "\(first) 积分"
    }
    guard let d = w.resetAt else { return w.label }
    let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN")
    if Calendar.current.isDateInToday(d) {
        f.dateFormat = "HH:mm"
        return "\(w.label) · \(f.string(from: d))"
    }
    f.dateFormat = "M/d"
    return "\(w.label) · \(f.string(from: d))"
}
