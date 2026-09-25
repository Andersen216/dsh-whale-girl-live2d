#!/usr/bin/env node
/** 数一数 15 秒里眨了几次、每次多长；顺便量聊天框是否对准头顶。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9800 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-blink-'))
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
  const ev = async (expr, to = 90000) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, to)
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result && r.result.value }
  await send('Page.navigate', { url: 'http://127.0.0.1:5199/' }, sessionId, 10000).catch(()=>{})
  for (let i = 0; i < 70; i++) { await sleep(500); try { if (await ev('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')) break } catch (e) {} }

  console.log('\n=== 眨眼统计（每 50ms 采样，共 15 秒）===')
  const r = JSON.parse(await ev(`(async function(){
    window.DSHPet.resetEverything();
    await new Promise(function(res){ setTimeout(res, 600) });
    var samples = [];
    for (var i = 0; i < 300; i++) { samples.push(window.DSHPet.eyes()); await new Promise(function(res){ setTimeout(res, 50) }); }
    var blinks = 0, inBlink = false, len = 0, lens = [];
    for (var j = 0; j < samples.length; j++) {
      var closed = samples[j] !== null && samples[j] < 0.5;
      if (closed && !inBlink) { inBlink = true; len = 1; blinks++; }
      else if (closed && inBlink) len++;
      else if (!closed && inBlink) { inBlink = false; lens.push(len * 50); }
    }
    return JSON.stringify({blinks: blinks, lens: lens, seconds: 15, blink: window.DSHPet.blink(), panels: window.DSHPet.state.panels});
  })()`))
  console.log(`  15 秒眨眼 ${r.blinks} 次（平均每 ${(15 / Math.max(1, r.blinks)).toFixed(1)} 秒一次）`)
  console.log(`  单次时长(ms)：${r.lens.join(', ')}`)
  console.log(`  眨眼闸门：${JSON.stringify(r.blink)}`)
  console.log(`  面板：${JSON.stringify(r.panels)}`)

  console.log('\n=== 聊天框是否对准头顶 ===')
  const pos = JSON.parse(await ev(`(async function(){
    var root = document.getElementById('dsh-live2d-pet');
    var out = [];
    var places = [['靠左墙', 8], ['中间', Math.round(window.innerWidth/2 - 120)], ['靠右墙', window.innerWidth - 250]];
    for (var k = 0; k < places.length; k++) {
      window.DSHPet.resetEverything();
      await new Promise(function(res){ setTimeout(res, 400) });
      root.style.left = places[k][1] + 'px'; root.style.top = '380px'; root.style.right = 'auto'; root.style.bottom = 'auto';
      await new Promise(function(res){ setTimeout(res, 300) });
      document.querySelector('.dshp-dock').children[0].click();
      await new Promise(function(res){ setTimeout(res, 450) });
      var box = document.querySelector('.dshp-composer.dshp-on').getBoundingClientRect();
      var head = window.DSHPet.state.headX !== undefined ? window.DSHPet.state.headX : null;
      out.push({where: places[k][0], panelCenter: Math.round(box.left + box.width/2),
        left: Math.round(box.left), right: Math.round(box.right), inside: box.left >= 0 && box.right <= window.innerWidth});
      document.querySelector('.dshp-dock').children[0].click();
      await new Promise(function(res){ setTimeout(res, 250) });
    }
    return JSON.stringify(out);
  })()`))
  for (const p of pos) console.log(`  ${p.where}: 面板中心 x=${p.panelCenter}（${p.left}~${p.right}，在屏内=${p.inside}）`)
  ws.close()
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 })
  .finally(async () => { try { chrome.kill('SIGKILL') } catch (e) {} ; await sleep(200); process.exit(process.exitCode || 0) })
