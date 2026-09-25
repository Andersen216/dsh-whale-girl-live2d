#!/usr/bin/env node
/** 快速诊断：清了所有层之后，桌上为什么还留着道具？ */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9600 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

  console.log('\n=== 打开菜单，看每个面板的夹取情况 ===')
  await ev(`window.DSHPet.resetEverything()`)
  await sleep(700)
  await ev(`(function(){ var r=document.getElementById('dsh-live2d-pet'); r.classList.add('dshp-open');
    document.querySelector('.dshp-dock').children[1].click(); return 1 })()`)
  await sleep(600)
  console.log(await ev(`(function(){
    var out = [];
    document.querySelectorAll('.dshp-panel, .dshp-hud').forEach(function(p){
      var r = p.getBoundingClientRect();
      out.push({cls: p.className, left: Math.round(r.left), right: Math.round(r.right),
        shift: getComputedStyle(p).getPropertyValue('--dshp-shift').trim()});
    });
    return JSON.stringify({vw: window.innerWidth, panels: out}, null, 1);
  })()`))
  ws.close()
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 })
  .finally(async () => { try { chrome.kill('SIGKILL') } catch (e) {} ; await sleep(200); process.exit(process.exitCode || 0) })
