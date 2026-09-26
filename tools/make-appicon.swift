// 生成 macOS App 图标（.icns）
// ————————————————————————————————————————————————————————————
// 设计：蓝色渐变圆角方形底（贴近鲸鱼娘的配色）+ 中间嵌她的平常脸立绘 + 一圈细高光。
// 为什么不用现成的 icon.png 直接转：macOS 图标有自己的形状语言（圆角方形、四周留白），
// 直接把方图塞进去会显得又满又挤，在 Dock / 启动台里一眼就看出「不是个正经 App」。
//
// 用法： swiftc -O -o /tmp/mkicon tools/make-appicon.swift && /tmp/mkicon <源图> <输出目录>
import Cocoa

let args = CommandLine.arguments
let srcPath = args.count > 1 ? args[1] : "assets/model/icon.png"
let outDir = args.count > 2 ? args[2] : "dist/desktop"

guard let src = NSImage(contentsOfFile: srcPath), src.size.width > 0 else {
    FileHandle.standardError.write("读不到源图：\(srcPath)\n".data(using: .utf8)!)
    exit(1)
}

/// 画一张指定边长的图标
func render(_ size: Int) -> NSBitmapImageRep {
    let s = CGFloat(size)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { exit(2) }
    rep.size = NSSize(width: s, height: s)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.setShouldAntialias(true)
    ctx.interpolationQuality = .high

    let full = NSRect(x: 0, y: 0, width: s, height: s)
    // macOS 图标的圆角约是边长的 22.37%，四周再留 4% 的白边（系统会自己裁）
    let body = full.insetBy(dx: s * 0.04, dy: s * 0.04)
    let radius = s * 0.2237 * 0.92
    let base = NSBezierPath(roundedRect: body, xRadius: radius, yRadius: radius)

    // 蓝色渐变底（鲸鱼娘的配色）
    let grad = NSGradient(colors: [
        NSColor(srgbRed: 0.42, green: 0.58, blue: 0.98, alpha: 1),
        NSColor(srgbRed: 0.16, green: 0.27, blue: 0.68, alpha: 1),
    ])
    grad?.draw(in: base, angle: -90)

    // 立绘：嵌进去、同款圆角、留一圈蓝边
    let inset = s * 0.115
    let inner = body.insetBy(dx: inset, dy: inset)
    let innerPath = NSBezierPath(roundedRect: inner, xRadius: radius * 0.62, yRadius: radius * 0.62)
    NSGraphicsContext.saveGraphicsState()
    innerPath.addClip()
    // 源图是方图，按「填满、居中裁切」画，避免被拉扁
    let srcSize = src.size
    let scale = max(inner.width / srcSize.width, inner.height / srcSize.height)
    let drawSize = NSSize(width: srcSize.width * scale, height: srcSize.height * scale)
    let drawRect = NSRect(x: inner.midX - drawSize.width / 2, y: inner.midY - drawSize.height / 2,
                          width: drawSize.width, height: drawSize.height)
    src.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()

    // 立绘外圈：细高光，深色桌面上也立得起来
    NSColor(white: 1, alpha: 0.35).setStroke()
    innerPath.lineWidth = max(1, s * 0.007)
    innerPath.stroke()

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let iconset = "\(outDir)/icon.iconset"
try? FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)

// iconutil 要求的尺寸命名
let wanted: [(Int, String)] = [
    (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
]
for (size, name) in wanted {
    let rep = render(size)
    guard let png = rep.representation(using: .png, properties: [:]) else { continue }
    try? png.write(to: URL(fileURLWithPath: "\(iconset)/\(name)"))
}
print("已生成 \(iconset)")
