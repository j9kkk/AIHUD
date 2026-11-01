import AppKit
import HUDCore

// 面板几何：锚定、四层同源、高度动画、阴影路径。
// 这里只有一个布局入口 place()，所有尺寸变化都必须经它，避免出现第二个几何源。

extension AppShell {

    func place(animated animatedIn: Bool) {
        let switching = screen.isSwitching
        screen.isSwitching = false

        let a = anchor()
        let vf = NSScreen.main?.visibleFrame ?? .zero
        let targetH = min(screen.measuredHeight(), vf.height - 48)
        let animated = animatedIn && ProcessInfo.processInfo.environment["AIHUD_GEOM_TEST"] == nil
        let duration: CFTimeInterval = switching ? 0.20 : 0.18

        applyFrames(a, vf, targetH, animated: animated, duration: duration)

        if switching, ProcessInfo.processInfo.environment["AIHUD_TRACK"] != nil {
            trackFrames(label: "switch")
        }
    }

    /// 高度动画：顶边固定，四层（窗口 / 材质 / 描边 / 内容）逐帧同源。
    /// 关键：内容层高度始终等于**当前**面板高度，顶边对齐 —— 内容不会因为新旧高度差而上下滑。
    func animateHeight(from oldH: CGFloat, to h: CGFloat, panelFrame f: NSRect,
                               width w: CGFloat, duration: CFTimeInterval) {
        heightTimer?.invalidate()
        let m = shadowMargin
        let v = screen as! NSView
        // 窗口按「两段里更高的那个」一次性定位，动画期间窗口不动，避免窗口服务器逐帧重配；
        // 结束那一帧再收到目标高度（此时面板已到位，外层只是透明边距，看不见）
        let winH = max(oldH, h)
        let topEdge = f.maxY - m
        let big = NSRect(x: f.origin.x, y: topEdge - winH - m, width: f.width, height: winH + 2 * m)
        panel.setFrame(big, display: true)
        let start = CACurrentMediaTime()
        let step: (Timer) -> Void = { [weak self] t in
            guard let self else { t.invalidate(); return }
            let p = min(max((CACurrentMediaTime() - start) / duration, 0), 1)
            let e = Motion.easeInOutQuad(p)
            let cur = oldH + (h - oldH) * CGFloat(e)
            let pr = NSRect(x: m, y: winH + m - cur, width: w, height: cur)
            self.effect.frame = pr
            self.rim.frame = pr
            v.frame = NSRect(x: 0, y: 0, width: w, height: cur)
            self.updateShadowPath(margin: m, w: w, h: cur, y: pr.origin.y)
            v.needsDisplay = true
            if p >= 1 {
                t.invalidate()
                self.heightTimer = nil
                self.panel.setFrame(f, display: false)
                self.effect.frame = NSRect(x: m, y: m, width: w, height: h)
                self.rim.frame = NSRect(x: m, y: m, width: w, height: h)
                v.frame = NSRect(x: 0, y: 0, width: w, height: h)
                self.updateShadowPath(margin: m, w: w, h: h, y: m)
                self.refreshChrome()
            }
        }
        heightTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 120.0, repeats: true, block: step)
        RunLoop.main.add(heightTimer!, forMode: .common)
        step(heightTimer!)
    }

    /// 采样一次切页期间各层在屏幕上的实际位置，用来判断"内容是不是在上下滑"
    func trackFrames(label: String) {
        let v = screen as! NSView
        var i = 0
        Timer.scheduledTimer(withTimeInterval: 0.016, repeats: true) { [weak self] t in
            guard let self else { t.invalidate(); return }
            let pf = self.panel.frame
            let contentTopWin = self.effect.frame.maxY - v.frame.minY - v.frame.height
            _ = contentTopWin
            let contentTopScreen = self.panel.convertPoint(toScreen: NSPoint(x: 0, y: self.effect.frame.minY + v.frame.maxY))
            let contentBotScreen = self.panel.convertPoint(toScreen: NSPoint(x: 0, y: self.effect.frame.minY + v.frame.minY))
            let sp = self.host.layer?.shadowPath?.boundingBox ?? .zero
            let eff = self.effect.frame
            print(String(format: "TRACK %@ t=%.3f panelTop=%.1f panelBot=%.1f contentTop=%.1f contentBot=%.1f effH=%.1f shadowY=%.1f shadowH=%.1f shadowDY=%.1f",
                         label, Double(i) * 0.016,
                         pf.maxY - 26, pf.minY + 26,
                         contentTopScreen.y, contentBotScreen.y, eff.height,
                         sp.origin.y, sp.height, abs(sp.origin.y - eff.origin.y)))
            i += 1
            if i > 22 { t.invalidate() }
        }
    }

    /// 只负责几何：窗口、材质层、描边层、内容层，四者同源
    func applyFrames(_ a: (right: CGFloat, top: CGFloat), _ vf: NSRect,
                             _ h: CGFloat, animated: Bool, duration: CFTimeInterval) {
        let w = screen.preferredWidth
        let m = shadowMargin
        var f = NSRect(x: a.right - w - m, y: a.top - h - m, width: w + 2 * m, height: h + 2 * m)
        f.origin.x = max(vf.minX + 8 - m, min(f.origin.x, vf.maxX - w - 8 + m))
        f.origin.y = max(vf.minY + 8 - m, min(f.origin.y, vf.maxY - h - 8 + m))

        let v = screen as! NSView
        let oldH = effect.frame.height
        let panelRect = NSRect(x: m, y: m, width: w, height: h)

        if animated && panel.isVisible && duration > 0 {
            animateHeight(from: oldH, to: h, panelFrame: f, width: w, duration: duration)
        } else {
            heightTimer?.invalidate(); heightTimer = nil
            panel.setFrame(f, display: true)
            effect.frame = panelRect
            rim.frame = panelRect
            v.frame = NSRect(x: 0, y: 0, width: w, height: h)
        }
        updateShadowPath(margin: m, w: w, h: h)
        refreshChrome()
    }

    /// 改尺寸后把材质/描边/内容全部标脏并强制重绘一次。
    /// 不做这一步，旧尺寸的圆角描边会留在窗口缓冲区里，看起来就是一条「边框残影」
    func refreshChrome() {
        host.needsDisplay = true
        host.layer?.setNeedsDisplay()
        effect.needsDisplay = true
        rim.needsDisplay = true
        (screen as? NSView)?.needsDisplay = true
        effect.layer?.setNeedsDisplay()
        rim.layer?.setNeedsDisplay()
        (screen as? NSView)?.layer?.setNeedsDisplay()
        effect.displayIfNeeded()
        rim.displayIfNeeded()
    }

    /// 阴影路径跟着面板矩形走（窗口比面板大一圈，阴影画在那一圈里）
    func updateShadowPath(margin m: CGFloat, w: CGFloat, h: CGFloat, y: CGFloat? = nil) {
        guard let l = host.layer else { return }
        // y 必须传面板**当前**在窗口里的下沿：窗口是顶边钉住的，影子若永远从窗口底部起算，
        // 动画期间就会和面板错开一层，看起来就是"阴影在闪"
        l.shadowPath = CGPath(roundedRect: CGRect(x: m, y: y ?? m, width: w, height: h),
                              cornerWidth: 14, cornerHeight: 14, transform: nil)
        // 之前 0.48 / 半径 27 / 偏移 -10 + 一圈 0.5pt 黑描边，
        // 叠起来在面板外就是一道明显的黑环；现在改成"淡影 + 无黑边"
        l.shadowColor = NSColor.black.cgColor
        l.shadowOpacity = 0.30
        l.shadowRadius = 22
        l.shadowOffset = CGSize(width: 0, height: -6)
        // 描边不能放这里：host 覆盖整个窗口，会把边框画在窗口外框上
        l.cornerRadius = 0
    }
}
