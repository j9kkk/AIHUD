import AppKit
import QuartzCore

// 数值补间与转场：两版 MVP 共用
// 关键约束：窗口高度只能用 timingFunction（NSWindow 不吃 spring），
// 所以窗口用 easeInEaseOut，内容层的位移/缩放/弹簧各自独立做。

public enum ScreenTransition {
    case pushForward    // 进二级：新页面从右侧推入
    case pushBack       // 返回：从左侧推回
    case morph          // 列表 ↔ 圆环：交叉淡入 + 轻微缩放
}

/// 一个数值的变化过程：用来画「旧值淡出上移、新值淡入」和圆环从旧值弹到新值
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

    /// 值变了就开一段补间；没变则什么都不做
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

    private func current(_ i: Item) -> CGFloat {
        guard i.start > 0 else { return i.to }
        let t = (CACurrentMediaTime() - i.start) / i.duration
        if t >= 1 { return i.to }
        // easeOutBack：末尾轻微过冲，像弹簧落到位
        let p = CGFloat(min(max(t, 0), 1))
        let s: CGFloat = 1.70158
        let q = p - 1
        return i.from + (i.to - i.from) * (1 + (s + 1) * q * q * q + s * q * q)
    }

    /// 画环用的当前值
    public func value(_ key: String) -> CGFloat? {
        guard let i = items[key] else { return nil }
        guard i.start > 0 else { return i.to }
        let t = (CACurrentMediaTime() - i.start) / i.duration
        if t >= 1 { return i.to }
        let p = CGFloat(min(max(t, 0), 1))
        let s: CGFloat = 1.70158
        let q = p - 1
        return i.from + (i.to - i.from) * (1 + (s + 1) * q * q * q + s * q * q)
    }

    /// 画字用的阶段：旧字淡出上移，新字淡入
    public func text(_ key: String) -> (old: String, new: String, t: CGFloat, active: Bool)? {
        guard let i = items[key], i.start > 0 else { return nil }
        let t = (CACurrentMediaTime() - i.start) / i.duration
        if t >= 1 { return nil }
        let p = CGFloat(min(max(t, 0), 1))
        // 前 60% 走完，后半段留一点余量，避免字一直在动
        let e = CGFloat(1 - pow(1 - p, 2))
        return (i.fromText, i.toText, e, true)
    }

    public var isAnimating: Bool {
        let now = CACurrentMediaTime()
        return items.values.contains { $0.start > 0 && now - $0.start < $0.duration }
    }

    public func reset() { items.removeAll() }
}

// MARK: - 转场

public func applyTransition(_ kind: ScreenTransition, on view: NSView) {
    guard let layer = view.layer else { return }
    // 尊重「减弱动态效果」：只留淡入淡出，位移和缩放全关（HIG 硬要求）
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
        let fade = CATransition()
        fade.type = .fade
        fade.duration = 0.12
        layer.add(fade, forKey: "screenFade")
        return
    }
    switch kind {
    case .pushForward, .pushBack:
        let t = CATransition()
        t.type = .push
        t.subtype = (kind == .pushForward) ? .fromRight : .fromLeft
        t.duration = 0.22
        t.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(t, forKey: "screenPush")
    case .morph:
        let fade = CATransition()
        fade.type = .fade
        fade.duration = 0.16
        layer.add(fade, forKey: "screenFade")
        scaleIn(layer, from: 0.98, duration: 0.28)
    }
}

/// 以视图中心缩放：不改 anchorPoint（改了会跟显式 frame 打架），
/// 用 translate(center) · scale · translate(-center) 组合出「绕中心缩放」的变换
public func scaleIn(_ layer: CALayer, from: CGFloat, duration: CFTimeInterval, translateY: CGFloat = 0) {
    guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
    let cx = layer.bounds.midX, cy = layer.bounds.midY
    let around = CATransform3DConcat(
        CATransform3DMakeTranslation(cx, cy, 0),
        CATransform3DConcat(CATransform3DMakeScale(from, from, 1),
                            CATransform3DMakeTranslation(-cx, -cy, 0)))

    let spring = CASpringAnimation(keyPath: "transform")
    spring.fromValue = NSValue(caTransform3D: around)
    spring.toValue = NSValue(caTransform3D: CATransform3DIdentity)
    spring.damping = 22
    spring.stiffness = 260
    spring.mass = 1
    spring.initialVelocity = 0
    spring.duration = max(duration, spring.settlingDuration)
    layer.add(spring, forKey: "scaleIn")

    if translateY != 0 {
        let move = CASpringAnimation(keyPath: "transform.translation.y")
        move.fromValue = translateY
        move.toValue = 0
        move.damping = 24
        move.stiffness = 280
        move.mass = 1
        move.duration = move.settlingDuration
        layer.add(move, forKey: "riseIn")
    }
}

/// 面板出现：alpha 淡入 + 轻微放大 + 上移 2pt
public func playAppear(_ view: NSView, alpha: (NSView, CGFloat) -> Void) {
    if let layer = view.layer { scaleIn(layer, from: 0.98, duration: 0.28, translateY: -2) }
}

// MARK: - 内容换页：快照 + 遮罩擦除

/// 把视图当前内容拍成一张 NSImageView（用视图盖在视图上，
/// 避免直接动 CALayer 内容时踩 flipped 坐标/上下颠倒的坑）
public func snapshotView(of view: NSView) -> NSImageView? {
    let b = view.bounds
    guard b.width > 1, b.height > 1,
          let rep = view.bitmapImageRepForCachingDisplay(in: b) else { return nil }
    view.cacheDisplay(in: b, to: rep)
    let img = NSImage(size: b.size)
    img.addRepresentation(rep)
    let iv = NSImageView(frame: b)
    iv.image = img
    iv.imageScaling = .scaleAxesIndependently
    iv.wantsLayer = true
    iv.autoresizingMask = []
    return iv
}

/// 页面切换：遮罩擦除
/// 新旧两页用**互补矩形遮罩**，同一时刻每个像素只有一层可见 —— 既不会重影，也不会空窗。
public func playWipe(host: NSView, content: NSView, snapshot: NSView?, duration: CFTimeInterval) {
    guard let snapshot, let oldLayer = snapshot.layer, let newLayer = content.layer else { return }

    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
        let fade = CATransition()
        fade.type = .fade
        fade.duration = 0.12
        newLayer.add(fade, forKey: "reduceMotionFade")
        return
    }

    // 顶边对齐：面板变矮时若沿用旧 y，旧页会整体下移，看起来就是"错位的影子"
    snapshot.frame.origin.y = host.bounds.height - snapshot.frame.height
    host.addSubview(snapshot, positioned: .below, relativeTo: nil)

    let b = host.bounds
    let m1 = CALayer(); m1.backgroundColor = NSColor.black.cgColor
    m1.anchorPoint = .zero; m1.position = .zero
    m1.bounds = CGRect(x: 0, y: 0, width: b.width, height: b.height)
    oldLayer.mask = m1

    let m2 = CALayer(); m2.backgroundColor = NSColor.black.cgColor
    m2.anchorPoint = .zero; m2.position = CGPoint(x: b.width, y: 0)
    m2.bounds = CGRect(x: 0, y: 0, width: 0, height: b.height)
    newLayer.mask = m2

    let timing = CAMediaTimingFunction(name: .easeInEaseOut)
    let w1 = CABasicAnimation(keyPath: "bounds.size.width")
    w1.fromValue = b.width; w1.toValue = 0
    let w2 = CABasicAnimation(keyPath: "bounds.size.width")
    w2.fromValue = 0; w2.toValue = b.width
    let p2 = CABasicAnimation(keyPath: "position.x")
    p2.fromValue = b.width; p2.toValue = 0
    for a in [w1, w2, p2] { a.duration = duration; a.timingFunction = timing }
    m1.add(w1, forKey: "sweep")
    m2.add(w2, forKey: "grow")
    m2.add(p2, forKey: "sweep")

    m1.bounds.size.width = 0
    m2.bounds.size.width = b.width
    m2.position.x = 0

    DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.02) {
        snapshot.removeFromSuperview()
        oldLayer.mask = nil
        newLayer.mask = nil
    }
}

