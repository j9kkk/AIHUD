import AppKit
import HUDCore

// 验收探针：环境变量开启，只打印几何/时序，不参与正常渲染。
//   AIHUD_GEOM_TEST=n  开关 + 切页 n 轮，断言顶边/右边缘离散度为 0
//   AIHUD_SWITCH_TEST  每次切页后打印面板/材质/内容几何
//   AIHUD_ANIM_TEST    动画过程中采样内容与面板的间隙
//   AIHUD_GROW_TEST / AIHUD_TWEEN_TEST / AIHUD_SWITCH_LIVE  同类
//   AIHUD_TRACK=1      120Hz 采样面板/内容/阴影矩形

extension AppShell {

    func growTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        screen.apply([], updatedAt: nil, refreshing: false)
        show()
        func dump(_ tag: String) {
            let v = screen as! NSView
            HUDLog.line(String(format: "GROW %@ panel=%@ effect=%@ rim=%@ v=%@ subviews=%d",
                               tag, NSStringFromRect(panel.frame), NSStringFromRect(effect.frame),
                               NSStringFromRect(rim.frame), NSStringFromRect(v.frame),
                               host.subviews.count))
            print(String(format: "GROW %@ panelH=%.1f effectH=%.1f rimH=%.1f vH=%.1f subs=%d",
                         tag, panel.frame.height, effect.frame.height, rim.frame.height, v.frame.height, host.subviews.count))
            if let subs = host.layer?.sublayers {
                for (i, l) in subs.enumerated() {
                    print(String(format: "  layer[%d] frame=%@ border=%.1f opacity=%.2f", i,
                                 NSStringFromRect(l.frame), l.borderWidth, l.opacity))
                }
            }
        }
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("empty")
        screen.apply(demoMode == "issue" ? HUD.demoIssue() : HUD.demo(), updatedAt: Date(), refreshing: false)
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("loaded")
        screen.debugSelect(0)
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("detail")
        screen.debugSelect(nil)
        RunLoop.current.run(until: Date().addingTimeInterval(1.2))
        dump("back")
        RunLoop.current.run(until: Date().addingTimeInterval(3.0))
        app.run()
    }

    /// 页面/视图切换回归：每次切换后打印 窗口帧 / 材质层帧 / 内容层帧 / 期望高度
    func switchTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        if demoMode == "issue" { screen.apply(HUD.demoIssue(), updatedAt: Date(), refreshing: false) }
        else { screen.apply(HUD.demo(), updatedAt: Date(), refreshing: false) }

        func settle() { RunLoop.current.run(until: Date().addingTimeInterval(0.40)) }
        func dump(_ tag: String) {
            let pf = panel.frame
            let ef = effect.frame
            let sf = (screen as! NSView).frame
            let want = screen.measuredHeight()
            HUDLog.line(String(format: "SWITCH %@ panel=%.0fx%.0f@(%.0f,%.0f) effect=%.0fx%.0f@y%.0f content=%.0fx%.0f@y%.0f want=%.1f",
                               tag, pf.width, pf.height, pf.minX, pf.minY,
                               ef.width, ef.height, ef.minY, sf.width, sf.height, sf.minY, want))
            let keys = (screen as? NSView)?.layer?.animationKeys()?.joined(separator: ",") ?? "-"
            print(String(format: "SWITCH %@ panelH=%.1f effectH=%.1f contentH=%.1f contentY=%.1f want=%.1f anim=[%@]",
                         tag, pf.height, ef.height, sf.height, sf.minY, want, keys))
        }
        settle(); show(); settle(); dump("open-list")
        screen.debugToggleView(); let i1 = panel.frame.height; settle()
        dump("grid"); print(String(format: "SWITCH grid immediateH=%.1f", i1))
        screen.debugToggleView(); let i2 = panel.frame.height; settle()
        dump("back-list"); print(String(format: "SWITCH back immediateH=%.1f", i2))
        screen.debugSelect(0); let i3 = panel.frame.height; settle()
        dump("detail"); print(String(format: "SWITCH detail immediateH=%.1f", i3))
        screen.debugSelect(nil); let i4 = panel.frame.height; settle()
        dump("pop"); print(String(format: "SWITCH pop immediateH=%.1f", i4))
        exit(0)
    }

    /// 真窗口验收：打开 → 2 秒后切换视图 → 4 秒后切回，全程保持运行，供外部截图
    func liveSwitchTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        if demoMode == "issue" { screen.apply(HUD.demoIssue(), updatedAt: Date(), refreshing: false) }
        else { screen.apply(HUD.demo(), updatedAt: Date(), refreshing: false) }
        show()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            self.screen.debugToggleView()
            HUDLog.line(String(format: "LIVE switch#1 panel=%@", NSStringFromRect(self.panel.frame)))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            self.screen.debugToggleView()
            HUDLog.line(String(format: "LIVE switch#2 panel=%@", NSStringFromRect(self.panel.frame)))
        }
        app.run()
    }

    /// 数值补间回归：换一批数值后，采样三次，值应当从旧值单调逼近新值
    func tweenTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        // 等启动那次 refresh 落定，否则它会把读数改回去，补间被覆盖（测试会看到抖动）
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        let base = demoMode == "issue" ? HUD.demoIssue() : HUD.demo()
        screen.apply(base, updatedAt: Date(), refreshing: false)
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))

        // 造一批新数值（各窗口剩余比例 ×0.5）
        let changed: [AccountReading] = base.map { r in
            guard case let .ok(ws) = r.state else { return r }
            let nw = ws.map { QuotaWindow(label: $0.label, remaining: max(0.02, $0.remaining * 0.5),
                                          valueText: $0.valueText, resetText: $0.resetText,
                                          resetAt: $0.resetAt, isExpiry: $0.isExpiry) }
            return AccountReading(meta: r.meta, state: .ok(nw))
        }
        screen.apply(changed, updatedAt: Date(), refreshing: false)
        var samples: [Double] = []
        for i in 0..<6 {
            if let v = screen.tweens.value("A0head") ?? screen.tweens.value("B0head") { samples.append(Double(v)) }
            if i < 5 { RunLoop.current.run(until: Date().addingTimeInterval(0.06)) }
        }
        let anim = screen.tweens.isAnimating
        print(String(format: "TWEEN samples=%@ animating=%@", samples.map { String(format: "%.3f", $0) }.joined(separator: " -> "),
                     anim ? "yes" : "no"))
        let monotonic = zip(samples, samples.dropFirst()).allSatisfy { $1 <= $0 + 0.001 }
        let moved = abs((samples.first ?? 0) - (samples.last ?? 0)) > 0.05
        exit((monotonic && moved) ? 0 : 1)
    }

    /// 动画过程回归：切换视图后连续采样，检查内容顶边是否始终贴着窗口顶边（gap 应恒为 0）
    func animTest() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        screen.apply(demoMode == "issue" ? HUD.demoIssue() : HUD.demo(), updatedAt: Date(), refreshing: false)
        show()
        var samples: [CGFloat] = []
        func sample() {
            guard let v = screen as? NSView else { return }
            // 读呈现层：动画中模型层的值已经是终态，用它测会误判
            let vl = v.layer?.presentation() ?? v.layer
            let el = effect.layer?.presentation() ?? effect.layer
            let viewH = vl?.bounds.height ?? v.frame.height
            let viewY = vl?.frame.origin.y ?? v.frame.origin.y
            let superH = el?.bounds.height ?? effect.bounds.height
            let gap = (superH - viewY) - viewH
            samples.append(gap)
            HUDLog.line(String(format: "ANIM panelH=%.1f contentH=%.1f y=%.1f gap=%.2f",
                               panel.frame.height, v.frame.height, v.frame.origin.y, gap))
        }
        sample()
        screen.debugToggleView()
        for _ in 0..<12 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.016))
            sample()
        }
        let worst = samples.map { abs($0) }.max() ?? 0
        print(String(format: "ANIM RESULT samples=%d worstGap=%.2f", samples.count, worst))
        exit(worst > 0.75 ? 1 : 0)
    }

    /// 面板位移回归测试：反复 打开 → 进二级 → 返回 → 关闭，检查顶边与右边缘是否恒定
    func geomTest(rounds: Int) {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        if demoMode == "issue" { screen.apply(HUD.demoIssue(), updatedAt: Date(), refreshing: false) }
        else if demoMode != nil { screen.apply(HUD.demo(), updatedAt: Date(), refreshing: false) }
        var tops: [CGFloat] = [], rights: [CGFloat] = []
        for i in 0..<rounds {
            show()
            let f0 = panel.frame
            screen.debugSelect(0)
            let f1 = panel.frame
            screen.debugSelect(nil)
            let f2 = panel.frame
            hide()
            // 按“面板本体”（去掉阴影边距）判断是否出屏，窗口外的那圈是透明的
            let m = shadowMargin
            tops += [f0.maxY - m, f1.maxY - m, f2.maxY - m]
            rights += [f0.maxX - m, f1.maxX - m, f2.maxX - m]
            HUDLog.line(String(format: "GEOM #%d show=%@ select=%@ back=%@", i, NSStringFromRect(f0), NSStringFromRect(f1), NSStringFromRect(f2)))
        }
        let tf = tops.max()! - tops.min()!
        let rf = rights.max()! - rights.min()!
        let vf = NSScreen.main!.visibleFrame
        var bad = 0
        for (i, t) in tops.enumerated() {
            if t > vf.maxY + 0.5 || t < vf.minY - 0.5 { bad += 1 }
            if rights[i] > vf.maxX + 0.5 || rights[i] < vf.minX - 0.5 { bad += 1 }
        }
        HUDLog.line(String(format: "GEOM RESULT rounds=%d topSpread=%.2f rightSpread=%.2f offscreen=%d visible=%@",
                          rounds, tf, rf, bad, NSStringFromRect(vf)))
        print(String(format: "GEOM RESULT topSpread=%.2f rightSpread=%.2f offscreen=%d", tf, rf, bad))
        exit(tf > 0.5 || rf > 0.5 || bad > 0 ? 1 : 0)
    }
}
