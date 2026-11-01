import AppKit
import HUDKit
import HUDCore

// 一级 · 圆环：4 列磁贴，系统小组件风格。

extension PanelScreen {

    func drawGrid() {
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
                     maxWidth: Metrics.tileW - 6)
            let (meta, color) = gridMetaText(r)
            drawText(meta, font: Theme.f10, color: color, x: rect.midX, midY: rect.minY + 84.5, center: true,
                     maxWidth: Metrics.tileW - 4)
        }
    }
}
