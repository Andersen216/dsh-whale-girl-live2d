#!/usr/bin/env node
/** 快速调试：工作模式 → 点蛋包饭 → 一键重置，逐项打印判定结果。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = 'http://127.0.0.1:5199/'
const PORT = 9800 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-dbg-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1200,820', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] })

async function main() {
  let ver = null
  for (let i = 0; i < 80 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch (e) {}
    if (!ver) await sleep(150)
  }
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  let id = 0
  const pend = new Map()
  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')
    let m; try { m = JSON.parse(raw) } catch (e) { return }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  })
  const send = (method, params, sid, to = 30000) =>
    new Promise((resolve, reject) => {
      const i = ++id
      const t = setTimeout(() => { pend.delete(i); reject(new Error('CDP 超时 ' + method)) }, to)
      pend.set(i, (m) => { clearTimeout(t); m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result) })
      const msg = { id: i, method, params: params || {} }
      if (sid) msg.sessionId = sid
      ws.send(JSON.stringify(msg))
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(() => {})
  const evaluate = async (expr, to) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, to || 30000)
    if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text))
    return r.result && r.result.value
  }
  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try { if (await evaluate('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')) break } catch (e) {}
  }
  const inject = (events, gap) => evaluate(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ events, gap }))}}).then(function(r){return r.status})`)
  const clickChip = (tab, label) => evaluate(`(function(){
    var r = document.getElementById('dsh-live2d-pet');
    r.classList.add('dshp-open');
    var get = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
    if (!get()) document.querySelector('.dshp-dock').children[1].click();
    var tabs = get().querySelectorAll('.dshp-tab-btn');
    for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === ${JSON.stringify(tab)}) tabs[i].click();
    var list = get().querySelectorAll('.dshp-chip');
    var chip = null;
    for (var j = 0; j < list.length; j++) if (list[j].textContent === ${JSON.stringify(label)}) chip = list[j];
    if (!chip) return 'chip-missing:' + Array.prototype.map.call(get().querySelectorAll('.dshp-chip'), function(c){return c.textContent}).join('|');
    chip.click();
    return 'clicked';
  })()`)

  await evaluate('window.DSHPet.resetEverything()')
  await sleep(600)
  await inject([{ t: 'user', text: '看资料' }, { t: 'turn-start', turn: 1 }, { t: 'step-start', turn: 1, step: 1 }, { t: 'tool-call', callId: 's1', name: 'web_search', label: '上网查', args: '{"queries":["x"]}' }], 120)
  await sleep(1800)
  console.log('点蛋包饭:', await clickChip('场景', '蛋包饭'))
  await sleep(900)
  console.log('点完    :', await evaluate(`JSON.stringify(window.DSHPet.state.props) + ' tidy=' + JSON.stringify(window.DSHPet.sceneTidy)`))

  await evaluate('window.DSHPet.resetEverything()')
  await sleep(900)
  const raw = await evaluate(`(function(){
    var s = window.DSHPet.state;
    var props = s.props.slice();
    var want = ['点菜按下', '画笔'];
    return JSON.stringify({
      propsRaw: props,
      sortedNow: props.slice().sort(),
      sortedWant: want.slice().sort(),
      joinedNow: props.slice().sort().join(','),
      joinedWant: want.slice().sort().join(','),
      eqProps: props.slice().sort().join(',') === want.slice().sort().join(','),
      face: s.face, faceIsNull: s.face === null,
      base: s.base, baseIsNeutral: s.base === 'neutral',
      workActive: s.work.active, deviceOut: s.device.out, tidy: s.sceneTidy,
      lenNow: props.length,
    });
  })()`)
  console.log('重置后  :', raw)

  console.log('摆两件  :', await clickChip('场景', '蛋包饭'))
  await sleep(400)
  console.log('第二件  :', await clickChip('场景', '桌面巴菲'))
  await sleep(700)
  console.log('两件之后:', await evaluate(`JSON.stringify(window.DSHPet.state.userProps) + ' tidy=' + JSON.stringify(window.DSHPet.sceneTidy)`))
  ws.close()
}
main().catch((e) => { console.error('失败:', e.message); process.exitCode = 1 }).finally(async () => {
  try { chrome.kill('SIGKILL') } catch (e) {}
  await sleep(200)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
  process.exit(process.exitCode || 0)
})
