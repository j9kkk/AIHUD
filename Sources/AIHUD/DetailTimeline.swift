import AppKit
import HUDKit
import HUDCore

// 二级 · 时间轴：倒计时列、竖轨 + 圆点、窗口名、17pt 数值、条、重置说明。

extension PanelScreen {

    func drawDetail(_ r: AccountReading) {
        drawHeader(back: true, title: r.meta.label, plan: r.meta.plan)
        switch r.state {
        case let .ok(ws):
            let timed = ws.filter { $0.resetText != nil && !($0.resetText!.contains("到期")) }
            let credits = ws.filter { $0.resetText?.contains("到期") == true }
            if timed.isEmpty {
                let t = credits.first ?? ws.first!
                drawText("积分余量", font: Theme.f11, color: Theme.label2, x: Metrics.pad + 2, midY: 57)
                drawText(t.valueText, font: Theme.f17b, color: t.isLow ? Theme.red : Theme.label, x: Metrics.pad, midY: 84)
                drawText(t.resetText ?? "", font: Theme.f11, color: Theme.label2, x: Metrics.pad, midY: 106)
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
                     x: Metrics.pad + 2, midY: 57, maxWidth: 300)
            drawSymbol("exclamationmark.triangle", in: NSRect(x: Metrics.pad, y: 84, width: 20, height: 20),
                       color: Theme.orange, size: 15)
            drawText("无法读取配额", font: Theme.f13b, color: Theme.label, x: Metrics.pad + 20, midY: 94)
            drawText("10月29日起没有新数据", font: Theme.f11, color: Theme.label2,
                     x: Metrics.pad + 20, midY: 112, maxWidth: 240)
            let h = measuredHeight()
            let btn = NSRect(x: Metrics.panelW - Metrics.pad - 86, y: footerTop(h) - 36, width: 86, height: 26)
            Theme.accent.setFill()
            NSBezierPath(roundedRect: btn, xRadius: 6, yRadius: 6).fill()
            drawText("重新授权…", font: Theme.f13, color: .white, x: btn.minX + 12, midY: btn.midY)
        }
        let h = measuredHeight()
        drawHairline(y: h - Metrics.sepOffset, x: Metrics.pad, width: 326)
        drawCommand(y: cmd1Y(h), title: "打开 \(r.meta.providerName) 用量页面…", key: nil, hovered: hoverCmd == 0)
        drawCommand(y: cmd2Y(h), title: "移除此账号…", key: nil, hovered: hoverCmd == 1)
    }

    func drawTimelineRow(_ w: QuotaWindow, index: Int, window: Int, y: CGFloat, isLast: Bool) {
        let (cd, at) = resetPair(w)
        drawText(cd, font: Theme.f13b, color: Theme.label, x: Metrics.pad, midY: y + 20, maxWidth: 84)
        drawText(at, font: Theme.f10, color: Theme.label2, x: Metrics.pad, midY: y + 36, maxWidth: 84)

        let railX = Metrics.pad + 96
        if !isLast {
            Theme.sep.setFill()
            NSRect(x: railX, y: y + 30, width: 1, height: 66).fill()
        }
        Theme.label2.withAlphaComponent(0.75).setFill()
        NSBezierPath(ovalIn: NSRect(x: railX - 3, y: y + 24, width: 7, height: 7)).fill()

        let bx: CGFloat = 125
        let bw = Metrics.panelW - Metrics.pad - bx
        drawText(w.label.hasSuffix("窗口") ? w.label : w.label + "窗口", font: Theme.f13, color: Theme.label,
                 x: bx, midY: y + 21)
        let low = w.isLow
        let key = "M\(index)w\(window)"
        let shown = tweens.value(key).map(Double.init) ?? w.remaining
        if let tr = tweens.text(key) {
            let c = low ? Theme.red : Theme.label
            drawText(tr.old, font: Theme.f17b, color: c.withAlphaComponent(1 - tr.t),
                     x: Metrics.panelW - Metrics.pad, midY: y + 19 - 2 * tr.t, right: true)
            drawText(tr.new, font: Theme.f17b, color: c.withAlphaComponent(tr.t),
                     x: Metrics.panelW - Metrics.pad, midY: y + 19 + 2 * (1 - tr.t), right: true)
        } else {
            drawText("\(Int((w.remaining * 100).rounded()))%", font: Theme.f17b, color: low ? Theme.red : Theme.label,
                     x: Metrics.panelW - Metrics.pad, midY: y + 19, right: true)
        }
        drawBar(x: bx, y: y + 37, width: bw, height: 6, progress: shown, color: low ? Theme.red : Theme.green)
        drawText(w.label.contains("周") ? "周配额重置至 100%" : "重置至 100%",
                 font: Theme.f11, color: Theme.label2, x: bx, midY: y + 54, maxWidth: bw)
    }
}
