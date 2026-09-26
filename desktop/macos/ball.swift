// 鲸鱼娘桌宠 · 收起态的「贴边悬浮小球」
// ————————————————————————————————————————————————————————————
// 主人要求：点「隐藏」不要只是消失不见，要像 360 那种悬浮球 ——
// 缩成一个小圆球贴在屏幕边上，中间是 DeepSeek 的图标，点一下就把她叫回来。
//
// 实现要点：
//   · 小球是**另一个窗口**（68×68，透明、无边框、置顶），主窗口 orderOut 让位
//   · 松手自动贴左/右墙（竖直位置随你放），下次打开还在那儿
//   · 点一下 = 展开；拖动 = 挪位置；右键 = 菜单（展开 / 退出）
//   · 图标直接读 DSH 安装目录里的官方 favicon.svg，不往仓库里塞别人的品牌素材
import Cocoa
import WebKit

extension AppDelegate {

    func makeBall() {
        let size: CGFloat = 68
        let f = NSRect(x: 0, y: 0, width: size, height: size)
        let w = NSWindow(contentRect: f, styleMask: [.borderless], backing: .buffered, defer: false)
        w.isOpaque = false
        w.backgroundColor = .clear
        w.hasShadow = false
        w.level = .floating
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        w.isReleasedWhenClosed = false

        let cfg = WKWebViewConfiguration()
        let web = WKWebView(frame: NSRect(origin: .zero, size: f.size), configuration: cfg)
        web.autoresizingMask = [.width, .height]
        if WKWebView.instancesRespond(to: NSSelectorFromString("_setDrawsBackground:")) {
            web.setValue(false, forKey: "drawsBackground")
        }
        if WKWebView.instancesRespond(to: NSSelectorFromString("_setDrawsTransparentBackground:")) {
            web.setValue(true, forKey: "drawsTransparentBackground")
        }
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        w.contentView!.addSubview(web)

        web.loadHTMLString(ballHTML(), baseURL: nil)
        ball = w
        ballWeb = web
        log("悬浮小球已就绪（收起后贴边显示）")
    }

    func ballHTML() -> String {
        """
        <!doctype html><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;background:transparent;overflow:hidden;
          -webkit-user-select:none;user-select:none;-webkit-user-drag:none}
        .ball{width:100%;height:100%;border-radius:50%;box-sizing:border-box;
          background:rgba(22,26,38,.9);border:1px solid rgba(255,255,255,.18);
          box-shadow:0 8px 22px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;
          transition:transform .12s ease,background .12s ease}
        .ball:hover{background:rgba(36,42,60,.97);transform:scale(1.07)}
        .ball svg{width:56%;height:56%}
        .ball svg path{fill:#fff}
        </style><body><div class="ball">\(brandSVG())</div></body>
        """
    }

    /// DSH 自带的品牌图标（从安装目录读；读不到就退回模型图标，最后兜底一个「DS」字样）
    func brandSVG() -> String {
        let candidates = [
            "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg",
            NSHomeDirectory() + "/.dsh/favicon.svg",
        ]
        for p in candidates {
            guard let s = try? String(contentsOfFile: p, encoding: .utf8), s.contains("<svg") else { continue }
            var out = s
            // 去掉它自带的 prefers-color-scheme 样式，颜色统一由小球这边控制
            if let a = out.range(of: "<style>"), let b = out.range(of: "</style>") {
                out.removeSubrange(a.lowerBound..<b.upperBound)
            }
            return out
        }
        log("没找到 DSH 的 favicon.svg，小球用兜底字样")
        return #"<span style="color:#fff;font:600 20px -apple-system,sans-serif">DS</span>"#
    }

    // MARK: - 收起 / 展开

    @objc func collapseToBall() {
        guard let b = ball else { return }
        if b.isVisible { return }
        savePosition()
        // 小球的初始位置：贴着主窗口所在的那一侧，竖直高度取主窗口中心
        let vf = (win.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let d = UserDefaults.standard
        var p: NSPoint
        if d.object(forKey: "ball.x") != nil {
            p = NSPoint(x: d.double(forKey: "ball.x"), y: d.double(forKey: "ball.y"))
        } else {
            let onLeft = win.frame.midX < vf.midX
            p = NSPoint(x: onLeft ? vf.minX + 6 : vf.maxX - b.frame.width - 6,
                        y: min(max(win.frame.midY - b.frame.height / 2, vf.minY + 6), vf.maxY - b.frame.height - 6))
        }
        b.setFrameOrigin(p)
        b.orderFrontRegardless()
        win.orderOut(nil)
        snapBall()
        log("已收起成小球（位置 \(Int(b.frame.minX)),\(Int(b.frame.minY))）")
        // 小球自己也量一次透明：它要是白方块就白做了
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, let bw = self.ballWeb else { return }
            self.clearBackdrops(bw)
            bw.takeSnapshot(with: WKSnapshotConfiguration()) { img, _ in
                let rep = img.flatMap { $0.tiffRepresentation }.flatMap { NSBitmapImageRep(data: $0) }
                if let c = rep?.colorAt(x: 2, y: 2) {
                    self.log(String(format: "小球角落像素 r%.2f g%.2f b%.2f a%.2f（a=0 表示圆外透明）",
                                    c.redComponent, c.greenComponent, c.blueComponent, c.alphaComponent))
                }
            }
        }
    }

    @objc func expandFromBall() {
        ball?.orderOut(nil)
        win.orderFrontRegardless()
        // 页面里那个「隐藏」状态也要一起改回来，否则她还是不显示
        web.evaluateJavaScript("window.DSHPet && DSHPet.setHidden && DSHPet.setHidden(false)",
                               completionHandler: nil)
        log("已展开桌宠")
    }

    /// 贴边：吸附到最近的一侧（只吸左右，竖直位置保持）
    func snapBall() {
        guard let b = ball, b.isVisible else { return }
        let vf = (b.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let f = b.frame
        let x = (f.midX < vf.midX) ? vf.minX + 6 : vf.maxX - f.width - 6
        let y = min(max(f.minY, vf.minY + 6), vf.maxY - f.height - 6)
        b.setFrameOrigin(NSPoint(x: x, y: y))
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
            if ballMoved > 3 {
                ball?.setFrameOrigin(NSPoint(x: ballAt.x + dx, y: ballAt.y + dy))
            }
            return nil

        case .leftMouseUp:
            if ballMoved > 3 { snapBall(); log("小球贴边") }
            else { expandFromBall() }
            return nil

        default:
            return e
        }
    }

    // MARK: - 页面里的隐藏状态 → 自动换小球

    /// 主人在页面里点了「隐藏」就把主窗口收起来、换成小球；
    /// 反过来如果页面里又显示了她（比如从浏览器那边点回来的），小球就收起来。
    func checkHidden() {
        guard let b = ball else { return }
        web.evaluateJavaScript("!!(document.body && document.body.classList.contains('dshp-pet-hidden'))") {
            [weak self] v, _ in
            guard let self else { return }
            let hidden = (v as? Bool) ?? false
            if hidden && !b.isVisible && self.win.isVisible {
                self.collapseToBall()
            }
        }
    }
}
