import AppKit
import QuartzCore

/// 动效的唯一入口。
///
/// 本项目的面板换页**不做内容转场**：内容瞬时替换，只有面板高度做 0.20s 伸缩
/// （见 `AppShell.animateHeight`）。历史验证过交叉溶解与遮罩擦除，在两页高度不同时
/// 必然重影或切碎文字，因此不保留相关代码。
public enum Motion {

    /// 尊重「减弱动态效果」：系统开启时，位移与缩放全部关掉（HIG 要求）
    public static var reduced: Bool {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    /// 面板出现：绕自身中心从 0.98 放大到 1，并上移 2pt。
    ///
    /// 不改 `anchorPoint`（改了会和显式 frame 打架），用 translate(center)·scale·translate(-center)
    /// 组合出"绕中心缩放"。
    public static func appear(_ layer: CALayer, scale: CGFloat = 0.98, duration: CFTimeInterval = 0.28) {
        guard !reduced else { return }
        let cx = layer.bounds.midX, cy = layer.bounds.midY
        let around = CATransform3DConcat(
            CATransform3DMakeTranslation(cx, cy, 0),
            CATransform3DConcat(CATransform3DMakeScale(scale, scale, 1),
                                CATransform3DMakeTranslation(-cx, -cy, 0)))
        let spring = CASpringAnimation(keyPath: "transform")
        spring.fromValue = NSValue(caTransform3D: around)
        spring.toValue = NSValue(caTransform3D: CATransform3DIdentity)
        spring.damping = 22
        spring.stiffness = 260
        spring.mass = 1
        spring.duration = max(duration, spring.settlingDuration)
        layer.add(spring, forKey: "appear")

        let move = CASpringAnimation(keyPath: "transform.translation.y")
        move.fromValue = -2
        move.toValue = 0
        move.damping = 24
        move.stiffness = 280
        move.mass = 1
        move.duration = move.settlingDuration
        layer.add(move, forKey: "rise")
    }

    /// 高度伸缩曲线：起止都收一点，中段最快（和 macOS 菜单一致）
    public static func easeInOutQuad(_ p: CGFloat) -> CGFloat {
        p < 0.5 ? 2 * p * p : 1 - pow(-2 * p + 2, 2) / 2
    }
}
