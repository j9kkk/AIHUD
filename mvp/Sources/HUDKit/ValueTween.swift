import AppKit
import QuartzCore

/// 一段数值的变化过程：驱动「环/条从旧值弹到新值」和「旧值淡出、新值淡入」。
///
/// 只存模型值，不做图层动画——所有视图在 `draw` 里读它，由 60fps ticker 推动重绘。
/// 这样同一时刻只有一份"当前值"，不会出现图层动画与绘制值不同步。
public final class TweenStore {
    struct Item {
        var from: CGFloat
        var to: CGFloat
        var fromText: String
        var toText: String
        var start: CFTimeInterval
        var duration: CFTimeInterval
    }

    private var items: [String: Item] = [:]

    public init() {}

    /// 值变了就开一段补间；没变则什么都不做。
    public func set(_ key: String, value: CGFloat, text: String, duration: CFTimeInterval = 0.26) {
        if let old = items[key] {
            if abs(old.to - value) < 0.0005 && old.toText == text { return }
            items[key] = Item(from: current(old), to: value, fromText: old.toText, toText: text,
                              start: CACurrentMediaTime(), duration: duration)
        } else {
            // 第一次出现不做动画
            items[key] = Item(from: value, to: value, fromText: text, toText: text,
                              start: 0, duration: duration)
        }
    }

    /// 画环/画条用的当前值
    public func value(_ key: String) -> CGFloat? {
        guard let i = items[key] else { return nil }
        guard i.start > 0 else { return i.to }
        let t = (CACurrentMediaTime() - i.start) / i.duration
        if t >= 1 { return i.to }
        // easeOutBack：末尾轻微过冲，像弹簧落到位
        let p = CGFloat(min(max(t, 0), 1))
        let s: CGFloat = 1.70158
        let q = p - 1
        return i.from + (i.to - i.from) * (1 + (s + 1) * q * q * q + s * q * q)
    }

    /// 画字用的阶段：旧字淡出上移，新字淡入
    public func text(_ key: String) -> (old: String, new: String, t: CGFloat)? {
        guard let i = items[key], i.start > 0 else { return nil }
        let t = (CACurrentMediaTime() - i.start) / i.duration
        if t >= 1 { return nil }
        let p = CGFloat(min(max(t, 0), 1))
        let e = CGFloat(1 - pow(1 - p, 2))
        return (i.fromText, i.toText, e)
    }

    public var isAnimating: Bool {
        let now = CACurrentMediaTime()
        return items.values.contains { $0.start > 0 && now - $0.start < $0.duration }
    }

    public func reset() { items.removeAll() }

    private func current(_ i: Item) -> CGFloat {
        guard i.start > 0 else { return i.to }
        let t = (CACurrentMediaTime() - i.start) / i.duration
        if t >= 1 { return i.to }
        let p = CGFloat(min(max(t, 0), 1))
        let s: CGFloat = 1.70158
        let q = p - 1
        return i.from + (i.to - i.from) * (1 + (s + 1) * q * q * q + s * q * q)
    }
}
