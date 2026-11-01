import AppKit
import HUDCore

/// AppShell：状态栏图标、菜单、面板、刷新、登录。
/// 界面差异只体现在 `HUDScreen` 的实现（`PanelScreen`）上。
public final class AppShell: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let makeScreen: () -> HUDScreen
    var panel: NSPanel!
    var effect: NSVisualEffectView!
    var host: NSView!
    var rim: NSView!
    let shadowMargin: CGFloat = 26
    var screen: HUDScreen!
    var status: NSStatusItem!
    var menu: NSMenu!
    var closedAt: Date?
    var heightTimer: Timer?      // 高度动画的逐帧驱动，同一时刻只允许一个
    var lastReading: [AccountReading] = []
    var updatedAt: Date?
    var refreshing = false
    let demoMode = ProcessInfo.processInfo.environment["AIHUD_DEMO"]
    var demo: Bool { demoMode != nil }
    let openOnLaunch = ProcessInfo.processInfo.environment["AIHUD_OPEN"] != nil

    public init(screen: @escaping () -> HUDScreen) {
        self.makeScreen = screen
        super.init()
    }

    public func run() {
        if ProcessInfo.processInfo.environment["AIHUD_SWITCH_LIVE"] != nil {
            liveSwitchTest(); return
        }
        if ProcessInfo.processInfo.environment["AIHUD_TWEEN_TEST"] != nil {
            tweenTest(); return
        }
        if ProcessInfo.processInfo.environment["AIHUD_ANIM_TEST"] != nil {
            animTest(); return
        }
        if ProcessInfo.processInfo.environment["AIHUD_GROW_TEST"] != nil {
            growTest(); return
        }
        if ProcessInfo.processInfo.environment["AIHUD_SWITCH_TEST"] != nil {
            switchTest(); return
        }
        if let raw = ProcessInfo.processInfo.environment["AIHUD_GEOM_TEST"], let n = Int(raw) {
            geomTest(rounds: n); return
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        app.delegate = self
        app.run()
    }

    public func applicationDidFinishLaunching(_ n: Notification) {
        let build = Bundle.main.object(forInfoDictionaryKey: "AIHUDBuildStamp") as? String ?? "dev"
        HUDLog.line("APP launch demo=\(demo) build=\(build)")
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.menu = NSMenu()
        self.menu.delegate = self
        installStatusClick()
        renderStatusItem()

        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 352, height: 300),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false          // 自己画三层阴影，系统那层太薄
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = false

        // 阴影宿主：窗口比面板大一圈，阴影画在这一圈里（原型 0 2px 8px .28 / 0 20px 54px .48）
        let hv = ShadowHost()
        hv.onClickOutsidePanel = { [weak self] in self?.hide() }
        host = hv
        host.wantsLayer = true
        host.layer?.masksToBounds = false
        panel.contentView = host

        effect = NSVisualEffectView()
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 14
        effect.layer?.masksToBounds = true
        // 原型给面板描了 .5pt 内描边（--stroke），没有它贴到浅色壁纸上会糊边
        effect.layer?.borderWidth = 0.5
        effect.layer?.borderColor = Theme.dyn(light: NSColor(white: 0, alpha: 0.14),
                                              dark: NSColor(white: 1, alpha: 0.14)).cgColor
        effect.autoresizingMask = []
        host.addSubview(effect)

        rim = NSView()
        rim.wantsLayer = true
        rim.layer?.cornerRadius = 14
        // 不再描黑边：黑环是"多出一圈"的主因。内层 white .14 的发丝线已经由 effect 提供
        rim.layer?.borderWidth = 0
        rim.isHidden = false
        host.addSubview(rim)

        let s = makeScreen()
        screen = s
        s.onRefresh = { [weak self] in self?.refresh(trigger: "screen") }
        s.onLogin = { [weak self] p in self?.login(p) }
        s.onOpenUsage = { [weak self] _ in self?.toast("MVP 未实现：打开用量页面") }
        s.onRemove = { [weak self] _ in self?.toast("MVP 未实现：移除账号") }
        s.onHeightChange = { [weak self] in self?.place(animated: true) }
        if let view = s as? NSView {
            // 宽度弹性 + 下边距弹性 = 顶边钉住。用 [.width,.height] 会让窗口改高时把高度算两遍
            view.autoresizingMask = []
            effect.addSubview(view)
        }

        render(initial: true)
        if ProcessInfo.processInfo.environment["AIHUD_NO_REFRESH"] == nil { refresh(trigger: "launch") }

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
                                              object: nil, queue: .main) { [weak self] _ in
            self?.cachedAnchor = nil
        }

        // Esc 收起
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in
            guard let self else { return e }
            if e.keyCode == 53, self.panel.isVisible { self.hide(); return nil }
            return e
        }
        if openOnLaunch { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.show() } }
    }

    // MARK: 面板


    /// 面板锚点：只在“打开面板”时取一次并缓存。
    /// 面板打开后状态栏按钮的 window rect 会变（实测从 x≈1460 变成 882），
    /// 靠它每次重算就会把面板甩到屏幕中间，所以打开期间不再读它。
    var cachedAnchor: (right: CGFloat, top: CGFloat)?

    func computeAnchor() -> (right: CGFloat, top: CGFloat) {
        let vf = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var right = vf.maxX - 16
        var top = vf.maxY - 30
        if let button = status.button, let win = button.window {
            let r = win.convertToScreen(button.convert(button.bounds, to: nil))
            // 只认“确实贴在菜单栏里”的矩形；未布局时会出现 y=-11、宽 32 这种假值
            let okY = r.minY >= vf.maxY - 44 && r.minY <= vf.maxY + 4
            let okW = r.width >= 16 && r.width <= 400
            if okY && okW {
                right = min(r.maxX, vf.maxX - 8)
                top = min(r.minY - 6, vf.maxY - 8)
            }
        }
        return (right, top)
    }

    func anchor() -> (right: CGFloat, top: CGFloat) {
        if let c = cachedAnchor { return c }
        let a = computeAnchor()
        cachedAnchor = a
        return a
    }

    public func toggle() { panel.isVisible ? hide() : show() }

    public func show() {
        if let c = closedAt, Date().timeIntervalSince(c) < 0.25 { return }
        cachedAnchor = computeAnchor()      // 每次打开重新贴一次图标，打开期间不再变
        place(animated: false)
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        panel.makeKey()
        // 出现动画：alpha 0→1，内容层 0.98→1 并上移 2pt（spring）
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.18
            panel.animator().alphaValue = 1
        }, completionHandler: { [weak self] in
            self?.panel.alphaValue = 1      // 中途被打断也不会停在半透明
        })
        if let layer = (screen as? NSView)?.layer {
            Motion.appear(layer)
        }
    }

    public func hide() {
        heightTimer?.invalidate(); heightTimer = nil
        guard panel.isVisible else { closedAt = Date(); return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.12
            panel.animator().alphaValue = 0
        }, completionHandler: {
            self.panel.orderOut(nil)
            self.panel.alphaValue = 1
        })
        closedAt = Date()
    }

    /// 唯一的布局入口：顶边固定、右边缘对齐图标、整体夹在可见区域内


    // MARK: 菜单

    public func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        if !lastReading.isEmpty {
            for r in lastReading where r.needsAttention {
                let title = attentionTitle(r)
                menu.addItem(withTitle: title, action: nil, keyEquivalent: "")
            }
            menu.addItem(.separator())
        }
        let refreshItem = NSMenuItem(title: refreshing ? "正在刷新…" : "立即刷新",
                                     action: refreshing ? nil : #selector(doRefresh), keyEquivalent: "r")
        refreshItem.target = self
        menu.addItem(refreshItem)
        let add = NSMenuItem(title: "添加账号", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (p, t) in [("claude", "Claude…"), ("codex", "Codex…"), ("workbuddy", "WorkBuddy…")] {
            let it = NSMenuItem(title: t, action: #selector(doLogin(_:)), keyEquivalent: "")
            it.representedObject = p; it.target = self
            sub.addItem(it)
        }
        add.submenu = sub
        menu.addItem(add)

        menu.addItem(withTitle: "退出 AI HUD", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }

    private func attentionTitle(_ r: AccountReading) -> String {
        switch r.state {
        case let .ok(ws):
            if let low = ws.min(by: { $0.remaining < $1.remaining }) {
                return "\(r.meta.label) 剩 \(low.valueText)（\(low.label)）"
            }
            return r.meta.label
        case .reauth: return "重新授权「\(r.meta.label)」…"
        case .limited: return "\(r.meta.label) 限流中"
        case .unreadable: return "\(r.meta.label) 读不到"
        }
    }

    @objc private func doRefresh() { refresh(trigger: "menu") }

    @objc private func doLogin(_ sender: NSMenuItem) {
        guard let p = sender.representedObject as? String else { return }
        login(p)
    }

    // MARK: 数据

    private func refresh(trigger: String) {
        guard !refreshing else { return }
        refreshing = true
        render(initial: false)
        HUDLog.line("REFRESH start trigger=\(trigger) demo=\(demo)")
        Task.detached {
            let out: [AccountReading]
            if self.demoMode == "issue" { out = HUD.demoIssue() }
            else if self.demo { out = HUD.demo() }
            else { out = await HUD.refreshAll() }
            await MainActor.run {
                self.lastReading = out
                self.updatedAt = Date()
                self.refreshing = false
                self.render(initial: false)
                self.renderStatusItem()
                let summary = out.map { r -> String in
                    switch r.state {
                    case let .ok(ws): return "\(r.meta.provider)=" + ws.map { "\($0.label):\($0.valueText)" }.joined(separator: ",")
                    case let .reauth(m), let .limited(m), let .unreadable(m): return "\(r.meta.provider)=\(m)"
                    }
                }
                HUDLog.line("REFRESH done \(summary.joined(separator: " | "))")
                if let path = ProcessInfo.processInfo.environment["AIHUD_SNAPSHOT"] { self.snapshot(to: path) }
            }
        }
    }

    private func login(_ provider: String) {
        hide()
        Task {
            do {
                try await HUD.login(provider)
                await MainActor.run { self.refresh(trigger: "login-\(provider)") }
            } catch {
                HUDLog.line("AUTH \(provider) failed \(error)")
                await MainActor.run {
                    let a = NSAlert(); a.messageText = "授权未完成"; a.informativeText = "\(error)"
                    a.runModal()
                }
            }
        }
    }

    private func render(initial: Bool) {
        screen.apply(lastReading, updatedAt: updatedAt, refreshing: refreshing)
        place(animated: !initial)
    }

    /// 离屏出图：不需要显示器、不受锁屏影响，用于验收截图
    private func snapshot(to path: String) {
        guard let view = screen as? NSView else { return }
        let w = screen.preferredWidth, h = screen.measuredHeight()
        view.frame = NSRect(x: 0, y: 0, width: w, height: h)
        view.layoutSubtreeIfNeeded()
        let scale: CGFloat = 2
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil,
                                         pixelsWide: Int(w * scale), pixelsHigh: Int(h * scale),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
        rep.size = NSSize(width: w, height: h)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        Theme.panelTint.setFill()
        NSBezierPath(rect: NSRect(x: 0, y: 0, width: w, height: h)).fill()
        view.cacheDisplay(in: view.bounds, to: rep)
        NSGraphicsContext.restoreGraphicsState()
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: URL(fileURLWithPath: path))
            HUDLog.line("SNAPSHOT \(path) \(Int(w))x\(Int(h))")
        }
        exit(0)
    }

    // MARK: 状态栏：平时只有图标；低于 20% 红字加粗；需授权带感叹号

    private func renderStatusItem() {
        guard let b = status.button else { return }
        b.image = gaugeImage()
        b.imagePosition = .imageLeading
        var lowest: Double?
        var needsAuth = false
        for r in lastReading {
            switch r.state {
            case let .ok(ws): for w in ws { lowest = min(lowest ?? 1, w.remaining) }
            case .reauth: needsAuth = true
            default: break
            }
        }
        let s = NSMutableAttributedString()
        if let l = lowest, l < 0.2 {
            s.append(NSAttributedString(string: " \(Int((l * 100).rounded()))%", attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .semibold),
                .foregroundColor: NSColor.systemRed]))
        }
        if needsAuth {
            s.append(NSAttributedString(string: " !", attributes: [
                .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
                .foregroundColor: NSColor.systemOrange]))
        }
        b.attributedTitle = s
    }

    /// 自绘圆环图标（template 图无法混色，所以两种外观各画一张）
    private func gaugeImage() -> NSImage {
        let size = NSSize(width: 16, height: 16)
        let img = NSImage(size: size, flipped: false) { rect in
            let c = NSPoint(x: rect.midX, y: rect.midY)
            let r = rect.width / 2 - 1
            let track = NSBezierPath()
            track.appendArc(withCenter: c, radius: r, startAngle: 0, endAngle: 360)
            track.lineWidth = 2
            NSColor.labelColor.withAlphaComponent(0.35).setStroke(); track.stroke()
            let arc = NSBezierPath()
            arc.appendArc(withCenter: c, radius: r, startAngle: 90, endAngle: -90, clockwise: true)
            arc.lineWidth = 2; arc.lineCapStyle = .round
            NSColor.labelColor.setStroke(); arc.stroke()
            return true
        }
        img.isTemplate = false
        return img
    }

    // MARK: 点击状态栏图标

    private func installStatusClick() {
        status.button?.target = self
        status.button?.action = #selector(statusClicked)
        status.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc private func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            status.menu = menu
            status.button?.performClick(nil)
            status.menu = nil
        } else {
            toggle()
        }
    }

    private func toast(_ s: String) {
        let a = NSAlert(); a.messageText = s; a.addButton(withTitle: "好")
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }
}

/// 面板外的那圈阴影区：点它就等于点“面板外面”，收起面板
final class ShadowHost: NSView {
    var onClickOutsidePanel: (() -> Void)?
    override func mouseDown(with e: NSEvent) { onClickOutsidePanel?() }
}
