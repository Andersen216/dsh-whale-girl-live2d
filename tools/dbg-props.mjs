#!/usr/bin/env node
/** 快速诊断：清了所有层之后，桌上为什么还留着道具？ */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9600 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ROOTOUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'promo', 'dbg')
fs.mkdirSync(ROOTOUT, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-dbgprops-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1200,820', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] })
async function main() {
  let ver = null
  for (let i = 0; i < 80 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch (e) {} ; if (!ver) await sleep(150) }
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  let id = 0; const pend = new Map()
  ws.addEventListener('message', (e) => { const raw = typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')
    let m; try { m = JSON.parse(raw) } catch (err) { return } ; if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
  const send = (method, params, sid, to = 30000) => new Promise((resolve, reject) => {
    const i = ++id; const t = setTimeout(() => { pend.delete(i); reject(new Error('CDP 超时 ' + method)) }, to)
    pend.set(i, (m) => { clearTimeout(t); m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result) })
    const msg = { id: i, method, params: params || {} }; if (sid) msg.sessionId = sid; ws.send(JSON.stringify(msg)) })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(()=>{})
  const ev = async (expr, to = 30000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, to)
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result && r.result.value }
  await send('Page.navigate', { url: 'http://127.0.0.1:5199/' }, sessionId, 8000).catch(()=>{})
  for (let i = 0; i < 70; i++) { await sleep(500); try { if (await ev('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')) break } catch (e) {} }
  const snap = (tag) => ev(`(function(){ var s=window.DSHPet.state; return ${JSON.stringify(tag)} + ' | props=' + JSON.stringify(s.props) + ' userProps=' + JSON.stringify(s.userProps) + ' baseProps=' + JSON.stringify(s.baseProps) + ' overrideProps=' + JSON.stringify(s.overrideProps) + ' ovLeft=' + s.overrideLeft; })()`)
  console.log('刚加载      :', await snap('load'))
  await ev(`window.DSHPet.playAction('omurice')`)
  await sleep(1500)
  console.log('播蛋包饭后  :', await snap('afterAction'))
  await ev(`window.DSHPet.clearProps(); window.DSHPet.resetEverything(); window.DSHPet.clearReaction()`)
  console.log('清完立刻    :', await snap('justCleared'))
  await sleep(3000)
  console.log('清完 3 秒   :', await snap('t+3s'))
  await sleep(6000)
  console.log('清完 9 秒   :', await snap('t+9s'))
  console.log('本地存档    :', await ev(`localStorage.getItem('dsh-live2d-pet:layout')`))
  // 对照实验：每步各截一张，看图里道具到底有没有真的消失（排除截图合成的假象）
  const shot = async (name) => {
    const box = JSON.parse(await ev(`(function(){
      var el=document.getElementById('dsh-live2d-pet'); var r=el.getBoundingClientRect(); var pad=20;
      return JSON.stringify({x:Math.max(0,r.left-pad), y:Math.max(0,r.top-pad),
        width:Math.min(window.innerWidth,r.right+pad)-Math.max(0,r.left-pad),
        height:Math.min(window.innerHeight,r.bottom+pad)-Math.max(0,r.top-pad)});})()`))
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 } }, sessionId, 20000)
    const f = path.join(ROOTOUT, name)
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    console.log('  截图 →', name, (fs.statSync(f).size / 1024).toFixed(0) + ' KB')
  }
  await shot('exp-1-干净待机.png')
  await ev(`window.DSHPet.playAction('omurice')`)
  await sleep(2500)
  await shot('exp-2-播蛋包饭中.png')
  await ev(`window.DSHPet.clearProps(); window.DSHPet.resetEverything(); window.DSHPet.clearReaction()`)
  await sleep(9000)
  console.log('清完 9 秒   :', await snap('again'))
  await shot('exp-3-清完9秒.png')
  await ev(`window.DSHPet.playAction('openLid')`)
  await sleep(2500)
  await shot('exp-4-掏手机.png')
  ws.close()
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 })
  .finally(async () => { try { chrome.kill('SIGKILL') } catch (e) {} ; await sleep(200); process.exit(process.exitCode || 0) })
