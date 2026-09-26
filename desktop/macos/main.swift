// 鲸鱼娘桌宠 · macOS 原生壳（方案 A）
// ————————————————————————————————————————————————————————————
// 做的事：开一个**透明、无边框、永远置顶**的窗口贴在你桌面上，里面跑插件的
// `/dsh-pet/standalone` 页面。于是桌宠不再只活在浏览器标签页里。
//
// 四个关键点，缺一个都不像「桌宠」：
//   1. 透明 + 无边框 + 无阴影：窗口本身看不见，只有鲸鱼娘和她的气泡
//   2. 永远置顶 + 跟随所有空间：切桌面、开全屏她都还在
//   3. **点击穿透**：鼠标压在她身上才收事件，其它地方事件直接穿到下面的 App。
//      判断「算不算在她身上」用页面里的 DSHPet.hitTest（alpha 掩码，不是方块），
//      另外把气泡/菜单/钱包/输入框这些面板也算进去，否则那些面板点不动。
//   4. 拖她 = 拖窗口（而不是在窗口里挪动她）；松手位置会记住，下次打开还在那儿。
//
// 编译见 tools/build-desktop-mac.sh；本文件不依赖任何第三方库。
import Cocoa
import WebKit

let PET_URL = "http://127.0.0.1:3080/dsh-pet/standalone"
let WIN_W: CGFloat = 620
let WIN_H: CGFloat = 560
let K_X = "pet.win.x", K_Y = "pet.win.y", K_TOP = "pet.win.top"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var win: NSWindow!
    var web: WKWebView!
    var status: NSStatusItem!
    var probe: Timer?

    var inside = false          // 鼠标当前是不是压在她（或她的面板）身上
    var downAt = NSPoint.zero   // 按下时的鼠标位置（屏幕坐标）
    var winAt = NSPoint.zero    // 按下时的窗口位置
    var moved: CGFloat = 0      // 这次按下总共挪了多少像素
    var shellDrag = false       // 已经判定为「拖窗口」而不是「点她」

    // MARK: - 启动

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.accessory)   // 不占 Dock、不抢焦点
        makeWindow()
        makeWeb()
        makeStatusItem()
        installMonitors()
        restorePosition()
        load()
        probe = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.updateHit()
        }
        RunLoop.current.add(probe!, forMode: .common)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    // MARK: - 窗口

    func makeWindow() {
        win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: WIN_W, height: WIN_H),
            styleMask: [.borderless], backing: .buffered, defer: false)
        win.isOpaque = false
        win.backgroundColor = .clear
        win.hasShadow = false
        win.level = .floating
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        win.ignoresMouseEvents = true          // 先全穿透，鼠标压到她身上再收事件
        win.isMovableByWindowBackground = false
        win.title = "DS 鲸鱼娘"
    }

    func makeWeb() {
        let cfg = WKWebViewConfiguration()
        web = WKWebView(frame: win.contentView!.bounds, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        // 透明背景：WKWebView 的 drawsBackground 是私有键，先确认存在再设，避免崩
        if WKWebView.instancesRespond(to: NSSelectorFromString("setDrawsBackground:")) {
            web.setValue(false, forKey: "drawsBackground")
        }
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        win.contentView!.addSubview(web)
    }

    func makeStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "🐋"          // 菜单栏上的入口：没有它这个窗口就关不掉了
        status.button?.toolTip = "DS 鲸鱼娘桌宠"
        let m = NSMenu()
        m.addItem(withTitle: "重新加载", action: #selector(reload), keyEquivalent: "r")
        m.addItem(withTitle: "回到右下角", action: #selector(resetPos), keyEquivalent: "")
        let top = m.addItem(withTitle: "总在最前", action: #selector(toggleTop), keyEquivalent: "")
        top.state = (UserDefaults.standard.object(forKey: K_TOP) as? Bool ?? true) ? .on : .off
        m.addItem(.separator())
        m.addItem(withTitle: "打开自检页（浏览器）", action: #selector(openDiag), keyEquivalent: "")
        m.addItem(withTitle: "打开 DSH 插件设置目录", action: #selector(openHome), keyEquivalent: "")
        m.addItem(.separator())
        m.addItem(withTitle: "退出桌宠", action: #selector(quit), keyEquivalent: "q")
        for it in m.items { it.target = self }
        status.menu = m
    }

    // MARK: - 拖动 / 点击

    func installMonitors() {
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) {
            [weak self] e in self?.handle(e) ?? e
        }
    }

    func handle(_ e: NSEvent) -> NSEvent? {
        switch e.type {
        case .leftMouseDown:
            downAt = NSEvent.mouseLocation
            winAt = win.frame.origin
            moved = 0
            shellDrag = false
            return e

        case .leftMouseDragged:
            let m = NSEvent.mouseLocation
            let dx = m.x - downAt.x, dy = m.y - downAt.y
            moved = max(moved, abs(dx) + abs(dy))
            if moved > 3 {
                if !shellDrag {
                    shellDrag = true
                    // 告诉她「这次不算点我」：前端监听 pointercancel 会把按下状态清掉
                    web.evaluateJavaScript(
                        "document.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}))",
                        completionHandler: nil)
                    NSCursor.closedHand.push()
                }
                win.setFrameOrigin(NSPoint(x: winAt.x + dx, y: winAt.y + dy))
                return nil                          // 吃掉拖动，别让页面里那个「拖动她」的逻辑也动
            }
            return e

        case .leftMouseUp:
            if shellDrag {
                shellDrag = false
                NSCursor.pop()
                savePosition()
                return nil                          // 吃掉这次松手：拖窗口不该被当成「摸头」
            }
            savePosition()
            return e

        default:
            return e
        }
    }

    // MARK: - 点击穿透

    /// 这行 JS 决定「鼠标这个位置算不算在她身上」：
    /// ① 模型本体：用页面自己的 alpha 掩码命中判定
    /// ② 她的面板：气泡 / 菜单 / 钱包 / 输入框 / 工具条（不然那些点不动）
    let hitJS = """
    (function(){try{
      var x=__X__, y=__Y__;
      if(window.DSHPet && DSHPet.hitTest && DSHPet.hitTest(x,y)) return true;
      var el=document.elementFromPoint(x,y);
      if(!el || el===document.body || el===document.documentElement) return false;
      if(!el.closest) return false;
      return !!el.closest('.dshp-panel,.dshp-menu,.dshp-hud,.dshp-bubble,.dshp-composer,.dshp-dock,.dshp-chip,.dshp-btn,.dshp-tabs');
    }catch(e){return false}})()
    """

    func updateHit() {
        let m = NSEvent.mouseLocation
        let f = win.frame
        if !f.contains(m) { setInside(false); return }
        let x = m.x - f.minX
        let y = f.height - (m.y - f.minY)     // 屏幕坐标 → 网页坐标（左上原点）
        let js = hitJS.replacingOccurrences(of: "__X__", with: String(format: "%.1f", x))
                       .replacingOccurrences(of: "__Y__", with: String(format: "%.1f", y))
        web.evaluateJavaScript(js) { [weak self] v, _ in
            let on = (v as? Bool) ?? ((v as? NSNumber)?.boolValue ?? false)
            self?.setInside(on)
        }
    }

    func setInside(_ v: Bool) {
        if v == inside { return }
        inside = v
        win.ignoresMouseEvents = !v
    }

    // MARK: - 加载与位置

    func load() {
        guard let u = URL(string: PET_URL) else { return }
        guard let token = deskToken() else {
            log("还没拿到本地通行证（~/.dsh/dsh-live2d-pet-desktop.json）—— 插件可能还是旧版，5 秒后重试")
            retry(after: 5)
            return
        }
        // 把通行证写成 cookie：之后页面里的 pet.js、SSE、控制接口都会自动带上它，
        // 不用改前端任何一行。
        let props: [HTTPCookiePropertyKey: Any] = [
            .name: "dsh_pet_desk", .value: token, .domain: "127.0.0.1", .path: "/",
        ]
        guard let cookie = HTTPCookie(properties: props) else {
            log("通行证 cookie 构造失败，直接尝试加载")
            web.load(URLRequest(url: u))
            return
        }
        web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
            self?.log("通行证已就位，加载 \(PET_URL)")
            self?.web.load(URLRequest(url: u))
        }
    }

    /// 读插件写的通行证文件（插件每次启动会确保它在）
    func deskToken() -> String? {
        let p = NSHomeDirectory() + "/.dsh/dsh-live2d-pet-desktop.json"
        guard let d = FileManager.default.contents(atPath: p),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let t = o["token"] as? String, t.count >= 16
        else { return nil }
        return t
    }

    func webView(_ w: WKWebView, didFinish navigation: WKNavigation!) {
        // 把「页面标题 + DSHPet 在不在」打出来：能一眼看出是加载了桌宠页还是加载了报错页
        w.evaluateJavaScript("document.title + ' | DSHPet=' + (window.DSHPet ? 'yes' : 'no')") {
            [weak self] v, _ in
            self?.log("页面加载完成 → \(v as? String ?? "?")")
        }
    }

    func webView(_ w: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError e: Error) {
        log("加载失败：\(e.localizedDescription) —— 5 秒后重试")
        retry(after: 5)
    }

    func webView(_ w: WKWebView, didFail nav: WKNavigation!, withError e: Error) {
        log("加载中断：\(e.localizedDescription) —— 5 秒后重试")
        retry(after: 5)
    }

    /// 状态码不是 200（比如通行证没生效被栅栏挡成 401）就当失败处理，别把错误页留在桌面上
    func webView(_ w: WKWebView, decidePolicyFor resp: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = resp.response as? HTTPURLResponse, http.statusCode != 200 {
            decisionHandler(.cancel)
            log("页面返回 HTTP \(http.statusCode) —— 3 秒后重试（若一直是 401：插件需要重启一次 DSH）")
            retry(after: 3)
            return
        }
        decisionHandler(.allow)
    }

    /// 日志同时进 stderr 和 ~/.dsh/whalegirlpet.log，出问题时能直接看
    func log(_ s: String) {
        let line = "[\(Date().formatted(date: .omitted, time: .standard))] \(s)\n"
        FileHandle.standardError.write(line.data(using: .utf8)!)
        let path = NSHomeDirectory() + "/.dsh/whalegirlpet.log"
        if let h = FileHandle(forWritingAtPath: path) {
            h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
        } else {
            try? line.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    /// DSH 还没启动 / 正在重启时不至于一片空白：过几秒自己再试
    func retry(after seconds: Double = 5) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in self?.load() }
    }

    func savePosition() {
        UserDefaults.standard.set(Double(win.frame.origin.x), forKey: K_X)
        UserDefaults.standard.set(Double(win.frame.origin.y), forKey: K_Y)
    }

    func restorePosition() {
        let d = UserDefaults.standard
        if d.object(forKey: K_X) != nil {
            let p = NSPoint(x: d.double(forKey: K_X), y: d.double(forKey: K_Y))
            let r = NSRect(origin: p, size: win.frame.size)
            if NSScreen.screens.contains(where: { $0.frame.intersects(r) }) {
                win.setFrameOrigin(p)
                return
            }
        }
        resetPos()
    }

    // MARK: - 菜单动作

    @objc func reload() { load() }

    @objc func resetPos() {
        guard let vf = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame else { return }
        win.setFrameOrigin(NSPoint(x: vf.maxX - WIN_W - 8, y: vf.minY + 8))
        savePosition()
    }

    @objc func toggleTop(_ item: NSMenuItem) {
        let on = !(UserDefaults.standard.object(forKey: K_TOP) as? Bool ?? true)
        UserDefaults.standard.set(on, forKey: K_TOP)
        item.state = on ? .on : .off
        win.level = on ? .floating : .normal
    }

    @objc func openDiag() {
        if let u = URL(string: "http://127.0.0.1:3080/dsh-pet/diag") { NSWorkspace.shared.open(u) }
    }

    @objc func openHome() {
        NSWorkspace.shared.open(URL(fileURLWithPath: NSHomeDirectory() + "/.dsh"))
    }

    @objc func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
