import AppKit
import QuartzCore
import HUDCore

/// 每个 MVP 只实现这个协议：视图自己负责绘制与点击，AppShell 负责窗口、菜单、刷新、登录。
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
    /// 下一次布局是不是"换页"（只影响高度动画时长，不做内容转场）
    var isSwitching: Bool { get set }
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

    /// 供 `ScreenA()` 这样直接构造；尺寸由 AppShell 按 preferredWidth / measuredHeight 重新设置
    public init() {
        super.init(frame: NSRect(x: 0, y: 0, width: 352, height: 200))
        wantsLayer = true
    }
    public required init?(coder: NSCoder) { fatalError() }

    public let tweens = TweenStore()
    public var isSwitching = false

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

    /// 验收用：切换视图（列表/圆环），列表 / 圆环 / 模块三档
    open func debugToggleView() {}
}
