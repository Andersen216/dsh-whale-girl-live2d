// 鲸鱼娘桌宠 · 收起态的贴边悬浮球（原生版）
// ————————————————————————————————————————————————————————————
// 为什么不用 WebView 画：主人要的是「液态玻璃」那种半透明观感 —— 那必须让系统去采样
// 桌面背后真正的内容（NSVisualEffectView + blendingMode = .behindWindow），
// 网页里的 backdrop-filter 只能模糊网页自己，做不出来。
//
// 观感：直径 36px 的圆形玻璃球（菜单里可调 28 / 36 / 48），中间是 DSH 官方图标（白色），
// 鼠标悬停微微放大，拖动跟手，松手**动画滑向最近的那一侧**（不是瞬移，也不是随便挑一边）。
import Cocoa

/// 小球本体：**纯手绘**的圆球（深色玻璃观感）+ 白图标 + 悬停放大。
///
/// 为什么不用 NSVisualEffectView：
/// 主人报「贴右边时上面多一条杠、显示不全」。查出来是玻璃材质（blendingMode = .behindWindow
/// 采样桌面）在圆角遮罩下会露出一条矩形边缘，而离屏渲染又抓不到它，很难控。
/// 现在改成自己画：圆 + 顶部柔光 + 描边 + 阴影，几何 100% 可控，任何桌面背景下都稳定。
final class BallView: NSView {
    var icon: NSImage?
    private(set) var diameter: CGFloat = 36
    /// 给阴影和悬停放大留的余量（窗口比圆大一圈；这圈是透明的，不显示东西）
    let pad: CGFloat = 14
    private var hover = false
    private var tracking: NSTrackingArea?

    init(diameter: CGFloat, icon: NSImage?) {
        self.diameter = diameter
        self.icon = icon
        super.init(frame: NSRect(x: 0, y: 0, width: diameter + pad * 2, height: diameter + pad * 2))
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError() }

    /// 圆在当前视图里的矩形（悬停时放大 10%）
    func circleRect() -> NSRect {
        let d = diameter * (hover ? 1.1 : 1)
        let c = NSPoint(x: bounds.midX, y: bounds.midY)
        return NSRect(x: c.x - d / 2, y: c.y - d / 2, width: d, height: d)
    }

    override func draw(_ dirtyRect: NSRect) {
        let rect = circleRect()
        let d = rect.width

        // ① 柔和的落影（自己做，比窗口阴影更听话，也不会被窗口边缘切）
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor(white: 0, alpha: 0.38)
        shadow.shadowBlurRadius = d * 0.24
        shadow.shadowOffset = NSSize(width: 0, height: -d * 0.07)
        shadow.set()
        NSColor(white: 0.10, alpha: 0.94).setFill()
        NSBezierPath(ovalIn: rect).fill()
        NSGraphicsContext.restoreGraphicsState()

        // ② 顶部柔光：液态玻璃那种「上亮下暗」的感觉
        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).addClip()
        let top = NSRect(x: rect.minX, y: rect.midY, width: rect.width, height: rect.height / 2)
        NSGradient(colors: [NSColor(white: 1, alpha: 0.26), NSColor(white: 1, alpha: 0.0)])?
            .draw(in: top, angle: -90)
        NSGraphicsContext.restoreGraphicsState()

        // ③ 描边：让它在深色桌面上也立得起来
        NSColor(white: 1, alpha: hover ? 0.55 : 0.34).setStroke()
        let border = NSBezierPath(ovalIn: rect.insetBy(dx: 0.75, dy: 0.75))
        border.lineWidth = 1.5
        border.stroke()

        // ④ 图标（白色，画的时候按当前填充色走的是模板图）
        if let img = icon {
            let s = d * 0.58
            img.draw(in: NSRect(x: rect.midX - s / 2, y: rect.midY - s / 2, width: s, height: s),
                     from: .zero, operation: .sourceOver, fraction: 1)
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        tracking = t
    }

    override func mouseEntered(with event: NSEvent) { setHover(true) }
    override func mouseExited(with event: NSEvent) { setHover(false) }

    private func setHover(_ on: Bool) {
        guard hover != on else { return }
        hover = on
        needsDisplay = true
    }
}

extension AppDelegate {

    /// 小球直径：主人可在菜单里选小 / 中 / 大
    func ballDiameter() -> CGFloat {
        let v = UserDefaults.standard.double(forKey: "ball.d")
        return v > 0 ? CGFloat(v) : 36
    }

    func makeBall() {
        let d = ballDiameter()
        let pad: CGFloat = 14
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: d + pad * 2, height: d + pad * 2),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false               // 阴影由 BallView 自己画（更可控、不会被窗口边缘切）
        w.level = .statusBar
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        w.isReleasedWhenClosed = false

        let view = BallView(diameter: d, icon: whiteIcon(ballIconImage()))
        w.contentView = view
        ball = w
        ballView = view
        log("悬浮小球已就绪（手绘圆球 " + String(Int(d)) + "px，窗口 " + String(Int(d + pad * 2)) + "px）")
    }

    /// 把图标染成纯白（手绘时模板图不会自动上色，得自己来）
    func whiteIcon(_ img: NSImage?) -> NSImage? {
        guard let img else { return nil }
        let size = img.size.width > 0 ? img.size : NSSize(width: 64, height: 64)
        let out = NSImage(size: size)
        out.lockFocus()
        let r = NSRect(origin: .zero, size: size)
        img.draw(in: r, from: .zero, operation: .sourceOver, fraction: 1)
        NSColor.white.setFill()
        r.fill(using: .sourceAtop)
        out.unlockFocus()
        return out
    }

    /// DSH 官方图标（读安装目录里的 favicon.svg；读不到退回模型自带图标，再不行用系统符号）
    func ballIconImage() -> NSImage? {
        let favicon = "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg"
        if let img = NSImage(contentsOfFile: favicon), img.size.width > 0 {
            img.isTemplate = true             // 当模板 → contentTintColor 能把它染白
            return img
        }
        if let img = NSImage(contentsOfFile: assetsPath + "/model/icon.png") { return img }
        log("小球图标：两个来源都没读到，用系统符号兜底")
        return NSImage(systemSymbolName: "water.waves", accessibilityDescription: "鲸鱼娘")
    }

    @objc func setBallSmall() { setBallDiameter(28) }
    @objc func setBallMedium() { setBallDiameter(36) }
    @objc func setBallLarge() { setBallDiameter(48) }

    func setBallDiameter(_ d: CGFloat) {
        UserDefaults.standard.set(Double(d), forKey: "ball.d")
        let wasVisible = ball?.isVisible ?? false
        let at = ball?.frame.origin ?? .zero
        ball?.orderOut(nil)
        makeBall()
        if wasVisible, let b = ball {
            b.setFrameOrigin(at)
            b.orderFrontRegardless()
            snapBall(animated: false)
        }
        log("小球直径改为 " + String(Int(d)) + "px")
    }

    // MARK: - 收起 / 展开（带过渡动画，不再「先卡一下」）

    @objc func collapseToBall() {
        guard let b = ball else { return }
        savePosition()
        // 主人要求：**瞬间**出现在**离她最近的那一边**，不要从中间飘过去、也不要先闪一下。
        // 所以这里一次算好目标位置：比她自己到左右边缘的距离，谁近贴谁；竖直高度跟着她。
        let vf = (win.screen ?? NSScreen.main)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let dLeft = abs(win.frame.midX - vf.minX)
        let dRight = abs(vf.maxX - win.frame.midX)
        let pad = ballView?.pad ?? 14
        let d = ballDiameter()
        let visibleD = d * 1.1 + 2
        let x = ((dLeft <= dRight) ? vf.minX + 3 : vf.maxX - visibleD - 3) - pad
        let y = min(max(win.frame.midY - b.frame.height / 2, vf.minY + 3 - pad), vf.maxY - visibleD - 3 - pad)
        b.setFrameOrigin(NSPoint(x: x, y: y))
        b.alphaValue = 1
        b.orderFrontRegardless()
        win.orderOut(nil)
        UserDefaults.standard.set(Double(x), forKey: "ball.x")
        UserDefaults.standard.set(Double(y), forKey: "ball.y")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.endAwake() }
        log("已收起成小球 → 贴" + (dLeft <= dRight ? "左" : "右") + "边 (\(Int(x)),\(Int(y))) 可见=\(b.isVisible)")
        // 几何自检：小球窗口 vs 屏幕可见范围（判断是不是被屏幕/程序坞切掉了）
        log("小球几何：窗口 x\(Int(b.frame.minX))–\(Int(b.frame.maxX)) y\(Int(b.frame.minY))–\(Int(b.frame.maxY))"
            + " | 屏幕可见 x\(Int(vf.minX))–\(Int(vf.maxX)) y\(Int(vf.minY))–\(Int(vf.maxY))")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.saveBallShot("dock") }
    }

    @objc func expandFromBall() {
        guard let b = ball else { return }
        beginAwake()
        b.orderOut(nil)
        win.alphaValue = 1
        win.orderFrontRegardless()
        web.evaluateJavaScript("window.DSHPet && DSHPet.setHidden && DSHPet.setHidden(false)",
                               completionHandler: nil)
        log("已展开桌宠")
    }


    /// 把小球渲染成图片存下来（开发诊断用）。
    /// 小球是原生视图、透明窗口又没法用系统截图，所以只能自己渲染一份来看 ——
    /// 主人报的「贴右边时上面多一条杠、显示不全」就是靠它定位的。
    func saveBallShot(_ tag: String) {
        guard let v = ballView else { return }
        let scale: CGFloat = 2
        let w = Int(v.bounds.width * scale), h = Int(v.bounds.height * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                         isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0) else { return }
        rep.size = v.bounds.size
        v.cacheDisplay(in: v.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else { return }
        let path = NSHomeDirectory() + "/.dsh/whalegirlpet-ball-\(tag).png"
        try? png.write(to: URL(fileURLWithPath: path))
        log("小球自检图已存：\(path)（\(w)×\(h)，窗口 \(Int(v.bounds.width))×\(Int(v.bounds.height))）")
    }

    /// 贴边：吸到**离得最近**的那一侧（比球心到左右边缘的距离），带动画
    func snapBall(animated: Bool) {
        guard let b = ball, b.isVisible else { return }
        let vf = (b.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let f = b.frame
        let pad = ballView?.pad ?? 14
        let d = ballDiameter()
        let dLeft = abs(f.midX - vf.minX)
        let dRight = abs(vf.maxX - f.midX)
        // 关键：按**圆**贴边（窗口比圆大一圈，那一圈是透明的）。
        // 之前按窗口贴边，圆就被推出屏幕一点 →「显示不全」。
        let visibleD = d * 1.1 + 2                       // 悬停会放大 10%，留出余量
        let circleX = (dLeft <= dRight) ? vf.minX + 3 : vf.maxX - visibleD - 3
        let x = circleX - pad
        let y = min(max(f.minY, vf.minY + 3 - pad), vf.maxY - visibleD - 3 - pad)
        let target = NSPoint(x: x, y: y)
        if animated {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.26
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                b.animator().setFrame(NSRect(origin: target, size: b.frame.size), display: true)
            }
        } else {
            b.setFrameOrigin(target)
        }
        UserDefaults.standard.set(Double(x), forKey: "ball.x")
        UserDefaults.standard.set(Double(y), forKey: "ball.y")
    }

    // MARK: - 小球上的鼠标

    func ballHandle(_ e: NSEvent) -> NSEvent? {
        switch e.type {
        case .leftMouseDown:
            ballDown = NSEvent.mouseLocation
            ballAt = ball?.frame.origin ?? .zero
            ballMoved = 0
            return nil

        case .leftMouseDragged:
            let m = NSEvent.mouseLocation
            let dx = m.x - ballDown.x, dy = m.y - ballDown.y
            ballMoved = max(ballMoved, abs(dx) + abs(dy))
            if ballMoved > 3 { ball?.setFrameOrigin(NSPoint(x: ballAt.x + dx, y: ballAt.y + dy)) }
            return nil

        case .leftMouseUp:
            if ballMoved > 3 { snapBall(animated: true) } else { expandFromBall() }
            return nil

        default:
            return e
        }
    }

    /// 兜底：万一前端那条 postMessage 没送到，1.5 秒轮询一次补上
    func checkHidden() {
        guard let b = ball else { return }
        // 启动后 8 秒内不自动收球：她可能正带着上次的 hidden 状态启动，别一开机就只剩一个球
        if Date().timeIntervalSince(launchedAt) < 8 { return }
        web.evaluateJavaScript("!!(document.body && document.body.classList.contains('dshp-pet-hidden'))") {
            [weak self] v, _ in
            guard let self else { return }
            let hidden = (v as? Bool) ?? false
            if hidden && !b.isVisible {
                // 两种情况都要把球叫回来：① 主窗口还开着（用户刚点了隐藏）
                // ② 两个窗口都不见了（主人报的「缩小以后球也没了，不知道去哪找」）
                self.collapseToBall()
            }
        }
    }
}
