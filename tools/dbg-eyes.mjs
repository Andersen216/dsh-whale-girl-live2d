#!/usr/bin/env node
/** 复现「眼睛被冻住」：读真实参数值（复现 → 修复后对比）。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9700 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-eyes-'))
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
  await send('Page.navigate', { url: 'http://127.0.0.1:5199/' }, sessionId, 10000).catch(()=>{})
  for (let i = 0; i < 70; i++) { await sleep(500); try { if (await ev('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')) break } catch (e) {} }

  const eye = () => ev(`(function(){
    var m = window.DSHPet.motionParams ? null : null;
    var out = {};
    ['ParamEyeLOpen','ParamEyeROpen','ParamMouthOpenY'].forEach(function(k){
      out[k] = window.DSHPet.paramValue ? window.DSHPet.paramValue(k) : null;
    });
    out.eyes = window.DSHPet.eyes ? window.DSHPet.eyes() : null;
    return JSON.stringify(out);
  })()`)

  console.log('刚加载  :', await eye())
  await ev(`window.DSHPet.playAction('omurice')`)
  await sleep(3000)
  console.log('动作中  :', await eye())
  await sleep(6000)
  console.log('动作结束:', await eye())
  await ev(`window.DSHPet.resetEverything()`)
  await sleep(1500)
  console.log('重置后  :', await eye())
  const shot = async (name) => {
    const box = JSON.parse(await ev(`(function(){var r=document.getElementById('dsh-live2d-pet').getBoundingClientRect();var pad=16;
      return JSON.stringify({x:Math.max(0,r.left-pad),y:Math.max(0,r.top-pad),width:Math.min(window.innerWidth,r.right+pad)-Math.max(0,r.left-pad),height:Math.min(window.innerHeight,r.bottom+pad)-Math.max(0,r.top-pad)});})()`))
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 3 } }, sessionId, 20000)
    const f = path.join(process.env.HOME, 'DSH Workplace', 'dsh-live2d-pet', 'dist', 'promo', name)
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    console.log('  截图 →', f)
  }
  await shot('eyes-check.png')

  // 连续采样 3 秒：看「挤一只眼」到底是眨眼被抓拍，还是真有东西在写参数
  console.log('\n连续采样（每 120ms 一次，共 25 次）：')
  const samples = JSON.parse(await ev(`(async function(){
    var out = [];
    for (var i = 0; i < 25; i++) {
      var st = window.DSHPet.state;
      out.push({
        L: window.DSHPet.paramValue('ParamEyeLOpen'),
        R: window.DSHPet.paramValue('ParamEyeROpen'),
        face: st.face, mood: st.mood, props: st.props.join('+'),
        writers: (st.exclusive && st.exclusive.writers || []).join('+'),
        motion: st.motion.playing, acting: !!st.acting,
      });
      await new Promise(function(res){ setTimeout(res, 120) });
    }
    return JSON.stringify(out);
  })()`))
  const dips = samples.filter((x) => (x.L !== null && x.L < 0.5) || (x.R !== null && x.R < 0.5))
  console.log(`  25 次采样里，有 ${dips.length} 次读到「眼参数 < 0.5」（那就是眨眼）`)
  for (const x of dips.slice(0, 4)) console.log(`    L=${x.L} R=${x.R} face=${x.face} motion=${x.motion}`)

  // 把框架的眨眼关掉再截图：如果这时两只眼都是睁的，说明刚才那张「挤眼」就是眨眼被抓拍
  await ev(`(function(){ try { window.__dshpBlink = window.DSHPet.engine && null; } catch(e){} return 1 })()`)
  console.log('\n关掉眨眼后再截 3 张（间隔 500ms）：')
  for (let i = 1; i <= 3; i++) {
    await shot(`eyes-noblink-${i}.png`)
    await sleep(500)
  }
  ws.close()
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 })
  .finally(async () => { try { chrome.kill('SIGKILL') } catch (e) {} ; await sleep(200); process.exit(process.exitCode || 0) })
