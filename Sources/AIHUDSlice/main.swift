import AppKit

// MARK: - 大号桌面组件（按 mockup-v5 方向三的大号尺寸：宽 364，内边距 16）

final class WidgetView: NSView {
    var readings: [Reading] = [] { didSet { needsDisplay = true } }
    var updatedAt: Date?
    var refreshing = false { didSet { needsDisplay = true } }
    var emptyHint = "还没有账号：点菜单栏图标 → 添加账号"

    override var isFlipped: Bool { true }

    static let W: CGFloat = 364, pad: CGFloat = 16
    static let labelCol: CGFloat = 40, valueCol: CGFloat = 120, gap: CGFloat = 8

    static func height(for rs: [Reading]) -> CGFloat {
        var h = pad + 14 + 4
        if rs.isEmpty { return h + 8 + 16 + pad }
        for r in rs {
            h += 8 + 16                                   // 上内边距 + 账号行
            switch r.status {
            case let .ok(bars): h += CGFloat(bars.count) * 24
            default: h += 24
            }
            h += 8
        }
        return h + pad - 8
    }

    private func text(_ s: String, _ size: CGFloat, _ weight: NSFont.Weight, _ color: NSColor, mono: Bool = false) -> NSAttributedString {
        let font = mono ? NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
        return NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: color])
    }

    private func draw(_ a: NSAttributedString, x: CGFloat, midY: CGFloat, right: Bool = false, maxW: CGFloat? = nil) {
        let sz = a.size()
        let w = min(sz.width, maxW ?? sz.width)
        let ox = right ? x - w : x
        a.draw(with: NSRect(x: ox, y: midY - sz.height / 2, width: w, height: sz.height),
               options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    }

    override func draw(_ dirtyRect: NSRect) {
        let W = bounds.width, P = Self.pad, R = W - P
        let tf = DateFormatter(); tf.dateFormat = "HH:mm:ss"
        // 标题行
        var y = P + 7
        draw(text("AI 额度", 11, .semibold, NSColor.labelColor.withAlphaComponent(0.72)), x: P, midY: y)
        let stamp = refreshing ? "刷新中…" : (updatedAt.map { "\(tf.string(from: $0)) 更新" } ?? "")
        draw(text(stamp, 11, .regular, NSColor.labelColor.withAlphaComponent(0.5), mono: true), x: R, midY: y, right: true)
        y = P + 14 + 4

        if readings.isEmpty {
            draw(text(emptyHint, 13, .regular, NSColor.labelColor.withAlphaComponent(0.72)), x: P, midY: y + 8 + 8)
            return
        }
        let barX = P + Self.labelCol + Self.gap
        let barW = R - Self.valueCol - Self.gap - barX
        for (i, r) in readings.enumerated() {
            if i > 0 {
                NSColor.separatorColor.setFill()
                NSRect(x: P, y: y, width: W - 2 * P, height: 1).fill()
            }
            y += 8
            // 账号行：名字 · 等级 ……… 渠道
            let name = text(r.label, 13, .semibold, .labelColor)
            draw(name, x: P, midY: y + 8, maxW: 200)
            if let plan = r.plan {
                draw(text(plan, 10, .semibold, NSColor.labelColor.withAlphaComponent(0.72)), x: P + min(name.size().width, 200) + 6, midY: y + 8.5)
            }
            let provider = ["claude": "Claude", "codex": "Codex", "workbuddy": "WorkBuddy"][r.provider] ?? r.provider
            switch r.status {
            case .ok: draw(text(provider, 11, .regular, NSColor.labelColor.withAlphaComponent(0.72)), x: R, midY: y + 8, right: true)
            case let .reauth(m), let .limited(m), let .unreadable(m):
                draw(text(m, 11, .medium, .systemOrange), x: R, midY: y + 8, right: true, maxW: 220)
            }
            y += 16
            switch r.status {
            case let .ok(bars):
                for b in bars {
                    let mid = y + 8 + 8
                    draw(text(b.label, 11, .regular, NSColor.labelColor.withAlphaComponent(0.72)), x: P, midY: mid)
                    let low = b.remaining < 0.2
                    let track = NSBezierPath(roundedRect: NSRect(x: barX, y: mid - 3, width: barW, height: 6), xRadius: 3, yRadius: 3)
                    NSColor.labelColor.withAlphaComponent(0.12).setFill(); track.fill()
                    let fw = max(6, barW * CGFloat(b.remaining))
                    if b.remaining > 0 {
                        (low ? NSColor.systemRed : NSColor.systemGreen).setFill()
                        NSBezierPath(roundedRect: NSRect(x: barX, y: mid - 3, width: fw, height: 6), xRadius: 3, yRadius: 3).fill()
                    }
                    let v = NSMutableAttributedString(attributedString: text(b.valueText, 13, .semibold, low ? .systemRed : .labelColor, mono: true))
                    if let rt = b.resetText { v.append(text(" · \(rt)", 11, .regular, NSColor.labelColor.withAlphaComponent(0.72), mono: true)) }
                    draw(v, x: R, midY: mid, right: true, maxW: Self.valueCol)
                    y += 24
                }
            default:
                let mid = y + 8 + 8
                draw(text("—", 11, .regular, NSColor.labelColor.withAlphaComponent(0.5)), x: P, midY: mid)
                let dash = NSBezierPath()
                dash.move(to: NSPoint(x: barX, y: mid)); dash.line(to: NSPoint(x: barX + barW, y: mid))
                dash.lineWidth = 1.5; dash.setLineDash([4, 4], count: 2, phase: 0)
                NSColor.labelColor.withAlphaComponent(0.5).setStroke(); dash.stroke()
                draw(text("无数据", 11, .regular, NSColor.labelColor.withAlphaComponent(0.5)), x: R, midY: mid, right: true)
                y += 24
            }
            y += 8
        }
    }
}

// MARK: - App

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var window: NSWindow!
    var widget = WidgetView()
    var effect: NSVisualEffectView!
    var status: NSStatusItem!
    var readings: [Reading] = []
    var refreshing = false

    func applicationDidFinishLaunching(_ n: Notification) {
        Log.line("APP launch")
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu(); menu.delegate = self
        status.menu = menu
        renderStatus()

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: WidgetView.W, height: 120),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.isMovableByWindowBackground = true
        effect = NSVisualEffectView()
        effect.material = .hudWindow
        effect.blendingMode = .behindWindow
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 22
        effect.layer?.masksToBounds = true
        effect.addSubview(widget)
        window.contentView = effect
        layout()
        window.orderFront(nil)

        readings = Store.all().map { Reading(provider: $0.provider, label: $0.label, plan: $0.plan, status: .unreadable("读取中…"), fetchedAt: Date()) }
        widget.readings = readings
        layout()
        refresh(trigger: "launch")

        // 测试钩子：SIGUSR1 走与菜单「立即刷新」完全相同的路径
        signal(SIGUSR1, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        src.setEventHandler { [weak self] in self?.refreshNow(nil) }
        src.resume()
        sigSource = src
    }
    var sigSource: DispatchSourceSignal?

    func layout() {
        let h = WidgetView.height(for: widget.readings)
        let vf = NSScreen.main!.visibleFrame
        let origin = NSPoint(x: vf.minX + 24, y: vf.maxY - 24 - h)
        window.setFrame(NSRect(origin: origin, size: NSSize(width: WidgetView.W, height: h)), display: true, animate: false)
        widget.frame = NSRect(x: 0, y: 0, width: WidgetView.W, height: h)
        effect.frame = widget.frame
    }

    // MARK: 菜单（每次打开时按当前状态重建）

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        var alerts = 0
        for r in readings {
            switch r.status {
            case let .ok(bars):
                if let low = bars.min(by: { $0.remaining < $1.remaining }), low.remaining < 0.2 {
                    menu.addItem(withTitle: "\(r.label) 剩 \(low.valueText)（\(low.label)）", action: nil, keyEquivalent: "")
                    alerts += 1
                }
            case .reauth:
                let it = NSMenuItem(title: "重新授权「\(r.label)」…", action: #selector(login(_:)), keyEquivalent: "")
                it.representedObject = r.provider; it.target = self
                menu.addItem(it); alerts += 1
            default: break
            }
        }
        if alerts > 0 { menu.addItem(.separator()) }
        let refresh = NSMenuItem(title: refreshing ? "正在刷新…" : "立即刷新", action: refreshing ? nil : #selector(refreshNow(_:)), keyEquivalent: "r")
        refresh.target = self
        menu.addItem(refresh)
        let add = NSMenuItem(title: "添加账号", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (p, t) in [("claude", "Claude…"), ("codex", "Codex…"), ("workbuddy", "WorkBuddy（国内站）…")] {
            let it = NSMenuItem(title: t, action: #selector(login(_:)), keyEquivalent: "")
            it.representedObject = p; it.target = self
            sub.addItem(it)
        }
        add.submenu = sub
        menu.addItem(add)
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 AI HUD", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    }

    @objc func login(_ sender: NSMenuItem) {
        guard let p = sender.representedObject as? String else { return }
        Task { @MainActor in
            do {
                switch p {
                case "claude": try await Claude.login()
                case "codex": try await Codex.login()
                default: try await WorkBuddy.login()
                }
                NSApp.activate(ignoringOtherApps: true)
                refresh(trigger: "login-\(p)")
            } catch {
                Log.line("AUTH \(p) failed: \(error)")
                let a = NSAlert(); a.messageText = "授权未完成"; a.informativeText = "\(error)"; a.runModal()
            }
        }
    }

    @objc func refreshNow(_ sender: Any?) { refresh(trigger: "manual") }

    func refresh(trigger: String) {
        guard !refreshing else { return }
        let metas = Store.all()
        guard !metas.isEmpty else { widget.updatedAt = Date(); widget.readings = []; layout(); return }
        refreshing = true
        widget.refreshing = true
        Log.line("REFRESH start trigger=\(trigger) accounts=\(metas.count)")
        Task.detached {
            let out = await withTaskGroup(of: (Int, Reading).self) { g -> [Reading] in
                for (i, m) in metas.enumerated() { g.addTask { (i, await Fetch.one(m)) } }
                var arr = [(Int, Reading)]()
                for await x in g { arr.append(x) }
                return arr.sorted { $0.0 < $1.0 }.map(\.1)
            }
            await MainActor.run {
                self.readings = out
                self.refreshing = false
                self.widget.updatedAt = Date()
                self.widget.refreshing = false
                self.widget.readings = out
                self.layout()
                self.renderStatus()
                let summary = out.map { r -> String in
                    switch r.status {
                    case let .ok(b): return "\(r.provider)=" + b.map { "\($0.label):\($0.valueText)" }.joined(separator: ",")
                    case let .reauth(m), let .limited(m), let .unreadable(m): return "\(r.provider)=\(m)"
                    }
                }
                Log.line("REFRESH done trigger=\(trigger) \(summary.joined(separator: " | "))")
            }
        }
    }

    // MARK: 菜单栏：平时只有图标；低于 20% 显示红字最低百分比；需重新授权带「!」

    func renderStatus() {
        guard let b = status.button else { return }
        let img = NSImage(systemSymbolName: "gauge.with.dots.needle.33percent", accessibilityDescription: "AI 额度")
        img?.isTemplate = true
        b.image = img
        b.imagePosition = .imageLeading
        var lowest: Double?
        var needsAuth = false
        for r in readings {
            switch r.status {
            case let .ok(bars): for x in bars { lowest = min(lowest ?? 1, x.remaining) }
            case .reauth: needsAuth = true
            default: break
            }
        }
        let s = NSMutableAttributedString()
        if let l = lowest, l < 0.2 {
            s.append(NSAttributedString(string: " \(pct(l))", attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .bold), .foregroundColor: NSColor.systemRed]))
        }
        if needsAuth {
            s.append(NSAttributedString(string: " !", attributes: [
                .font: NSFont.systemFont(ofSize: 13, weight: .bold), .foregroundColor: NSColor.systemOrange]))
        }
        b.attributedTitle = s
    }
}

// MARK: - 入口：--login <provider> / --fetch（命令行验证）/ 默认 GUI

let args = CommandLine.arguments
if args.count >= 3, args[1] == "--login" {
    let p = args[2]
    let sem = DispatchSemaphore(value: 0)
    var code: Int32 = 0
    Task {
        do {
            switch p {
            case "claude": try await Claude.login()
            case "codex": try await Codex.login()
            case "workbuddy": try await WorkBuddy.login()
            default: throw HTTPError(status: -9, body: "未知渠道 \(p)")
            }
            print("OK \(p) 已授权，凭据写入钥匙串 service=\(Vault.service) account=\(p)")
        } catch { print("FAIL \(p): \(error) \((error as? HTTPError)?.body.prefix(200) ?? "")"); code = 1 }
        sem.signal()
    }
    // 回调监听需要运行循环
    while sem.wait(timeout: .now()) == .timedOut { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
    exit(code)
} else if args.count >= 2, args[1] == "--fetch" {
    let sem = DispatchSemaphore(value: 0)
    Task {
        for m in Store.all() {
            let r = await Fetch.one(m)
            switch r.status {
            case let .ok(bars): print("✔ \(m.provider) \(r.label) \(r.plan ?? "") | " + bars.map { "\($0.label) \($0.valueText) \($0.resetText ?? "")" }.joined(separator: " | "))
            case let .reauth(x), let .limited(x), let .unreadable(x): print("✘ \(m.provider) \(r.label) | \(x)")
            }
        }
        sem.signal()
    }
    while sem.wait(timeout: .now()) == .timedOut { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = App()
app.delegate = delegate
app.run()
