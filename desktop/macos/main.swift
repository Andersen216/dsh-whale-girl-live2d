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

/// 插件资源目录：优先用「装进 profile 的那份」，找不到再按 App 包相对位置找，
/// 这样不管 App 放在 dist/ 还是被拷到「应用程序」里都能定位到图标。
let assetsPath: String = {
    let profile = NSHomeDirectory() + "/.dsh/profiles/web/node_modules/dsh-whale-girl-live2d/assets"
    if FileManager.default.fileExists(atPath: profile) { return profile }
    let rel = Bundle.main.bundlePath + "/../../../../assets"
    return (rel as NSString).standardizingPath
}()

/// 普通无边框窗口 canBecomeKey 默认是 false —— 表现就是「网页里能点、但打不出字」。
/// 桌宠要能聊天，这个必须打开。
final class PetWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var win: NSWindow!
    var web: WKWebView!
    var status: NSStatusItem!
    var probe: Timer?
    var health: Timer?
    var activity: NSObjectProtocol?
    var lastHealth = ""
    // 收起态：贴边悬浮小球
    var ball: NSWindow?
    var ballWeb: WKWebView?
    var ballView: BallView?
    var ballDown = NSPoint.zero
    var ballAt = NSPoint.zero
    var ballMoved: CGFloat = 0
    var hiddenWatch: Timer?
    var launchedAt = Date()

    var inside = false          // 鼠标当前是不是压在她（或她的面板）身上
    var downAt = NSPoint.zero   // 按下时的鼠标位置（屏幕坐标）
    var winAt = NSPoint.zero    // 按下时的窗口位置
    var moved: CGFloat = 0      // 这次按下总共挪了多少像素
    var shellDrag = false       // 已经判定为「拖窗口」而不是「点她」

    // MARK: - 启动

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.accessory)   // 不占 Dock、不抢焦点
        // 关键：别让 macOS 把「没人操作的透明窗口」判成 App Nap 而掐掉 requestAnimationFrame。
        // 被掐的症状极隐蔽：页面不报错、模型数据也加载了，但 rAF 永不触发 →
        // 前端启动流程停在「等一帧」那一步，于是既画不出她、也连不上事件流。
        activity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .latencyCritical], reason: "DS 鲸鱼娘桌宠需要持续渲染")
        makeWindow()
        makeWeb()
        makeStatusItem()
        makeBall()
        installMonitors()
        restorePosition()
        win.orderFrontRegardless()
        load()
        probe = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.updateHit()
        }
        RunLoop.current.add(probe!, forMode: .common)
        // 页面里点「隐藏」→ 自动换成悬浮小球；这是她和壳子的约定
        launchedAt = Date()
        hiddenWatch = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.checkHidden()
        }
        RunLoop.current.add(hiddenWatch!, forMode: .common)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    // MARK: - 窗口

    func makeWindow() {
        win = PetWindow(
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
        // 把页面里的 console / 报错转发到原生日志：壳子里没有开发者工具，
        // 出问题时只能靠这个看它卡在哪一步。
        let ucc = WKUserContentController()
        ucc.add(self, name: "dshpetlog")
        ucc.add(self, name: "dshpetshell")   // 前端发指令：收起 / 展开 / 彻底退出
        let hook = """
        (function(){
          function send(t, a){
            try{
              var s = a.map(function(x){ try{ return typeof x === 'string' ? x : JSON.stringify(x) }catch(e){ return String(x) } }).join(' ');
              window.webkit.messageHandlers.dshpetlog.postMessage(t + ' ' + s);
            }catch(e){}
          }
          ['log','warn','error'].forEach(function(k){
            var o = console[k] ? console[k].bind(console) : function(){};
            console[k] = function(){ send(k, [].slice.call(arguments)); o.apply(null, arguments) };
          });
          window.addEventListener('error', function(e){ send('✗ window.onerror', [String(e.message) + ' @ ' + e.filename + ':' + e.lineno]) });
          window.addEventListener('unhandledrejection', function(e){ send('✗ unhandledrejection', [String(e.reason)]) });
          // 告诉前端「我在桌面壳里」：设置页会因此多出「收起成小球 / 彻底关闭」两项
          window.__DSHPET_SHELL__ = true;
          // 网页面自己那个「鲸鱼娘」小把手在壳子里不需要（壳子有原生小球），
          // 不藏掉的话收起时会先闪一下那个把手，看着很卡。
          try{
            var st = document.createElement('style');
            st.textContent = 'body.dshp-pet-hidden .dshp-tab{display:none!important}';
            (document.head || document.documentElement).appendChild(st);
          }catch(e){}
        })()
        """
        ucc.addUserScript(WKUserScript(source: hook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = ucc

        web = WKWebView(frame: win.contentView!.bounds, configuration: cfg)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        // 透明背景：三管齐下（WKWebView 的 drawsBackground 是私有键，先确认存在再设，避免崩）
        // 关掉 WKWebView 自己的白底。
        // 坑：老写法查的是 setDrawsBackground:，但那是私有属性 —— 运行时真名是
        // _setDrawsBackground:（KVC 会找到它），查 setDrawsBackground: 只会得到 false，
        // 于是一直以为「不支持」而跳过，白底就这么留了一路。
        if WKWebView.instancesRespond(to: NSSelectorFromString("_setDrawsBackground:")) {
            web.setValue(false, forKey: "drawsBackground")
            log("透明自检：已调用 _setDrawsBackground: 关掉 WebView 白底")
        } else {
            log("透明自检：这台系统没有 _setDrawsBackground:，改用 underPageBackgroundColor")
        }
        if WKWebView.instancesRespond(to: NSSelectorFromString("_setDrawsTransparentBackground:")) {
            web.setValue(true, forKey: "drawsTransparentBackground")
            log("透明自检：已调用 _setDrawsTransparentBackground:")
        }
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        // 图层底色也清掉：窗口是透明的，但 NSView 图层默认可能带底色（「大白框」的头号嫌疑）
        web.wantsLayer = true
        web.layer?.backgroundColor = NSColor.clear.cgColor
        win.contentView?.wantsLayer = true
        win.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
        win.contentView!.addSubview(web)
        clearBackdrops(web)          // WKWebView 内部的滚动视图默认是白底，必须拆掉
        dumpBackgroundMethods()
        log("透明自检：underPageBackgroundColor = \(web.underPageBackgroundColor)")
        // 3 秒后量一次真实像素：窗口角落应该是全透明（alpha=0）
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.probeWindowAlpha() }
    }

    func makeStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "🐋"          // 菜单栏上的入口：没有它这个窗口就关不掉了
        status.button?.toolTip = "DS 鲸鱼娘桌宠"
        let m = NSMenu()
        m.addItem(withTitle: "重新加载", action: #selector(reload), keyEquivalent: "r")
        m.addItem(withTitle: "回到右下角", action: #selector(resetPos), keyEquivalent: "")
        m.addItem(withTitle: "收起成小球（贴边）", action: #selector(collapseToBall), keyEquivalent: "")
        m.addItem(withTitle: "展开桌宠", action: #selector(expandFromBall), keyEquivalent: "")
        let sizeItem = m.addItem(withTitle: "小球大小", action: nil, keyEquivalent: "")
        let sizeMenu = NSMenu()
        for (title, sel) in [("小（28）", #selector(setBallSmall)), ("中（36）", #selector(setBallMedium)), ("大（48）", #selector(setBallLarge))] {
            let it = sizeMenu.addItem(withTitle: title, action: sel, keyEquivalent: "")
            it.target = self
        }
        sizeItem.submenu = sizeMenu
        m.addItem(withTitle: "安装到「应用程序」（之后可双击打开）", action: #selector(installApp), keyEquivalent: "")
        let top = m.addItem(withTitle: "总在最前", action: #selector(toggleTop), keyEquivalent: "")
        top.state = (UserDefaults.standard.object(forKey: K_TOP) as? Bool ?? true) ? .on : .off
        m.addItem(.separator())
        m.addItem(withTitle: "打开自检页（浏览器）", action: #selector(openDiag), keyEquivalent: "")
        m.addItem(withTitle: "打开 DSH 插件设置目录", action: #selector(openHome), keyEquivalent: "")
        m.addItem(.separator())
        m.addItem(withTitle: "彻底退出桌宠", action: #selector(quitNow), keyEquivalent: "q")
        for it in m.items { it.target = self }
        status.menu = m
    }

    // MARK: - 拖动 / 点击

    func installMonitors() {
        NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) {
            [weak self] e in
            guard let self else { return e }
            if let w = e.window, w === self.ball { return self.ballHandle(e) }
            return self.handle(e)
        }
    }

    func handle(_ e: NSEvent) -> NSEvent? {
        switch e.type {
        case .leftMouseDown:
            downAt = NSEvent.mouseLocation
            winAt = win.frame.origin
            moved = 0
            shellDrag = false
            // 点她 = 想跟她说话：把 App 激活、窗口变 key、焦点交给网页，
            // 否则无边框窗口收不到键盘事件（「能点但打不了字」就是这么来的）
            NSApp.activate(ignoringOtherApps: true)
            win.makeKeyAndOrderFront(nil)
            win.makeFirstResponder(web)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                guard let self else { return }
                self.log("键盘自检：isKeyWindow=\(self.win.isKeyWindow) firstResponder=\(String(describing: self.win.firstResponder))")
            }
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
      if(el.tagName==='CANVAS') return false;
      // 她自己的 DOM：凡是能被 elementFromPoint 返回的元素都是可交互的
      //（透明容器一律 pointer-events:none，压根不会被返回）。
      // 之前写死类名白名单，漏了恢复用的把手 .dshp-tab —— 结果一收起就再也点不回来。
      return !!el.closest('.dshp-root, .dshp-tab, [class*="dshp-"]');
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
        clearBackdrops(web)
        win.makeFirstResponder(web)
        // 启动时一定先把她展开：上次退出时如果是「隐藏」状态，页面会带着 hidden 类回来，
        // 壳子会立刻收成小球 —— 主人会以为「人没了」。先把状态清掉，要收再自己收。
        // 页面启动是异步的：它读完保存的布局后可能又把自己设成 hidden，
        // 所以启动后连补几次「展开」，确保主人一开 App 就能看到她。
        for delay in [0.8, 2.0, 4.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.web.evaluateJavaScript("window.DSHPet && DSHPet.setHidden && DSHPet.setHidden(false)",
                                             completionHandler: nil)
            }
        }
        startHealthChecks()
    }

    /// 页面里的 console / 报错转发过来的入口
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "dshpetlog" { log(String(describing: message.body)); return }
        guard message.name == "dshpetshell" else { return }
        // 前端 → 壳子的即时指令。走消息而不是轮询页面状态：
        // 点「收起」立刻开始动画，没有 0.5 秒的延迟感。
        switch String(describing: message.body) {
        case "hidden", "collapse": collapseToBall()
        case "shown", "expand": expandFromBall()
        case "quit": quitNow()
        default: log("壳子收到未知指令：\(message.body)")
        }
    }

    /// 彻底退出（设置页里的「彻底关闭桌宠应用」也走这里）
    @objc func quitNow() {
        log("收到退出指令，正在关闭桌宠")
        UserDefaults.standard.synchronize()
        NSApp.terminate(nil)
    }

    /// 把自己拷到「应用程序」，之后就能像普通 App 一样双击打开（Launchpad / 聚焦都能搜到）
    @objc func installApp() {
        let src = Bundle.main.bundlePath
        let dir = NSHomeDirectory() + "/Applications"
        let dest = dir + "/" + (src as NSString).lastPathComponent
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: dest) { try FileManager.default.removeItem(atPath: dest) }
            try FileManager.default.copyItem(atPath: src, toPath: dest)
            log("已安装到「应用程序」：\(dest)")
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: dest)])
        } catch {
            log("安装到「应用程序」失败：\(error.localizedDescription)")
        }
    }

    /// 每 6 秒问一次页面「你到哪一步了」：模型有没有加载出来、事件流连上没有。
    /// 桌宠是透明的，出问题时「看不见」和「没启动」长得一样，只能靠这个区分。
    func startHealthChecks() {
        health?.invalidate()
        health = Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { [weak self] _ in
            guard let self else { return }
            let js = """
            (function(){try{
              var s = (window.DSHPet && window.DSHPet.state) || null;
              var out = {
                pet: !!window.DSHPet,
                model: !!(s && s.modelSize && s.modelSize.w),
                size: s && s.modelSize ? Math.round(s.modelSize.w)+'x'+Math.round(s.modelSize.h) : null,
                expr: s && s.expressions ? s.expressions.length : null,
                mood: s ? (s.mood || s.baseMood || null) : null,
                agent: s && s.agent ? s.agent.status : null,
                clients: window.__dshpetClients || null,
                webgl: (function(){ try{ var c=document.createElement('canvas'); return !!(c.getContext('webgl')||c.getContext('experimental-webgl')) }catch(e){ return false } })(),
                raf: (function(){
                  if (window.__rafMs === undefined) { try{ requestAnimationFrame(function(){ window.__rafMs = 1 }) }catch(e){} return 'armed' }
                  return window.__rafMs
                })(),
                err: window.__DSHPetError ? String(window.__DSHPetError).slice(0,160) : null,
                bg: getComputedStyle(document.body).backgroundColor + ' / ' + getComputedStyle(document.documentElement).backgroundColor,
                hidden: document.body.classList.contains('dshp-pet-hidden'),
                panels: (function(){
                  var out=[];
                  try{
                    document.querySelectorAll('[class*="dshp-"]').forEach(function(n){
                      var r=n.getBoundingClientRect(), c=getComputedStyle(n).backgroundColor;
                      if(r.width>150 && r.height>100 && c && c!=='rgba(0, 0, 0, 0)')
                        out.push(String(n.className).split(' ')[0]+':'+Math.round(r.width)+'x'+Math.round(r.height)+':'+c);
                    });
                  }catch(e){}
                  return out.slice(0,5);
                })(),
                boot: window.__dshpetBootDone === true
              };
              return JSON.stringify(out);
            }catch(e){ return 'probe error: ' + e.message }})()
            """
            self.web.evaluateJavaScript(js) { v, _ in
                // 只在状态变化时记录，免得日志文件一直长
                let line = v as? String ?? "?"
                if line != self.lastHealth {
                    self.lastHealth = line
                    self.log("健康检查 \(line)")
                }
            }
        }
        RunLoop.current.add(health!, forMode: .common)
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

    /// 把视图树里所有「白色底」拆掉。
    /// 为什么需要：WKWebView 内部包着 NSScrollView，它的 drawsBackground 默认是 true（白），
    /// 而旧的 setDrawsBackground 私有键在新系统上已经没了 —— 这就是「大白框」的来源。
    /// 用运行时反射列出 WKWebView 上跟「背景 / 不透明」有关的私有方法名。
    /// 为什么要这么土：setDrawsBackground 这个老私有键在新系统上已经不存在了，
    /// 得知道现在到底叫什么才能把白底关掉。
    func dumpBackgroundMethods() {
        var count: UInt32 = 0
        guard let methods = class_copyMethodList(WKWebView.self, &count) else { return }
        var hits: [String] = []
        for i in 0..<Int(count) {
            let name = NSStringFromSelector(method_getName(methods[i]))
            let low = name.lowercased()
            if low.contains("background") || low.contains("opaque") || low.contains("draws") {
                hits.append(name)
            }
        }
        free(methods)
        // 同时看看父类 NSView 那边有没有相关可用的
        log("WKWebView 背景相关方法: " + (hits.isEmpty ? "（一个都没有）" : hits.joined(separator: ", ")))
    }

    @discardableResult
    func clearBackdrops(_ v: NSView) -> Int {
        var n = 0
        v.wantsLayer = true
        v.layer?.backgroundColor = NSColor.clear.cgColor
        if let sv = v as? NSScrollView {
            sv.drawsBackground = false
            sv.backgroundColor = .clear
            n += 1
        }
        for sub in v.subviews { n += clearBackdrops(sub) }
        return n
    }

    /// 把窗口内容渲染到位图里，量几个角落的像素 alpha：
    /// 全透明 = 修复成功；白色不透明 = 还有底没拆掉。
    func probeWindowAlpha() {
        let n = clearBackdrops(web)
        log("透明量测：又拆了一遍白底，本次找到 NSScrollView \(n) 个")

        func px(_ rep: NSBitmapImageRep?, _ label: String) {
            guard let rep else { log("\(label)：拿不到位图"); return }
            var out: [String] = []
            for (x, y) in [(3, 3), (Int(win.frame.width) - 4, 3), (3, Int(win.frame.height) - 4)] {
                if x < rep.pixelsWide, y < rep.pixelsHigh, let c = rep.colorAt(x: x, y: y) {
                    out.append(String(format: "(%d,%d)=r%.2f g%.2f b%.2f a%.2f",
                                      x, y, c.redComponent, c.greenComponent, c.blueComponent, c.alphaComponent))
                }
            }
            log("\(label)：\(out.joined(separator: "  "))")
        }

        // ① 对照实验：先把她自己的所有面板/气泡/工具栏藏掉，快照一次。
        //    如果这时角落还是白的，白底就与她无关，是 WebView 自己的。
        web.evaluateJavaScript("""
        (function(){var s=document.createElement('style');s.id='dshpet-probe-hide';
          s.textContent='[class*="dshp-"]{display:none!important}';document.head.appendChild(s);return 1})()
        """) { [weak self] _, _ in
            guard let self else { return }
            self.web.takeSnapshot(with: WKSnapshotConfiguration()) { img, _ in
                let rep = img.flatMap { $0.tiffRepresentation }.flatMap { NSBitmapImageRep(data: $0) }
                px(rep, "藏起她全部 UI 后的角落")
                self.web.evaluateJavaScript("var e=document.getElementById('dshpet-probe-hide'); e&&e.remove()",
                                            completionHandler: nil)
            }
        }

        // ② 网页内容自己的快照：它透明就说明白底来自 WebView 而不是页面
        web.takeSnapshot(with: WKSnapshotConfiguration()) { [weak self] img, err in
            guard let self else { return }
            let rep = img.flatMap { $0.tiffRepresentation }.flatMap { NSBitmapImageRep(data: $0) }
            px(rep, "网页快照角落" + (err == nil ? "" : "（err=\(err!.localizedDescription)）"))
        }

        // ② 窗口在屏幕上的真实样子（没有屏幕录制权限时拿不到，拿不到就说明权限不够）
        if let cg = CGWindowListCreateImage(.null, .optionIncludingWindow,
                                            CGWindowID(win.windowNumber), [.boundsIgnoreFraming]) {
            px(NSBitmapImageRep(cgImage: cg), "屏幕上的窗口角落")
        } else {
            log("屏幕上的窗口位图拿不到（缺「屏幕录制」权限，属正常，用网页快照判断）")
        }
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
