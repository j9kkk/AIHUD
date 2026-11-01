import AppKit
import HUDKit
import HUDCore

// 合并版：B 的列表/圆环 + A 的控制中心模块（第三种视图）+ A 的时间轴详情
// 坐标来自 measure-p11.json / measure-p12.json

enum Metrics {
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

final class PanelScreen: BaseScreen {
    enum Mode: Int { case list = 0, grid = 1, modules = 2 }
    var mode: Mode = Mode(rawValue: UserDefaults.standard.integer(forKey: "AIHUD.view")) ?? .list {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: "AIHUD.view")
            isSwitching = true
            needsDisplay = true; onHeightChange?()
        }
    }
    var selected: Int?
    var hoverRow: Int?
    var hoverCmd: Int?
    var hoverSeg: Int?

    override var preferredWidth: CGFloat { Metrics.panelW }


    func feedTweens() {
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
        isSwitching = true
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
            return 49 + 58 + Metrics.footerH
        }
        if let s = selected, s < readings.count { return detailHeight(readings[s]) }
        switch mode {
        case .list:
            return 49 + CGFloat(readings.count) * Metrics.rowH + Metrics.footerH
        case .grid:
            let rows = (readings.count + 3) / 4
            return 49 + CGFloat(rows) * Metrics.tileH + CGFloat(max(rows - 1, 0)) * 8 + Metrics.footerH
        case .modules:
            let rows = (restIndices.count + 1) / 2
            if rows == 0 { return 49 + Metrics.modH + Metrics.footerH + 8 }
            return 49 + Metrics.modH + 8 + CGFloat(rows) * Metrics.modH + CGFloat(rows - 1) * 8 + Metrics.footerH + 8
        }
    }

    func detailHeight(_ r: AccountReading) -> CGFloat {
        let body: CGFloat
        switch r.state {
        case let .ok(ws):
            let timed = ws.filter { $0.resetText != nil && !($0.resetText!.contains("到期")) }
            if timed.isEmpty { body = 49 + 58 }
            else { body = 49 + CGFloat(timed.count) * 68 + CGFloat(max(timed.count - 1, 0)) * 4 }
        default:
            body = 49 + 24 + 57 + 28 + 8      // A 版异常详情
        }
        return body + Metrics.footerH
    }

    func footerTop(_ h: CGFloat) -> CGFloat { h - Metrics.footerH }
    func cmd1Y(_ h: CGFloat) -> CGFloat { h - 12 - 56 }
    func cmd2Y(_ h: CGFloat) -> CGFloat { h - 12 - 28 }

    func rowRect(_ i: Int) -> NSRect {
        NSRect(x: Metrics.pad, y: 49 + CGFloat(i) * Metrics.rowH, width: Metrics.panelW - 2 * Metrics.pad, height: Metrics.rowH)
    }
    func tileRect(_ i: Int) -> NSRect {
        let row = i / 4, col = i % 4
        return NSRect(x: 9 + CGFloat(col) * Metrics.tileW, y: 49 + CGFloat(row) * (Metrics.tileH + 8), width: Metrics.tileW, height: Metrics.tileH)
    }
    var segRect: NSRect { NSRect(x: 215, y: Metrics.headerY, width: 90, height: 28) }

    // MARK: 模块视图（A 版一级）

    var heroIndex: Int? {
        let okOnes = readings.enumerated().filter { if case .ok = $0.element.state { return true }; return false }
        if let best = okOnes.min(by: { ($0.element.tightest?.remaining ?? 1) < ($1.element.tightest?.remaining ?? 1) }) {
            return best.offset
        }
        return readings.isEmpty ? nil : 0
    }
    var restIndices: [Int] {
        guard let h = heroIndex else { return [] }
        return readings.indices.filter { $0 != h }
    }
    func duoRect(_ i: Int, count: Int) -> NSRect {
        let w: CGFloat = 159, h: CGFloat = Metrics.modH, gap: CGFloat = 8
        let row = i / 2
        let y = Metrics.heroY + Metrics.modH + 8 + CGFloat(row) * (h + gap)
        if count % 2 == 1 && i == count - 1 {
            return NSRect(x: Metrics.pad, y: y, width: Metrics.panelW - 2 * Metrics.pad, height: h)
        }
        return NSRect(x: Metrics.pad + CGFloat(i % 2) * (w + gap), y: y, width: w, height: h)
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
                if let hi = heroIndex, NSRect(x: Metrics.pad, y: Metrics.heroY, width: Metrics.panelW - 2 * Metrics.pad, height: Metrics.modH).contains(p) {
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
            if NSRect(x: Metrics.pad, y: Metrics.headerY, width: 28, height: 28).contains(p) {
                isSwitching = true
                selected = nil; hoverRow = nil; needsDisplay = true; onHeightChange?(); return
            }
            if case .reauth = readings[s].state,
               NSRect(x: Metrics.panelW - Metrics.pad - 86, y: footerTop(h) - 36, width: 86, height: 28).contains(p) {
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
                isSwitching = true
                selected = i; needsDisplay = true; onHeightChange?(); return
            }
        case .grid:
            for i in readings.indices where tileRect(i).contains(p) {
                isSwitching = true
                selected = i; needsDisplay = true; onHeightChange?(); return
            }
        case .modules:
            let heroRect = NSRect(x: Metrics.pad, y: Metrics.heroY, width: Metrics.panelW - 2 * Metrics.pad, height: Metrics.modH)
            if heroRect.contains(p), let hi = heroIndex {
                isSwitching = true
                selected = hi; needsDisplay = true; onHeightChange?(); return
            }
            for (i, idx) in restIndices.enumerated() {
                let r = duoRect(i, count: restIndices.count)
                if r.contains(p) {
                    isSwitching = true
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
        drawHairline(y: h - Metrics.sepOffset, x: Metrics.pad, width: 326)
        drawCommand(y: cmd1Y(h), title: "添加账号…", key: nil, hovered: hoverCmd == 0)
        drawCommand(y: cmd2Y(h), title: "AI HUD 设置…", key: "⌘,", hovered: hoverCmd == 1)
    }

    func drawCommand(y: CGFloat, title: String, key: String?, hovered: Bool) {
        let rect = NSRect(x: 5, y: y, width: 342, height: Metrics.cmdH)
        if hovered {
            Theme.hover.setFill()
            NSBezierPath(roundedRect: rect, xRadius: 6, yRadius: 6).fill()
        }
        drawText(title, font: Theme.f13, color: Theme.label, x: 13, midY: rect.midY)
        if let key { drawText(key, font: Theme.f13, color: Theme.label2, x: 339, midY: rect.midY, right: true) }
    }

    func drawRing24(_ r: AccountReading, key: String, center: NSPoint) {
        if let t = r.tightest {
            drawRing(center: center, radius: 12, lineWidth: 3, progress: tweens.value(key).map(Double.init) ?? t.remaining,
                     color: t.isLow ? Theme.red : Theme.green)
        } else {
            drawRing(center: center, radius: 12, lineWidth: 3, progress: nil, color: Theme.orange)
            drawSymbol("exclamationmark.triangle", in: NSRect(x: center.x - 6, y: center.y - 6, width: 12, height: 12),
                       color: Theme.orange, size: 8)
        }
    }

    func drawEmpty() {
        drawHeader()
        drawText("还没有账号", font: Theme.f13, color: Theme.label, x: Metrics.pad, midY: 90)
        drawText("点菜单栏图标 → 添加账号", font: Theme.f11, color: Theme.label2, x: Metrics.pad, midY: 110)
        drawHairline(y: measuredHeight() - Metrics.sepOffset, x: Metrics.pad, width: 326)
        drawCommand(y: cmd1Y(measuredHeight()), title: "添加账号…", key: nil, hovered: false)
        drawCommand(y: cmd2Y(measuredHeight()), title: "AI HUD 设置…", key: "⌘,", hovered: false)
    }

    // MARK: 文案

    func listContent(_ r: AccountReading) -> (String?, String, Bool) {
        switch r.state {
        case let .ok(ws):
            guard let t = ws.min(by: { $0.remaining < $1.remaining }) else { return (nil, "无数据", false) }
            return ("\(Int((t.remaining * 100).rounded()))%", listMeta(t), t.isLow)
        case .reauth: return (nil, "登录已失效 · 需重新授权", false)
        case let .limited(m), let .unreadable(m): return (nil, m, false)
        }
    }

    func gridMetaText(_ r: AccountReading) -> (String, NSColor) {
        switch r.state {
        case let .ok(ws):
            guard let t = ws.min(by: { $0.remaining < $1.remaining }) else { return ("无数据", Theme.label2) }
            return (gridMeta(t), Theme.label2)
        case .reauth: return ("需重新授权", Theme.orange)
        case .limited: return ("限流中", Theme.orange)
        case .unreadable: return ("读不到", Theme.orange)
        }
    }

    func shortReset(_ s: String?) -> String {
        guard var t = s, !t.isEmpty else { return "" }
        t = t.replacingOccurrences(of: "今天 ", with: "")
        if let m = t.range(of: #"^(\d{1,2})月(\d{1,2})日.*$"#, options: .regularExpression) {
            let nums = String(t[m]).components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }
            if nums.count >= 2 { return "\(nums[0])/\(nums[1])" }
        }
        if t.contains("到期") { return "到期" }
        return t
    }

    func hhmm(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
    }
}

extension AccountReading {
    var isBroken: Bool { if case .reauth = state { return true }; return false }
}
