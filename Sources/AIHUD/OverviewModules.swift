import AppKit
import HUDKit
import HUDCore

// 一级 · 模块：最紧张账号通栏 + 其余两列卡片（容量条）。

extension PanelScreen {

    func drawModules() {
        if let hi = heroIndex {
            drawModule(readings[hi], index: hi,
                       rect: NSRect(x: Metrics.pad, y: Metrics.heroY, width: 326, height: Metrics.modH),
                       hero: true, hovered: hoverRow == hi)
        }
        for (i, idx) in restIndices.enumerated() {
            drawModule(readings[idx], index: idx, rect: duoRect(i, count: restIndices.count),
                       hero: false, hovered: hoverRow == idx)
        }
    }

    func drawModule(_ r: AccountReading, index: Int, rect: NSRect, hero: Bool, hovered: Bool) {
        (hovered ? Theme.hover : Theme.moduleFill).setFill()
        NSBezierPath(roundedRect: rect, xRadius: Metrics.modR, yRadius: Metrics.modR).fill()
        let x = rect.minX + Metrics.modPad
        let right = rect.maxX - Metrics.modPad

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
}
