import AppKit
import HUDCore

/// Shell：状态栏图标、菜单、面板、刷新、登录。两个 MVP 共用，差异只在 HUDScreen 实现。
public final class Shell: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let makeScreen: () -> HUDScreen
    private var panel: NSPanel!
    private var effect: NSVisualEffectView!
    private var host: NSView!
    private var rim: NSView!
    private let shadowMargin: CGFloat = 26
    private var screen: HUDScreen!
    private var status: NSStatusItem!
    private var menu: NSMenu!
    private var closedAt: Date?
    private var lastReading: [AccountReading] = []
    private var updatedAt: Date?
    private var refreshing = false
    private let demoMode = ProcessInfo.processInfo.environment["AIHUD_DEMO"]
    private var demo: Bool { demoMode != nil }
    private let openOnLaunch = ProcessInfo.processInfo.environment["AIHUD_OPEN"] != nil

    public init(screen: @escaping () -> HUDScreen) {
        self.makeScreen = screen
        super.init()
    }

    public func run() {
        if ProcessInfo.processInfo.environment["AIHUD_SWITCH_LIVE"] != nil {
            liveSwitchTest(); return
        }
        if ProcessInfo.processInfo.environment["AIHUD_WIPE_TEST"] != nil {
            wipeTest(); return
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

    /// 复现「面板由小变大」时的边框残影：先空数据、再灌数据，各停 0.5s
    private func growTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        screen.apply([], updatedAt: nil, refreshing: false)
        show()
        func dump(_ tag: String) {
            let v = screen as! NSView
            HUDLog.line(String(format: "GROW %@ panel=%@ effect=%@ rim=%@ v=%@ subviews=%d",
                               tag, NSStringFromRect(panel.frame), NSStringFromRect(effect.frame),
                               NSStringFromRect(rim.frame), NSStringFromRect(v.frame),
                               host.subviews.count))
            print(String(format: "GROW %@ panelH=%.1f effectH=%.1f rimH=%.1f vH=%.1f subs=%d",
                         tag, panel.frame.height, effect.frame.height, rim.frame.height, v.frame.height, host.subviews.count))
            if let subs = host.layer?.sublayers {
                for (i, l) in subs.enumerated() {
                    print(String(format: "  layer[%d] frame=%@ border=%.1f opacity=%.2f", i,
                                 NSStringFromRect(l.frame), l.borderWidth, l.opacity))
                }
            }
        }
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("empty")
        screen.apply(demoMode == "issue" ? HUD.demoIssue() : HUD.demo(), updatedAt: Date(), refreshing: false)
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("loaded")
        screen.debugSelect(0)
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("detail")
        screen.debugSelect(nil)
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("back")
        RunLoop.current.run(until: Date().addingTimeInterval(3.0))
        app.run()
    }

    /// 页面/视图切换回归：每次切换后打印 窗口帧 / 材质层帧 / 内容层帧 / 期望高度
    private func switchTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        if demoMode == "issue" { screen.apply(HUD.demoIssue(), updatedAt: Date(), refreshing: false) }
        else { screen.apply(HUD.demo(), updatedAt: Date(), refreshing: false) }

        func settle() { RunLoop.current.run(until: Date().addingTimeInterval(0.40)) }
        func dump(_ tag: String) {
            let pf = panel.frame
            let ef = effect.frame
            let sf = (screen as! NSView).frame
            let want = screen.measuredHeight()
            HUDLog.line(String(format: "SWITCH %@ panel=%.0fx%.0f@(%.0f,%.0f) effect=%.0fx%.0f@y%.0f content=%.0fx%.0f@y%.0f want=%.1f",
                               tag, pf.width, pf.height, pf.minX, pf.minY,
                               ef.width, ef.height, ef.minY, sf.width, sf.height, sf.minY, want))
            let keys = (screen as? NSView)?.layer?.animationKeys()?.joined(separator: ",") ?? "-"
            print(String(format: "SWITCH %@ panelH=%.1f effectH=%.1f contentH=%.1f contentY=%.1f want=%.1f anim=[%@]",
                         tag, pf.height, ef.height, sf.height, sf.minY, want, keys))
        }
        settle(); show(); settle(); dump("open-list")
        screen.debugToggleView(); let i1 = panel.frame.height; settle()
        dump("grid"); print(String(format: "SWITCH grid immediateH=%.1f", i1))
        screen.debugToggleView(); let i2 = panel.frame.height; settle()
        dump("back-list"); print(String(format: "SWITCH back immediateH=%.1f", i2))
        screen.debugSelect(0); let i3 = panel.frame.height; settle()
        dump("detail"); print(String(format: "SWITCH detail immediateH=%.1f", i3))
        screen.debugSelect(nil); let i4 = panel.frame.height; settle()
        dump("pop"); print(String(format: "SWITCH pop immediateH=%.1f", i4))
        exit(0)
    }

    /// 真窗口验收：打开 → 2 秒后切换视图 → 4 秒后切回，全程保持运行，供外部截图
    private func liveSwitchTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        if demoMode == "issue" { screen.apply(HUD.demoIssue(), updatedAt: Date(), refreshing: false) }
        else { screen.apply(HUD.demo(), updatedAt: Date(), refreshing: false) }
        show()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            self.screen.debugToggleView()
            HUDLog.line(String(format: "LIVE switch#1 panel=%@", NSStringFromRect(self.panel.frame)))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            self.screen.debugToggleView()
            HUDLog.line(String(format: "LIVE switch#2 panel=%@", NSStringFromRect(self.panel.frame)))
        }
        app.run()
    }

    /// 擦除回归：采样两个互补遮罩，任意时刻 旧可见宽 + 新可见宽 = 面板宽
    private func wipeTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        screen.apply(demoMode == "issue" ? HUD.demoIssue() : HUD.demo(), updatedAt: Date(), refreshing: false)
        show()
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))

        screen.debugSelect(0)
        let v = screen as! NSView
        let W = v.bounds.width
        var rows: [String] = []
        for _ in 0..<6 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.045))
            let snapMask = effect.subviews.compactMap { $0 as? NSImageView }.last?.layer?.mask
            let newMask = v.layer?.mask
            let oldW = snapMask?.presentation()?.bounds.width ?? -1
            let newW = newMask?.presentation()?.bounds.width ?? -1
            let sum = oldW + newW
            rows.append(String(format: "old=%.0f new=%.0f sum=%.0f (W=%.0f)", oldW, newW, sum, W))
        }
        print("WIPE " + rows.joined(separator: " | "))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            let leftover = self.effect.subviews.compactMap { $0 as? NSImageView }.count
            let maskLeft = v.layer?.mask != nil
            print("WIPE cleanup snapshots=\(leftover) contentMask=\(maskLeft)")
            exit(0)
        }
        app.run()
    }

    /// 数值补间回归：换一批数值后，采样三次，值应当从旧值单调逼近新值
    private func tweenTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        // 等启动那次 refresh 落定，否则它会把读数改回去，补间被覆盖（测试会看到抖动）
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        let base = demoMode == "issue" ? HUD.demoIssue() : HUD.demo()
        screen.apply(base, updatedAt: Date(), refreshing: false)
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))

        // 造一批新数值（各窗口剩余比例 ×0.5）
        let changed: [AccountReading] = base.map { r in
            guard case let .ok(ws) = r.state else { return r }
            let nw = ws.map { QuotaWindow(label: $0.label, remaining: max(0.02, $0.remaining * 0.5),
                                          valueText: $0.valueText, resetText: $0.resetText,
                                          resetAt: $0.resetAt, isExpiry: $0.isExpiry) }
            return AccountReading(meta: r.meta, state: .ok(nw))
        }
        screen.apply(changed, updatedAt: Date(), refreshing: false)
        var samples: [Double] = []
        for i in 0..<6 {
            if let v = screen.tweens.value("A0head") ?? screen.tweens.value("B0head") { samples.append(Double(v)) }
            if i < 5 { RunLoop.current.run(until: Date().addingTimeInterval(0.06)) }
        }
        let anim = screen.tweens.isAnimating
        print(String(format: "TWEEN samples=%@ animating=%@", samples.map { String(format: "%.3f", $0) }.joined(separator: " -> "),
                     anim ? "yes" : "no"))
        let monotonic = zip(samples, samples.dropFirst()).allSatisfy { $1 <= $0 + 0.001 }
        let moved = abs((samples.first ?? 0) - (samples.last ?? 0)) > 0.05
        exit((monotonic && moved) ? 0 : 1)
    }

    /// 动画过程回归：切换视图后连续采样，检查内容顶边是否始终贴着窗口顶边（gap 应恒为 0）
    private func animTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        screen.apply(demoMode == "issue" ? HUD.demoIssue() : HUD.demo(), updatedAt: Date(), refreshing: false)
        show()
        var samples: [CGFloat] = []
        func sample() {
            guard let v = screen as? NSView else { return }
            // 读呈现层：动画中模型层的值已经是终态，用它测会误判
            let vl = v.layer?.presentation() ?? v.layer
            let el = effect.layer?.presentation() ?? effect.layer
            let viewH = vl?.bounds.height ?? v.frame.height
            let viewY = vl?.frame.origin.y ?? v.frame.origin.y
            let superH = el?.bounds.height ?? effect.bounds.height
            let gap = (superH - viewY) - viewH
            samples.append(gap)
            HUDLog.line(String(format: "ANIM panelH=%.1f contentH=%.1f y=%.1f gap=%.2f",
                               panel.frame.height, v.frame.height, v.frame.origin.y, gap))
        }
        sample()
        screen.debugToggleView()
        for _ in 0..<12 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.016))
            sample()
        }
        let worst = samples.map { abs($0) }.max() ?? 0
        print(String(format: "ANIM RESULT samples=%d worstGap=%.2f", samples.count, worst))
        exit(worst > 0.75 ? 1 : 0)
    }

    /// 面板位移回归测试：反复 打开 → 进二级 → 返回 → 关闭，检查顶边与右边缘是否恒定
    private func geomTest(rounds: Int) {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        if demoMode == "issue" { screen.apply(HUD.demoIssue(), updatedAt: Date(), refreshing: false) }
        else if demoMode != nil { screen.apply(HUD.demo(), updatedAt: Date(), refreshing: false) }
        var tops: [CGFloat] = [], rights: [CGFloat] = []
        for i in 0..<rounds {
            show()
            let f0 = panel.frame
            screen.debugSelect(0)
            let f1 = panel.frame
            screen.debugSelect(nil)
            let f2 = panel.frame
            hide()
            // 按“面板本体”（去掉阴影边距）判断是否出屏，窗口外的那圈是透明的
            let m = shadowMargin
            tops += [f0.maxY - m, f1.maxY - m, f2.maxY - m]
            rights += [f0.maxX - m, f1.maxX - m, f2.maxX - m]
            HUDLog.line(String(format: "GEOM #%d show=%@ select=%@ back=%@", i, NSStringFromRect(f0), NSStringFromRect(f1), NSStringFromRect(f2)))
        }
        let tf = tops.max()! - tops.min()!
        let rf = rights.max()! - rights.min()!
        let vf = NSScreen.main!.visibleFrame
        var bad = 0
        for (i, t) in tops.enumerated() {
            if t > vf.maxY + 0.5 || t < vf.minY - 0.5 { bad += 1 }
            if rights[i] > vf.maxX + 0.5 || rights[i] < vf.minX - 0.5 { bad += 1 }
        }
        HUDLog.line(String(format: "GEOM RESULT rounds=%d topSpread=%.2f rightSpread=%.2f offscreen=%d visible=%@",
                          rounds, tf, rf, bad, NSStringFromRect(vf)))
        print(String(format: "GEOM RESULT topSpread=%.2f rightSpread=%.2f offscreen=%d", tf, rf, bad))
        exit(tf > 0.5 || rf > 0.5 || bad > 0 ? 1 : 0)
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
    private var cachedAnchor: (right: CGFloat, top: CGFloat)?

    private func computeAnchor() -> (right: CGFloat, top: CGFloat) {
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

    private func anchor() -> (right: CGFloat, top: CGFloat) {
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
        if let v = screen as? NSView, let layer = v.layer,
           !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            scaleIn(layer, from: 0.98, duration: 0.28, translateY: -2)
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


    private func place(animated animatedIn: Bool) {
        let transition = screen.pendingTransition
        screen.pendingTransition = nil
        screen.pendingAnchor = nil

        let a = anchor()
        let vf = NSScreen.main?.visibleFrame ?? .zero
        let targetH = min(screen.measuredHeight(), vf.height - 48)
        let animated = animatedIn && ProcessInfo.processInfo.environment["AIHUD_GEOM_TEST"] == nil
        let duration: CFTimeInterval = transition != nil ? 0.20 : 0.18

        applyFrames(a, vf, targetH, animated: animated, duration: duration)

        if transition != nil, ProcessInfo.processInfo.environment["AIHUD_TRACK"] != nil {
            trackFrames(label: "switch")
        }

        if transition != nil, ProcessInfo.processInfo.environment["AIHUD_WIPE"] != nil,
           let v = screen as? NSView {
            // 实验分支：遮罩擦除（默认关闭）
            v.needsDisplay = true
            v.displayIfNeeded()
            playWipe(host: effect, content: v, snapshot: snapshotView(of: v), duration: duration)
        }
    }

    private var heightTimer: Timer?

    /// 高度动画：顶边固定，四层（窗口 / 材质 / 描边 / 内容）逐帧同源。
    /// 关键：内容层高度始终等于**当前**面板高度，顶边对齐 —— 内容不会因为新旧高度差而上下滑。
    private func animateHeight(from oldH: CGFloat, to h: CGFloat, panelFrame f: NSRect,
                               width w: CGFloat, duration: CFTimeInterval) {
        heightTimer?.invalidate()
        let m = shadowMargin
        let v = screen as! NSView
        // 窗口按「两段里更高的那个」一次性定位，动画期间窗口不动，避免窗口服务器逐帧重配；
        // 结束那一帧再收到目标高度（此时面板已到位，外层只是透明边距，看不见）
        let winH = max(oldH, h)
        let topEdge = f.maxY - m
        let big = NSRect(x: f.origin.x, y: topEdge - winH - m, width: f.width, height: winH + 2 * m)
        panel.setFrame(big, display: true)
        let start = CACurrentMediaTime()
        let step: (Timer) -> Void = { [weak self] t in
            guard let self else { t.invalidate(); return }
            let p = min(max((CACurrentMediaTime() - start) / duration, 0), 1)
            let e = p < 0.5 ? 2 * p * p : 1 - pow(-2 * p + 2, 2) / 2
            let cur = oldH + (h - oldH) * CGFloat(e)
            let pr = NSRect(x: m, y: winH + m - cur, width: w, height: cur)
            self.effect.frame = pr
            self.rim.frame = pr
            v.frame = NSRect(x: 0, y: 0, width: w, height: cur)
            self.updateShadowPath(margin: m, w: w, h: cur, y: pr.origin.y)
            v.needsDisplay = true
            if p >= 1 {
                t.invalidate()
                self.heightTimer = nil
                self.panel.setFrame(f, display: false)
                self.effect.frame = NSRect(x: m, y: m, width: w, height: h)
                self.rim.frame = NSRect(x: m, y: m, width: w, height: h)
                v.frame = NSRect(x: 0, y: 0, width: w, height: h)
                self.updateShadowPath(margin: m, w: w, h: h, y: m)
                self.refreshChrome()
            }
        }
        heightTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 120.0, repeats: true, block: step)
        RunLoop.main.add(heightTimer!, forMode: .common)
        step(heightTimer!)
    }

    /// 采样一次切页期间各层在屏幕上的实际位置，用来判断"内容是不是在上下滑"
    private func trackFrames(label: String) {
        let v = screen as! NSView
        var i = 0
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] t in
            guard let self else { t.invalidate(); return }
            let pf = self.panel.frame
            let contentTopWin = self.effect.frame.maxY - v.frame.minY - v.frame.height
            _ = contentTopWin
            let contentTopScreen = self.panel.convertPoint(toScreen: NSPoint(x: 0, y: self.effect.frame.minY + v.frame.maxY))
            let contentBotScreen = self.panel.convertPoint(toScreen: NSPoint(x: 0, y: self.effect.frame.minY + v.frame.minY))
            let sp = self.host.layer?.shadowPath?.boundingBox ?? .zero
            let eff = self.effect.frame
            print(String(format: "TRACK %@ t=%.3f panelTop=%.1f panelBot=%.1f contentTop=%.1f contentBot=%.1f effH=%.1f shadowY=%.1f shadowH=%.1f shadowDY=%.1f",
                         label, Double(i) * 0.016,
                         pf.maxY - 26, pf.minY + 26,
                         contentTopScreen.y, contentBotScreen.y, eff.height,
                         sp.origin.y, sp.height, abs(sp.origin.y - eff.origin.y)))
            i += 1
            if i > 22 { t.invalidate() }
        }
    }

    /// 只负责几何：窗口、材质层、描边层、内容层，四者同源
    private func applyFrames(_ a: (right: CGFloat, top: CGFloat), _ vf: NSRect,
                             _ h: CGFloat, animated: Bool, duration: CFTimeInterval) {
        let w = screen.preferredWidth
        let m = shadowMargin
        var f = NSRect(x: a.right - w - m, y: a.top - h - m, width: w + 2 * m, height: h + 2 * m)
        f.origin.x = max(vf.minX + 8 - m, min(f.origin.x, vf.maxX - w - 8 + m))
        f.origin.y = max(vf.minY + 8 - m, min(f.origin.y, vf.maxY - h - 8 + m))

        let v = screen as! NSView
        let oldH = effect.frame.height
        let panelRect = NSRect(x: m, y: m, width: w, height: h)

        if animated && panel.isVisible && duration > 0 {
            animateHeight(from: oldH, to: h, panelFrame: f, width: w, duration: duration)
        } else {
            heightTimer?.invalidate(); heightTimer = nil
            panel.setFrame(f, display: true)
            effect.frame = panelRect
            rim.frame = panelRect
            v.frame = NSRect(x: 0, y: 0, width: w, height: h)
        }
        updateShadowPath(margin: m, w: w, h: h)
        refreshChrome()
    }

    /// 改尺寸后把材质/描边/内容全部标脏并强制重绘一次。
    /// 不做这一步，旧尺寸的圆角描边会留在窗口缓冲区里，看起来就是一条「边框残影」
    private func refreshChrome() {
        host.needsDisplay = true
        host.layer?.setNeedsDisplay()
        effect.needsDisplay = true
        rim.needsDisplay = true
        (screen as? NSView)?.needsDisplay = true
        effect.layer?.setNeedsDisplay()
        rim.layer?.setNeedsDisplay()
        (screen as? NSView)?.layer?.setNeedsDisplay()
        effect.displayIfNeeded()
        rim.displayIfNeeded()
    }

    /// 阴影路径跟着面板矩形走（窗口比面板大一圈，阴影画在那一圈里）
    private func updateShadowPath(margin m: CGFloat, w: CGFloat, h: CGFloat, y: CGFloat? = nil) {
        guard let l = host.layer else { return }
        // y 必须传面板**当前**在窗口里的下沿：窗口是顶边钉住的，影子若永远从窗口底部起算，
        // 动画期间就会和面板错开一层，看起来就是"阴影在闪"
        l.shadowPath = CGPath(roundedRect: CGRect(x: m, y: y ?? m, width: w, height: h),
                              cornerWidth: 14, cornerHeight: 14, transform: nil)
        // 之前 0.48 / 半径 27 / 偏移 -10 + 一圈 0.5pt 黑描边，
        // 叠起来在面板外就是一道明显的黑环；现在改成"淡影 + 无黑边"
        l.shadowColor = NSColor.black.cgColor
        l.shadowOpacity = 0.30
        l.shadowRadius = 22
        l.shadowOffset = CGSize(width: 0, height: -6)
        // 描边不能放这里：host 覆盖整个窗口，会把边框画在窗口外框上
        l.cornerRadius = 0
    }

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
