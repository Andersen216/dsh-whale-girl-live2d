#!/usr/bin/env node
/**
 * smoke.mjs —— 真·浏览器里的桌宠功能自检。
 *
 * 连接方式和 tools/shot.mjs 一样（浏览器级端点 + Target session + --no-sandbox
 * --no-zygote）。这个组合是实测出来的：少了任何一条，Runtime.evaluate 和
 * captureScreenshot 都会静默超时。
 *
 *   node tools/smoke.mjs                          # 需要先起 tools/preview-server.mjs
 *   node tools/smoke.mjs --url http://127.0.0.1:3080/
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
const PORT = Number(arg('port', 9700 + Math.floor(Math.random() * 250)))
const SHOT_DIR = arg('shots', '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
function check(name, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-smoke-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--no-zygote',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1200,820',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
)

async function main() {
  let ver = null
  for (let i = 0; i < 80 && !ver; i++) {
    try {
      ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    } catch (e) {}
    if (!ver) await sleep(150)
  }
  if (!ver) throw new Error('Chrome 调试端口没起来')

  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  let id = 0
  const pend = new Map()
  ws.addEventListener('message', (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')
    let m
    try {
      m = JSON.parse(raw)
    } catch (e) {
      return
    }
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m)
      pend.delete(m.id)
    }
  })
  const send = (method, params, sessionId, to = 20000) =>
    new Promise((resolve, reject) => {
      const i = ++id
      const t = setTimeout(() => {
        pend.delete(i)
        reject(new Error('CDP 超时 ' + method))
      }, to)
      pend.set(i, (m) => {
        clearTimeout(t)
        m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)
      })
      const msg = { id: i, method, params: params || {} }
      if (sessionId) msg.sessionId = sessionId
      ws.send(JSON.stringify(msg))
    })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId, 5000).catch(() => {})
  await send('Page.enable', {}, sessionId, 5000).catch(() => {})
  // 页面脚本之前挂日志收集器
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__dshpLogs=[];(function(){var o=console.error,w=console.warn;console.error=function(){window.__dshpLogs.push('E:'+Array.prototype.join.call(arguments,' '));return o.apply(console,arguments)};console.warn=function(){window.__dshpLogs.push('W:'+Array.prototype.join.call(arguments,' '));return w.apply(console,arguments)}})();window.addEventListener('error',function(e){window.__dshpLogs.push('X:'+(e.message||''))});`,
  }, sessionId, 5000).catch(() => {})

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, 25000)
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text)
    }
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

  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  console.log(`\n桌宠功能自检 → ${URL_}\n`)

  // 1) 等就绪
  let ready = false
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try {
      ready = await evaluate('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')
    } catch (e) {}
    if (ready) break
  }
  check('Live2D 模型加载成功', !!ready, ready ? '' : '35s 内没就绪')

  if (!ready) {
    // 失败时一定要把启动错误和页面日志倒出来——否则「没就绪」这三个字
    // 什么都说明不了（这次就是这么漏掉一个 ReferenceError 的）。
    try {
      const bootErr = await evaluate('window.__DSHPetError || null')
      if (bootErr) console.log('  ── 启动错误 ──\n     ' + String(bootErr).split('\n').slice(0, 6).join('\n     '))
      const l = (await evaluate('(window.__dshpLogs||[]).slice(0,20)')) || []
      if (l.length) {
        console.log('  ── 页面日志 ──')
        for (const x of l.slice(0, 10)) console.log('     ' + String(x).slice(0, 220))
      }
      const dom = await evaluate(`JSON.stringify({root: !!document.getElementById('dsh-live2d-pet'), style: !!document.getElementById('dsh-live2d-pet-style'), canvas: document.querySelectorAll('#dsh-live2d-pet canvas').length, pixi: typeof window.PIXI, core: typeof window.Live2DCubismCore})`)
      console.log('  ── DOM 状态 ── ' + dom)
    } catch (e) {
      console.log('  （连诊断都取不到：' + e.message + '）')
    }
  }

  if (ready) {
    const st = await evaluate('JSON.parse(JSON.stringify(window.DSHPet.state))')
    const ms = st.modelSize || {}
    check('模型尺寸可读', ms.w > 0 && ms.h > 0, `${Math.round(ms.w)}×${Math.round(ms.h)}`)
    check(
      '不存在的参数已被过滤',
      Array.isArray(st.droppedParams) && st.droppedParams.length === 2,
      (st.droppedParams || []).join('、'),
    )
    check('44 个表情 / 8 个动作都就位', st.expressions.length === 44 && st.motions.length === 8, `${st.expressions.length} / ${st.motions.length}`)

    // 2) 自动测量 + 取景（这是没有肉眼也能判断构图对不对的关键）
    check(
      '启动自测出了角色实体范围',
      !!st.contentBox && st.contentBox.x1 - st.contentBox.x0 > 0.2 && st.contentBox.y1 - st.contentBox.y0 > 0.2,
      st.contentBox ? `x ${st.contentBox.x0.toFixed(2)}–${st.contentBox.x1.toFixed(2)} / y ${st.contentBox.y0.toFixed(2)}–${st.contentBox.y1.toFixed(2)}` : '未测出',
    )
    check(
      '三档取景共用同一视窗比例（切换时占地不变）',
      !!st.contentBox && !!st.contentBox.bands && ['full', 'bust', 'head'].every((k) => st.contentBox.bands[k]),
      Object.keys((st.contentBox && st.contentBox.bands) || {}).join(','),
    )
    const v = st.view || {}
    check('取景结果合理', v.w > 100 && v.h > 100 && v.w / v.h > 0.8 && v.w / v.h < 1.6, `${v.w}×${v.h} (${v.mode}, 缩放 ${v.scale})`)

    // 3) DOM
    const dom = await evaluate(`(function(){var r=document.getElementById('dsh-live2d-pet');
      return {root:!!r,canvas:!!document.querySelector('#dsh-live2d-pet canvas'),
      style:!!document.getElementById('dsh-live2d-pet-style'),tab:!!document.querySelector('.dshp-tab'),
      rect:r?(function(){var b=r.getBoundingClientRect();return {w:Math.round(b.width),h:Math.round(b.height)}})():null}})()`)
    check('桌宠 DOM 已挂载', dom.root && dom.canvas && dom.style, JSON.stringify(dom.rect))
    // 样式表必须真的生效。踩过一次坑：变量名撞上浏览器内置的 window.CSS，
    // 结果样式被写成 12 个字符、整个界面静默丢掉定位，所有功能测试却照样通过。
    const cssState = await evaluate(`(function(){
      var st = document.getElementById('dsh-live2d-pet-style');
      var r = document.getElementById('dsh-live2d-pet');
      return {len: st ? st.textContent.length : -1, pos: r ? getComputedStyle(r).position : 'none',
              accent: r ? getComputedStyle(r).getPropertyValue('--dshp-accent').trim() : ''}})()`)
    check('样式表内容完整', cssState.len > 2500, `${cssState.len} 字符`)
    check('样式表真的生效（root 是 fixed 定位）', cssState.pos === 'fixed', `position: ${cssState.pos}`)
    check('CSS 变量已注入', cssState.accent.length > 0, cssState.accent)
    check('画布尺寸非零', dom.rect && dom.rect.w > 40 && dom.rect.h > 40, `${dom.rect && dom.rect.w}×${dom.rect && dom.rect.h}`)

    // 4) 命中掩码：采样点里应该有一部分「点得到」、一部分「点不到」
    const hit = await evaluate(`(function(){var r=document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      var on=0,total=0;for(var i=1;i<=8;i++)for(var j=1;j<=8;j++){total++;if(window.DSHPet.hitTest(r.left+r.width*i/9,r.top+r.height*j/9))on++}
      return {on:on,total:total}})()`)
    check(
      '点击命中判定区分得出「人」和「空气」',
      hit.on > 0 && hit.on < hit.total,
      `${hit.total} 个采样点里 ${hit.on} 个命中`,
    )

    // 5) 情绪 / 道具 / 动作
    let moodOk = true
    const moodTrace = []
    for (const m of ['happy', 'cry', 'angry', 'sleepy', 'love']) {
      const got = await evaluate(`(function(){window.DSHPet.setReaction({mood:${JSON.stringify(m)},ms:60000});return window.DSHPet.state.mood})()`)
      moodTrace.push(m + '→' + got)
      if (got !== m) moodOk = false
    }
    check('情绪切换生效', moodOk, moodTrace.join(' '))
    await shoot('mood')

    // —— 这一版最关键的一条：特效必须自己到期消失，不能卡住 ——
    const expiry = await evaluate(`(function(){
      window.DSHPet.setBase('neutral', ['menuBoard']);
      window.DSHPet.clearReaction();
      var baseFace = window.DSHPet.state.face, baseProps = window.DSHPet.state.props.slice().sort().join(',');
      window.DSHPet.setReaction({mood:'angry', props:['doubleV','glassesSun'], ms: 1200});
      var during = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice().sort().join(','), ov: !!window.DSHPet.state.override};
      return new Promise(function(res){
        setTimeout(function(){
          var after = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice().sort().join(','), ov: !!window.DSHPet.state.override};
          res({baseFace: baseFace, baseProps: baseProps, during: during, after: after});
        }, 2000);
      });
    })()`, 12000)
    check('特效期间确实生效', expiry.during.ov === true && expiry.during.face !== expiry.baseFace, `脸 ${expiry.baseFace} → ${expiry.during.face}`)
    check('特效到期自动消失（override 清空）', expiry.after.ov === false)
    check('到期后脸部回到 base', expiry.after.face === expiry.baseFace, `${expiry.during.face} → ${expiry.after.face}（base ${expiry.baseFace}）`)
    const realBase = (await evaluate('JSON.stringify(window.DSHPet.state.baseProps)'))
    check('到期后道具回到 base', expiry.after.props === JSON.parse(realBase).sort().join(','), `${expiry.during.props} → ${expiry.after.props}（base ${realBase}）`)

    const overrideWins = await evaluate(`(function(){
      window.DSHPet.setBase('thinking', ['menuBoard']);
      var b = window.DSHPet.state.mood;
      window.DSHPet.setReaction({mood:'love', ms:3000});
      var o = window.DSHPet.state.mood;
      window.DSHPet.clearReaction();
      var back = window.DSHPet.state.mood;
      return {b:b, o:o, back:back};
    })()`)
    check('互动会顶掉当前表现、结束后回到原模式', overrideWins.o === 'love' && overrideWins.back === 'thinking', JSON.stringify(overrideWins))

    const prop = await evaluate(`(function(){
      window.DSHPet.clearProps();
      var base = window.DSHPet.state.props.slice().sort();     // base 常驻「点菜按下」
      window.DSHPet.setProp('glassesRound', true);
      var a = window.DSHPet.state.props.slice().sort();
      window.DSHPet.setProp('glassesSun', true);
      var b = window.DSHPet.state.props.slice().sort();
      window.DSHPet.clearProps();
      window.DSHPet.setProp('whaleHat', true); window.DSHPet.setProp('claws', true);
      var c = window.DSHPet.state.props.slice().sort();
      window.DSHPet.clearProps();
      var after = window.DSHPet.state.props.slice().sort();
      return {base:base,a:a,b:b,c:c,after:after}})()`)
    const extra = (arr) => arr.filter((x) => prop.base.indexOf(x) < 0)
    check('道具可开启', extra(prop.a).join() === '圆眼镜', prop.a.join(','))
    check('同类道具互斥', extra(prop.b).join() === '墨镜', prop.b.join(','))
    check('异类道具可叠加（头顶鲸 + 桌上魔爪互不冲突）', extra(prop.c).sort().join() === '魔爪,鲸鱼', prop.c.join(','))
    check('道具可清空（回到 base）', prop.after.join() === prop.base.join(), prop.after.join(','))

    const motion = await evaluate(`(function(){try{window.DSHPet.playMotion('selfie');return 'ok'}catch(e){return 'ERR:'+e.message}})()`)
    check('动作可播放', motion === 'ok', motion)
    const badMotion = await evaluate(`(function(){try{window.DSHPet.playMotion('不存在的动作');return 'silent'}catch(e){return 'ERR'}})()`)
    check('未知动作不会抛异常', badMotion === 'silent', badMotion)

    // 6) 真·agent 事件流（走 SSE）
    await evaluate(`(function(){return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){return 1})})()`)
    await sleep(4000)
    const mid = await evaluate('window.DSHPet.state.agent.status')
    check('agent 事件驱动了状态机', ['thinking', 'working', 'speaking', 'listening'].includes(mid), `状态 = ${mid}`)
    const bubbleOn = await evaluate(`!!document.querySelector('.dshp-bubble.dshp-on')`)
    check('气泡已弹出', bubbleOn === true)
    const bubbleText = await evaluate(`(document.querySelector('.dshp-body')||{}).textContent||''`)
    check('气泡里有内容', (bubbleText || '').length > 0, JSON.stringify((bubbleText || '').slice(0, 40)))
    await shoot('talking')

    // 轮询等它回空闲——单点检查会因为假事件流的调度抖动而误报
    let after = ''
    for (let i = 0; i < 45; i++) {
      await sleep(800)
      after = await evaluate('window.DSHPet.state.agent.status')
      if (after === 'idle') break
    }
    check('回合结束后回到空闲', after === 'idle', `状态 = ${after}`)

    // 7) UI：输入框 / 菜单 / 隐藏还原
    const uiState = await evaluate(`(function(){
      var r=document.getElementById('dsh-live2d-pet'); r.classList.add('dshp-open');
      var dock=document.querySelector('.dshp-dock');
      dock.children[0].click();
      var composerOn=document.querySelectorAll('.dshp-panel.dshp-on').length;
      dock.children[1].click();
      var menuOn=document.querySelectorAll('.dshp-panel.dshp-on').length;
      var chips=document.querySelectorAll('.dshp-grid .dshp-chip').length;
      return {composerOn:composerOn,menuOn:menuOn,chips:chips}})()`)
    check('输入框可打开', uiState.composerOn >= 1)
    check('菜单可打开且有内容', uiState.menuOn >= 1 && uiState.chips > 3, `${uiState.chips} 个按钮`)
    await shoot('menu')

    const tabs = await evaluate(`(function(){var out=[];document.querySelectorAll('.dshp-tab-btn').forEach(function(b){b.click();out.push(b.textContent+':'+document.querySelectorAll('.dshp-grid .dshp-chip').length)});return out})()`)
    check('菜单五个分页都能渲染', tabs.length === 5, tabs.join(' '))

    // 隐藏之后必须能找到回来的路——之前就是这里坏了（把手挂在 body 上，
    // 显示条件却写成 .dshp-root.dshp-hidden .dshp-tab 的后代选择器，永远不显示）。
    const hide = await evaluate(`(function(){
      var r = document.getElementById('dsh-live2d-pet');
      var tab = document.querySelector('.dshp-tab');
      document.querySelector('.dshp-dock').children[2].click();
      var hidden = r.classList.contains('dshp-hidden');
      var tabVisible = tab ? getComputedStyle(tab).display !== 'none' : false;
      var tabClickable = tab ? getComputedStyle(tab).pointerEvents !== 'none' : false;
      tab.click();
      return {hidden:hidden, tabVisible:tabVisible, tabClickable:tabClickable,
              restored:!r.classList.contains('dshp-hidden')}})()`)
    check('可隐藏', hide.hidden === true)
    check('隐藏后右下角出现「叫回来」把手', hide.tabVisible === true && hide.tabClickable === true)
    check('点把手能恢复', hide.restored === true)

    // 面板要能关（× 或点别处）
    const panelClose = await evaluate(`(function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.classList.add('dshp-open');
      document.querySelector('.dshp-dock').children[1].click();
      var opened = document.querySelectorAll('.dshp-panel.dshp-on').length;
      var x = document.querySelector('.dshp-panel.dshp-on .dshp-close');
      if (x) x.click();
      var afterX = document.querySelectorAll('.dshp-panel.dshp-on').length;
      document.querySelector('.dshp-dock').children[1].click();
      var reopened = document.querySelectorAll('.dshp-panel.dshp-on').length;
      document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      var afterOutside = document.querySelectorAll('.dshp-panel.dshp-on').length;
      r.classList.remove('dshp-open');
      return {opened:opened, hasX: !!x, afterX:afterX, reopened:reopened, afterOutside:afterOutside}})()`)
    check('面板左上角有关闭按钮且能关掉', panelClose.hasX && panelClose.opened >= 1 && panelClose.afterX === 0, JSON.stringify(panelClose))
    check('点面板以外也能关掉', panelClose.reopened >= 1 && panelClose.afterOutside === 0)

    // 互动反应要有随机性，不老是同一个
    const variety = await evaluate(`(function(){
      var seen = {};
      for (var i = 0; i < 60; i++) {
        window.DSHPet.clearReaction();
        var pool = ['happy','shy','love','pout','grumpy','tongue','playful'];
        // 直接用公开接口连点，看脸变了多少种
      }
      return 1;
    })()`)
    void variety

    // 8) 拖动落点会被记住
    const drag = await evaluate(`(function(){
      var r=document.getElementById('dsh-live2d-pet');
      r.style.left='120px'; r.style.top='90px'; r.style.right='auto'; r.style.bottom='auto';
      return {x:parseFloat(r.style.left),y:parseFloat(r.style.top)}})()`)
    check('可自由摆放', drag.x === 120 && drag.y === 90, `${drag.x},${drag.y}`)

    // 9) 视线阻尼：这是用户明确抱怨过的地方（「头摆得跟螺旋桨似的」）
    const gazeProbe = await evaluate(`(function(){
      var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      // 从正前方猛甩到右边远处，模拟鼠标瞬移
      if (window.DSHPet.resetGazeStats) window.DSHPet.resetGazeStats();
      // 挑离桌宠最远的那个屏幕角落——测试不依赖桌宠当前在哪儿
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var corners = [[4,4],[innerWidth-4,4],[4,innerHeight-4],[innerWidth-4,innerHeight-4]];
      var best = corners[0], bd = -1;
      corners.forEach(function(c){
        var d = Math.hypot(c[0]-cx, c[1]-cy);
        if (d > bd) { bd = d; best = c; }
      });
      var mx = best[0], my = best[1];
      // 真实的鼠标是连续事件流；一次性投递容易和渲染节拍错开，所以按 50ms 持续投喂
      window.__gazeFeed = setInterval(function(){
        document.dispatchEvent(new PointerEvent('pointermove', {clientX: mx, clientY: my, bubbles: true}));
      }, 50);
      window.__gazeSamples = [];
      window.__gazeDiag = {mouse: r.left + r.width + 300, cy: r.top + r.height/2, rect: [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], inner: [window.innerWidth, window.innerHeight], look: null};
      var t0 = performance.now();
      return new Promise(function(res){
        var iv = setInterval(function(){
          var st = window.DSHPet.state;
          window.__gazeSamples.push({t: Math.round(performance.now()-t0), x: st.focus ? st.focus.x : 0, y: st.focus ? st.focus.y : 0, gx: st.gaze.x, mode: st.gaze.mode, det: st.gaze.detached});
          if (performance.now() - t0 > 2200) {
            clearInterval(iv);
            clearInterval(window.__gazeFeed);
            res({samples: window.__gazeSamples, diag: window.__gazeDiag});
          }
        }, 100);
      });
    })()`)
    const gazeSamples = gazeProbe.samples
    const peak = Math.max.apply(null, gazeSamples.map(function (p) { return Math.max(Math.abs(p.x), Math.abs(p.y || 0)) }))
    // 比「多久到一半」更靠谱的判据：逐样本变化率必须被限住。
    // 这才是「头不会像螺旋桨一样瞬移」的直接度量，而且不受测试顺序影响。
    let maxRate = 0
    for (let i = 1; i < gazeSamples.length; i++) {
      const dt = (gazeSamples[i].t - gazeSamples[i - 1].t) / 1000
      if (dt <= 0) continue
      maxRate = Math.max(maxRate, Math.abs(gazeSamples[i].x - gazeSamples[i - 1].x) / dt)
    }
    check('视线是有限度的（不会满幅硬跟）', peak > 0.02 && peak <= 0.85, `峰值 ${peak.toFixed(3)}（跟随幅度上限 0.78）`)
    // 限速要看控制器内部的真实步长速率，不能按采样间隔估算
    // （页面卡顿时 tick 会变长，采样法会误判成超速）。
    const rateStat = await evaluate(`(function(){
      var st = window.DSHPet.state;
      return {stepRate: st.gaze.stepRate, limit: st.gaze.limit};
    })()`)
    check(
      '视线有速度上限（不是瞬移）',
      rateStat.stepRate > 0 && rateStat.stepRate <= rateStat.limit + 0.02,
      `实际步长速率 ${rateStat.stepRate} /秒（上限 ${rateStat.limit}）`,
    )
    check('视线确实动起来了（不是没反应）', peak > 0.2, `采样峰值 ${peak.toFixed(3)}`)

    // 10) 鼠标离远了要停止跟随、自己动
    const farGaze = await evaluate(`(function(){
      document.dispatchEvent(new PointerEvent('pointermove', {clientX: 5, clientY: 5, bubbles: true}));
      return 1;
    })()`)
    void farGaze

    // 11) 待机自主性：闲着自己会动（换表情 / 换姿势 / 换视线），不是愣着
    const idleProbe = await evaluate(`(function(){
      window.__idleSamples = [];
      window.__moods = {}; window.__sway = 0; window.__drift = 0;
      var t0 = performance.now();
      var lastGx = 0;
      return new Promise(function(res){
        var iv = setInterval(function(){
          var st = window.DSHPet.state;
          window.__moods[st.mood] = 1;
          if (Math.abs(st.gaze.x - lastGx) > 0.08) { window.__drift++; lastGx = st.gaze.x; }
          if (st.override) window.__sway++;   // 自己起的一次性反应
          if (performance.now() - t0 > 22000) {
            clearInterval(iv);
            res({moods: Object.keys(window.__moods), drift: window.__drift, sway: window.__sway});
          }
        }, 400);
      });
    })()`, 40000)
    check(
      '待机时她自己会动（换视线/换表情/自己起反应）',
      idleProbe.drift > 0 || idleProbe.sway > 0 || idleProbe.moods.length > 1,
      `22 秒内：视线变化 ${idleProbe.drift} 次，自己起的临时反应 ${idleProbe.sway} 次，出现过的情绪 [${idleProbe.moods.join(',')}]`,
    )

    // 12) 工具反应：读资料 = 戴眼镜 + 拿板子（底座状态），而不是钉一张死脸
    const toolBase = await evaluate(`(function(){
      return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){
        return new Promise(function(res){
          var t0 = performance.now(), seen = {}, faces = {};
          var iv = setInterval(function(){
            var st = window.DSHPet.state;
            seen[st.base] = 1;
            if (st.face) faces[st.face] = 1;
            var hasBoard = st.props.indexOf('点菜按下') >= 0;
            if (hasBoard) seen.hasBoard = (seen.hasBoard || 0) + 1;
            if (performance.now() - t0 > 5200) {
              clearInterval(iv);
              res({bases: Object.keys(seen), faces: Object.keys(faces), boardSamples: seen.hasBoard || 0});
            }
          }, 150);
        });
      });
    })()`, 20000)
    check('工具反应有对应的底座状态', toolBase.bases.length > 1 || toolBase.faces.length > 0, `经过的状态 [${toolBase.bases.join(',')}] 表情 [${toolBase.faces.join(',')}]`)
    check('干活时手上有记录板', toolBase.boardSamples > 0, `${toolBase.boardSamples} 次采样命中`)

    // 13) 点击互动 + 工作优先级——「点击触发动作」是目标里的硬要求，
    //     而「干活时点不动她」是主人明确要的规矩，两件事一起验。
    const doPoke = `(function(){
      var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      var pt = null;
      for (var i = 1; i <= 12 && !pt; i++) {
        for (var j = 1; j <= 12 && !pt; j++) {
          var x = r.left + r.width * i / 13, y = r.top + r.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) pt = {x: x, y: y};
        }
      }
      if (!pt) return {ok: false, why: '找不到能点中她的坐标'};
      var before = window.DSHPet.state.mood;
      var o = {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1, pointerId: 1, isPrimary: true};
      document.dispatchEvent(new PointerEvent('pointerdown', o));
      document.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, {buttons: 0})));
      var st = window.DSHPet.state;
      return {ok: true, status: st.agent.status, base: st.base, head: (pt.y - r.top) / r.height < 0.45,
              beforeMood: before, afterMood: st.mood, override: !!st.override,
              bubble: ((document.querySelector('.dshp-body') || {}).textContent || '').slice(0, 40)};
    })()`

    // 13a) 先让她忙起来，这时候点她应该没有任何反应
    await evaluate(`(function(){return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){return 1})})()`)
    await sleep(5600)
    const busyPoke = await evaluate(doPoke)
    check('干活时点她也能互动', busyPoke.status !== 'idle' && busyPoke.override === true, JSON.stringify({status: busyPoke.status, override: busyPoke.override}))
    check('互动不改底层工作状态（互动完回到工作）', busyPoke.base === 'reading' || busyPoke.base === 'thinking', `base=${busyPoke.base}`)

    // 13b) 等她闲下来，这时候点她才该有反应
    let idleNow = ''
    for (let i = 0; i < 30; i++) {
      await sleep(800)
      idleNow = await evaluate('window.DSHPet.state.agent.status')
      if (idleNow === 'idle') break
    }
    await evaluate('window.DSHPet.clearReaction()')
    const freePoke = await evaluate(doPoke)
    check('闲下来点她会触发反应', freePoke.ok === true && freePoke.override === true, JSON.stringify(freePoke))
    check('点击后出现了对应台词', !!freePoke.bubble && freePoke.bubble.length > 0, JSON.stringify(freePoke.bubble))
    check('点击确实换了表情或进了一次性反应', freePoke.override === true, `${freePoke.beforeMood} → ${freePoke.afterMood}`)

    // 点出来的反应必须是「一会儿就消失」的
    await sleep(4200)
    const ap = JSON.parse(await evaluate('JSON.stringify({ov: !!window.DSHPet.state.override, mood: window.DSHPet.state.mood, base: window.DSHPet.state.base, props: window.DSHPet.state.props})'))
    check('互动反应几秒后自己消失、回到「本子+笔+平常」', ap.ov === false && ap.mood === ap.base && ap.props.join() === '点菜按下,画笔', JSON.stringify(ap))

    // 14) 一键重置：不管刚才点出了什么特效，一下回到「本子+笔+平常脸」
    const resetTest = await evaluate(`(function(){
      // 先把状态搞乱
      window.DSHPet.setProp('whale', true);
      window.DSHPet.setProp('glassesSun', true);
      window.DSHPet.setReaction({mood: 'angry', props: ['doubleV'], ms: 60000});
      window.DSHPet.setUserFace('love');
      var r = document.getElementById('dsh-live2d-pet');
      r.style.left = '200px'; r.style.top = '150px'; r.style.right = 'auto'; r.style.bottom = 'auto';
      var dirty = {props: window.DSHPet.state.props.slice(), mood: window.DSHPet.state.mood, override: !!window.DSHPet.state.override};
      window.DSHPet.resetEverything();
      var st = window.DSHPet.state;
      return {
        dirty: dirty,
        props: st.props.slice(), mood: st.mood, face: st.face, base: st.base, override: !!st.override,
        left: r.style.left, right: r.style.right, hidden: r.classList.contains('dshp-hidden'),
      };
    })()`)
    check('一键重置前状态确实是乱的', resetTest.dirty.props.length > 2 && resetTest.dirty.override === true, JSON.stringify(resetTest.dirty))
    check('一键重置后回到「本子+笔+平常脸」', resetTest.override === false && resetTest.mood === 'neutral' && resetTest.face === null && resetTest.props.join() === '点菜按下,画笔', JSON.stringify({mood: resetTest.mood, face: resetTest.face, props: resetTest.props}))
    check('一键重置同时归位到角落、解除隐藏', (resetTest.left === '' || resetTest.left === 'auto') && resetTest.right !== '' && resetTest.hidden === false, JSON.stringify({left: resetTest.left, right: resetTest.right, hidden: resetTest.hidden}))

    // 15) 「两个表情不许重叠」——用可观测的独占裁决指标验证
    const overlap = await evaluate(`(function(){
      // 墨镜写 ParamEyeLOpen/ParamEyeROpen，调皮也写 ParamEyeROpen —— 天然冲突
      window.DSHPet.resetEverything();
      window.DSHPet.setProp('glassesSun', true);
      window.DSHPet.setReaction({mood: 'playful', ms: 30000});
      return 1;
    })()`)
    void overlap
    await sleep(900)
    const excl = await evaluate('JSON.stringify(window.DSHPet.state.exclusive)')
    const ex = JSON.parse(excl)
    check('同一参数只有一个写入者（独占裁决在跑）', ex && ex.skipped > 0, excl)
    check('这一帧只写了一组参数', ex && ex.written > 0 && ex.written < 40, ex ? `${ex.written} 个参数，写入者 [${ex.writers.join(',')}]` : '无')

    // 16) 每次表演前先归零：新表演开始时旧的必须已经被清掉
    const sequential = await evaluate(`(function(){
      window.DSHPet.resetEverything();
      var a = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()};
      window.DSHPet.setReaction({mood: 'love', props: ['whale'], ms: 30000});
      var during1 = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()};
      window.DSHPet.setReaction({mood: 'grumpy', props: [], ms: 30000});
      var during2 = {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()};
      window.DSHPet.resetEverything();
      return {a: a, during1: during1, during2: during2, after: {face: window.DSHPet.state.face, props: window.DSHPet.state.props.slice()}};
    })()`)
    check('新表演开始时旧表情已经被换掉（不叠加）', sequential.during2.face !== sequential.during1.face, JSON.stringify(sequential))
    check('新表演开始时旧的一次性道具被清掉', sequential.during2.props.indexOf('鲸鱼') < 0, JSON.stringify(sequential.during2.props))
    check('重置后回到「本子+笔+平常脸」', sequential.after.face === null && sequential.after.props.join() === '点菜按下,画笔', JSON.stringify(sequential.after))

    // 17) 待机必须是「正常坐姿 + 正常眼型 + 正常表情」：
    //     不长播任何动作，也不留任何多余的表情参数
    await evaluate('window.DSHPet.resetEverything()')
    // 待机时她**本来就该偶尔换个表情**（几秒就收），所以不能随便抓一帧就断言；
    // 要等她那次自发表情过期、真正「静下来」的那一刻再看。
    let atRest = null
    for (let i = 0; i < 20; i++) {
      await sleep(800)
      const probe = JSON.parse(await evaluate(`JSON.stringify({ov: !!window.DSHPet.state.override})`))
      if (!probe.ov) {
        atRest = JSON.parse(await evaluate(`JSON.stringify({
      motion: window.DSHPet.state.motion,
      face: window.DSHPet.state.face,
      props: window.DSHPet.state.props,
      writers: (window.DSHPet.state.exclusive || {}).writers,
          skipped: (window.DSHPet.state.exclusive || {}).skipped,
        })`))
        break
      }
    }
    check('待机时没有任何动作在播', atRest.motion && atRest.motion.playing === false, JSON.stringify(atRest.motion))
    check('待机时脸上没有多余表情', atRest.face === null, String(atRest.face))
    check('待机时只有「本子 + 笔」两个道具', atRest.props.join() === '点菜按下,画笔', atRest.props.join())
    check('待机写入者只有本子和笔（没有表情在抢参数）', (atRest.writers || []).every((w) => w === '点菜按下' || w === '画笔'), JSON.stringify(atRest.writers))

    // 18) 完整跑一轮，结束后必须干净地回到平常
    await evaluate(`(function(){return fetch('/__demo',{method:'POST',body:'ok'}).then(function(){return 1})})()`)
    let settled = null
    for (let i = 0; i < 40; i++) {
      await sleep(1000)
      const st = JSON.parse(await evaluate(`JSON.stringify({
        status: window.DSHPet.state.agent.status,
        motion: window.DSHPet.state.motion,
        face: window.DSHPet.state.face,
        props: window.DSHPet.state.props,
        base: window.DSHPet.state.base,
        override: !!window.DSHPet.state.override,
      })`))
      if (st.status === 'idle' && !st.override && !st.motion.playing) { settled = st; break }
      settled = st
    }
    check('一轮跑完后回到空闲', settled.status === 'idle', JSON.stringify(settled))
    check('结束后没有动作在播', settled.motion.playing === false, JSON.stringify(settled.motion))
    check('结束后脸上没有残留表情（不留挤眼睛之类）', settled.face === null, String(settled.face))
    check('结束后底层状态回到平常', settled.base === 'neutral', String(settled.base))
    check('结束后道具回到「本子 + 笔」', settled.props.join() === '点菜按下,画笔', settled.props.join())

    // 19) 拖到边上要吸附（左下 / 右下角）
    const dragTo = (txPct, tyPct) => `(function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.style.transition = '';
      r.style.left = '260px'; r.style.top = '180px'; r.style.right = 'auto'; r.style.bottom = 'auto';
      var st = document.querySelector('.dshp-stage').getBoundingClientRect();
      var pt = null;
      for (var i = 1; i <= 12 && !pt; i++) {
        for (var j = 1; j <= 12 && !pt; j++) {
          var x = st.left + st.width * i / 13, y = st.top + st.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) pt = {x: x, y: y};
        }
      }
      if (!pt) return JSON.stringify({ok: false});
      var tx = Math.round(innerWidth * ${txPct}), ty = Math.round(innerHeight * ${tyPct});
      var o = {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1, pointerId: 1, isPrimary: true};
      document.dispatchEvent(new PointerEvent('pointerdown', o));
      document.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, o, {clientX: tx, clientY: ty})));
      document.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, {clientX: tx, clientY: ty, buttons: 0})));
      var rr = r.getBoundingClientRect();
      return JSON.stringify({
        ok: true, corner: r.dataset.corner,
        gapRight: Math.round(innerWidth - rr.right),
        gapBottom: Math.round(innerHeight - rr.bottom),
        layout: JSON.parse(localStorage.getItem('dsh-live2d-pet:layout') || '{}'),
      });
    })()`
    const snapBR = JSON.parse(await evaluate(dragTo('0.97', '0.94')))
    check('拖到右下角会吸附', snapBR.ok && snapBR.corner === 'br', JSON.stringify(snapBR))
    check('吸附后确实贴住了右下边', snapBR.gapRight !== undefined && snapBR.gapRight <= 20, `右边距 ${snapBR.gapRight}px`)
    const snapBL = JSON.parse(await evaluate(dragTo('0.03', '0.94')))
    check('拖到左下角会吸附', snapBL.ok && snapBL.corner === 'bl', JSON.stringify(snapBL))
    // 拖回右下，别把状态留给后面的用例
    await evaluate(dragTo('0.97', '0.94'))
    await evaluate('window.DSHPet.resetEverything()')

    // 20) 「隐藏过一次之后还能不能起来」——这是主人实际踩到的坑：
    //     隐藏态存进 localStorage，下次打开时初始化代码在 ui 赋值前调 setHidden，
    //     直接抛异常，桌宠彻底起不来、右下角也没把手。必须回归。
    await evaluate(`(function(){
      var k='dsh-live2d-pet:layout';
      var v=JSON.parse(localStorage.getItem(k)||'{}');
      v.hidden = true;
      localStorage.setItem(k, JSON.stringify(v));
      return 1;
    })()`)
    await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
    await sleep(12000)
    const afterHiddenReload = await evaluate(`(function(){
      var r = document.getElementById('dsh-live2d-pet');
      var t = document.querySelector('.dshp-tab');
      return {
        petAlive: !!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize),
        bootError: window.__DSHPetError || null,
        hidden: r ? r.classList.contains('dshp-hidden') : null,
        tabVisible: t ? getComputedStyle(t).display !== 'none' : false,
        tabClickable: t ? getComputedStyle(t).pointerEvents !== 'none' : false,
      };
    })()`)
    check('隐藏态持久化后仍能正常启动', afterHiddenReload.petAlive === true, afterHiddenReload.bootError ? String(afterHiddenReload.bootError).split('\n')[0] : '')
    check('重新打开时保持隐藏但把手可见可点', afterHiddenReload.hidden === true && afterHiddenReload.tabVisible && afterHiddenReload.tabClickable, JSON.stringify(afterHiddenReload))
    // 清干净，别把隐藏态留给下一次
    await evaluate(`(function(){ localStorage.removeItem('dsh-live2d-pet:layout'); return 1 })()`)

    // 14) 连点生气 —— 主人第二次抱怨「平常模式点几下就生气，不好玩」。
    //     旧的判定是「和上次点击间隔 < 1.8 秒就累加」，于是每 1.5 秒点一下，
    //     到第三下照样炸毛。现在改成滑动窗口 + 平均间隔的真正速率判定，
    //     先用纯函数验几条边界，再用真实点击走一遍完整交互路径。
    const tiers = JSON.parse(
      await evaluate(`JSON.stringify({
        slow:     window.DSHPet.pokeTierFor([1200,1200,1200,1200,1200,1200]),
        normal:   window.DSHPet.pokeTierFor([800,800,800,800,800,800,800,800]),
        brisk:    window.DSHPet.pokeTierFor([500,500,500,500,500,500]),
        fourFast: window.DSHPet.pokeTierFor([250,250,250,250]),
        fast:     window.DSHPet.pokeTierFor([380,380,380,380,380,380,380]),
        frantic:  window.DSHPet.pokeTierFor([200,200,200,200,200,200,200,200,200,200]),
        burstThenCalm: window.DSHPet.pokeTierFor([150,150,150,150,150,150,150,3000,900,900,900]),
      })`),
    )
    check('慢慢点（1.2 秒一下）永远不生气', tiers.slow.rapid === false && tiers.slow.furious === false, JSON.stringify(tiers.slow))
    check('正常速度点（0.8 秒一下）不生气', tiers.normal.rapid === false, JSON.stringify(tiers.normal))
    check('手快但正常（0.5 秒一下）也不生气', tiers.brisk.rapid === false, JSON.stringify(tiers.brisk))
    check('连点四下（0.25 秒一下）只是被戳痒，不算生气', tiers.fourFast.rapid === true && tiers.fourFast.furious === false, JSON.stringify(tiers.fourFast))
    check('快（0.38 秒一下）也只是撒娇抗议，不生气', tiers.fast.rapid === true && tiers.fast.furious === false, JSON.stringify(tiers.fast))
    check('手速党（0.2 秒一下 × 10）才会真炸毛', tiers.frantic.rapid === true && tiers.frantic.furious === true, JSON.stringify(tiers.frantic))
    check('窗口是滑动的：炸毛后再停一会儿，慢点就不再生气', tiers.burstThenCalm.furious === false, JSON.stringify(tiers.burstThenCalm))

    // 真实点击：先慢，再快
    // 注意：上面那条「隐藏态持久化」的检查会把页面留在隐藏状态，
    // 而隐藏时点击是被忽略的——所以这里先一键重置（顺带解除隐藏）。
    const pokeRunner = (count, gap) => `(async function(){
      window.DSHPet.resetEverything();
      await new Promise(function(res){ setTimeout(res, 600) });
      var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
      function find(){
        for (var i = 1; i <= 12; i++) for (var j = 1; j <= 12; j++) {
          var x = r.left + r.width * i / 13, y = r.top + r.height * j / 13;
          if (window.DSHPet.hitTest(x, y)) return {x: x, y: y};
        }
        return null;
      }
      window.DSHPet.clearPokes();
      var moods = [];
      var missed = 0;
      for (var k = 0; k < ${count}; k++) {
        var pt = find();
        if (pt) {
          var o = {bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, buttons: 1, pointerId: 1, isPrimary: true};
          document.dispatchEvent(new PointerEvent('pointerdown', o));
          document.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, {buttons: 0})));
        } else {
          missed++;
        }
        moods.push(window.DSHPet.state.mood);
        await new Promise(function(res){ setTimeout(res, ${gap}) });
      }
      return JSON.stringify({
        hidden: document.getElementById('dsh-live2d-pet').classList.contains('dshp-hidden'),
        missed: missed, tier: window.DSHPet.pokeTier(), moods: moods,
      });
    })()`

    const slowReal = JSON.parse(await evaluate(pokeRunner(5, 900)))
    check(
      '真实点击：慢慢点五下，全是可爱反应，没有一张生气的脸',
      slowReal.missed === 0 && slowReal.tier.count > 0 && slowReal.tier.rapid === false && slowReal.moods.indexOf('grumpy') === -1,
      JSON.stringify(slowReal),
    )

    const fastReal = JSON.parse(await evaluate(pokeRunner(8, 120)))
    check(
      '真实点击：手速党连点八下才炸毛',
      fastReal.tier.rapid === true && ['grumpy', 'alert', 'pout'].indexOf(fastReal.moods[6]) >= 0,
      JSON.stringify(fastReal),
    )
    check(
      '炸毛前那几下仍然是可爱反应（不提前生气）',
      fastReal.moods.slice(0, 6).indexOf('grumpy') === -1,
      JSON.stringify(fastReal.moods),
    )

    // 炸毛之后有冷静期：紧接着再来一串快点击，也不该再凶主人
    const afterAnger = JSON.parse(await evaluate(pokeRunner(8, 120)))
    check('炸毛之后有冷静期，连着快点击也不会一直凶', afterAnger.tier.furious === false, JSON.stringify(afterAnger.tier))

    // 15) 菜单里每一项都得「真的有事发生」——主人抱怨「点了没用、就卡在那」。
    //     逐页点一遍：表情页按**表情**去重、每一项都有配好的台词；
    //     装饰/场景是「常驻」的，动作是「一次性」的——三页分开，别混。
    const openTab = (name) => `(function(){
      var r = document.getElementById('dsh-live2d-pet');
      r.classList.add('dshp-open');
      var dock = document.querySelector('.dshp-dock');
      var panel = document.querySelector('.dshp-panel.dshp-on');
      if (!panel || !panel.classList.contains('dshp-on')) panel = null;
      if (!panel) dock.children[1].click();
      panel = document.querySelector('.dshp-panel.dshp-on');
      if (!panel) return JSON.stringify({err: '菜单打不开'});
      var tabs = panel.querySelectorAll('.dshp-tab-btn');
      for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === NAME) tabs[i].click();
      return JSON.stringify({ok: true});
    })()`.replace('NAME', JSON.stringify(name))

    await evaluate(openTab('表情'))
    const faceMenu = JSON.parse(await evaluate('JSON.stringify(window.DSHPet.menu())'))
    const faceLabels = faceMenu.chips.map((c) => c.label)
    check(
      '表情菜单按表情去重（星星眼不再出现两次）',
      new Set(faceLabels).size === faceLabels.length,
      faceLabels.join(','),
    )
    check(
      '表情菜单不再出现 呆呆眼 / 晕晕（主人点名不要的）',
      !faceLabels.some((l) => ['呆呆眼', '晕晕'].includes(l)),
      faceLabels.join(','),
    )
    check(
      '闭眼口水保留（原作者按键表里的正经表情 Alt+T）',
      faceLabels.includes('闭眼口水'),
      faceLabels.join(','),
    )
    check('菜单顶上写着「现在是什么状态」', /现在：/.test(faceMenu.status), faceMenu.status)

    // 每一个表情按钮：点下去要换脸 + 冒出一句配好的话
    const faceProbe = JSON.parse(
      await evaluate(`(async function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        var panel = document.querySelector('.dshp-panel.dshp-on');
        if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
        var out = [];
        var labels = [];
        var chips = panel.querySelectorAll('.dshp-chip');
        for (var i = 0; i < chips.length; i++) labels.push(chips[i].textContent);
        for (var i = 0; i < chips.length; i++) {
          // 每次重新取，因为点完会重画这一页
          panel = document.querySelector('.dshp-panel.dshp-on');
          var list = panel.querySelectorAll('.dshp-chip');
          var label = labels[i];
          var chip = null;
          for (var j = 0; j < list.length; j++) if (list[j].textContent === label) chip = list[j];
          if (!chip) { out.push({label: label, err: 'chip 不见了'}); continue; }
          chip.click();
          await new Promise(function(res){ setTimeout(res, 260) });
          var st = window.DSHPet.state;
          var bubble = (document.querySelector('.dshp-body') || {}).textContent || '';
          out.push({label: label, mood: st.mood, face: st.face, override: !!st.override, said: bubble.slice(0, 24)});
        }
        return JSON.stringify(out);
      })()`),
    )
    const noReaction = faceProbe.filter((x) => x.err || (!x.override && !x.face))
    check(
      '每个表情按钮点下去都有反应（换脸 or 一次性表演）',
      noReaction.length === 0,
      JSON.stringify(noReaction.slice(0, 4)),
    )
    const silent = faceProbe.filter((x) => x.label !== '平常' && !x.said)
    check('每个表情按钮点下去都会说一句配好的话', silent.length === 0, JSON.stringify(silent.slice(0, 4)))

    // 菜单表情的规矩（主人这一轮定的）：
    //   · 点一下只演「三四秒」，不是 30 秒手动常驻 → 之后必须回到平常脸
    //   · 期间再点一个 / 她自己换表情 / agent 事件来了，都要能把它顶掉
    const faceLife = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 400) });
        function clickFace(label){
          var r = document.getElementById('dsh-live2d-pet');
          r.classList.add('dshp-open');
          var panel = document.querySelector('.dshp-panel.dshp-on');
          if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
          var tabs = panel.querySelectorAll('.dshp-tab-btn');
          for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '表情') tabs[i].click();
          var list = panel.querySelectorAll('.dshp-chip');
          for (var j = 0; j < list.length; j++) if (list[j].textContent === label) { list[j].click(); return true; }
          return false;
        }
        var out = {};
        out.clicked = clickFace('爱心眼');
        await new Promise(function(res){ setTimeout(res, 250) });
        var s1 = window.DSHPet.state;
        out.after1 = {face: s1.face, left: s1.overrideLeft, userFace: s1.userProps && null};
        // 再点另一个：必须立刻顶掉
        clickFace('生气');
        await new Promise(function(res){ setTimeout(res, 250) });
        out.after2 = {face: window.DSHPet.state.face};
        // 等它自己过期
        await new Promise(function(res){ setTimeout(res, 4200) });
        var s3 = window.DSHPet.state;
        out.afterExpire = {face: s3.face, base: s3.base, overrideLeft: s3.overrideLeft};
        return JSON.stringify(out);
      })()`),
    )
    check('点菜单表情：立刻换脸，而且只挂三四秒（不是 30 秒手动常驻）',
      faceLife.clicked && faceLife.after1.face === '爱心眼' && faceLife.after1.left > 0 && faceLife.after1.left <= 4500,
      JSON.stringify(faceLife.after1))
    check('再点一个表情会立刻把它顶掉', faceLife.after2.face === '生气', JSON.stringify(faceLife.after2))
    check('过期后自己回到「平常脸」', faceLife.afterExpire.face === null && faceLife.afterExpire.base === 'neutral', JSON.stringify(faceLife.afterExpire))

    // agent 事件来了要能盖掉菜单选的临时表情
    const faceOverride = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 300) });
        window.DSHPet.setReaction({mood: 'cry', ms: 8000});
        var during = window.DSHPet.state.face;
        await fetch('/__events', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({events:[{t:'turn-start',turn:9},{t:'step-start',turn:9,step:1},
            {t:'tool-call',callId:'ov1',name:'read',label:'读文件',args:'{}'}], gap: 120})});
        await new Promise(function(res){ setTimeout(res, 900) });
        var after = window.DSHPet.state;
        return JSON.stringify({during: during, after: {face: after.face, base: after.base, mood: after.mood}});
      })()`),
    )
    check('真实事件能盖掉临时表情（不会被她一直挂着）',
      faceOverride.after.base === 'reading' && faceOverride.after.face !== '哭',
      JSON.stringify(faceOverride))
    await evaluate(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[{t:'turn-end',turn:9,reason:{kind:'completed'},ms:600,tokens:10}],gap:0})})`)
    await sleep(1200)

    // 装饰页
    await evaluate(openTab('装饰'))
    const propMenu = JSON.parse(await evaluate('JSON.stringify(window.DSHPet.menu())'))
    check('装饰菜单里每一项都有台词（不是点了没反应）', propMenu.chips.every((c) => /她会说/.test(c.title)), JSON.stringify(propMenu.chips.filter((c) => !/她会说/.test(c.title)).map((c) => c.label)))

    const propProbe = JSON.parse(
      await evaluate(`(async function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        var getPanel = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
        if (!getPanel()) { document.querySelector('.dshp-dock').children[1].click(); }
        var out = [];
        var labels = [];
        var chips = getPanel().querySelectorAll('.dshp-chip');
        for (var i = 0; i < chips.length; i++) labels.push(chips[i].textContent);
        for (var i = 0; i < labels.length; i++) {
          var list = getPanel().querySelectorAll('.dshp-chip');
          var chip = null;
          for (var j = 0; j < list.length; j++) if (list[j].textContent === labels[i]) chip = list[j];
          if (!chip) { out.push({label: labels[i], err: 'chip 不见了'}); continue; }
          chip.click();
          await new Promise(function(res){ setTimeout(res, 300) });
          var st = window.DSHPet.state;
          var bubble = (document.querySelector('.dshp-body') || {}).textContent || '';
          out.push({label: labels[i], props: st.props, mood: st.mood, said: bubble.slice(0, 24)});
          // 关掉，免得同类互斥影响下一项
          var list2 = getPanel().querySelectorAll('.dshp-chip');
          for (var k = 0; k < list2.length; k++) if (list2[k].textContent === labels[i]) list2[k].click();
          await new Promise(function(res){ setTimeout(res, 200) });
        }
        return JSON.stringify(out);
      })()`),
    )
    const propDead = propProbe.filter((x) => x.err || !x.said)
    check('每个装饰品点下去都有表情 + 台词', propDead.length === 0, JSON.stringify(propDead.slice(0, 4)))

    // 白魔爪：得真的把爪子亮出来（以前只开一层看不见的颜色，主人说「点了没用」）
    const clawsWhite = JSON.parse(
      await evaluate(`(async function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        var getPanel = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
        if (!getPanel()) document.querySelector('.dshp-dock').children[1].click();
        var tabs = getPanel().querySelectorAll('.dshp-tab-btn');
        for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '场景') tabs[i].click();
        var list = getPanel().querySelectorAll('.dshp-chip');
        var chip = null;
        for (var j = 0; j < list.length; j++) if (list[j].textContent === '白魔爪') chip = list[j];
        if (!chip) return JSON.stringify({err: '没有白魔爪按钮'});
        chip.click();
        await new Promise(function(res){ setTimeout(res, 300) });
        var st = window.DSHPet.state;
        return JSON.stringify({props: st.props, mood: st.mood, bubble: ((document.querySelector('.dshp-body')||{}).textContent||'').slice(0,24)});
      })()`),
    )
    check(
      '白魔爪会同时亮出爪子 + 换色（不再是「点了没反应」）',
      !clawsWhite.err && clawsWhite.props.indexOf('魔爪') >= 0 && clawsWhite.props.indexOf('魔爪换色') >= 0,
      JSON.stringify(clawsWhite),
    )

    // 场景是「摆着不走」的：点开之后过 16 秒还得在
    const persist = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 300) });
        var chip = null;
        var panel = document.querySelector('.dshp-panel.dshp-on');
        if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
        var tabs = panel.querySelectorAll('.dshp-tab-btn');
        for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '场景') tabs[i].click();
        var list = panel.querySelectorAll('.dshp-chip');
        for (var j = 0; j < list.length; j++) if (list[j].textContent === '桌面巴菲') chip = list[j];
        if (!chip) return JSON.stringify({err: '没有桌面巴菲按钮'});
        chip.click();
        await new Promise(function(res){ setTimeout(res, 500) });
        var first = window.DSHPet.state.props.slice();
        await new Promise(function(res){ setTimeout(res, 16000) });
        return JSON.stringify({first: first, later: window.DSHPet.state.props.slice(), userProps: window.DSHPet.state.userProps});
      })()`),
    )
    check(
      '场景摆设是常驻的：16 秒后还摆在桌上（主人要的「一直存在」）',
      !persist.err && persist.first.indexOf('巴菲') >= 0 && persist.later.indexOf('巴菲') >= 0,
      JSON.stringify(persist),
    )

    // 动作是「一次性」的：演完就消失，而且绝不写进 userProps
    const oneShot = JSON.parse(
      await evaluate(`(async function(){
        window.DSHPet.resetEverything();
        await new Promise(function(res){ setTimeout(res, 300) });
        var panel = document.querySelector('.dshp-panel.dshp-on');
        if (!panel) { document.querySelector('.dshp-dock').children[1].click(); panel = document.querySelector('.dshp-panel.dshp-on'); }
        var tabs = panel.querySelectorAll('.dshp-tab-btn');
        for (var i = 0; i < tabs.length; i++) if (tabs[i].textContent === '动作') tabs[i].click();
        var list = panel.querySelectorAll('.dshp-chip');
        var out = {labels: [], during: [], after: [], leaked: []};
        for (var j = 0; j < list.length; j++) out.labels.push(list[j].textContent);
        for (var k = 0; k < out.labels.length; k++) {
          var panel2 = document.querySelector('.dshp-panel.dshp-on');
          var l2 = panel2.querySelectorAll('.dshp-chip');
          var chip = null;
          for (var m = 0; m < l2.length; m++) if (l2[m].textContent === out.labels[k]) chip = l2[m];
          chip.click();
          await new Promise(function(res){ setTimeout(res, 700) });
          var st = window.DSHPet.state;
          out.during.push({label: out.labels[k], props: st.props.slice(), overrideProps: st.overrideProps, mood: st.mood,
            said: ((document.querySelector('.dshp-body')||{}).textContent||'').slice(0,20)});
          if (st.userProps.length) out.leaked.push({label: out.labels[k], userProps: st.userProps.slice()});
          await new Promise(function(res){ setTimeout(res, 6500) });
          out.after.push({label: out.labels[k], props: window.DSHPet.state.props.slice()});
        }
        return JSON.stringify(out);
      })()`),
    )
    check('动作页列出了一次性动作（猫爪/比耶/蛋包饭…）', oneShot.labels.length >= 5, JSON.stringify(oneShot.labels))
    check(
      '每个动作点下去都真的演了（有表情/道具变化）+ 说了话',
      oneShot.during.every((d) => d.overrideProps && d.overrideProps.length >= 2 && d.said),
      JSON.stringify(oneShot.during.filter((d) => !d.overrideProps || !d.said)),
    )
    check(
      '动作不会写进「常驻」那一层（所以不会一直挂着）',
      oneShot.leaked.length === 0,
      JSON.stringify(oneShot.leaked),
    )
    check(
      '动作演完自己消失，回到「本子 + 笔」',
      oneShot.after.every((a) => a.props.length === 2 && a.props.indexOf('点菜按下') >= 0),
      JSON.stringify(oneShot.after),
    )

    // 每个菜单项都有台词表（静态）——四项：表情 / 装饰 / 场景 / 动作
    const tableCheck = JSON.parse(
      await evaluate(`JSON.stringify({
        face: ['happy','love','sad','cry','grumpy','confused','alert','tongue','dead','shy','pout','smug','gloomy','sweat','excited','listening','playful'].filter(function(k){ return !window.DSHPet.itemLines('face', k) }),
        decor: ['glassesRound','glassesSquare','glassesOval','glassesSun','stickerCat','stickerRabbit','stickerBow','flower','ponytail','headband'].filter(function(k){ return !window.DSHPet.itemLines('decor', k) }),
        scene: ['darkCloth','whale','whaleOnDesk','parfait','claws','clawsWhite','phoneSkin'].filter(function(k){ return !window.DSHPet.itemLines('scene', k) }),
        action: window.DSHPet.actions().map(function(a){ return a.key }).filter(function(k){ return !window.DSHPet.itemLines('action', k) }),
      })`),
    )
    check(
      '所有表情/装饰/场景/动作都配了台词',
      tableCheck.face.length + tableCheck.decor.length + tableCheck.scene.length + tableCheck.action.length === 0,
      JSON.stringify(tableCheck),
    )

    // 收尾：关掉菜单，别影响后面的检查
    await evaluate(`(function(){ document.getElementById('dsh-live2d-pet').classList.remove('dshp-open'); var p = document.querySelector('.dshp-panel.dshp-on'); if (p) p.classList.remove('dshp-on'); window.DSHPet.resetEverything(); return 1 })()`)
    await sleep(400)

    // 16) 主人报的「工作模式卡死」——干活中点了蛋包饭/手机之后，
    //     一键重置必须真的把一切清回「本子 + 笔 + 平常脸」，
    //     而且之后不能被干活轮播又推回工作脸（这是当时真正的病根）。
    const workEvents = [
      { t: 'user', text: '把这份资料看完' },
      { t: 'turn-start', turn: 1 },
      { t: 'step-start', turn: 1, step: 1 },
      { t: 'tool-call', callId: 's1', name: 'web_search', label: '上网查', args: '{"queries":["背景"]}' },
    ]
    const inject = (events, gap) => evaluate(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ events, gap: gap || 150 }))}}).then(function(r){return r.status})`)
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
      if (!chip) return 'chip-missing';
      chip.click();
      return 'clicked';
    })()`)
    const brief = () => evaluate(`(function(){
      var s = window.DSHPet.state;
      return JSON.stringify({status: s.agent.status, mood: s.mood, face: s.face, base: s.base,
        props: s.props, userProps: s.userProps, work: s.work, device: s.device});
    })()`).then(JSON.parse)

    await evaluate('window.DSHPet.resetEverything()')
    await sleep(600)
    await inject(workEvents, 150)
    await sleep(1800)
    const busyNow = await brief()
    check('测试前提：确实进了工作模式', busyNow.status === 'working' && busyNow.work.active === true, JSON.stringify(busyNow))

    check('干活时点蛋包饭有反应', (await clickChip('场景', '蛋包饭')) === 'clicked')
    await sleep(900)
    const withOmurice = await brief()
    check(
      '干活时点蛋包饭：蛋包饭出现在桌上，且没写进常驻层',
      withOmurice.props.indexOf('蛋包饭') >= 0 && withOmurice.userProps.length === 0,
      JSON.stringify(withOmurice),
    )

    await evaluate('window.DSHPet.resetEverything()')
    await sleep(900)
    const afterReset = await brief()
    check(
      '一键重置：道具清空（只剩本子+笔）、表情回平常',
      afterReset.props.sort().join(',') === ['点菜按下', '画笔'].sort().join(',') &&
        afterReset.face === null &&
        afterReset.base === 'neutral',
      JSON.stringify(afterReset),
    )
    check('一键重置：干活轮播停掉（否则几秒后又被推回工作脸）', afterReset.work.active === false, JSON.stringify(afterReset.work))
    check('一键重置：小设备（手机）收回去', afterReset.device.out === false, JSON.stringify(afterReset.device))
    check('一键重置：连动作留下的临时层也清掉', afterReset.overrideProps === null, JSON.stringify(afterReset.overrideProps))

    // 关键：重置之后一段时间里，不能被任何东西又推回工作状态
    const drift = []
    for (let i = 0; i < 8; i++) {
      await sleep(1000)
      drift.push(await brief())
    }
    const dirty = drift.filter((d) => d.face !== null || d.base !== 'neutral' || d.props.length !== 2)
    check(
      '重置后 8 秒内一直保持「本子+笔+平常脸」（不会自己漂回工作状态）',
      dirty.length === 0,
      JSON.stringify(dirty.slice(0, 3)),
    )

    // 桌上同时摆两件场景摆设：两件都得在（常驻）
    await clickChip('场景', '桌面巴菲')
    await sleep(300)
    await clickChip('场景', '深色桌布')
    await sleep(600)
    const twoScenes = await brief()
    check(
      '同时摆两件场景摆设：两件都在桌上（常驻）',
      twoScenes.props.indexOf('巴菲') >= 0 && twoScenes.props.indexOf('深色桌布') >= 0,
      JSON.stringify(twoScenes.props),
    )
    await evaluate('window.DSHPet.resetEverything()')
    await sleep(700)
    const cleaned = await brief()
    check('一键重置能把两件摆设一起清掉', cleaned.props.length === 2, JSON.stringify(cleaned))

    // 收工：把这一轮结束掉，免得影响后面的检查
    await inject([{ t: 'turn-end', turn: 1, reason: { kind: 'completed' }, ms: 800, tokens: 100 }], 0)
    await sleep(1500)

    // 17) UI 几何：主人抱怨「底下那三个框太大」「菜单不好用」。
    //     三个按钮必须排成一行、别比模型还显眼；面板必须完整落在屏幕里
    //     （桌宠蹲在右下角时，菜单右半边以前会跑到屏幕外，滑块和关闭按钮点不到）。
    await evaluate('window.DSHPet.resetEverything()')
    await sleep(700)
    const geom = JSON.parse(
      await evaluate(`(function(){
        var r = document.getElementById('dsh-live2d-pet');
        r.classList.add('dshp-open');
        var get = function(){ return document.querySelector('.dshp-panel.dshp-on'); };
        if (!get()) document.querySelector('.dshp-dock').children[1].click();
        var dock = document.querySelector('.dshp-dock');
        var btns = [];
        for (var i = 0; i < dock.children.length; i++) {
          var b = dock.children[i].getBoundingClientRect();
          btns.push({text: dock.children[i].textContent, w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), left: Math.round(b.left)});
        }
        var stage = document.querySelector('.dshp-stage').getBoundingClientRect();
        var p = get().getBoundingClientRect();
        return JSON.stringify({
          btns: btns, stageH: Math.round(stage.height), vw: window.innerWidth, vh: window.innerHeight,
          panel: {left: Math.round(p.left), right: Math.round(p.right), top: Math.round(p.top), bottom: Math.round(p.bottom), w: Math.round(p.width)},
          now: (document.querySelector('.dshp-now') || {}).textContent || '',
        });
      })()`),
    )
    const rows = new Set(geom.btns.map((b) => b.top))
    check('底下三个按钮排成一行（不再被挤成又窄又高的方块）', rows.size === 1, JSON.stringify(geom.btns))
    check(
      '按钮高度不超过模型的 8%（主人说原来太大）',
      geom.btns.every((b) => b.h <= geom.stageH * 0.08),
      `${JSON.stringify(geom.btns.map((b) => b.h))} vs 模型 ${geom.stageH}`,
    )
    check(
      '菜单面板完整落在视口里（关闭按钮和滑块都点得到）',
      geom.panel.left >= 0 && geom.panel.right <= geom.vw && geom.panel.top >= 0,
      JSON.stringify({ panel: geom.panel, vw: geom.vw, vh: geom.vh }),
    )
    check('菜单顶上的状态行有内容', /现在：/.test(geom.now), geom.now)

    await evaluate('window.DSHPet.resetEverything()')
    await sleep(500)

    const logs = (await evaluate('(window.__dshpLogs||[]).slice(0,20)')) || []
    const errors = logs.filter((l) => l.indexOf('E:') === 0 || l.indexOf('X:') === 0)
    check('运行期没有 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | ') || '干净')
    if (logs.length) {
      console.log('  ── 页面日志 ──')
      for (const l of logs.slice(0, 8)) console.log('     ' + String(l).slice(0, 200))
    }
  }

  ws.close()
}

main()
  .catch((err) => {
    console.error('\n自检脚本失败:', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`)
    try {
      chrome.kill('SIGKILL')
    } catch (e) {}
    await sleep(200)
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch (e) {}
    process.exit(fail > 0 ? 1 : 0)
  })
