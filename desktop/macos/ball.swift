// 鲸鱼娘桌宠 · 收起态的贴边悬浮球（原生版）
// ————————————————————————————————————————————————————————————
// 为什么不用 WebView 画：主人要的是「液态玻璃」那种半透明观感 —— 那必须让系统去采样
// 桌面背后真正的内容（NSVisualEffectView + blendingMode = .behindWindow），
// 网页里的 backdrop-filter 只能模糊网页自己，做不出来。
//
// 观感：直径 36px 的圆形玻璃球（菜单里可调 28 / 36 / 48），中间是 DSH 官方图标（白色），
// 鼠标悬停微微放大，拖动跟手，松手**动画滑向最近的那一侧**（不是瞬移，也不是随便挑一边）。
import Cocoa

/// 小球本体：圆形玻璃 + 图标 + 悬停放大
final class BallView: NSView {
    let effect = NSVisualEffectView()
    let icon = NSImageView()
    private var tracking: NSTrackingArea?
    private var sheen: CAGradientLayer?
    private(set) var diameter: CGFloat = 36
    let pad: CGFloat = 16          // 给阴影和悬停放大留的余量

    init(diameter: CGFloat, icon: NSImage?) {
        self.diameter = diameter
        super.init(frame: NSRect(x: 0, y: 0, width: diameter + pad * 2, height: diameter + pad * 2))
        wantsLayer = true

        effect.material = .hudWindow
        effect.blendingMode = .behindWindow     // 关键：透出桌面真实内容，才有玻璃感
        effect.state = .active
        // 强制深色玻璃：浅色材质在白桌面上 + 白图标 = 完全看不见（主人报的问题）
        effect.appearance = NSAppearance(named: .darkAqua)
        effect.wantsLayer = true
        effect.layer?.cornerRadius = diameter / 2
        effect.layer?.masksToBounds = true
        effect.layer?.borderWidth = 1.5
        effect.layer?.borderColor = NSColor(white: 1, alpha: 0.55).cgColor   // 亮边：深底上也勾得出来
        addSubview(effect)

        // 深色压底：就算玻璃材质被系统调亮，这一层也保证「白底上是个黑球」
        let tint = NSView()
        tint.wantsLayer = true
        tint.layer?.backgroundColor = NSColor(white: 0.04, alpha: 0.5).cgColor
        tint.frame = effect.bounds
        tint.autoresizingMask = [.width, .height]
        effect.addSubview(tint)

        // 液态玻璃的高光：上半部分一道柔光
        let sheen = CAGradientLayer()
        sheen.colors = [NSColor(white: 1, alpha: 0.22).cgColor, NSColor(white: 1, alpha: 0).cgColor]
        sheen.startPoint = CGPoint(x: 0.5, y: 1)
        sheen.endPoint = CGPoint(x: 0.5, y: 0.35)
        sheen.frame = effect.bounds
        effect.layer?.addSublayer(sheen)
        self.sheen = sheen

        self.icon.image = icon
        self.icon.imageScaling = .scaleProportionallyUpOrDown
        self.icon.contentTintColor = .white
        effect.addSubview(self.icon)

        layoutBall(scale: 1)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        tracking = t
    }

    override func mouseEntered(with event: NSEvent) { animate(scale: 1.12) }
    override func mouseExited(with event: NSEvent) { animate(scale: 1) }

    /// 用 animator() 调它 → 悬停放大是动画，不是跳变
    @objc func layoutBall(scale: CGFloat) {
        let d = diameter * scale
        let c = NSPoint(x: bounds.midX, y: bounds.midY)
        effect.frame = NSRect(x: c.x - d / 2, y: c.y - d / 2, width: d, height: d)
        effect.layer?.cornerRadius = d / 2
        let s = d * 0.58
        icon.frame = NSRect(x: (d - s) / 2, y: (d - s) / 2, width: s, height: s)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        sheen?.frame = NSRect(x: 0, y: 0, width: d, height: d)
        CATransaction.commit()
    }

    private func animate(scale: CGFloat) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.14
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            self.animator().layoutBall(scale: scale)
        }
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
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: d + 32, height: d + 32),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = true                    // 窗口阴影跟着圆形 alpha 走，正好是球的光晕
        w.level = .statusBar          // 抬到普通窗口之上，免得被别的 App 盖住「看不见了」
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        w.isReleasedWhenClosed = false

        let view = BallView(diameter: d, icon: ballIconImage())
        w.contentView = view
        ball = w
        ballView = view
        log("悬浮小球已就绪（原生玻璃球 " + String(Int(d)) + "px）")
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
        let x = (dLeft <= dRight) ? vf.minX + 4 : vf.maxX - b.frame.width - 4
        let y = min(max(win.frame.midY - b.frame.height / 2, vf.minY + 4), vf.maxY - b.frame.height - 4)
        b.setFrameOrigin(NSPoint(x: x, y: y))
        b.alphaValue = 1
        b.orderFrontRegardless()
        win.orderOut(nil)
        UserDefaults.standard.set(Double(x), forKey: "ball.x")
        UserDefaults.standard.set(Double(y), forKey: "ball.y")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.endAwake() }
        log("已收起成小球 → 贴" + (dLeft <= dRight ? "左" : "右") + "边 (\(Int(x)),\(Int(y))) 可见=\(b.isVisible)")
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

    /// 贴边：吸到**离得最近**的那一侧（比球心到左右边缘的距离），带动画
    func snapBall(animated: Bool) {
        guard let b = ball, b.isVisible else { return }
        let vf = (b.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let f = b.frame
        let dLeft = abs(f.midX - vf.minX)
        let dRight = abs(vf.maxX - f.midX)
        let x = (dLeft <= dRight) ? vf.minX + 4 : vf.maxX - f.width - 4
        let y = min(max(f.minY, vf.minY + 4), vf.maxY - f.height - 4)
        let target = NSPoint(x: x, y: y)
        if animated {
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.26
                ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
                b.animator().setFrameOrigin(target)
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
