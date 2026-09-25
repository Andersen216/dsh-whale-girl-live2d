#!/usr/bin/env node
/**
 * catalog-test.mjs —— 把每一个表情 / 道具 / 场景 / 动作都点一遍，客观测出
 * 哪些「点了没反应」。
 *
 * 做法：先记录一张基准画面（只留常态的笔和本子），然后逐个施加，
 * 抓降采样像素做逐点差异，算出「变化像素占比」。占比接近 0 的就是坏按钮。
 *
 * 顺带测几件 UI 的事：大小滑块能不能拖、底下三个按钮有多大。
 *
 *   node tools/catalog-test.mjs                     # 需要先起 preview-server
 *   node tools/catalog-test.mjs --url http://127.0.0.1:5199/
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
const URL_ = arg('url', 'http://127.0.0.1:5199/')
const PORT = Number(arg('port', 9500 + Math.floor(Math.random() * 250)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-catalog-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage',
  '--disable-crash-reporter', '--disable-breakpad',
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
  await send('Page.enable', {}, sessionId, 5000).catch(() => {})
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

  const catalog = await evaluate('JSON.stringify(window.DSHPet.catalog())')
  const cat = JSON.parse(catalog)
  console.log(`\n逐个试一遍：表情 ${cat.expressions.length} · 道具 ${cat.props.length} · 场景 ${cat.scenes.length} · 动作 ${cat.motions.length}\n`)

  // 基准：清空一切，只留常态
  const baseline = async () => {
    await evaluate(`(function(){ window.DSHPet.resetEverything(); window.DSHPet.clearReaction(); return 1 })()`)
    await sleep(900)
    return await evaluate('JSON.stringify(window.DSHPet.sampleCanvas(40))').then(JSON.parse)
  }

  const diff = (a, b) => {
    if (!a || !b || a.length !== b.length) return -1
    let n = 0
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]) > 24) n++
    }
    return n / (a.length / 4)
  }

  const base = await baseline()
  const dead = []
  const weak = []

  const testOne = async (kind, key, applyExpr) => {
    await evaluate(`(function(){ window.DSHPet.resetEverything(); window.DSHPet.clearReaction(); return 1 })()`)
    await sleep(350)
    await evaluate(applyExpr)
    await sleep(kind === 'motion' ? 1100 : 900)
    const s = JSON.parse(await evaluate('JSON.stringify(window.DSHPet.sampleCanvas(40))'))
    const d = diff(base, s)
    const desc = await evaluate(`JSON.stringify(window.DSHPet.describe(${JSON.stringify(key)}))`)
    let info = ''
    if (kind === 'expr' && desc && desc !== 'null') {
      const dd = JSON.parse(desc)
      const missing = dd.params.filter((p) => !p.exists).map((p) => p.id)
      if (missing.length) info = `缺失参数 ${missing.join(',')}`
    }
    if (d < 0.005) dead.push({ kind, key, d, info })
    else if (d < 0.02) weak.push({ kind, key, d, info })
    return d
  }

  console.log('— 表情 —')
  for (const name of cat.expressions) {
    const d = await testOne('expr', name, `(function(){ window.DSHPet.setUserFace(${JSON.stringify(name)}); return 1 })()`)
    const flag = d < 0.005 ? '❌ 没反应' : d < 0.02 ? '⚠️ 很弱' : '✅'
    console.log(`  ${flag}  ${name.padEnd(16)} 变化 ${(d * 100).toFixed(1)}%`)
  }

  console.log('\n— 道具 —')
  for (const key of cat.props) {
    const d = await testOne('prop', key, `(function(){ window.DSHPet.setProp(${JSON.stringify(key)}, true); return 1 })()`)
    const flag = d < 0.005 ? '❌ 没反应' : d < 0.02 ? '⚠️ 很弱' : '✅'
    console.log(`  ${flag}  ${key.padEnd(16)} 变化 ${(d * 100).toFixed(1)}%`)
  }

  console.log('\n— 场景 —')
  for (const key of cat.scenes) {
    const d = await testOne('scene', key, `(function(){ window.DSHPet.setProp(${JSON.stringify(key)}, true); return 1 })()`)
    const flag = d < 0.005 ? '❌ 没反应' : d < 0.02 ? '⚠️ 很弱' : '✅'
    console.log(`  ${flag}  ${key.padEnd(16)} 变化 ${(d * 100).toFixed(1)}%`)
  }

  console.log('\n— 动作 —')
  for (const g of cat.motions) {
    const d = await testOne('motion', g, `(function(){ window.DSHPet.playMotion(${JSON.stringify(g)}); return 1 })()`)
    const flag = d < 0.005 ? '❌ 没反应' : d < 0.02 ? '⚠️ 很弱' : '✅'
    console.log(`  ${flag}  ${g.padEnd(16)} 变化 ${(d * 100).toFixed(1)}%`)
  }

  // ——— UI 检查 ———
  console.log('\n— UI —')
  await evaluate('window.DSHPet.resetEverything()')
  const uiInfo = await evaluate(`(function(){
    var r = document.getElementById('dsh-live2d-pet');
    r.classList.add('dshp-open');
    document.querySelector('.dshp-dock').children[1].click();
    var panel = document.querySelector('.dshp-panel.dshp-on');
    if (!panel) return JSON.stringify({err: '菜单没打开'});
    // 切到设置页
    var tabs = panel.querySelectorAll('.dshp-tab-btn');
    for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '设置') tabs[i].click();
    var slider = panel.querySelector('input[type=range]');
    var dock = document.querySelector('.dshp-dock').getBoundingClientRect();
    var stage = document.querySelector('.dshp-stage').getBoundingClientRect();
    return JSON.stringify({
      hasSlider: !!slider,
      sliderRect: slider ? {w: Math.round(slider.getBoundingClientRect().width), h: Math.round(slider.getBoundingClientRect().height)} : null,
      sliderValue: slider ? slider.value : null,
      dockW: Math.round(dock.width), dockH: Math.round(dock.height),
      stageW: Math.round(stage.width), stageH: Math.round(stage.height),
      btnH: Math.round(document.querySelector('.dshp-btn').getBoundingClientRect().height),
      panelW: Math.round(panel.getBoundingClientRect().width),
    });
  })()`)
  console.log('  ' + uiInfo)

  // 滑块能不能拖，**不能用页面里造的假事件测**：range 的原生拖拽要真实
  // 指针事件才会走（假的 PointerEvent 只会让 value 一动不动，看着像坏了）。
  // 真鼠标的拖拽验证在 tools/ui-probe.mjs（走 CDP Input.dispatchMouseEvent）。
  console.log('  滑块拖拽: 见 tools/ui-probe.mjs（用真鼠标事件测，假事件测不出来）')

  console.log(`\n=== 汇总 ===`)
  console.log(`  完全没反应: ${dead.length} 个`)
  for (const x of dead) console.log(`     ❌ [${x.kind}] ${x.key} ${x.info}`)
  console.log(`  变化很弱(可能也算没反应): ${weak.length} 个`)
  for (const x of weak) console.log(`     ⚠️  [${x.kind}] ${x.key} ${(x.d * 100).toFixed(1)}% ${x.info}`)
  console.log('')
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
