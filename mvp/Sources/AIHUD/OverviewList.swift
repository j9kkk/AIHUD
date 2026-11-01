import AppKit
import HUDKit
import HUDCore

// 一级 · 列表：56pt 行（账号/套餐、meta、右对齐百分比、24pt 小环）。

extension PanelScreen {

    func drawList() {
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
                drawHairline(y: rect.maxY, x: Metrics.pad, width: 326)
            }
        }
    }
}
