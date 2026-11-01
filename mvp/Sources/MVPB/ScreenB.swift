import AppKit
import HUDKit
import HUDCore

// 坐标全部来自原型实测（docs/reboot/explore/measure-p12.json）

private enum M {
    static let panelW: CGFloat = 352
    static let pad: CGFloat = 12
    static let headerY: CGFloat = 13
    static let rowH: CGFloat = 56
    static let tileW: CGFloat = 83.5
    static let tileH: CGFloat = 97
    static let cmdH: CGFloat = 28
    static let footerH: CGFloat = 79.5
    static let sepOffset: CGFloat = 73.5
}

final class ScreenB: BaseScreen {
    private enum Mode: Int { case list = 0, grid = 1 }
    private var mode: Mode = Mode(rawValue: UserDefaults.standard.integer(forKey: "MVPB.view")) ?? .list {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: "MVPB.view")
            pendingTransition = .morph
            needsDisplay = true; onHeightChange?()
        }
    }
    private var selected: Int?
    private var hoverRow: Int?
    private var hoverCmd: Int?
    private var hoverSeg: Int?

    override var preferredWidth: CGFloat { M.panelW }


    private func feedTweens() {
        for (i, r) in readings.enumerated() {
            guard case let .ok(ws) = r.state, let t = ws.min(by: { $0.remaining < $1.remaining }) else { continue }
            tweens.set("B\(i)head", value: CGFloat(t.remaining),
                       text: "\(Int((t.remaining * 100).rounded()))%")
            for (j, w) in ws.enumerated() {
                tweens.set("B\(i)w\(j)", value: CGFloat(w.remaining),
                           text: "\(Int((w.remaining * 100).rounded()))%")
            }
        }
    }

    override func apply(_ readings: [AccountReading], updatedAt: Date?, refreshing: Bool) {
        super.apply(readings, updatedAt: updatedAt, refreshing: refreshing)
        feedTweens()
        // 验收用：AIHUD_VIEW=0/1 指定视图，AIHUD_SELECT=n 直接进第 n 个账号的详情
        if let raw = ProcessInfo.processInfo.environment["AIHUD_VIEW"], let v = Int(raw) {
            mode = (v == 1) ? .grid : .list
        }
        if let raw = ProcessInfo.processInfo.environment["AIHUD_SELECT"], let n = Int(raw),
           n >= 0, n < readings.count, selected == nil {
            selected = n
            onHeightChange?()
        }
    }

    override func debugSelect(_ index: Int?) {
        pendingTransition = (index == nil) ? .pushBack : .pushForward
        selected = (index != nil && index! >= 0 && index! < readings.count) ? index : nil
        needsDisplay = true
        onHeightChange?()
    }

    override func debugToggleView() { mode = (mode == .list) ? .grid : .list }

    // MARK: 高度

    override func measuredHeight() -> CGFloat {
        if readings.isEmpty {
            return 49 + 58 + M.footerH
        }
        if let s = selected, s < readings.count { return detailHeight(readings[s]) }
        switch mode {
        case .list:
            return 49 + CGFloat(readings.count) * M.rowH + M.footerH
        case .grid:
            let rows = (readings.count + 3) / 4
            return 49 + CGFloat(rows) * M.tileH + CGFloat(max(rows - 1, 0)) * 8 + M.footerH
        }
    }

    private func detailHeight(_ r: AccountReading) -> CGFloat {
        let body: CGFloat
        switch r.state {
        case let .ok(ws):
            body = 49 + 107 + CGFloat(max(ws.count - 2, 0)) * 46
        default:
            body = 192                        // 总高 271.5 = 192 + footer 79.5，分割线落在 y=198
        }
        return body + M.footerH
    }

    private func footerTop(_ h: CGFloat) -> CGFloat { h - M.footerH }
    private func cmd1Y(_ h: CGFloat) -> CGFloat { h - 12 - 56 }
    private func cmd2Y(_ h: CGFloat) -> CGFloat { h - 12 - 28 }

    private func rowRect(_ i: Int) -> NSRect {
        NSRect(x: M.pad, y: 49 + CGFloat(i) * M.rowH, width: M.panelW - 2 * M.pad, height: M.rowH)
    }
    private func tileRect(_ i: Int) -> NSRect {
        let row = i / 4, col = i % 4
        return NSRect(x: 9 + CGFloat(col) * M.tileW, y: 49 + CGFloat(row) * (M.tileH + 8), width: M.tileW, height: M.tileH)
    }
    private var segRect: NSRect { NSRect(x: 245, y: M.headerY, width: 60, height: 28) }

    // MARK: 事件

    override func mouseMoved(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        var r: Int?; var c: Int?; var s: Int?
        if segRect.contains(p) { s = p.x < segRect.midX ? 0 : 1 }
        if selected == nil {
            if mode == .list {
                for i in readings.indices where rowRect(i).contains(p) { r = i }
            } else {
                for i in readings.indices where tileRect(i).contains(p) { r = i }
            }
        }
        let h = measuredHeight()
        if NSRect(x: 5, y: cmd1Y(h), width: 342, height: 28).contains(p) { c = 0 }
        else if NSRect(x: 5, y: cmd2Y(h), width: 342, height: 28).contains(p) { c = 1 }
        if r != hoverRow || c != hoverCmd || s != hoverSeg {
            hoverRow = r; hoverCmd = c; hoverSeg = s; needsDisplay = true
        }
    }

    override func mouseExited(with e: NSEvent) {
        if hoverRow != nil || hoverCmd != nil || hoverSeg != nil {
            hoverRow = nil; hoverCmd = nil; hoverSeg = nil; needsDisplay = true
        }
    }

    override func mouseDown(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        let h = measuredHeight()

        if let s = selected, s < readings.count {
            if NSRect(x: M.pad, y: M.headerY, width: 28, height: 28).contains(p) {
                pendingTransition = .pushBack
                selected = nil; hoverRow = nil; needsDisplay = true; onHeightChange?(); return
            }
            if case .reauth = readings[s].state,
               NSRect(x: M.panelW - M.pad - 86, y: footerTop(h) - 36, width: 86, height: 28).contains(p) {
                onLogin?(readings[s].meta.provider); return
            }
            if NSRect(x: 5, y: cmd1Y(h), width: 342, height: 28).contains(p) {
                onOpenUsage?(readings[s].meta.provider); return
            }
            if NSRect(x: 5, y: cmd2Y(h), width: 342, height: 28).contains(p) {
                onRemove?(readings[s].meta.provider); return
            }
            return
        }

        if segRect.contains(p) {
            mode = (p.x < segRect.midX) ? .list : .grid
            return
        }
        if mode == .list {
            for i in readings.indices where rowRect(i).contains(p) {
                pendingTransition = .pushForward
                pendingAnchor = rowRect(i)
                selected = i; needsDisplay = true; onHeightChange?(); return
            }
        } else {
            for i in readings.indices where tileRect(i).contains(p) {
                pendingTransition = .pushForward
                pendingAnchor = tileRect(i)
                selected = i; needsDisplay = true; onHeightChange?(); return
            }
        }
        if NSRect(x: 5, y: cmd1Y(h), width: 342, height: 28).contains(p) { onLogin?(""); return }
    }

    // MARK: 绘制

    override func draw(_ dirtyRect: NSRect) {
        if readings.isEmpty { drawEmpty(); return }
        if let s = selected, s < readings.count { drawDetail(readings[s]); return }
        drawHeader()
        if mode == .list { drawList() } else { drawGrid() }
        let h = measuredHeight()
        drawHairline(y: h - M.sepOffset, x: M.pad, width: 326)
        drawCommand(y: cmd1Y(h), title: "添加账号…", key: nil, hovered: hoverCmd == 0)
        drawCommand(y: cmd2Y(h), title: "AI HUD 设置…", key: "⌘,", hovered: hoverCmd == 1)
    }

    private func drawHeader(back: Bool = false, title: String = "AI 额度", plan: String? = nil) {
        var x = M.pad
        if back {
            drawSymbol("chevron.left", in: NSRect(x: M.pad, y: M.headerY, width: 28, height: 28),
                       color: Theme.label2, size: 13, weight: .semibold)
            x = M.pad + 28
        }
        drawText(title, font: Theme.f13b, color: Theme.label, x: x, midY: M.headerY + 14)
        if let plan, !plan.isEmpty {
            let w = (title as NSString).size(withAttributes: [.font: Theme.f13b]).width
            drawText(plan, font: Theme.f10, color: Theme.label2, x: x + w + 6, midY: M.headerY + 15)
        }
        if !back {
            let stamp = refreshing ? "刷新中…" : (updatedAt.map { "剩余 · " + hhmm($0) + " 更新" } ?? "剩余")
            drawText(stamp, font: Theme.f11, color: Theme.label2, x: M.pad + 48, midY: M.headerY + 15)
            drawSegmented()
        }
        drawSymbol("arrow.clockwise", in: NSRect(x: M.panelW - M.pad - 28, y: M.headerY, width: 28, height: 28),
                   color: Theme.label2, size: 13, rotation: spinAngle)
    }

    private func drawSegmented() {
        Theme.segTrack.setFill()
        NSBezierPath(roundedRect: segRect, xRadius: 7, yRadius: 7).fill()
        for i in 0..<2 {
            let cell = NSRect(x: segRect.minX + CGFloat(i) * 30, y: segRect.minY, width: 30, height: 28)
            if Int(mode.rawValue) == i {
                Theme.segThumb.setFill()
                NSBezierPath(roundedRect: cell.insetBy(dx: 3, dy: 3), xRadius: 5, yRadius: 5).fill()
            } else if hoverSeg == i {
                Theme.hover.setFill()
                NSBezierPath(roundedRect: cell.insetBy(dx: 3, dy: 3), xRadius: 5, yRadius: 5).fill()
            }
            drawSymbol(i == 0 ? "list.bullet" : "square.grid.2x2",
                       in: cell.insetBy(dx: 8, dy: 7),
                       color: Int(mode.rawValue) == i ? Theme.label : Theme.label2, size: 11)
        }
    }

    private func drawList() {
        let valRight: CGFloat = 303               // 原型 .val 右边缘；到圆环还有 10pt 间隙
        for (i, r) in readings.enumerated() {
            let rect = rowRect(i)
            if hoverRow == i {
                Theme.hover.setFill()
                NSBezierPath(roundedRect: rect.insetBy(dx: -2, dy: 0), xRadius: 8, yRadius: 8).fill()
            }
            let x = rect.minX + 2
            drawText(r.meta.label, font: Theme.f13b, color: Theme.label, x: x, midY: rect.minY + 20, maxWidth: 200)
            if let plan = r.meta.plan, plan != r.meta.label {
                let w = min((r.meta.label as NSString).size(withAttributes: [.font: Theme.f13b]).width, 200)
                drawText(plan, font: Theme.f10, color: Theme.label2, x: x + w + 6, midY: rect.minY + 21.5)
            }
            let (value, meta, low) = listContent(r)
            drawText(meta, font: Theme.f11,
                     color: r.isBroken ? Theme.orange : Theme.label2, x: x, midY: rect.minY + 37, maxWidth: 236)
            let key = "B\(i)head"
            if let v = value {
                if let tr = tweens.text(key) {
                    let c = low ? Theme.red : Theme.label
                    drawText(tr.old, font: Theme.f13b, color: c.withAlphaComponent(1 - tr.t),
                             x: valRight, midY: rect.minY + 28 - 2 * tr.t, right: true)
                    drawText(tr.new, font: Theme.f13b, color: c.withAlphaComponent(tr.t),
                             x: valRight, midY: rect.minY + 28 + 2 * (1 - tr.t), right: true)
                } else {
                    drawText(v, font: Theme.f13b, color: low ? Theme.red : Theme.label,
                             x: valRight, midY: rect.minY + 28, right: true)
                }
            }
            drawRing24(r, key: key, center: NSPoint(x: 325, y: rect.minY + 28))
            if i < readings.count - 1 {
                drawHairline(y: rect.maxY, x: M.pad, width: 326)
            }
        }
    }

    private func drawGrid() {
        for (i, r) in readings.enumerated() {
            let rect = tileRect(i)
            if hoverRow == i {
                Theme.hover.setFill()
                NSBezierPath(roundedRect: rect, xRadius: 10, yRadius: 10).fill()
            }
            let c = NSPoint(x: rect.midX, y: rect.minY + 31)
            if let t = r.tightest {
                let low = t.isLow
                let key = "B\(i)head"
                drawRing(center: c, radius: 23.5, lineWidth: 5,
                         progress: tweens.value(key).map(Double.init) ?? t.remaining,
                         color: low ? Theme.red : Theme.green)
                if let tr = tweens.text(key) {
                    let col = low ? Theme.red : Theme.label
                    drawText(tr.old, font: Theme.f15b, color: col.withAlphaComponent(1 - tr.t),
                             x: c.x, midY: c.y - 2 * tr.t, center: true, maxWidth: 44)
                    drawText(tr.new, font: Theme.f15b, color: col.withAlphaComponent(tr.t),
                             x: c.x, midY: c.y + 2 * (1 - tr.t), center: true, maxWidth: 44)
                } else {
                    drawText("\(Int((t.remaining * 100).rounded()))%", font: Theme.f15b,
                             color: low ? Theme.red : Theme.label, x: c.x, midY: c.y, center: true, maxWidth: 44)
                }
            } else {
                drawRing(center: c, radius: 23.5, lineWidth: 5, progress: nil, color: Theme.orange)
                drawSymbol("exclamationmark.triangle", in: NSRect(x: c.x - 8, y: c.y - 8, width: 16, height: 16),
                           color: Theme.orange, size: 12)
            }
            let name = r.meta.label.contains("@") ? r.meta.providerName : r.meta.label
            drawText(name, font: Theme.f11, color: Theme.label, x: rect.midX, midY: rect.minY + 71, center: true,
                     maxWidth: M.tileW - 6)
            let (meta, color) = gridMetaText(r)
            drawText(meta, font: Theme.f10, color: color, x: rect.midX, midY: rect.minY + 84.5, center: true,
                     maxWidth: M.tileW - 4)
        }
    }

    private func drawDetail(_ r: AccountReading) {
        drawHeader(back: true, title: r.meta.label, plan: r.meta.plan)
        let wellH: CGFloat = { if case let .ok(ws) = r.state { return 107 + CGFloat(max(ws.count - 2, 0)) * 46 }; return 105 }()
        let well = NSRect(x: M.pad, y: 49, width: 326, height: wellH)
        Theme.wellFill.setFill()
        NSBezierPath(roundedRect: well, xRadius: 10, yRadius: 10).fill()

        switch r.state {
        case let .ok(ws):
            var y = well.minY + 10
            for (i, w) in ws.enumerated() {
                let rowTop = y
                let c = NSPoint(x: 39, y: rowTop + 23)          // 原型 .rg: x=25, 28pt, 行内 +9
                let key = "B\(readings.firstIndex(where: { $0.meta.provider == r.meta.provider }) ?? 0)w\(i)"
                drawRing(center: c, radius: 14, lineWidth: 3.5,
                         progress: tweens.value(key).map(Double.init) ?? w.remaining,
                         color: w.isLow ? Theme.red : Theme.green)
                drawText(w.label.hasSuffix("窗口") ? w.label : w.label + "窗口", font: Theme.f13, color: Theme.label,
                         x: 63, midY: rowTop + 16)
                drawText(resetLine(w), font: Theme.f11, color: Theme.label2, x: 63, midY: rowTop + 31,
                         maxWidth: 210)
                let val = "\(Int((w.remaining * 100).rounded()))"
                let col = w.isLow ? Theme.red : Theme.label
                if let tr = tweens.text(key) {
                    drawRich([(tr.old.replacingOccurrences(of: "%", with: ""), Theme.f17b, col.withAlphaComponent(1 - tr.t)),
                              ("%", Theme.rounded13, col.withAlphaComponent(1 - tr.t))],
                             x: 327, midY: rowTop + 23 - 2 * tr.t, right: true)
                    drawRich([(tr.new.replacingOccurrences(of: "%", with: ""), Theme.f17b, col.withAlphaComponent(tr.t)),
                              ("%", Theme.rounded13, col.withAlphaComponent(tr.t))],
                             x: 327, midY: rowTop + 23 + 2 * (1 - tr.t), right: true)
                } else {
                    drawRich([(val, Theme.f17b, col), ("%", Theme.rounded13, col)],
                             x: 327, midY: rowTop + 23, right: true)
                }
                y += 46
                if i < ws.count - 1 {
                    drawHairline(y: y - 2, x: M.pad + 25, width: 302 - 25)
                }
            }
        default:
            drawSymbol("exclamationmark.triangle", in: NSRect(x: 26, y: 67, width: 26, height: 24),
                       color: Theme.orange, size: 22)
            drawText("登录已失效", font: Theme.f13, color: Theme.label, x: 61, midY: 71)
            drawText("10月29日起没有新数据，重新授权后保留别名与历史", font: Theme.f11, color: Theme.label2,
                     x: 61, midY: 89.5, maxWidth: 257)
            drawHairline(y: 103, x: M.pad + 12, width: 302)
            drawRing(center: NSPoint(x: 39, y: 127), radius: 14, lineWidth: 3.5, progress: nil, color: Theme.orange)
            drawText("5 小时 / 本周 窗口", font: Theme.f13, color: Theme.label, x: 63, midY: 120)
            drawText("上次成功读取：10月29日 14:20", font: Theme.f11, color: Theme.label2,
                     x: 63, midY: 135, maxWidth: 215)
            drawText("无数据", font: Theme.f13, color: Theme.label2, x: 327, midY: 127, right: true)

            let btn = NSRect(x: 252.6, y: 160, width: 86.4, height: 28)
            Theme.accent.setFill()
            NSBezierPath(roundedRect: btn, xRadius: 6, yRadius: 6).fill()
            drawText("重新授权…", font: Theme.f13, color: .white, x: btn.minX + 13, midY: btn.midY)
        }

        let h = measuredHeight()
        drawHairline(y: h - M.sepOffset, x: M.pad, width: 326)
        drawCommand(y: cmd1Y(h), title: "打开 \(r.meta.providerName) 用量页面…", key: nil, hovered: hoverCmd == 0)
        drawCommand(y: cmd2Y(h), title: "移除此账号…", key: nil, hovered: hoverCmd == 1)
    }

    private func drawCommand(y: CGFloat, title: String, key: String?, hovered: Bool) {
        let rect = NSRect(x: 5, y: y, width: 342, height: M.cmdH)
        if hovered {
            Theme.hover.setFill()
            NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6).fill()
        }
        drawText(title, font: Theme.f13, color: Theme.label, x: 13, midY: rect.midY)
        if let key { drawText(key, font: Theme.f13, color: Theme.label2, x: 339, midY: rect.midY, right: true) }
    }

    private func drawRing24(_ r: AccountReading, key: String, center: NSPoint) {
        if let t = r.tightest {
            drawRing(center: center, radius: 12, lineWidth: 3, progress: tweens.value(key).map(Double.init) ?? t.remaining,
                     color: t.isLow ? Theme.red : Theme.green)
        } else {
            drawRing(center: center, radius: 12, lineWidth: 3, progress: nil, color: Theme.orange)
            drawSymbol("exclamationmark.triangle", in: NSRect(x: center.x - 6, y: center.y - 6, width: 12, height: 12),
                       color: Theme.orange, size: 8)
        }
    }

    private func drawEmpty() {
        drawHeader()
        drawText("还没有账号", font: Theme.f13, color: Theme.label, x: M.pad, midY: 90)
        drawText("点菜单栏图标 → 添加账号", font: Theme.f11, color: Theme.label2, x: M.pad, midY: 110)
        drawHairline(y: measuredHeight() - M.sepOffset, x: M.pad, width: 326)
        drawCommand(y: cmd1Y(measuredHeight()), title: "添加账号…", key: nil, hovered: false)
        drawCommand(y: cmd2Y(measuredHeight()), title: "AI HUD 设置…", key: "⌘,", hovered: false)
    }

    // MARK: 文案

    private func listContent(_ r: AccountReading) -> (String?, String, Bool) {
        switch r.state {
        case let .ok(ws):
            guard let t = ws.min(by: { $0.remaining < $1.remaining }) else { return (nil, "无数据", false) }
            return ("\(Int((t.remaining * 100).rounded()))%", listMeta(t), t.isLow)
        case .reauth: return (nil, "登录已失效 · 需重新授权", false)
        case let .limited(m), let .unreadable(m): return (nil, m, false)
        }
    }

    private func gridMetaText(_ r: AccountReading) -> (String, NSColor) {
        switch r.state {
        case let .ok(ws):
            guard let t = ws.min(by: { $0.remaining < $1.remaining }) else { return ("无数据", Theme.label2) }
            return (gridMeta(t), Theme.label2)
        case .reauth: return ("需重新授权", Theme.orange)
        case .limited: return ("限流中", Theme.orange)
        case .unreadable: return ("读不到", Theme.orange)
        }
    }

    private func shortReset(_ s: String?) -> String {
        guard var t = s, !t.isEmpty else { return "" }
        t = t.replacingOccurrences(of: "今天 ", with: "")
        if let m = t.range(of: #"^(\d{1,2})月(\d{1,2})日.*$"#, options: .regularExpression) {
            let nums = String(t[m]).components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }
            if nums.count >= 2 { return "\(nums[0])/\(nums[1])" }
        }
        if t.contains("到期") { return "到期" }
        return t
    }

    private func hhmm(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
    }
}

private extension AccountReading {
    var isBroken: Bool { if case .reauth = state { return true }; return false }
}
