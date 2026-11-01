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
