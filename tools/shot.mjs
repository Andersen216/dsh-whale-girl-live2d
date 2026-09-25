#!/usr/bin/env node
/**
 * shot.mjs —— 无头浏览器截图 + ASCII 预览。
 *
 * 两个坑都踩过了，记在这里免得再踩：
 *
 *   1. 必须走「浏览器级端点 + Target.createTarget + attachToTarget(flatten) + sessionId」。
 *      直接用 /json/list 里那个页面级 WebSocket，Runtime.evaluate 和 captureScreenshot
 *      会全部超时（这台机器的 Chrome 上实测如此），连 Runtime.enable 都不回包。
 *   2. 必须带 --no-sandbox / --disable-gpu-sandbox / --no-zygote。否则 GPU 进程
 *      以 exit_code=6 (SIGABRT) 挂掉，WebGL 起不来，画布全透明——截图看着就像
 *      「模型没出来」，其实只是没渲染。
 *
 * 另外，agent 在很多环境里看不到图片，所以这里顺手把截图降采样成 ASCII 打到终端，
 * 至少能判断「东西在不在、形状对不对、有没有被裁掉」。
 *
 *   node tools/shot.mjs                                   # 截预览页
 *   node tools/shot.mjs --url http://127.0.0.1:3080/      # 截正在跑的 DSH
 *   node tools/shot.mjs --ascii 110                       # 附带 ASCII 预览
 *   node tools/shot.mjs --script "DSHPet.setMood('angry')" --after 2000
 *   node tools/shot.mjs --states                          # 依次截 整张桌子/上半身/只有头
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? dflt : process.argv[i + 1]
}
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = arg('url', 'http://127.0.0.1:5199/')
const OUT = arg('out', '/tmp/dsh-pet-shot.png')
const WAIT = Number(arg('wait', 9000))
const WIDTH = Number(arg('width', 1200))
const HEIGHT = Number(arg('height', 820))
const SCRIPT = arg('script', '')
const ASCII_W = Number(arg('ascii', 0))
const STATES = process.argv.includes('--states')
const PORT = Number(arg('port', 9700 + Math.floor(Math.random() * 250)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 解 Chrome 截图产出的 PNG（8bit RGB/RGBA、非隔行），够用了。 */
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
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return null
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

function asciiPreview(buf, cols) {
  const img = decodePng(buf)
  if (!img) {
    console.log('（ASCII 预览跳过：不支持的 PNG 格式）')
    return
  }
  const { width, height, bpp, stride, px } = img
  const rows = Math.max(8, Math.round(((cols * height) / width) * 0.5))
  const ramp = ' .:-=+*#%@'
  const lines = []
  for (let ry = 0; ry < rows; ry++) {
    let line = ''
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor((rx * width) / cols)
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * width) / cols))
      const y0 = Math.floor((ry * height) / rows)
      const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * height) / rows))
      let lum = 0
      let sat = 0
      let n = 0
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = y * stride + x * bpp
          const r = px[i]
          const g = px[i + 1]
          const b = px[i + 2]
          lum += 0.299 * r + 0.587 * g + 0.114 * b
          sat += Math.max(r, g, b) - Math.min(r, g, b)
          n++
        }
      }
      lum = n ? lum / n : 0
      sat = n ? sat / n : 0
      // 有彩色的地方给更高权重：模型是彩色的，界面背景基本是灰的
      const v = Math.min(1, (lum / 255) * 0.6 + (sat / 255) * 2.2)
      line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))]
    }
    lines.push(line)
  }
  console.log(`\n--- ASCII 预览（${width}×${height} → ${cols}×${rows}；越密 = 越亮/越彩）---`)
  console.log(lines.join('\n'))
  console.log('--- ASCII 结束 ---\n')
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-shot-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--no-zygote',
      '--disable-dev-shm-usage',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )

  try {
    let ver = null
    for (let i = 0; i < 80 && !ver; i++) {
      try {
        ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      } catch (e) {}
      if (!ver) await sleep(150)
    }
    if (!ver) throw new Error('Chrome 调试端口没起来')

    const ws = new WebSocket(ver.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res)
      ws.addEventListener('error', rej)
    })
    let id = 0
    const pend = new Map()
    ws.addEventListener('message', async (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')
      let m
      try {
        m = JSON.parse(raw)
      } catch (e) {
        return
      }
      if (m.id && pend.has(m.id)) {
        pend.get(m.id)(m)
        pend.delete(m.id)
      }
    })
    const send = (method, params, sessionId, to = 20000) =>
      new Promise((resolve, reject) => {
        const i = ++id
        const t = setTimeout(() => {
          pend.delete(i)
          reject(new Error('CDP 超时 ' + method))
        }, to)
        pend.set(i, (m) => {
          clearTimeout(t)
          m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)
        })
        const msg = { id: i, method, params: params || {} }
        if (sessionId) msg.sessionId = sessionId
        ws.send(JSON.stringify(msg))
      })

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(() => {})
    await send('Page.enable', {}, sessionId, 5000).catch(() => {})

    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, 20000)
      if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
      return r.result && r.result.value
    }
    const shootTo = async (file) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId, 60000)
      const buf = Buffer.from(shot.data, 'base64')
      fs.writeFileSync(file, buf)
      console.log(`\n截图: ${file}（${buf.length} 字节）`)
      return buf
    }

    await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
    await sleep(WAIT)

    if (STATES) {
      for (const mode of ['full', 'bust', 'head']) {
        await evaluate(
          `(()=>{const k='dsh-live2d-pet:layout';const v=JSON.parse(localStorage.getItem(k)||'{}');v.fit='${mode}';localStorage.setItem(k,JSON.stringify(v));return 1})()`,
        )
        await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
        await sleep(WAIT)
        const st = await evaluate('window.DSHPet?JSON.stringify(window.DSHPet.state.view):null')
        const file = OUT.replace(/\.png$/, '') + '-' + mode + '.png'
        const buf = await shootTo(file)
        console.log(`  取景 ${mode}: ${st}`)
        if (ASCII_W) asciiPreview(buf, ASCII_W)
      }
      ws.close()
      return
    }

    if (SCRIPT) {
      console.log('执行: ' + SCRIPT)
      const scriptResult = await evaluate(SCRIPT)
      if (scriptResult !== undefined && scriptResult !== null) {
        console.log('脚本返回: ' + (typeof scriptResult === 'string' ? scriptResult : JSON.stringify(scriptResult)))
      }
      await sleep(Number(arg('after', 1500)))
    }

    const buf = await shootTo(OUT)
    const st = await evaluate(
      'window.DSHPet?JSON.stringify({view:window.DSHPet.state.view,content:window.DSHPet.state.contentBox,mood:window.DSHPet.state.mood,props:window.DSHPet.state.props}):null',
    )
    console.log('状态: ' + st)
    if (ASCII_W) asciiPreview(buf, ASCII_W)
    ws.close()
  } finally {
    try {
      chrome.kill('SIGKILL')
    } catch (e) {}
    await sleep(200)
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch (e) {}
  }
}

main().catch((err) => {
  console.error('shot 失败:', err.message)
  process.exitCode = 1
})
