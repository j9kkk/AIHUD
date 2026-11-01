import AppKit
import HUDKit
import HUDCore

// 面板骨架：标题行、视图分段控件、底部命令、空状态、状态栏小环。

extension PanelScreen {

    func drawHeader(back: Bool = false, title: String = "AI 额度", plan: String? = nil) {
        var x = Metrics.pad
        if back {
            drawSymbol("chevron.left", in: NSRect(x: Metrics.pad, y: Metrics.headerY, width: 28, height: 28),
                       color: Theme.label2, size: 13, weight: .semibold)
            x = Metrics.pad + 28
        }
        drawText(title, font: Theme.f13b, color: Theme.label, x: x, midY: Metrics.headerY + 14)
        if let plan, !plan.isEmpty {
            let w = (title as NSString).size(withAttributes: [.font: Theme.f13b]).width
            drawText(plan, font: Theme.f10, color: Theme.label2, x: x + w + 6, midY: Metrics.headerY + 15)
        }
        if !back {
            let stamp = refreshing ? "刷新中…" : (updatedAt.map { "剩余 · " + hhmm($0) + " 更新" } ?? "剩余")
            drawText(stamp, font: Theme.f11, color: Theme.label2, x: Metrics.pad + 48, midY: Metrics.headerY + 15)
            drawSegmented()
        }
        drawSymbol("arrow.clockwise", in: NSRect(x: Metrics.panelW - Metrics.pad - 28, y: Metrics.headerY, width: 28, height: 28),
                   color: Theme.label2, size: 13, rotation: spinAngle)
    }

    func drawSegmented() {
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
}
