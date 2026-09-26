// 生成分享图·无网址版（1080×1440）—— B 站/平台机审会把图里的域名 OCR 出来，这版把域名换成「搜仓库名」
// ————————————————————————————————————————————————————————————
// 为什么这么做：小红书正文不能放链接，所以把网址**写进图里** + 置顶评论放完整链接。
// 图里不放二维码 —— 用户是在手机上看图，扫不了自己的屏幕，二维码纯属浪费位置。
//
// 用法： swiftc -O -o /tmp/mkcard tools/make-share-card.swift && /tmp/mkcard <她的实拍图> <输出目录>
import Cocoa

let args = CommandLine.arguments
let shotPath = args.count > 1 ? args[1] : NSHomeDirectory() + "/.dsh/whalegirlpet-shot.png"
let outDir = args.count > 2 ? args[2] : "dist/promo"
let SITE = "andersen216.github.io/dsh-whale-girl-live2d"
let W = 1080.0, H = 1440.0

let shot = NSImage(contentsOfFile: shotPath)

func ctxFor(_ w: Double, _ h: Double) -> (NSBitmapImageRep, NSGraphicsContext) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(w), pixelsHigh: Int(h),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: w, height: h)
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    return (rep, ctx)
}

func write(_ rep: NSBitmapImageRep, _ name: String) {
    guard let png = rep.representation(using: .png, properties: [:]) else { return }
    let path = "\(outDir)/\(name)"
    try? png.write(to: URL(fileURLWithPath: path))
    print("已生成 \(path)")
}

func text(_ s: String, _ rect: NSRect, size: CGFloat, weight: NSFont.Weight = .regular,
          color: NSColor = .white, align: NSTextAlignment = .center, line: CGFloat = 1.15) {
    let p = NSMutableParagraphStyle()
    p.alignment = align
    p.lineHeightMultiple = line
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: p,
    ]
    (s as NSString).draw(in: rect, withAttributes: attrs)
}


/// 按 alpha 把图片裁到「有内容的范围」——只留她，去掉四周的透明留白
func cropToContent(_ img: NSImage) -> NSImage? {
    guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
    var minX = rep.pixelsWide, minY = rep.pixelsHigh, maxX = 0, maxY = 0
    for y in stride(from: 0, to: rep.pixelsHigh, by: 2) {
        for x in stride(from: 0, to: rep.pixelsWide, by: 2) {
            if let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.25 {
                if x < minX { minX = x }; if x > maxX { maxX = x }
                if y < minY { minY = y }; if y > maxY { maxY = y }
            }
        }
    }
    guard maxX > minX, maxY > minY else { return nil }
    let pad = 8
    let rect = NSRect(x: max(0, minX - pad), y: max(0, minY - pad),
                      width: min(rep.pixelsWide - 1, maxX + pad) - max(0, minX - pad),
                      height: min(rep.pixelsHigh - 1, maxY + pad) - max(0, minY - pad))
    guard let cg = rep.cgImage?.cropping(to: rect) else { return nil }
    return NSImage(cgImage: cg, size: NSSize(width: rect.width, height: rect.height))
}

/// 蓝色渐变底（鲸鱼娘配色）
func paintBackground(_ ctx: NSGraphicsContext) {
    let grad = NSGradient(colors: [
        NSColor(srgbRed: 0.13, green: 0.20, blue: 0.46, alpha: 1),
        NSColor(srgbRed: 0.07, green: 0.10, blue: 0.24, alpha: 1),
    ])!
    // 整幅径向渐变：外圈直接落到深色，避免出现矩形硬边（第一版就栽在这）
    let base = NSGradient(colors: [
        NSColor(srgbRed: 0.20, green: 0.31, blue: 0.68, alpha: 1),
        NSColor(srgbRed: 0.09, green: 0.13, blue: 0.30, alpha: 1),
        NSColor(srgbRed: 0.05, green: 0.07, blue: 0.17, alpha: 1),
    ])!
    base.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)
}

/// ① 主图：她 + 一句话 + 网址
func card1() {
    let (rep, ctx) = ctxFor(W, H)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    paintBackground(ctx)

    // 她的实拍（透明底）：先裁到实体范围再居中放大 ——
    // 原图她待在右下角，直接铺会把画面重心弄偏（第一版就是这样）
    if let s = shot, let cropped = cropToContent(s) {
        let box = NSRect(x: 70, y: 330, width: W - 140, height: 660)
        let scale = min(box.width / cropped.size.width, box.height / cropped.size.height)
        let dw = cropped.size.width * scale, dh = cropped.size.height * scale
        cropped.draw(in: NSRect(x: box.midX - dw / 2, y: box.minY + (box.height - dh) / 2, width: dw, height: dh),
                     from: .zero, operation: .sourceOver, fraction: 1)
    }

    text("🐋 电脑上养了只鲸鱼娘", NSRect(x: 60, y: 1180, width: W - 120, height: 120),
         size: 76, weight: .bold)
    text("她跟着 AI 一起干活 —— 我思考她翻本子，我查资料她戴眼镜",
         NSRect(x: 70, y: 1080, width: W - 140, height: 60), size: 33,
         color: NSColor(white: 1, alpha: 0.88))
    text("免费 · 开源 · 非商业", NSRect(x: 60, y: 1000, width: W - 120, height: 60),
         size: 32, weight: .medium, color: NSColor(srgbRed: 0.66, green: 0.78, blue: 1, alpha: 1))

    // 网址块：图里能看清，评论区再放完整链接
    let bar = NSBezierPath(roundedRect: NSRect(x: 90, y: 150, width: W - 180, height: 130),
                           xRadius: 28, yRadius: 28)
    NSColor(white: 1, alpha: 0.12).setFill()
    bar.fill()
    NSColor(white: 1, alpha: 0.28).setStroke()
    bar.lineWidth = 2
    bar.stroke()
    text("装法在下一张图 · 网址在评论区置顶", NSRect(x: 110, y: 210, width: W - 220, height: 44),
         size: 30, color: NSColor(white: 1, alpha: 0.72))
    text("GitHub 搜 dsh-whale-girl-live2d", NSRect(x: 110, y: 160, width: W - 220, height: 52), size: 40, weight: .semibold)
    NSGraphicsContext.restoreGraphicsState()
    write(rep, "分享图-1-主图.png")
}

/// ② 怎么装：三步，越简洁越好
func card2() {
    let (rep, ctx) = ctxFor(W, H)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    paintBackground(ctx)

    text("怎么装（3 步，2 分钟）", NSRect(x: 60, y: 1270, width: W - 120, height: 90),
         size: 64, weight: .bold)

    let steps: [(String, String, String)] = [
        ("1", "装 DSH 插件（一条命令）", "dsh plugin --profile web add\ngithub:Andersen216/dsh-whale-girl-live2d"),
        ("2", "下载桌面客户端", "Windows 装 .exe · Mac 拖进「应用程序」\n（客户端里也能一键装插件）"),
        ("3", "重启 DSH，她就出现了", "网页版：刷新页面 · 桌面版：双击打开\n她每 5 秒自动重连，不用重启客户端"),
    ]
    var y = 1120.0
    for (num, title, detail) in steps {
        let card = NSBezierPath(roundedRect: NSRect(x: 70, y: y - 200, width: W - 140, height: 250),
                                xRadius: 32, yRadius: 32)
        NSColor(white: 1, alpha: 0.10).setFill()
        card.fill()
        NSColor(white: 1, alpha: 0.20).setStroke()
        card.lineWidth = 2
        card.stroke()

        let badge = NSBezierPath(ovalIn: NSRect(x: 110, y: y - 60, width: 64, height: 64))
        NSColor(srgbRed: 0.35, green: 0.50, blue: 0.95, alpha: 1).setFill()
        badge.fill()
        text(num, NSRect(x: 110, y: y - 52, width: 64, height: 48), size: 36, weight: .bold)

        text(title, NSRect(x: 200, y: y - 70, width: W - 320, height: 60),
             size: 42, weight: .semibold, align: .left)
        text(detail, NSRect(x: 200, y: y - 190, width: W - 320, height: 120),
             size: 30, color: NSColor(white: 1, alpha: 0.80), align: .left, line: 1.3)
        y -= 300
    }

    text("GitHub 搜 dsh-whale-girl-live2d", NSRect(x: 40, y: 120, width: W - 80, height: 56), size: 34, weight: .semibold,
         color: NSColor(srgbRed: 0.74, green: 0.83, blue: 1, alpha: 1))
    text("（网址放在评论区置顶）", NSRect(x: 60, y: 84, width: W - 120, height: 36),
         size: 24, color: NSColor(white: 1, alpha: 0.55))
    text("模型来自 B 站 @氵六青 · 角色形象 @上善无形 @ZipZipPipe",
         NSRect(x: 40, y: 40, width: W - 80, height: 36), size: 23,
         color: NSColor(white: 1, alpha: 0.5))
    NSGraphicsContext.restoreGraphicsState()
    write(rep, "分享图-2-怎么装.png")
}

try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
card1()
card2()
