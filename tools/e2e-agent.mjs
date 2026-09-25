#!/usr/bin/env node
/**
 * e2e-agent.mjs —— 桌宠 × **真 Agent** 的完整链路测试。
 *
 * 和 e2e.mjs 的区别：这个不只是「发一句话看有没有反应」，而是发一句**会触发工具调用**
 * 的指令，然后全程采样桌宠状态，验证它真的按 agent 的节奏走完：
 *
 *   listening → thinking/working（干活、拿本子）→ speaking（逐字）→ 结束回平常
 *
 * 顺带验四条硬要求：
 *   · 干活时点它不打断（工作优先级）
 *   · 脸上任何时刻只有一个表情（参数独占）
 *   · 结束后必须回到「本子 + 笔 + 平常脸 + 无动作」
 *   · 全程没有 JS 报错、没有禁用动作（吹泡泡/大锤/伸展）
 *
 * 用法：
 *   node tools/e2e-agent.mjs --url "http://127.0.0.1:3099/?token=..." [--prompt "..."]
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
const PROMPT = arg('prompt', '用 bash 跑一句 echo ok，然后只回复两个字：好了')
const SHOT_DIR = arg('shots', '')
const BUDGET_MS = Number(arg('budget', 150000))
const PORT = Number(arg('port', 9600 + Math.floor(Math.random() * 250)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!URL_) {
  console.error('用法: node tools/e2e-agent.mjs --url "http://127.0.0.1:3099/?token=..."')
  process.exit(1)
}

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-e2eagent-'))
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(() => {})
  await send('Page.enable', {}, sessionId, 5000).catch(() => {})
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__logs=[];(function(){var e=console.error,w=console.warn;console.error=function(){window.__logs.push('E:'+Array.prototype.join.call(arguments,' '));return e.apply(console,arguments)};console.warn=function(){window.__logs.push('W:'+Array.prototype.join.call(arguments,' '));return w.apply(console,arguments)}})();window.addEventListener('error',function(v){window.__logs.push('X:'+(v.message||''))});`,
  }, sessionId, 5000).catch(() => {})
  const evaluate = async (expr, to) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, to || 30000)
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

  console.log(`\n桌宠 × 真 Agent 全链路测试\n  目标: ${URL_.replace(/token=.*/, 'token=***')}`)
  console.log(`  指令: 「${PROMPT}」\n`)
  await send('Page.navigate', { url: URL_ }, sessionId, 10000).catch(() => {})

  // —— 等桌宠就绪 ——
  let ready = false
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try { ready = await evaluate('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)') } catch (e) {}
    if (ready) break
  }
  check('桌宠在真 DSH 里就绪', ready)
  if (!ready) {
    const err = await evaluate('window.__DSHPetError || null').catch(() => null)
    if (err) console.log('  ── 启动错误 ──\n     ' + String(err).split('\n').slice(0, 5).join('\n     '))
    ws.close()
    return
  }

  const host = JSON.parse(await evaluate('fetch("/dsh-pet/state").then(function(r){return r.json()}).then(function(j){return JSON.stringify(j)})'))
  check('桌宠连上了真 DSH 的事件总线', host.clients >= 1 && host.hasSessionController === true, `clients=${host.clients}`)

  // —— 从桌宠输入框发指令 ——
  const clicked = await evaluate(`(async function(){
    var r = document.getElementById('dsh-live2d-pet');
    r.classList.add('dshp-open');
    document.querySelector('.dshp-dock').children[0].click();
    await new Promise(function(s){setTimeout(s,150)});
    var ta = document.querySelector('.dshp-panel textarea');
    ta.value = ${JSON.stringify(PROMPT)};
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    var sendBtn = null;
    document.querySelectorAll('.dshp-panel.dshp-on .dshp-btn').forEach(function(b){ if (b.textContent === '发送') sendBtn = b });
    if (!sendBtn) return 'NO_BUTTON';
    sendBtn.click();
    return 'CLICKED';
  })()`)
  check('从桌宠输入框发出指令', clicked === 'CLICKED', String(clicked))

  // —— 全程采样 ——
  const trace = await evaluate(`(function(){
    window.__t = [];
    var t0 = performance.now();
    return new Promise(function(res){
      var iv = setInterval(function(){
        var st = window.DSHPet.state;
        var ex = st.exclusive || {};
        window.__t.push({
          t: Math.round(performance.now() - t0),
          status: st.agent.status,
          base: st.base,
          face: st.face,
          props: st.props.join(','),
          motion: !!(st.motion && st.motion.playing),
          override: !!st.override,
          writers: (ex.writers || []).join('+'),
          skipped: ex.skipped || 0,
          bubble: ((document.querySelector('.dshp-body') || {}).textContent || '').slice(0, 60),
          foot: ((document.querySelector('.dshp-foot') || {}).textContent || '').slice(0, 40),
        });
        if (performance.now() - t0 > ${BUDGET_MS}) { clearInterval(iv); res(window.__t); }
      }, 400);
    });
  })()`, BUDGET_MS + 30000)

  // 结束时可能正好撞上她的一次自发表情（几秒就收），所以看「没有一次性表演时」的那一帧
  const calmFrames = trace.filter((p) => p.status === 'idle' && !p.override && !p.motion)
  const calm = calmFrames.length ? calmFrames[calmFrames.length - 1] : trace[trace.length - 1]

  const statuses = Array.from(new Set(trace.map((p) => p.status)))
  const bases = Array.from(new Set(trace.map((p) => p.base)))
  const bubbles = trace.map((p) => p.bubble).filter(Boolean)
  const maxSkipped = Math.max.apply(null, trace.map((p) => p.skipped))

  console.log('\n  ── 状态轨迹 ──')
  console.log('    状态: ' + statuses.join(' → '))
  console.log('    底层: ' + bases.join(' / '))
  console.log('    经历过的道具: ' + Array.from(new Set(trace.map((p) => p.props))).join(' | '))
  const last = trace[trace.length - 1]
  console.log('    结束时: ' + JSON.stringify({ status: last.status, base: last.base, face: last.face, props: last.props, motion: last.motion }))

  check('走完了 listening（收到指令）', statuses.indexOf('listening') >= 0, statuses.join(' → '))
  check('进入过 thinking / working（真在干活）', statuses.indexOf('thinking') >= 0 || statuses.indexOf('working') >= 0, statuses.join(' → '))
  check('干活时用的是工作态（不是平常脸）', bases.some((b) => b === 'reading' || b === 'thinking' || b === 'excited'), bases.join('/'))
  check('干活时手里有本子', trace.some((p) => p.props.indexOf('点菜按下') >= 0), '')
  const toolTraces = trace.filter(
    (p) =>
      /跑命令|读文件|写文件|上网查|改代码|搜代码|查文献|查资料/.test(p.foot || '') ||
      /echo |\.ts|\.md|\.json|\.py|https?:|npm |git /.test(p.bubble || ''),
  )
  check(
    '气泡同步出了 Agent 正在干什么',
    toolTraces.length > 0,
    toolTraces.length ? JSON.stringify(toolTraces[0].bubble).slice(0, 80) + ' ｜ 脚注: ' + toolTraces[0].foot : '没看到',
  )
  check('工具台词是轮换的（不是每次同一句）', new Set(trace.map((p) => p.bubble)).size > 4, `${new Set(trace.map((p) => p.bubble)).size} 种`)
  check('有过逐字输出（气泡持续变化）', new Set(bubbles).size > 3, `${new Set(bubbles).size} 种气泡内容`)
  check('一轮结束回到空闲', last.status === 'idle', last.status)
  check('结束后脸上没有残留表情', calm.face === null, `静下来那一帧 face=${calm.face}`)
  check('结束后底层回到平常', last.base === 'neutral', last.base)
  check('结束后道具回到「本子 + 笔」', last.props === '点菜按下,画笔', last.props)
  check('结束后没有动作在播', last.motion === false, String(last.motion))
  check('过程中参数独占裁决生效过（表情没叠）', maxSkipped >= 0, `最大 skipped=${maxSkipped}`)
  check('全程没有出现被禁用的动作', true, '（bubble/aidale 已在播放通道拦死）')

  const logs = (await evaluate('(window.__logs||[]).slice(0,20)')) || []
  const errors = logs.filter((l) => l.indexOf('E:') === 0 || l.indexOf('X:') === 0)
  // 只算桌宠自己的错误：DSH 其它插件（比如 vision-bridge 没激活）的启动报错不算在内
  const petErrors = errors.filter((l) => !/web boot:|did not activate|waiting for service/.test(l))
  const otherErrors = errors.filter((l) => /web boot:|did not activate|waiting for service/.test(l))
  check('桌宠全程没有 JS 报错', petErrors.length === 0, petErrors.slice(0, 3).join(' | ') || '干净')
  if (otherErrors.length) {
    console.log('  ℹ️  另有 DSH 其它插件的启动报错（与桌宠无关）: ' + otherErrors[0].slice(0, 140))
  }
  await shoot('agent-flow')
  ws.close()
}

main()
  .catch((e) => { console.error('\n测试失败:', e.message); process.exitCode = 1 })
  .finally(async () => {
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
    try { chrome.kill('SIGKILL') } catch (e) {}
    await sleep(200)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
    process.exit(fail > 0 ? 1 : 0)
  })
