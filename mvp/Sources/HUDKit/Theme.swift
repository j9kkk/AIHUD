import AppKit

// 设计令牌：与 docs/reboot/explore/SPEC-p11-p12.md 一一对应

public enum Theme {
    public static func dyn(light: NSColor, dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return isDark ? dark : light
        }
    }
    // 文字三档
    public static var label: NSColor { dyn(light: NSColor(white: 0, alpha: 0.88), dark: .white) }
    public static var label2: NSColor { dyn(light: NSColor(white: 0, alpha: 0.65), dark: NSColor(white: 1, alpha: 0.72)) }
    public static var label3: NSColor { dyn(light: NSColor(white: 0, alpha: 0.48), dark: NSColor(white: 1, alpha: 0.55)) }
    // 状态色：一种颜色一种含义
    public static var green: NSColor { dyn(light: NSColor(srgbRed: 0.20, green: 0.78, blue: 0.35, alpha: 1),
                                           dark: NSColor(srgbRed: 0.19, green: 0.82, blue: 0.35, alpha: 1)) }
    public static var red: NSColor { dyn(light: NSColor(srgbRed: 1.0, green: 0.23, blue: 0.19, alpha: 1),
                                         dark: NSColor(srgbRed: 1.0, green: 0.27, blue: 0.23, alpha: 1)) }
    public static var orange: NSColor { dyn(light: NSColor(srgbRed: 0.78, green: 0.20, blue: 0, alpha: 1),
                                            dark: NSColor(srgbRed: 1.0, green: 0.62, blue: 0.04, alpha: 1)) }
    public static var accent: NSColor { dyn(light: NSColor(srgbRed: 0, green: 0.48, blue: 1, alpha: 1),
                                            dark: NSColor(srgbRed: 0.04, green: 0.52, blue: 1, alpha: 1)) }
    // 面与线
    public static var moduleFill: NSColor { dyn(light: NSColor(white: 0, alpha: 0.06), dark: NSColor(white: 1, alpha: 0.10)) }
    public static var wellFill: NSColor { dyn(light: NSColor(white: 0, alpha: 0.04), dark: NSColor(white: 1, alpha: 0.06)) }
    public static var track: NSColor { dyn(light: NSColor(white: 0, alpha: 0.08), dark: NSColor(white: 1, alpha: 0.14)) }
    public static var sep: NSColor { dyn(light: NSColor(white: 0, alpha: 0.09), dark: NSColor(white: 1, alpha: 0.12)) }
    public static var hover: NSColor { dyn(light: NSColor(white: 0, alpha: 0.05), dark: NSColor(white: 1, alpha: 0.08)) }
    public static var panelTint: NSColor { dyn(light: NSColor(srgbRed: 0.965, green: 0.965, blue: 0.973, alpha: 0.78),
                                               dark: NSColor(srgbRed: 0.118, green: 0.118, blue: 0.125, alpha: 0.68)) }
    public static var segTrack: NSColor { dyn(light: NSColor(white: 0, alpha: 0.06), dark: NSColor(white: 1, alpha: 0.10)) }
    public static var segThumb: NSColor { dyn(light: .white, dark: NSColor(white: 1, alpha: 0.22)) }

    /// 圆体（SF Pro Rounded）：页面级数值用，与原型一致
    private static func rounded(_ size: CGFloat, _ weight: NSFont.Weight) -> NSFont {
        let base = NSFont.systemFont(ofSize: size, weight: weight)
        guard let d = base.fontDescriptor.withDesign(.rounded) else { return base }
        return NSFont(descriptor: d, size: size) ?? base
    }

    // 字号：17 / 15 / 13 / 11 / 10；字重只有 regular 与 semibold
    public static let f17b = rounded(17, .semibold)
    public static let f15b = rounded(15, .semibold)
    public static let f13b = NSFont.systemFont(ofSize: 13, weight: .semibold)
    public static let rounded13 = rounded(13, .semibold)
    public static let f13 = NSFont.systemFont(ofSize: 13, weight: .regular)
    public static let f11 = NSFont.systemFont(ofSize: 11, weight: .regular)
    public static let f10 = NSFont.systemFont(ofSize: 10, weight: .regular)

    public static var scale: CGFloat { NSScreen.main?.backingScaleFactor ?? 2 }
    public static var hairline: CGFloat { 1 / scale }
}

// 绘制工具：坐标系为 flipped（原点左上），与原型一致

/// 关掉「字体加粗」平滑：AppKit 在图层里默认开着，11/400 会比浏览器粗约 1px（2x 下）
/// 每次绘制都要设，因为每帧的 CGContext 是新的
@inline(__always) func tuneFontRendering() {
    guard let cg = NSGraphicsContext.current?.cgContext else { return }
    cg.setShouldSmoothFonts(false)
    cg.setShouldAntialias(true)
    cg.setAllowsFontSubpixelPositioning(true)
    cg.setAllowsFontSubpixelQuantization(true)
}

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
public func drawWarningGlyph(in rect: NSRect, color: NSColor) {
    let p = NSBezierPath()
    let cx = rect.midX, cy = rect.midY, r = min(rect.width, rect.height) / 2
    p.move(to: NSPoint(x: cx, y: cy + r))
    p.line(to: NSPoint(x: cx + r, y: cy - r * 0.8))
    p.line(to: NSPoint(x: cx - r, y: cy - r * 0.8))
    p.close()
    p.lineWidth = 1.4
    p.lineJoinStyle = .round
    color.setStroke(); p.stroke()
    let ex = NSBezierPath()
    ex.move(to: NSPoint(x: cx, y: cy + r * 0.35))
    ex.line(to: NSPoint(x: cx, y: cy - r * 0.15))
    ex.lineWidth = 1.4; ex.lineCapStyle = .round
    color.setStroke(); ex.stroke()
    color.setFill()
    NSRect(x: cx - 0.9, y: cy - r * 0.62, width: 1.8, height: 1.8).fill()
}

/// 展开箭头（点开详情时使用，不用来暗示开新窗口）
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
