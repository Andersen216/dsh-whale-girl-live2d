#!/usr/bin/env node
/**
 * ascii.mjs —— 把 PNG（可选裁剪区域）转成 ASCII 打到终端。
 *
 * 存在的理由：这个环境里 agent 看不到图片（vision 工具返回非 JSON），
 * 但能读终端文本。降采样成 ASCII 之后，「东西在不在、形状对不对、有没有被裁掉」
 * 都能判断，比盲猜强得多。
 *
 *   node tools/ascii.mjs shot.png                  # 整图，默认 110 列
 *   node tools/ascii.mjs shot.png 100              # 指定列数
 *   node tools/ascii.mjs shot.png 100 810,360,400,380   # 只画这块区域
 *   node tools/ascii.mjs shot.png 100 810,360,400,380 color   # 用颜色分类而不是亮度
 */

import fs from 'node:fs'
import zlib from 'node:zlib'

const [, , file, colsArg, cropArg, modeArg] = process.argv
if (!file) {
  console.error('用法: node tools/ascii.mjs <png> [列数] [x,y,w,h] [color]')
  process.exit(1)
}
const COLS = Number(colsArg) || 110
const MODE = modeArg === 'color' ? 'color' : 'luma'

function decodePng(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 6
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`不支持的 PNG: bitDepth=${bitDepth} colorType=${colorType}`)
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const px = Buffer.alloc(height * stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const f = raw[rp++]
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const cur = px.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
  }
  return { width, height, bpp, stride, px }
}

const img = decodePng(fs.readFileSync(file))
let { x: cx, y: cy, w: cw, h: chh } = { x: 0, y: 0, w: img.width, h: img.height }
if (cropArg) {
  const [a, b, c, d] = cropArg.split(',').map(Number)
  cx = Math.max(0, a); cy = Math.max(0, b)
  cw = Math.min(img.width - cx, c); chh = Math.min(img.height - cy, d)
}
const rows = Math.max(4, Math.round(((COLS * chh) / cw) * 0.48))
const RAMP = ' .:-=+*#%@'
// 「有颜色」判定：饱和度足够高就算角色的像素（界面背景基本是灰的）
const lines = []
let colored = 0
let total = 0
for (let ry = 0; ry < rows; ry++) {
  let line = ''
  for (let rx = 0; rx < COLS; rx++) {
    const x0 = cx + Math.floor((rx * cw) / COLS)
    const x1 = cx + Math.max(Math.floor((rx * cw) / COLS) + 1, Math.floor(((rx + 1) * cw) / COLS))
    const y0 = cy + Math.floor((ry * chh) / rows)
    const y1 = cy + Math.max(Math.floor((ry * chh) / rows) + 1, Math.floor(((ry + 1) * chh) / rows))
    let lum = 0, sat = 0, n = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * img.stride + x * img.bpp
        const r = img.px[i], g = img.px[i + 1], b = img.px[i + 2]
        lum += 0.299 * r + 0.587 * g + 0.114 * b
        sat += Math.max(r, g, b) - Math.min(r, g, b)
        n++
      }
    }
    lum = n ? lum / n : 0
    sat = n ? sat / n : 0
    total++
    if (sat > 26) colored++
    const v = MODE === 'color'
      ? Math.min(1, sat / 90)
      : Math.min(1, (lum / 255) * 0.62 + (sat / 255) * 2.0)
    line += RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))]
  }
  lines.push(line)
}
console.log(`${file}  ${img.width}×${img.height}  区域 ${cx},${cy} ${cw}×${chh}  →  ${COLS}×${rows}`)
console.log(`彩色像素占比（粗略的角色覆盖率）: ${((colored / total) * 100).toFixed(1)}%`)
console.log(lines.join('\n'))
