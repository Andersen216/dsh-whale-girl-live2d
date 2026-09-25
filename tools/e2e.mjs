#!/usr/bin/env node
/**
 * e2e.mjs —— 端到端验证：桌宠跑在**真实 DSH Web** 里，并被真实 agent 事件驱动。
 *
 * 和 smoke.mjs 的区别：smoke 跑在 tools/preview-server.mjs 的假事件发生器上，
 * 这个直接连一个真的 DSH 实例（需要传入带 token 的地址），走的是真会话、真事件总线。
 *
 *   node tools/e2e.mjs --url "http://127.0.0.1:3099/?token=..." [--send "你好"]
 *
 * 连接方式同 shot.mjs：浏览器级端点 + Target session + --no-sandbox --no-zygote。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name)
  return i === -1 ? dflt : process.argv[i + 1]
}
const URL_ = arg('url', '')
const SEND = arg('send', '')
const SHOT_DIR = arg('shots', '')
const PORT = Number(arg('port', 9700 + Math.floor(Math.random() * 250)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!URL_) {
  console.error('用法: node tools/e2e.mjs --url "http://127.0.0.1:3099/?token=..." [--send "你好"]')
  process.exit(1)
}

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-e2e-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage',
  '--disable-crash-reporter', '--disable-breakpad',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1400,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] })

async function main() {
  let ver = null
  for (let i = 0; i < 80 && !ver; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch (e) {}
    if (!ver) await sleep(150)
  }
  if (!ver) throw new Error('Chrome 调试端口没起来')
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  let id = 0
  const pend = new Map()
  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')
    let m; try { m = JSON.parse(raw) } catch (e) { return }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  })
  const send = (method, params, sessionId, to = 25000) =>
    new Promise((resolve, reject) => {
      const i = ++id
      const t = setTimeout(() => { pend.delete(i); reject(new Error('CDP 超时 ' + method)) }, to)
      pend.set(i, (m) => { clearTimeout(t); m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result) })
      const msg = { id: i, method, params: params || {} }
      if (sessionId) msg.sessionId = sessionId
      ws.send(JSON.stringify(msg))
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(() => {})
  await send('Page.enable', {}, sessionId, 5000).catch(() => {})
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__logs=[];(function(){var e=console.error,w=console.warn;console.error=function(){window.__logs.push('E:'+Array.prototype.join.call(arguments,' '));return e.apply(console,arguments)};console.warn=function(){window.__logs.push('W:'+Array.prototype.join.call(arguments,' '));return w.apply(console,arguments)}})();window.addEventListener('error',function(v){window.__logs.push('X:'+(v.message||'')+' | '+((v.error&&v.error.stack)||'').split('\\n').slice(0,4).join(' <- '))});`,
  }, sessionId, 5000).catch(() => {})
  const evaluate = async (expr, timeoutMs) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, timeoutMs || 30000)
    if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text))
    return r.result && r.result.value
  }
  const shoot = async (name) => {
    if (!SHOT_DIR) return
    try {
      const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId, 60000)
      fs.mkdirSync(SHOT_DIR, { recursive: true })
      fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(s.data, 'base64'))
    } catch (e) {}
  }

  console.log(`\n桌宠 × 真实 DSH 端到端验证 → ${URL_.replace(/token=.*/, 'token=***')}\n`)
  await send('Page.navigate', { url: URL_ }, sessionId, 10000).catch(() => {})

  // 1) DSH 本体起来了
  let dshReady = false
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    try { dshReady = await evaluate('!!document.querySelector("#app, #root, body > div") && !document.querySelector(".dsh-error")') } catch (e) {}
    if (dshReady) break
  }
  check('DSH Web 界面已加载', !!dshReady)

  // 2) 桌宠脚本被注入并起效
  let petReady = false
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try { petReady = await evaluate('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)') } catch (e) {}
    if (petReady) break
  }
  check('桌宠已注入 DSH 界面并加载模型', !!petReady, petReady ? '' : '35s 内没就绪')
  if (!petReady) {
    try {
      const err = await evaluate('window.__DSHPetError || null')
      if (err) console.log('  ── 启动错误 ──\n     ' + String(err).split('\n').slice(0, 6).join('\n     '))
      const l = (await evaluate('(window.__logs||[]).slice(0,10)')) || []
      for (const x of l.slice(0, 8)) console.log('     ' + String(x).slice(0, 200))
    } catch (e) {}
    ws.close()
    return
  }

  const st = await evaluate('JSON.parse(JSON.stringify(window.DSHPet.state))')
  check('模型尺寸/取景可用', !!st.view && st.view.w > 100, st.view ? `${st.view.w}×${st.view.h} (${st.view.mode})` : '无')
  check('样式表生效（root 是 fixed）', (await evaluate('getComputedStyle(document.getElementById("dsh-live2d-pet")).position')) === 'fixed')
  await shoot('01-dsh-with-pet')

  // 3) 桌宠的 SSE 是否连到了**真 DSH** 的事件总线
  const hostState = await evaluate('fetch("/dsh-pet/state").then(function(r){return r.json()}).then(function(j){return JSON.stringify(j)})')
  const hs = JSON.parse(hostState)
  check('桌宠已连上 DSH 宿主路由', hs.ok === true, `插件版本 ${hs.version}`)
  check('SSE 客户端已连接（clients >= 1）', hs.clients >= 1, `clients = ${hs.clients}`)
  check('能拿到会话控制器', hs.hasSessionController === true)

  // 4) 通过桌宠的输入框真的发一句话（走 UI，不走接口）
  if (SEND) {
    console.log(`\n  通过桌宠输入框发送：「${SEND}」`)
    const sendResult = await evaluate(`(async function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.classList.add('dshp-open');
      document.querySelector('.dshp-dock').children[0].click();
      await new Promise(function(s){setTimeout(s,150)});
      var ta = document.querySelector('.dshp-panel textarea');
      ta.value = ${JSON.stringify(SEND)};
      ta.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('.dshp-dock').children[0].click();
      await new Promise(function(s){setTimeout(s,150)});
      var btns = document.querySelectorAll('.dshp-panel.dshp-on .dshp-btn');
      var sendBtn = null;
      btns.forEach(function(b){ if (b.textContent === '发送') sendBtn = b; });
      if (!sendBtn) return 'NO_BUTTON';
      sendBtn.click();
      return 'CLICKED';
    })()`)
    check('桌宠输入框可以发送', sendResult === 'CLICKED', String(sendResult))

    // 5) 观察真实 agent 事件把桌宠从 listening → thinking/working → idle 推一遍
    const trace = await evaluate(`(function(){
      window.__trace = [];
      var t0 = performance.now();
      return new Promise(function(res){
        var iv = setInterval(function(){
          var s = window.DSHPet.state;
          window.__trace.push({t: Math.round(performance.now()-t0), st: s.agent.status, mood: s.mood, bubble: (document.querySelector('.dshp-body')||{}).textContent||''});
          if (performance.now() - t0 > 22000) { clearInterval(iv); res(window.__trace); }
        }, 500);
      });
    })()`, 45000)
    const seen = {}
    for (const p of trace) seen[p.st] = (seen[p.st] || 0) + 1
    const moods = Array.from(new Set(trace.map((p) => p.mood)))
    check('桌宠被真实事件驱动（进入过非 idle 状态）', Object.keys(seen).some((k) => k !== 'idle'), `状态序列: ${Object.keys(seen).join(' → ')}`)
    check('过程中换过表情', moods.length > 1, moods.join(', '))
    check('气泡显示过真实内容', trace.some((p) => p.bubble && p.bubble.length > 0), `示例: ${JSON.stringify((trace.find((p) => p.bubble) || {}).bubble || '').slice(0, 60)}`)
    await shoot('02-after-send')
  }

  const logs = (await evaluate('(window.__logs||[]).slice(0,20)')) || []
  const errors = logs.filter((l) => l.indexOf('E:') === 0 || l.indexOf('X:') === 0)
  check('运行期没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | ') || '干净')
  ws.close()
}

main()
  .catch((e) => { console.error('\nE2E 失败:', e.message); process.exitCode = 1 })
  .finally(async () => {
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
    try { chrome.kill('SIGKILL') } catch (e) {}
    await sleep(200)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
    process.exit(fail > 0 ? 1 : 0)
  })
