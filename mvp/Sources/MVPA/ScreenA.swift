import AppKit
import HUDKit
import HUDCore

// 坐标全部来自原型实测（docs/reboot/explore/measure-p11.json）

private enum M {
    static let panelW: CGFloat = 352
    static let pad: CGFloat = 12
    static let headerY: CGFloat = 13
    static let modH: CGFloat = 107
    static let modR: CGFloat = 12
    static let modPad: CGFloat = 12
    static let cmdH: CGFloat = 28
    static let cmdR: CGFloat = 6
    static let heroY: CGFloat = 49
    static let duoY: CGFloat = 164
    static let footerH: CGFloat = 81.5   // 与最后一块之间的 8 + 分组线 + 两行命令 + 底部 12
    static let sepOffset: CGFloat = 73.5  // 分组线距底边
}

final class ScreenA: BaseScreen {
    private var selected: Int?
    private var hoverModule: Int?
    private var hoverCmd: Int?

    override var preferredWidth: CGFloat { M.panelW }

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
        let y = M.duoY + CGFloat(row) * (h + gap)
        if count % 2 == 1 && i == count - 1 {
            return NSRect(x: M.pad, y: y, width: M.panelW - 2 * M.pad, height: h)
        }
        return NSRect(x: M.pad + CGFloat(i % 2) * (w + gap), y: y, width: w, height: h)
    }


    private func feedTweens() {
        for (i, r) in readings.enumerated() {
            guard case let .ok(ws) = r.state, let t = ws.min(by: { $0.remaining < $1.remaining }) else { continue }
            tweens.set("A\(i)head", value: CGFloat(t.remaining),
                       text: "\(Int((t.remaining * 100).rounded()))")
            for (j, w) in ws.enumerated() {
                tweens.set("A\(i)w\(j)", value: CGFloat(w.remaining),
                           text: "\(Int((w.remaining * 100).rounded()))%")
            }
        }
    }

    override func apply(_ readings: [AccountReading], updatedAt: Date?, refreshing: Bool) {
        super.apply(readings, updatedAt: updatedAt, refreshing: refreshing)
        feedTweens()
        // 验收用：AIHUD_SELECT=n 直接进第 n 个账号的二级页
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

    // MARK: 高度

    override func measuredHeight() -> CGFloat {
        if readings.isEmpty { return 200 }
        if let s = selected, s < readings.count { return detailHeight(readings[s]) }
        let rows = (restIndices.count + 1) / 2
        if rows == 0 { return 49 + M.modH + M.footerH }
        let duo = CGFloat(rows) * M.modH + CGFloat(rows - 1) * 8
        return 49 + M.modH + 8 + duo + M.footerH
    }

    private func detailHeight(_ r: AccountReading) -> CGFloat {
        let body: CGFloat
        switch r.state {
        case let .ok(ws):
            let timed = ws.filter { $0.resetText != nil && !($0.resetText!.contains("到期")) }
            body = timed.isEmpty ? 58 : CGFloat(timed.count) * 68 + CGFloat(max(timed.count - 1, 0)) * 4
        default:
            body = 24 + 57 + 28 + 8
        }
        return 49 + body + M.footerH
    }

    private func footerTop(_ h: CGFloat) -> CGFloat { h - M.footerH }
    private func cmd1Y(_ h: CGFloat) -> CGFloat { h - 12 - 56 }
    private func cmd2Y(_ h: CGFloat) -> CGFloat { h - 12 - 28 }

    // MARK: 事件

    override func mouseMoved(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        var m: Int?; var c: Int?
        if selected == nil && !readings.isEmpty {
            if NSRect(x: M.pad, y: M.heroY, width: M.panelW - 2 * M.pad, height: M.modH).contains(p) { m = -1 }
            for (i, _) in restIndices.enumerated() where duoRect(i, count: restIndices.count).contains(p) { m = i }
        }
        let h = measuredHeight()
        if NSRect(x: 5, y: cmd1Y(h), width: 342, height: 28).contains(p) { c = 0 }
        else if NSRect(x: 5, y: cmd2Y(h), width: 342, height: 28).contains(p) { c = 1 }
        if m != hoverModule || c != hoverCmd { hoverModule = m; hoverCmd = c; needsDisplay = true }
    }

    override func mouseExited(with e: NSEvent) {
        if hoverModule != nil || hoverCmd != nil { hoverModule = nil; hoverCmd = nil; needsDisplay = true }
    }

    override func mouseDown(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)
        let h = measuredHeight()

        if let s = selected, s < readings.count {
            if NSRect(x: M.pad, y: M.headerY, width: 28, height: 28).contains(p) {
                pendingTransition = .pushBack
                selected = nil; hoverModule = nil; needsDisplay = true; onHeightChange?(); return
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

        if !readings.isEmpty {
            if NSRect(x: M.pad, y: M.heroY, width: M.panelW - 2 * M.pad, height: M.modH).contains(p) {
                pendingTransition = .pushForward
                pendingAnchor = NSRect(x: M.pad, y: M.heroY, width: M.panelW - 2 * M.pad, height: M.modH)
                selected = heroIndex; needsDisplay = true; onHeightChange?(); return
            }
            for (i, idx) in restIndices.enumerated() where duoRect(i, count: restIndices.count).contains(p) {
                pendingTransition = .pushForward
                pendingAnchor = duoRect(i, count: restIndices.count)
                selected = idx; needsDisplay = true; onHeightChange?(); return
            }
        }
        if NSRect(x: 5, y: cmd1Y(h), width: 342, height: 28).contains(p) { onLogin?(""); return }
    }

    // MARK: 绘制

    override func draw(_ dirtyRect: NSRect) {
        if readings.isEmpty { drawEmpty(); return }
        if let s = selected, s < readings.count { drawDetail(readings[s]); return }
        drawLevel1()
    }

    private func drawHeader(title: String, plan: String?, back: Bool) {
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
        drawSymbol("arrow.clockwise", in: NSRect(x: M.panelW - M.pad - 28, y: M.headerY, width: 28, height: 28),
                   color: Theme.label2, size: 13, rotation: spinAngle)
    }

    private func drawLevel1() {
        drawText("AI 额度", font: Theme.f13b, color: Theme.label, x: M.pad, midY: M.headerY + 14)
        let stamp = refreshing ? "刷新中…" : (updatedAt.map { "剩余 · " + hhmm($0) + " 更新" } ?? "剩余")
        let titleW = ("AI 额度" as NSString).size(withAttributes: [.font: Theme.f13b]).width
        drawText(stamp, font: Theme.f11, color: Theme.label2, x: M.pad + titleW + 6, midY: M.headerY + 15)
        drawSymbol("arrow.clockwise", in: NSRect(x: M.panelW - M.pad - 28, y: M.headerY, width: 28, height: 28),
                   color: Theme.label2, size: 13, rotation: spinAngle)

        if let hi = heroIndex {
            drawModule(readings[hi], index: hi, rect: NSRect(x: M.pad, y: M.heroY, width: 326, height: M.modH),
                       hero: true, hovered: hoverModule == -1)
        }
        for (i, idx) in restIndices.enumerated() {
            drawModule(readings[idx], index: idx, rect: duoRect(i, count: restIndices.count),
                       hero: false, hovered: hoverModule == i)
        }
        let h = measuredHeight()
        drawHairline(y: h - M.sepOffset, x: M.pad, width: 326)
        drawCommand(y: cmd1Y(h), title: "添加账号…", key: nil, hovered: hoverCmd == 0)
        drawCommand(y: cmd2Y(h), title: "AI HUD 设置…", key: "⌘,", hovered: hoverCmd == 1)
    }

    private func drawModule(_ r: AccountReading, index: Int, rect: NSRect, hero: Bool, hovered: Bool) {
        (hovered ? Theme.hover : Theme.moduleFill).setFill()
        NSBezierPath(roundedRect: rect, xRadius: M.modR, yRadius: M.modR).fill()
        let x = rect.minX + M.modPad
        let right = rect.maxX - M.modPad

        // 名称 + 徽章：先给徽章留位置，名称放不下就截断，绝不让徽章被压成一个字
        var sub: [String] = []
        if let plan = r.meta.plan, plan != r.meta.label { sub.append(plan) }
        if hero, r.meta.providerName != r.meta.label { sub.append(r.meta.providerName) }
        let subText = sub.joined(separator: " · ")
        let avail = right - x - 16            // 16 给右侧箭头
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
            let key = "A\(index)head"
            let shown = tweens.value(key).map(Double.init) ?? w.remaining
            if let tr = tweens.text(key) {
                // 旧值淡出上移 2pt，新值淡入
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
            drawBar(x: x, y: rect.minY + 69, width: right - x, height: 6,
                    progress: shown, color: low ? Theme.red : Theme.green)
            let meta = moduleMeta(w)
            drawText(meta, font: Theme.f11, color: Theme.label2, x: x, midY: rect.minY + 88, maxWidth: right - x)
        case .reauth, .limited, .unreadable:
            drawText("需重新授权", font: Theme.f13b, color: Theme.orange, x: x, midY: rect.minY + 46)
            drawBar(x: x, y: rect.minY + 69, width: right - x, height: 6, progress: 0, color: Theme.label2)
            drawText("登录已失效", font: Theme.f11, color: Theme.label2, x: x, midY: rect.minY + 87)
        }
    }

    private func drawDetail(_ r: AccountReading) {
        drawHeader(title: r.meta.label, plan: r.meta.plan, back: true)
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
            // 连接两个圆点：从本行点下沿到下一行点上沿，不留缝
            NSRect(x: railX, y: y + 30, width: 1, height: 66).fill()
        }
        Theme.label2.withAlphaComponent(0.75).setFill()
        NSBezierPath(ovalIn: NSRect(x: railX - 3, y: y + 24, width: 7, height: 7)).fill()

        let bx: CGFloat = 125
        let bw = M.panelW - M.pad - bx
        drawText(w.label.hasSuffix("窗口") ? w.label : w.label + "窗口", font: Theme.f13, color: Theme.label,
                 x: bx, midY: y + 21)
        let low = w.isLow
        let key = "A\(index)w\(window)"
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
            NSBezierPath(roundedRect: rect, xRadius: M.cmdR, yRadius: M.cmdR).fill()
        }
        drawText(title, font: Theme.f13, color: Theme.label, x: 13, midY: rect.midY)
        if let key { drawText(key, font: Theme.f13, color: Theme.label2, x: 339, midY: rect.midY, right: true) }
    }

    private func drawEmpty() {
        drawText("AI 额度", font: Theme.f13b, color: Theme.label, x: M.pad, midY: M.headerY + 14)
        drawSymbol("arrow.clockwise", in: NSRect(x: M.panelW - M.pad - 28, y: M.headerY, width: 28, height: 28),
                   color: Theme.label2, size: 13, rotation: spinAngle)
        drawText("还没有账号", font: Theme.f13, color: Theme.label, x: M.pad, midY: 100)
        drawText("点菜单栏图标 → 添加账号", font: Theme.f11, color: Theme.label2, x: M.pad, midY: 120)
        drawHairline(y: 200 - M.sepOffset, x: M.pad, width: 326)
        drawCommand(y: cmd1Y(200), title: "添加账号…", key: nil, hovered: false)
        drawCommand(y: cmd2Y(200), title: "AI HUD 设置…", key: "⌘,", hovered: false)
    }

    private func hhmm(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
    }

}
