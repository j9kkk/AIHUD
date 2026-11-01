import AppKit
import HUDKit
import HUDCore

// 合并版：B 的列表/圆环 + A 的控制中心模块（第三种视图）+ A 的时间轴详情
// 坐标来自 measure-p11.json / measure-p12.json

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
    static let modH: CGFloat = 107
    static let modR: CGFloat = 12
    static let modPad: CGFloat = 12
    static let heroY: CGFloat = 49
}

final class ScreenM: BaseScreen {
    private enum Mode: Int { case list = 0, grid = 1, modules = 2 }
    private var mode: Mode = Mode(rawValue: UserDefaults.standard.integer(forKey: "MVPM.view")) ?? .list {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: "MVPM.view")
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
            tweens.set("M\(i)head", value: CGFloat(t.remaining),
                       text: "\(Int((t.remaining * 100).rounded()))%")
            for (j, w) in ws.enumerated() {
                tweens.set("M\(i)w\(j)", value: CGFloat(w.remaining),
                           text: "\(Int((w.remaining * 100).rounded()))%")
            }
        }
    }

    override func apply(_ readings: [AccountReading], updatedAt: Date?, refreshing: Bool) {
        super.apply(readings, updatedAt: updatedAt, refreshing: refreshing)
        feedTweens()
        // 验收用：AIHUD_VIEW=0/1 指定视图，AIHUD_SELECT=n 直接进第 n 个账号的详情
        if let raw = ProcessInfo.processInfo.environment["AIHUD_VIEW"], let v = Int(raw),
           let m = Mode(rawValue: v) {
            mode = m
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

    override func debugToggleView() {
        mode = Mode(rawValue: (mode.rawValue + 1) % 3) ?? .list
    }

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
        case .modules:
            let rows = (restIndices.count + 1) / 2
            if rows == 0 { return 49 + M.modH + M.footerH + 8 }
            return 49 + M.modH + 8 + CGFloat(rows) * M.modH + CGFloat(rows - 1) * 8 + M.footerH + 8
        }
    }

    private func detailHeight(_ r: AccountReading) -> CGFloat {
        let body: CGFloat
        switch r.state {
        case let .ok(ws):
            let timed = ws.filter { $0.resetText != nil && !($0.resetText!.contains("到期")) }
            if timed.isEmpty { body = 49 + 58 }
            else { body = 49 + CGFloat(timed.count) * 68 + CGFloat(max(timed.count - 1, 0)) * 4 }
        default:
            body = 49 + 24 + 57 + 28 + 8      // A 版异常详情
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
    private var segRect: NSRect { NSRect(x: 215, y: M.headerY, width: 90, height: 28) }

    // MARK: 模块视图（A 版一级）

    private var heroIndex: Int? {
        let okOnes = readings.enumerated().filter { if case .ok = $0.element.state { return true }; return false }
        if let best = okOnes.min(by: { ($0.element.tightest?.remaining ?? 1) < ($1.element.tightest?.remaining ?? 1) }) {
            return best.offset
        }
        return readings.isEmpty ? nil : 0
    }
    private var restIndices: [Int] {
        guard let h = heroIndex else { return [] }
        return readings.indices.filter { $0 != h }
    }
    private func duoRect(_ i: Int, count: Int) -> NSRect {
        let w: CGFloat = 159, h: CGFloat = M.modH, gap: CGFloat = 8
        let row = i / 2
        let y = M.heroY + M.modH + 8 + CGFloat(row) * (h + gap)
        if count % 2 == 1 && i == count - 1 {
            return NSRect(x: M.pad, y: y, width: M.panelW - 2 * M.pad, height: h)
        }
        return NSRect(x: M.pad + CGFloat(i % 2) * (w + gap), y: y, width: w, height: h)
    }

    // MARK: 事件

    override func mouseMoved(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        var r: Int?; var c: Int?; var s: Int?
        if segRect.contains(p) { s = min(2, max(0, Int((p.x - segRect.minX) / 30))) }
        if selected == nil {
            switch mode {
            case .list:
                for i in readings.indices where rowRect(i).contains(p) { r = i }
            case .grid:
                for i in readings.indices where tileRect(i).contains(p) { r = i }
            case .modules:
                if let hi = heroIndex, NSRect(x: M.pad, y: M.heroY, width: M.panelW - 2 * M.pad, height: M.modH).contains(p) {
                    r = hi
                }
                for (i, idx) in restIndices.enumerated() where duoRect(i, count: restIndices.count).contains(p) { r = idx }
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
            mode = Mode(rawValue: min(2, max(0, Int((p.x - segRect.minX) / 30)))) ?? .list
            return
        }
        switch mode {
        case .list:
            for i in readings.indices where rowRect(i).contains(p) {
                pendingTransition = .pushForward
                pendingAnchor = rowRect(i)
                selected = i; needsDisplay = true; onHeightChange?(); return
            }
        case .grid:
            for i in readings.indices where tileRect(i).contains(p) {
                pendingTransition = .pushForward
                pendingAnchor = tileRect(i)
                selected = i; needsDisplay = true; onHeightChange?(); return
            }
        case .modules:
            let heroRect = NSRect(x: M.pad, y: M.heroY, width: M.panelW - 2 * M.pad, height: M.modH)
            if heroRect.contains(p), let hi = heroIndex {
                pendingTransition = .pushForward
                pendingAnchor = heroRect
                selected = hi; needsDisplay = true; onHeightChange?(); return
            }
            for (i, idx) in restIndices.enumerated() {
                let r = duoRect(i, count: restIndices.count)
                if r.contains(p) {
                    pendingTransition = .pushForward
                    pendingAnchor = r
                    selected = idx; needsDisplay = true; onHeightChange?(); return
                }
            }
        }
        if NSRect(x: 5, y: cmd1Y(h), width: 342, height: 28).contains(p) { onLogin?(""); return }
    }

    // MARK: 绘制

    override func draw(_ dirtyRect: NSRect) {
        if readings.isEmpty { drawEmpty(); return }
        if let s = selected, s < readings.count { drawDetail(readings[s]); return }
        drawHeader()
        switch mode {
        case .list: drawList()
        case .grid: drawGrid()
        case .modules: drawModules()
        }
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
        let icons = ["list.bullet", "square.grid.2x2", "rectangle.split.2x1"]
        for i in 0..<3 {
            let cell = NSRect(x: segRect.minX + CGFloat(i) * 30, y: segRect.minY, width: 30, height: 28)
            if Int(mode.rawValue) == i {
                Theme.segThumb.setFill()
                NSBezierPath(roundedRect: cell.insetBy(dx: 3, dy: 3), xRadius: 5, yRadius: 5).fill()
            } else if hoverSeg == i {
                Theme.hover.setFill()
                NSBezierPath(roundedRect: cell.insetBy(dx: 3, dy: 3), xRadius: 5, yRadius: 5).fill()
            }
            drawSymbol(icons[i], in: cell.insetBy(dx: 8, dy: 7),
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
            let key = "M\(i)head"
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

    private func drawModules() {
        if let hi = heroIndex {
            drawModule(readings[hi], index: hi,
                       rect: NSRect(x: M.pad, y: M.heroY, width: 326, height: M.modH),
                       hero: true, hovered: hoverRow == hi)
        }
        for (i, idx) in restIndices.enumerated() {
            drawModule(readings[idx], index: idx, rect: duoRect(i, count: restIndices.count),
                       hero: false, hovered: hoverRow == idx)
        }
    }

    private func drawModule(_ r: AccountReading, index: Int, rect: NSRect, hero: Bool, hovered: Bool) {
        (hovered ? Theme.hover : Theme.moduleFill).setFill()
        NSBezierPath(roundedRect: rect, xRadius: M.modR, yRadius: M.modR).fill()
        let x = rect.minX + M.modPad
        let right = rect.maxX - M.modPad

        var sub: [String] = []
        if let plan = r.meta.plan, plan != r.meta.label { sub.append(plan) }
        if hero, r.meta.providerName != r.meta.label { sub.append(r.meta.providerName) }
        let subText = sub.joined(separator: " · ")
        let avail = right - x - 16
        let subW = subText.isEmpty ? 0 : (subText as NSString).size(withAttributes: [.font: Theme.f10]).width.rounded(.up)
        let showSub = !subText.isEmpty && avail - subW - 6 > 60
        let nameMax = showSub ? avail - subW - 6 : avail
        drawText(r.meta.label, font: Theme.f13b, color: Theme.label, x: x, midY: rect.minY + 21, maxWidth: nameMax)
        let nameW = min((r.meta.label as NSString).size(withAttributes: [.font: Theme.f13b]).width, nameMax)
        if showSub {
            drawText(subText, font: Theme.f10, color: Theme.label2,
                     x: x + nameW + 6, midY: rect.minY + 22.5, maxWidth: right - (x + nameW + 6) - 14)
        }
        drawSymbol("chevron.right", in: NSRect(x: right - 12, y: rect.minY + 15, width: 12, height: 12),
                   color: Theme.label2, size: 10, weight: .regular)

        switch r.state {
        case let .ok(ws):
            let w = ws.min { $0.remaining < $1.remaining }!
            let low = w.isLow
            let color = low ? Theme.red : Theme.label
            let valueMidY = rect.minY + 49.5
            let key = "M\(index)head"
            let shown = tweens.value(key).map(Double.init) ?? w.remaining
            if let tr = tweens.text(key) {
                drawRich([(tr.old, Theme.f17b, color.withAlphaComponent(1 - tr.t)),
                          ("%", Theme.rounded13, color.withAlphaComponent(1 - tr.t))],
                         x: x, midY: valueMidY - 2 * tr.t)
                drawRich([(tr.new, Theme.f17b, color.withAlphaComponent(tr.t)),
                          ("%", Theme.rounded13, color.withAlphaComponent(tr.t))],
                         x: x, midY: valueMidY + 2 * (1 - tr.t))
            } else {
                drawRich([("\(Int((w.remaining * 100).rounded()))", Theme.f17b, color),
                          ("%", Theme.rounded13, color)],
                         x: x, midY: valueMidY)
            }
            if hero {
                let detail = w.label == "积分" ? "剩 \(w.valueText)" : (w.resetText ?? "")
                drawText(detail, font: Theme.f11, color: Theme.label2, x: right, midY: rect.minY + 51, right: true)
            }
            drawBar(x: x, y: rect.minY + 69, width: right - x, height: 6, progress: shown,
                    color: low ? Theme.red : Theme.green)
            drawText(moduleMeta(w), font: Theme.f11, color: Theme.label2, x: x, midY: rect.minY + 88, maxWidth: right - x)
        case .reauth, .limited, .unreadable:
            drawText("需重新授权", font: Theme.f13b, color: Theme.orange, x: x, midY: rect.minY + 46)
            drawBar(x: x, y: rect.minY + 69, width: right - x, height: 6, progress: 0, color: Theme.label2)
            drawText("登录已失效", font: Theme.f11, color: Theme.label2, x: x, midY: rect.minY + 87)
        }
    }

    private func drawDetail(_ r: AccountReading) {
        drawHeader(back: true, title: r.meta.label, plan: r.meta.plan)
        switch r.state {
        case let .ok(ws):
            let timed = ws.filter { $0.resetText != nil && !($0.resetText!.contains("到期")) }
            let credits = ws.filter { $0.resetText?.contains("到期") == true }
            if timed.isEmpty {
                let t = credits.first ?? ws.first!
                drawText("积分余量", font: Theme.f11, color: Theme.label2, x: M.pad + 2, midY: 57)
                drawText(t.valueText, font: Theme.f17b, color: t.isLow ? Theme.red : Theme.label, x: M.pad, midY: 84)
                drawText(t.resetText ?? "", font: Theme.f11, color: Theme.label2, x: M.pad, midY: 106)
            } else {
                var y: CGFloat = 49
                let idx = readings.firstIndex(where: { $0.meta.provider == r.meta.provider }) ?? 0
                for (i, w) in timed.enumerated() {
                    drawTimelineRow(w, index: idx, window: i, y: y, isLast: i == timed.count - 1)
                    y += 68 + (i == timed.count - 1 ? 0 : 4)
                }
            }
        default:
            drawText("登录已失效，没有可用的恢复时间", font: Theme.f11, color: Theme.label2,
                     x: M.pad + 2, midY: 57, maxWidth: 300)
            drawSymbol("exclamationmark.triangle", in: NSRect(x: M.pad, y: 84, width: 20, height: 20),
                       color: Theme.orange, size: 15)
            drawText("无法读取配额", font: Theme.f13b, color: Theme.label, x: M.pad + 20, midY: 94)
            drawText("10月29日起没有新数据", font: Theme.f11, color: Theme.label2,
                     x: M.pad + 20, midY: 112, maxWidth: 240)
            let h = measuredHeight()
            let btn = NSRect(x: M.panelW - M.pad - 86, y: footerTop(h) - 36, width: 86, height: 26)
            Theme.accent.setFill()
            NSBezierPath(roundedRect: btn, xRadius: 6, yRadius: 6).fill()
            drawText("重新授权…", font: Theme.f13, color: .white, x: btn.minX + 12, midY: btn.midY)
        }
        let h = measuredHeight()
        drawHairline(y: h - M.sepOffset, x: M.pad, width: 326)
        drawCommand(y: cmd1Y(h), title: "打开 \(r.meta.providerName) 用量页面…", key: nil, hovered: hoverCmd == 0)
        drawCommand(y: cmd2Y(h), title: "移除此账号…", key: nil, hovered: hoverCmd == 1)
    }

    private func drawTimelineRow(_ w: QuotaWindow, index: Int, window: Int, y: CGFloat, isLast: Bool) {
        let (cd, at) = resetPair(w)
        drawText(cd, font: Theme.f13b, color: Theme.label, x: M.pad, midY: y + 20, maxWidth: 84)
        drawText(at, font: Theme.f10, color: Theme.label2, x: M.pad, midY: y + 36, maxWidth: 84)

        let railX = M.pad + 96
        if !isLast {
            Theme.sep.setFill()
            NSRect(x: railX, y: y + 30, width: 1, height: 66).fill()
        }
        Theme.label2.withAlphaComponent(0.75).setFill()
        NSBezierPath(ovalIn: NSRect(x: railX - 3, y: y + 24, width: 7, height: 7)).fill()

        let bx: CGFloat = 125
        let bw = M.panelW - M.pad - bx
        drawText(w.label.hasSuffix("窗口") ? w.label : w.label + "窗口", font: Theme.f13, color: Theme.label,
                 x: bx, midY: y + 21)
        let low = w.isLow
        let key = "M\(index)w\(window)"
        let shown = tweens.value(key).map(Double.init) ?? w.remaining
        if let tr = tweens.text(key) {
            let c = low ? Theme.red : Theme.label
            drawText(tr.old, font: Theme.f17b, color: c.withAlphaComponent(1 - tr.t),
                     x: M.panelW - M.pad, midY: y + 19 - 2 * tr.t, right: true)
            drawText(tr.new, font: Theme.f17b, color: c.withAlphaComponent(tr.t),
                     x: M.panelW - M.pad, midY: y + 19 + 2 * (1 - tr.t), right: true)
        } else {
            drawText("\(Int((w.remaining * 100).rounded()))%", font: Theme.f17b, color: low ? Theme.red : Theme.label,
                     x: M.panelW - M.pad, midY: y + 19, right: true)
        }
        drawBar(x: bx, y: y + 37, width: bw, height: 6, progress: shown, color: low ? Theme.red : Theme.green)
        drawText(w.label.contains("周") ? "周配额重置至 100%" : "重置至 100%",
                 font: Theme.f11, color: Theme.label2, x: bx, midY: y + 54, maxWidth: bw)
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
