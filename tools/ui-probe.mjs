#!/usr/bin/env node
/**
 * ui-probe.mjs —— 用「真鼠标事件」（CDP Input，不是页面里造的假事件）去试
 * 设置面板里的滑块到底能不能拖，顺便量一下底下三个按钮有多大。
 *
 *   node tools/ui-probe.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = (() => { const i = process.argv.indexOf('--url'); return i === -1 ? 'http://127.0.0.1:5199/' : process.argv[i + 1] })()
const PORT = 9700 + Math.floor(Math.random() * 200)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-uiprobe-'))
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
  let ready = false
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try { ready = await evaluate('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)') } catch (e) {}
    if (ready) break
  }
  if (!ready) { console.error('桌宠没就绪'); return }

  // 抓「谁把面板关掉了」：给 classList.remove 打补丁，记下调用栈
  await evaluate(`(function(){
    window.__rmLog = [];
    var orig = DOMTokenList.prototype.remove;
    DOMTokenList.prototype.remove = function () {
      for (var i = 0; i < arguments.length; i++) {
        var c = arguments[i];
        if (c === 'dshp-open' || c === 'dshp-on') {
          window.__rmLog.push(c + ' @ ' + String(new Error().stack).split('\\n').slice(1, 5).join(' <- '));
        }
      }
      return orig.apply(this, arguments);
    };
    return 1;
  })()`)

  // 打开设置页
  const opened = await evaluate(`(function(){
    var r = document.getElementById('dsh-live2d-pet');
    r.classList.add('dshp-open');
    var dock = document.querySelector('.dshp-dock');
    dock.children[1].click();
    var panel = document.querySelector('.dshp-panel.dshp-on');
    if (!panel) return JSON.stringify({err:'菜单没开'});
    var tabs = panel.querySelectorAll('.dshp-tab-btn');
    for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '设置') tabs[i].click();
    panel = document.querySelector('.dshp-panel.dshp-on');
    var s = panel.querySelector('input[type=range]');
    if (!s) return JSON.stringify({err:'设置页没有滑块', text: panel.textContent.slice(0,120)});
    var b = s.getBoundingClientRect();
    var cs = getComputedStyle(s);
    var mid = {x: b.left + b.width/2, y: b.top + b.height/2};
    var top = document.elementFromPoint(mid.x, mid.y);
    return JSON.stringify({
      slider: {x:b.left, y:b.top, w:b.width, h:b.height, value:s.value},
      pointerEvents: cs.pointerEvents, display: cs.display, appearance: cs.appearance,
      topEl: top ? (top.tagName + '.' + top.className) : null,
      topIsSlider: top === s,
      parentPointerEvents: getComputedStyle(s.parentElement).pointerEvents,
    });
  })()`)
  console.log('设置页: ' + opened)
  const info = JSON.parse(opened)
  if (info.err) { ws.close(); return }
  const sl = info.slider

  // 真鼠标拖拽
  const y = sl.y + sl.h / 2
  const vw = await evaluate('window.innerWidth')
  const usableRight = Math.min(sl.x + sl.w, vw - 6)
  const usableLeft = Math.max(sl.x, 6)
  const x0 = usableRight - 12
  const x1 = usableLeft + 12
  console.log(`滑块可见范围 ${Math.round(usableLeft)}→${Math.round(usableRight)}（视口 ${vw}；滑块右缘 ${Math.round(sl.x + sl.w)}）`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y, button: 'none', buttons: 0, pointerType: 'mouse' }, sessionId)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' }, sessionId)
  const diag = `(function(){
    var root = document.getElementById('dsh-live2d-pet');
    var panels = document.querySelectorAll('.dshp-panel');
    var on = document.querySelectorAll('.dshp-panel.dshp-on');
    return JSON.stringify({
      rootClass: root.className,
      panels: panels.length,
      onPanels: on.length,
      ranges: document.querySelectorAll('.dshp-panel input[type=range]').length,
      onRanges: document.querySelectorAll('.dshp-panel.dshp-on input[type=range]').length,
      menuEl: !!document.querySelector('.dshp-menu'),
      activeEl: document.activeElement ? document.activeElement.tagName : null,
    });
  })()`
  console.log('按下前: ' + (await evaluate(diag)))
  const before = await evaluate(`(document.querySelector('.dshp-panel.dshp-on input[type=range]')||{}).value`)
  console.log('按下后: ' + (await evaluate(diag)))
  console.log('关面板调用栈: ' + (await evaluate('JSON.stringify(window.__rmLog||[])')))
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'mouse' }, sessionId)
    await sleep(35)
  }
  const during = await evaluate(`document.querySelector('.dshp-panel.dshp-on input[type=range]').value`)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' }, sessionId)
  await sleep(120)
  const after = await evaluate(`document.querySelector('.dshp-panel.dshp-on input[type=range]').value`)
  const height = await evaluate(`window.DSHPet.state.view && window.DSHPet.state.view.h`)
  console.log(`拖拽: 按下时 ${before} → 拖动中 ${during} → 松手 ${after}（模型高度 ${height}）`)
  console.log(during !== before ? '  ✅ 滑块可以拖拽' : '  ❌ 滑块拖不动（只能点一下设置一个值）')

  // 量一下底部三个按钮
  const sizes = await evaluate(`(function(){
    var dock = document.querySelector('.dshp-dock');
    var out = [];
    for (var i = 0; i < dock.children.length; i++) {
      var b = dock.children[i].getBoundingClientRect();
      out.push({text: dock.children[i].textContent, w: Math.round(b.width), h: Math.round(b.height)});
    }
    var stage = document.querySelector('.dshp-stage').getBoundingClientRect();
    var panel = document.querySelector('.dshp-panel.dshp-on').getBoundingClientRect();
    var r = document.getElementById('dsh-live2d-pet').getBoundingClientRect();
    var cs = getComputedStyle(document.getElementById('dsh-live2d-pet'));
    return JSON.stringify({buttons: out, stage: {w: Math.round(stage.width), h: Math.round(stage.height)},
      root: {w: Math.round(r.width), h: Math.round(r.height)},
      panel: {w: Math.round(panel.width), h: Math.round(panel.height)},
      scale: cs.getPropertyValue('--dshp-s').trim(),
      fontSize: cs.fontSize});
  })()`)
  console.log('尺寸: ' + sizes)
  const sz = JSON.parse(sizes)
  const rel = sz.buttons.map((b) => `${b.text} ${b.w}×${b.h}（占模型高 ${((b.h / sz.stage.h) * 100).toFixed(0)}%）`)
  console.log('  按钮: ' + rel.join(' | '))
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
