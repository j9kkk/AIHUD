import AppKit
import HUDCore

// 绘制原语：文字、值条、圆环、分割线、箭头、SF Symbols。
// 所有尺寸都是"从顶往下的绝对坐标"，调用方传面板内的 y。

public func drawText(_ s: String, font: NSFont, color: NSColor, x: CGFloat, midY: CGFloat,
                     right: Bool = false, center: Bool = false, maxWidth: CGFloat? = nil) {
    tuneFontRendering()
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let a = NSAttributedString(string: s, attributes: attrs)
    let size = a.size()
    let w = min(size.width, maxWidth ?? size.width)
    let ox = center ? x - w / 2 : (right ? x - w : x)
    a.draw(with: NSRect(x: ox, y: midY - size.height / 2, width: w, height: size.height),
           options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
}

public func drawRich(_ parts: [(String, NSFont, NSColor)], x: CGFloat, midY: CGFloat, right: Bool = false) {
    tuneFontRendering()
    let m = NSMutableAttributedString()
    for (s, f, c) in parts {
        m.append(NSAttributedString(string: s, attributes: [.font: f, .foregroundColor: c]))
    }
    let size = m.size()
    let ox = right ? x - size.width : x
    m.draw(with: NSRect(x: ox, y: midY - size.height / 2, width: size.width, height: size.height),
           options: [.usesLineFragmentOrigin])
}

public func drawBar(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat = 6,
                    progress: Double, color: NSColor) {
    let track = NSBezierPath(roundedRect: NSRect(x: x, y: y, width: width, height: height),
                             xRadius: height / 2, yRadius: height / 2)
    Theme.track.setFill(); track.fill()
    guard progress > 0 else { return }
    let w = max(height, width * CGFloat(min(1, progress)))
    let fill = NSBezierPath(roundedRect: NSRect(x: x, y: y, width: progress >= 1 ? width : w, height: height),
                            xRadius: height / 2, yRadius: height / 2)
    color.setFill(); fill.fill()
}

public func drawRing(center: NSPoint, radius: CGFloat, lineWidth: CGFloat,
                     progress: Double?, color: NSColor) {
    // 视图是 flipped（y 向下），用折线手绘，保证从 12 点顺时针；AppKit 的 arc 角度在翻转坐标里会跑位
    func arcPath(from a0: CGFloat, to a1: CGFloat) -> NSBezierPath {
        let path = NSBezierPath()
        let steps = max(2, Int(abs(a1 - a0) / 0.08))
        for i in 0...steps {
            let t = a0 + (a1 - a0) * CGFloat(i) / CGFloat(steps)
            let pt = NSPoint(x: center.x + radius * cos(t), y: center.y + radius * sin(t))
            if i == 0 { path.move(to: pt) } else { path.line(to: pt) }
        }
        return path
    }
    let top = -CGFloat.pi / 2
    if let p = progress, p >= 0 {
        let full = arcPath(from: top, to: top + 2 * .pi)
        full.lineWidth = lineWidth
        color.withAlphaComponent(0.25).setStroke(); full.stroke()
        guard p > 0 else { return }
        let sweep = 2 * .pi * CGFloat(min(1, p))
        let arc = arcPath(from: top, to: top + sweep)
        arc.lineWidth = lineWidth
        arc.lineCapStyle = .round
        arc.lineJoinStyle = .round
        color.setStroke(); arc.stroke()
    } else {
        let dashed = NSBezierPath()
        dashed.appendArc(withCenter: center, radius: radius, startAngle: 0, endAngle: 360)
        dashed.lineWidth = max(1.5, lineWidth / 3)
        dashed.setLineDash([3, 3.5], count: 2, phase: 0)
        Theme.label2.withAlphaComponent(0.8).setStroke(); dashed.stroke()
    }
}

public func drawHairline(y: CGFloat, x: CGFloat, width: CGFloat) {
    Theme.sep.setFill()
    NSRect(x: x, y: y, width: width, height: Theme.hairline).fill()
}

/// 告警三角（失败/需授权状态的图形，不靠颜色单独表意）
public func drawChevron(rect: NSRect, color: NSColor, direction: CGFloat = 1) {
    let p = NSBezierPath()
    let h = rect.height * 0.34, w = rect.width * 0.34
    p.move(to: NSPoint(x: rect.midX - w * direction, y: rect.midY + h))
    p.line(to: NSPoint(x: rect.midX + w * direction, y: rect.midY))
    p.line(to: NSPoint(x: rect.midX - w * direction, y: rect.midY - h))
    p.lineWidth = 1.6
    p.lineCapStyle = .round
    p.lineJoinStyle = .round
    color.setStroke(); p.stroke()
}

// SF Symbols：图标用它，不手画
public func symbolImage(_ name: String, size: CGFloat, weight: NSFont.Weight = .regular) -> NSImage? {
    let cfg = NSImage.SymbolConfiguration(pointSize: size, weight: weight)
    return NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(cfg)
}

/// 画一个 SF Symbol，居中于 rect；用模板色渲染以跟随深浅外观
public func drawSymbol(_ name: String, in rect: NSRect, color: NSColor,
                       size: CGFloat, weight: NSFont.Weight = .regular, rotation: CGFloat = 0) {
    guard let img = symbolImage(name, size: size, weight: weight) else { return }
    let tinted = NSImage(size: img.size, flipped: false) { r in
        img.draw(in: r)
        color.set()
        r.fill(using: .sourceAtop)
        return true
    }
    tinted.isTemplate = false
    let w = img.size.width, h = img.size.height
    let target = NSRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h)
    guard rotation != 0 else { tinted.draw(in: target); return }
    // 绕中心旋转（卡片/刷新图标用）
    NSGraphicsContext.saveGraphicsState()
    if let cg = NSGraphicsContext.current?.cgContext {
        cg.translateBy(x: rect.midX, y: rect.midY)
        cg.rotate(by: rotation * .pi / 180)
        cg.translateBy(x: -rect.midX, y: -rect.midY)
    }
    tinted.draw(in: target)
    NSGraphicsContext.restoreGraphicsState()
}
