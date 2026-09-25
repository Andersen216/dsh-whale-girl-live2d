#!/usr/bin/env node
/**
 * hud-probe.mjs —— 试右键 HUD：余额 / 本轮消耗 / 峰谷 + 倒计时，并截图看设计。
 *   node tools/hud-probe.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist', 'promo')
fs.mkdirSync(OUT, { recursive: true })
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9700 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-hud-'))
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1200,860', 'about:blank'],
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 860, deviceScaleFactor: 2, mobile: false }, sessionId, 5000).catch(()=>{})
  const ev = async (expr, to = 30000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, to)
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result && r.result.value }
  await send('Page.navigate', { url: 'http://127.0.0.1:5199/' }, sessionId, 10000).catch(()=>{})
  for (let i = 0; i < 70; i++) { await sleep(500); try { if (await ev('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')) break } catch (e) {} }

  const shot = async (name) => {
    const box = JSON.parse(await ev(`(function(){
      var parts=[document.getElementById('dsh-live2d-pet')];
      var hud=document.querySelector('.dshp-hud.dshp-on'); if(hud) parts.push(hud);
      var b=document.querySelector('.dshp-bubble.dshp-on'); if(b) parts.push(b);
      var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      parts.forEach(function(el){var r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
        x0=Math.min(x0,r.left);y0=Math.min(y0,r.top);x1=Math.max(x1,r.right);y1=Math.max(y1,r.bottom);});
      var pad=24;
      return JSON.stringify({x:Math.max(0,x0-pad),y:Math.max(0,y0-pad),
        width:Math.min(window.innerWidth,x1+pad)-Math.max(0,x0-pad),
        height:Math.min(window.innerHeight,y1+pad)-Math.max(0,y0-pad)});})()`))
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 } }, sessionId, 20000)
    const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    console.log('  截图 →', name, (fs.statSync(f).size / 1024).toFixed(0) + ' KB')
  }

  console.log('\n=== 1) 右键（真鼠标事件）应该弹 HUD ===')
  const pt = JSON.parse(await ev(`(function(){
    var r=document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
    for(var i=1;i<=12;i++)for(var j=1;j<=12;j++){var x=r.left+r.width*i/13,y=r.top+r.height*j/13;
      if(window.DSHPet.hitTest(x,y)) return JSON.stringify({x:x,y:y});}
    return 'null';})()`))
  const x = pt.x, y = pt.y
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 }, sessionId)
  await sleep(1500)
  const r1 = await ev('JSON.stringify(window.DSHPet.hud.read())')
  console.log('  HUD 状态:', r1)
  const j1 = JSON.parse(r1)
  console.log(j1.open ? '  ✅ 右键弹出的是 HUD（不是设置菜单）' : '  ❌ 右键没弹出 HUD')
  console.log((j1.text.money || '').indexOf('42.50') >= 0 ? '  ✅ 余额显示正确 ' + j1.text.money : '  ❌ 余额没显示：' + j1.text.money)
  console.log(/峰|谷/.test(j1.text.badge) ? '  ✅ 峰谷标记：' + j1.text.badge + '（' + j1.text.badgeClass + '）' : '  ❌ 没有峰谷标记')
  console.log(j1.text.countdown !== '—' ? '  ✅ 距切换倒计时：' + j1.text.countdown : '  ❌ 没有倒计时')
  await shot('HUD-1-峰（右键弹出）.png')

  console.log('\n=== 2) 谷价配色（?peak=0 强制谷）===')
  await ev(`(async function(){ const r = await fetch('/dsh-whale/balance.json?peak=0',{cache:'no-store'}).then(r=>r.json());
    window.__peak0 = r; return 1 })()`)
  // 直接改 HUD 内部数据再看渲染（模拟谷价）
  await ev(`(function(){ window.DSHPet.hud.hide(); return 1 })()`)
  await ev(`(async function(){
    const r = await fetch('/dsh-whale/balance.json?peak=0',{cache:'no-store'}).then(r=>r.json());
    window.DSHPet.hud.show({flash:true});
    await new Promise(function(res){setTimeout(res,300)});
    return 1 })()`)
  await sleep(1200)
  console.log('  （预览站的假接口按真实时间给峰谷，谷价配色用下面这张真机上才准）')

  console.log('\n=== 3) 一轮结束应该自动弹出「本轮消耗」===')
  await ev(`window.DSHPet.hud.hide()`)
  await sleep(300)
  await ev(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[
    {t:'turn-start',turn:3},{t:'step-start',turn:3,step:1},
    {t:'tool-call',callId:'h1',name:'bash',label:'跑命令',args:'{"command":"npm test"}'},
    {t:'tool-result',callId:'h1',name:'bash',label:'跑命令',ms:1500,error:null},
    {t:'turn-end',turn:3,reason:{kind:'completed'},ms:9000,tokens:21500}],gap:250})}).then(function(){return 1})`)
  await sleep(4200)
  const r3 = JSON.parse(await ev('JSON.stringify(window.DSHPet.hud.read())'))
  console.log('  HUD 状态:', JSON.stringify({ open: r3.open, turn: r3.turn, text: r3.text && r3.text.turn }))
  console.log(r3.open ? '  ✅ 一轮结束后自动弹出来了' : '  ❌ 没有自动弹出')
  console.log(r3.turn && r3.turn.amount !== null ? '  ✅ 本轮消耗：' + r3.text.turn : '  ❌ 没读到本轮消耗')
  await shot('HUD-2-一轮结束自动弹出.png')

  console.log('\n=== 4) 不能跟对话冲突：打开菜单时 HUD 要收起来 ===')
  await ev(`window.DSHPet.hud.show()`)
  await sleep(400)
  const a = await ev('window.DSHPet.hud.open()')
  await ev(`(function(){ var r=document.getElementById('dsh-live2d-pet'); r.classList.add('dshp-open');
    document.querySelector('.dshp-dock').children[1].click(); return 1 })()`)
  await sleep(500)
  const b = await ev('window.DSHPet.hud.open()')
  console.log(`  HUD 打开=${a} → 打开菜单后 HUD 打开=${b}`)
  console.log(a === true && b === false ? '  ✅ 菜单和 HUD 不会同时占屏' : '  ❌ 两者叠在一起了')
  await sleep(300)
  await shot('HUD-3-与菜单不冲突.png')
  ws.close()
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 })
  .finally(async () => { try { chrome.kill('SIGKILL') } catch (e) {} ; await sleep(200); process.exit(process.exitCode || 0) })
