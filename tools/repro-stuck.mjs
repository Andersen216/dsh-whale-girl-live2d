#!/usr/bin/env node
/**
 * repro-stuck.mjs —— 复现主人报的那个 bug：
 *
 *   「工作模式的时候我再让它互动，比如点蛋包饭，就会卡住：
 *     蛋包饭永久停在桌上、表情回不去；拿手机拍照也回不去；
 *     连一键重置所有状态都救不回来。」
 *
 * 做法：用 /__events 灌一串「长时间干活」的事件（不结束），
 * 在干活中间去点菜单里的蛋包饭 / 手机，然后按主人的操作路径一步步 dump 状态。
 *
 *   node tools/repro-stuck.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = (() => { const i = process.argv.indexOf('--url'); return i === -1 ? 'http://127.0.0.1:5199/' : process.argv[i + 1] })()
const PORT = 9900 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-repro-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1200,820', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] })

const J = (o) => JSON.stringify(o)

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
  let ready = false
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try { ready = await evaluate('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)') } catch (e) {}
    if (ready) break
  }
  if (!ready) { console.error('桌宠没就绪'); ws.close(); return }

  const snap = () => evaluate(`(function(){
    var s = window.DSHPet.state;
    return JSON.stringify({
      status: s.agent.status, mood: s.mood, face: s.face, base: s.base, props: s.props,
      userProps: s.userProps, ovLeft: s.overrideLeft, work: s.work, device: s.device,
      sceneTidy: s.sceneTidy, motion: s.motion.playing,
      bubble: ((document.querySelector('.dshp-body')||{}).textContent||'').slice(0,28),
    });
  })()`).then(JSON.parse)

  const menu = (tab, chip) => `(function(){
    var r = document.getElementById('dsh-live2d-pet');
    r.classList.add('dshp-open');
    var get = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
    if (!get()) document.querySelector('.dshp-dock').children[1].click();
    var tabs = get().querySelectorAll('.dshp-tab-btn');
    for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === ${J(tab)}) tabs[i].click();
    var list = get().querySelectorAll('.dshp-chip');
    var chip = null;
    for (var j = 0; j < list.length; j++) if (list[j].textContent === ${J(chip)}) chip = list[j];
    if (!chip) return 'chip-missing';
    chip.click();
    return 'clicked';
  })()`

  const events = [
    { t: 'user', text: '帮我把这份资料看完' },
    { t: 'turn-start', turn: 1 },
    { t: 'step-start', turn: 1, step: 1 },
    { t: 'tool-call', callId: 'd1', name: 'web_search', label: '上网查', args: '{"queries":["背景资料"]}' },
  ]

  console.log('\n=== 场景一：干活中（手机已掏出）点「蛋包饭」 ===')
  await evaluate('window.DSHPet.resetEverything()')
  await sleep(800)
  await fetch(URL_.replace(/\/$/, '') + '/__events', { method: 'POST', body: J({ events, gap: 200 }) })
  await sleep(2200)
  let s = await snap()
  console.log('干活中      :', J(s))
  console.log('点蛋包饭    :', await evaluate(menu('场景', '蛋包饭')))
  await sleep(1200)
  s = await snap(); console.log('点完 1.2 秒 :', J(s))
  await sleep(4000)
  s = await snap(); console.log('点完 5 秒   :', J(s))
  await sleep(11000)
  s = await snap(); console.log('点完 16 秒  :', J(s))
  console.log('一键重置    :', await evaluate('String(window.DSHPet.resetEverything())'))
  await sleep(1200)
  s = await snap(); console.log('重置后 1.2s :', J(s))
  await sleep(4000)
  s = await snap(); console.log('重置后 5s   :', J(s))
  await sleep(9000)
  s = await snap(); console.log('重置后 14s  :', J(s))

  console.log('\n=== 场景二：干活中掏出手机（查资料）后点「手机换色」 ===')
  await evaluate('window.DSHPet.resetEverything()')
  await sleep(600)
  await fetch(URL_.replace(/\/$/, '') + '/__events', { method: 'POST', body: J({ events, gap: 200 }) })
  await sleep(2000)
  s = await snap(); console.log('手机已掏出  :', J(s))
  console.log('点手机换色  :', await evaluate(menu('场景', '手机换色')))
  await sleep(1200)
  s = await snap(); console.log('点完 1.2 秒 :', J(s))
  console.log('一键重置    :', await evaluate('String(window.DSHPet.resetEverything())'))
  await sleep(1500)
  s = await snap(); console.log('重置后 1.5s :', J(s))
  await sleep(9500)
  s = await snap(); console.log('重置后 11s  :', J(s))

  console.log('\n=== 场景二点五：重置之后必须一直是「本子+笔+平常脸」 ===')
  await evaluate('window.DSHPet.resetEverything()')
  await sleep(500)
  const watch = []
  for (let i = 0; i < 12; i++) {
    await sleep(1000)
    const st = await snap()
    watch.push(st.face + '/' + st.base + '/' + st.props.join('+'))
  }
  console.log('重置后 12 秒内每秒采样：')
  console.log('  ' + watch.join('\n  '))

  console.log('\n=== 场景三：干活中途，agent 那边结束了这一轮 ===')
  await evaluate('window.DSHPet.resetEverything()')
  await sleep(600)
  await fetch(URL_.replace(/\/$/, '') + '/__events', {
    method: 'POST',
    body: J({ events: events.concat([{ t: 'tool-result', callId: 'd1', name: 'web_search', label: '上网查', ms: 1200, error: null }]), gap: 200 }),
  })
  await sleep(1800)
  console.log('点蛋包饭    :', await evaluate(menu('场景', '蛋包饭')))
  await sleep(800)
  s = await snap(); console.log('点完        :', J(s))
  await fetch(URL_.replace(/\/$/, '') + '/__events', {
    method: 'POST',
    body: J({ events: [{ t: 'turn-end', turn: 1, reason: { kind: 'completed' }, ms: 3000, tokens: 100 }], gap: 0 }),
  })
  await sleep(2500)
  s = await snap(); console.log('收工后 2.5s :', J(s))
  await sleep(4000)
  s = await snap(); console.log('收工后 6.5s :', J(s))

  ws.close()
}

main()
  .catch((e) => { console.error('失败:', e.message); process.exitCode = 1 })
  .finally(async () => {
    try { chrome.kill('SIGKILL') } catch (e) {}
    await sleep(200)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
    process.exit(process.exitCode || 0)
  })
