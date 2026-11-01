import AppKit
import QuartzCore
import HUDCore

/// 每个 MVP 只实现这个协议：视图自己负责绘制与点击，Shell 负责窗口、菜单、刷新、登录。
public protocol HUDScreen: AnyObject {
    var preferredWidth: CGFloat { get }
    func apply(_ readings: [AccountReading], updatedAt: Date?, refreshing: Bool)
    func measuredHeight() -> CGFloat
    /// 内容高度变化（例如从一级进入二级）时通知 Shell 重新布局
    var onHeightChange: (() -> Void)? { get set }
    var onLogin: ((String) -> Void)? { get set }
    var onRefresh: (() -> Void)? { get set }
    var onOpenUsage: ((String) -> Void)? { get set }
    var onRemove: ((String) -> Void)? { get set }
    /// 验收用：直接切二级页（nil 返回一级）
    func debugSelect(_ index: Int?)
    /// 下一次布局时要播的转场
    var pendingTransition: ScreenTransition? { get set }
    /// 转场锚点（被点击的卡片/行，用于"从卡片里钻入"），视图坐标
    var pendingAnchor: NSRect? { get set }
    /// 数值补间仓库（验收脚本会读）
    var tweens: TweenStore { get }
    func debugToggleView()
}

open class BaseScreen: NSView, HUDScreen {

    open override func draw(_ dirtyRect: NSRect) {
        // 浏览器不开「字体加粗」平滑；开着会让 13/400 看着接近 600，和原型差一个档
        if let cg = NSGraphicsContext.current?.cgContext {
            cg.setShouldSmoothFonts(false)
            cg.setShouldAntialias(true)
        }
        super.draw(dirtyRect)
    }
    public var onHeightChange: (() -> Void)?
    public var onLogin: ((String) -> Void)?
    public var onRefresh: (() -> Void)?
    public var onOpenUsage: ((String) -> Void)?
    public var onRemove: ((String) -> Void)?
    open var preferredWidth: CGFloat { 352 }
    public internal(set) var readings: [AccountReading] = []
    public internal(set) var updatedAt: Date?
    public internal(set) var refreshing = false

    public override var isFlipped: Bool { true }

    public override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }

    /// 供 `ScreenA()` 这样直接构造；尺寸由 Shell 按 preferredWidth / measuredHeight 重新设置
    public init() {
        super.init(frame: NSRect(x: 0, y: 0, width: 352, height: 200))
        wantsLayer = true
    }
    public required init?(coder: NSCoder) { fatalError() }

    public let tweens = TweenStore()
    public var pendingTransition: ScreenTransition?
    public var pendingAnchor: NSRect?

    private var ticker: Timer?
    private var spinStart: CFTimeInterval = 0

    /// 刷新动画的角度（0…360）
    public var spinAngle: CGFloat {
        guard refreshing else { return 0 }
        if spinStart == 0 { spinStart = CACurrentMediaTime() }
        let t = (CACurrentMediaTime() - spinStart) * 1.6      // 每秒 1.6 圈
        return CGFloat((t - floor(t)) * 360)
    }

    open func startTicker() {
        guard ticker == nil else { return }
        ticker = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            guard let self else { return }
            if !self.refreshing && !self.tweens.isAnimating {
                self.stopTicker()
            }
            self.needsDisplay = true
        }
        RunLoop.main.add(ticker!, forMode: .common)
    }

    open func stopTicker() {
        ticker?.invalidate(); ticker = nil
        if !refreshing { spinStart = 0 }
    }

    open func apply(_ readings: [AccountReading], updatedAt: Date?, refreshing: Bool) {
        let wasRefreshing = self.refreshing
        self.readings = readings
        self.updatedAt = updatedAt
        self.refreshing = refreshing
        if refreshing && !wasRefreshing { spinStart = CACurrentMediaTime() }
        if !refreshing && wasRefreshing { spinStart = 0; tweens.reset() }
        if refreshing || tweens.isAnimating { startTicker() }
        needsDisplay = true
        onHeightChange?()
    }
    open func measuredHeight() -> CGFloat { 200 }

    /// 验收用：子类覆写以直接切二级页；基类默认什么都不做
    open func debugSelect(_ index: Int?) {}

    /// 验收用：切换视图（列表/圆环），仅 B 版有意义
    open func debugToggleView() {}
}

/// 28×28 图标按钮：默认无边框，悬停出现浅底（HIG 工具栏图标按钮）
public final class IconButton: NSView {
    public enum Glyph { case refresh, back, chevronDown }
    public var glyph: Glyph = .refresh { didSet { needsDisplay = true } }
    public var action: (() -> Void)?
    public var spinning = false { didSet { needsDisplay = true } }
    private var hovering = false
    private var angle: CGFloat = 0

    public override var isFlipped: Bool { true }
    public override var intrinsicContentSize: NSSize { NSSize(width: 28, height: 28) }

    public override init(frame: NSRect) {
        super.init(frame: frame)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self))
    }
    public required init?(coder: NSCoder) { fatalError() }
    public override func mouseEntered(with e: NSEvent) { hovering = true; needsDisplay = true }
    public override func mouseExited(with e: NSEvent) { hovering = false; needsDisplay = true }
    public override func mouseDown(with e: NSEvent) { action?() }

    public override func draw(_ dirtyRect: NSRect) {
        if hovering {
            Theme.hover.setFill()
            NSBezierPath(roundedRect: bounds, xRadius: 6, yRadius: 6).fill()
        }
        let c = hovering ? Theme.label : Theme.label2
        let r = bounds.insetBy(dx: 2, dy: 2)
        switch glyph {
        case .back:
            drawChevron(rect: r, color: c, direction: -1)
        case .chevronDown:
            NSGraphicsContext.saveGraphicsState()
            let t = NSAffineTransform()
            t.translateX(by: 0, yBy: bounds.height)
            t.rotate(byDegrees: 90)
            t.concat()
            drawChevron(rect: NSRect(x: 0, y: 0, width: bounds.width, height: bounds.height), color: c, direction: 1)
            NSGraphicsContext.restoreGraphicsState()
        case .refresh:
            NSGraphicsContext.saveGraphicsState()
            let center = NSPoint(x: bounds.midX, y: bounds.midY)
            let t = NSAffineTransform()
            t.translateX(by: center.x, yBy: center.y)
            t.rotate(byDegrees: angle)
            t.translateX(by: -center.x, yBy: -center.y)
            t.concat()
            let p = NSBezierPath()
            p.appendArc(withCenter: center, radius: 5.2, startAngle: 40, endAngle: 330, clockwise: false)
            p.lineWidth = 1.5; p.lineCapStyle = .round
            c.setStroke(); p.stroke()
            let arrow = NSBezierPath()
            arrow.move(to: NSPoint(x: center.x + 3.2, y: center.y - 4.6))
            arrow.line(to: NSPoint(x: center.x + 6.0, y: center.y - 4.9))
            arrow.line(to: NSPoint(x: center.x + 5.6, y: center.y - 1.8))
            arrow.lineWidth = 1.5; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
            c.setStroke(); arrow.stroke()
            NSGraphicsContext.restoreGraphicsState()
        }
    }
    public func startSpin() {
        guard !spinning else { return }
        spinning = true
        Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] t in
            guard let self, self.spinning else { t.invalidate(); return }
            self.angle = (self.angle + 8).truncatingRemainder(dividingBy: 360)
            self.needsDisplay = true
        }
    }
    public func stopSpin() { spinning = false; needsDisplay = true }
}

/// 双图标分段控件：容器 28 高、每段 30×28、选中滑块 22 高（与 p12 原型一致）
public final class ViewSwitch: NSView {
    public var icons: [NSImage?] = []
    public var selected = 0 { didSet { needsDisplay = true } }
    public var onSelect: ((Int) -> Void)?
    public override var isFlipped: Bool { true }
    public override var intrinsicContentSize: NSSize { NSSize(width: 60, height: 28) }
    private var hovering = -1

    public override init(frame: NSRect) {
        super.init(frame: frame)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self))
    }
    public required init?(coder: NSCoder) { fatalError() }
    private func index(at p: NSPoint) -> Int { p.x < bounds.width / 2 ? 0 : 1 }
    public override func mouseMoved(with e: NSEvent) {
        let i = index(at: convert(e.locationInWindow, from: nil))
        if i != hovering { hovering = i; needsDisplay = true }
    }
    public override func mouseExited(with e: NSEvent) { hovering = -1; needsDisplay = true }
    public override func mouseDown(with e: NSEvent) {
        let i = index(at: convert(e.locationInWindow, from: nil))
        selected = i; onSelect?(i)
    }
    public override func draw(_ dirtyRect: NSRect) {
        Theme.segTrack.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 7, yRadius: 7).fill()
        let w = bounds.width / 2
        for i in 0..<2 {
            let cell = NSRect(x: CGFloat(i) * w, y: 0, width: w, height: bounds.height)
            if i == selected {
                Theme.segThumb.setFill()
                NSBezierPath(roundedRect: cell.insetBy(dx: 3, dy: 3), xRadius: 5, yRadius: 5).fill()
            } else if i == hovering {
                Theme.hover.setFill()
                NSBezierPath(roundedRect: cell.insetBy(dx: 3, dy: 3), xRadius: 5, yRadius: 5).fill()
            }
            let c = i == selected ? Theme.label : Theme.label2
            drawSwitchGlyph(list: i == 0, in: cell.insetBy(dx: 8, dy: 6), color: c)
        }
    }
    private func drawSwitchGlyph(list: Bool, in rect: NSRect, color: NSColor) {
        if list {
            for (i, y) in [0.22, 0.5, 0.78].enumerated() {
                let py = rect.minY + rect.height * y
                color.setFill()
                NSBezierPath(ovalIn: NSRect(x: rect.minX, y: py - 1, width: 2, height: 2)).fill()
                let line = NSBezierPath()
                line.move(to: NSPoint(x: rect.minX + 4, y: py))
                line.line(to: NSPoint(x: rect.maxX, y: py))
                line.lineWidth = 1.5; line.lineCapStyle = .round
                color.setStroke(); line.stroke()
                _ = i
            }
        } else {
            let s = min(rect.width, rect.height) / 2 - 0.5
            for (dx, dy) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)] {
                let r = NSRect(x: rect.minX + dx * (s + 2), y: rect.minY + dy * (s + 2), width: s, height: s)
                let p = NSBezierPath(roundedRect: r, xRadius: 1.4, yRadius: 1.4)
                p.lineWidth = 1.4
                color.setStroke(); p.stroke()
            }
        }
    }
}
