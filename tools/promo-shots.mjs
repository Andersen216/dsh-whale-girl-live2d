#!/usr/bin/env node
/**
 * promo-shots.mjs —— 给小红书/宣发拍几张真机截图（不是效果图，是真的模型和界面）。
 *
 * 每张都会裁到「桌宠 + 面板 + 气泡」的实际范围，2 倍分辨率，方便直接发帖。
 *
 *   node tools/promo-shots.mjs            # 输出到 dist/promo/
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist', 'promo')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9250 + Math.floor(Math.random() * 120)
const URL_ = (() => { const i = process.argv.indexOf('--url'); return i === -1 ? 'http://127.0.0.1:5199/' : process.argv[i + 1] })()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-promo-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1400,900', 'about:blank',
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 2, mobile: false }, sessionId, 5000).catch(() => {})
  const ev = async (expr, to = 30000) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, to)
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result && r.result.value
  }
  await send('Page.navigate', { url: URL_ }, sessionId, 8000).catch(() => {})
  for (let i = 0; i < 70; i++) {
    await sleep(500)
    try { if (await ev('!!(window.DSHPet && window.DSHPet.state && window.DSHPet.state.modelSize)')) break } catch (e) {}
  }

  /** 裁到「桌宠 + 面板 + 气泡」的实际范围，留点边距 */
  async function shot(name, note) {
    await sleep(400)
    const box = JSON.parse(await ev(`(function(){
      var parts = [document.getElementById('dsh-live2d-pet')];
      var panel = document.querySelector('.dshp-panel.dshp-on'); if (panel) parts.push(panel);
      var b = document.querySelector('.dshp-bubble.dshp-on'); if (b) parts.push(b);
      var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      parts.forEach(function(el){ var r=el.getBoundingClientRect();
        if(!r.width||!r.height) return;
        x0=Math.min(x0,r.left); y0=Math.min(y0,r.top); x1=Math.max(x1,r.right); y1=Math.max(y1,r.bottom); });
      var pad=28;
      return JSON.stringify({x:Math.max(0,x0-pad), y:Math.max(0,y0-pad),
        width:Math.min(1360,x1+pad)-Math.max(0,x0-pad), height:Math.min(860,y1+pad)-Math.max(0,y0-pad)});
    })()`))
    const r = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
    }, sessionId, 20000)
    const file = path.join(OUT, name)
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    console.log(`  ✅ ${name}  ${Math.round(box.width)}×${Math.round(box.height)} → ${(fs.statSync(file).size / 1024).toFixed(0)} KB   ${note || ''}`)
  }

  const openTab = (label) => ev(`(function(){
    var r=document.getElementById('dsh-live2d-pet'); r.classList.add('dshp-open');
    var get=function(){return document.querySelector('.dshp-panel.dshp-on');};
    if(!get()) document.querySelector('.dshp-dock').children[1].click();
    var tabs=get().querySelectorAll('.dshp-tab-btn');
    for(var i=0;i<tabs.length;i++) if(tabs[i].textContent===${JSON.stringify(label)}) tabs[i].click();
    return 1;})()`)

  console.log('\n开始拍图（真机、无滤镜）：')

  // 1) 待机：左手笔右手本子 + 平常脸
  await ev('window.DSHPet.resetEverything()')
  await sleep(900)
  await shot('01-待机-本子加笔.png', '待机常态')

  // 2) 菜单：表情页（去重后的一张脸一个按钮）
  await openTab('表情')
  await sleep(500)
  await shot('02-菜单-表情页.png', '表情页')

  // 3) 菜单：动作页（一次性动作）
  await openTab('动作')
  await sleep(500)
  await shot('03-菜单-动作页.png', '动作页')

  // 4) 场景页（常驻摆设）
  await openTab('场景')
  await sleep(500)
  await shot('04-菜单-场景页.png', '场景页')

  // 5) 蛋包饭：挤番茄酱（一次性动作）
  await ev(`(function(){ var r=document.getElementById('dsh-live2d-pet'); r.classList.remove('dshp-open'); window.DSHPet.resetEverything(); return 1 })()`)
  await sleep(600)
  await ev(`window.DSHPet.playAction('omurice')`)
  await sleep(1600)
  await shot('05-挤番茄酱-蛋包饭.png', '一次性动作')

  // 6) 爱心眼 + 冒爱心
  await ev(`(function(){ window.DSHPet.resetEverything(); window.DSHPet.playAction('love'); return 1 })()`)
  await sleep(1200)
  await shot('06-冒爱心.png', '表情+粒子')

  // 7) 干活中：只有这一张能说明「她跟着 agent 动」
  await ev('window.DSHPet.resetEverything()')
  await sleep(500)
  await ev(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[
    {t:'user',text:'帮我把这份资料看完，整理成摘要'},
    {t:'turn-start',turn:1},{t:'step-start',turn:1,step:1},
    {t:'tool-call',callId:'p1',name:'read',label:'读文件',args:'{"file_path":"docs/report.pdf"}'}],gap:180})}).then(function(){return 1})`)
  await sleep(2200)
  await shot('07-干活中-戴眼镜看资料.png', '工作联动')
  await ev(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[
    {t:'tool-result',callId:'p1',name:'read',label:'读文件',ms:1500,error:null},
    {t:'tool-call',callId:'p2',name:'web_search',label:'上网查',args:'{"queries":["资料"]}'}],gap:200})}).then(function(){return 1})`)
  await sleep(2600)
  await shot('08-干活中-掏手机查资料.png', '工作联动')
  await ev(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[
    {t:'turn-end',turn:1,reason:{kind:'completed'},ms:12000,tokens:3180}],gap:0})}).then(function(){return 1})`)
  await sleep(1500)
  await shot('09-收工庆祝-用时统计.png', '收工统计')

  // 10) 换装：眼镜 + 马尾 + 贴纸 + 花花（这就是「能换各种皮肤」）
  // 先让上一轮动作的残留道具过期（一次性动作的 TTL 最长 6.2 秒），画面才干净
  await ev('window.DSHPet.clearProps(); window.DSHPet.resetEverything(); window.DSHPet.clearReaction()')
  await sleep(8000)
  await ev(`(function(){ ['glassesRound','ponytail','stickerCat','flower'].forEach(function(k){ window.DSHPet.setProp(k,true) }); return 1 })()`)
  await sleep(1400)
  await shot('10-换装-眼镜马尾贴纸花花.png', '换装/皮肤')

  // 11) 再换一身：方眼镜 + 发箍 + 头顶鲸 + 深色桌布
  await ev('window.DSHPet.clearProps(); window.DSHPet.resetEverything(); window.DSHPet.clearReaction()')
  await sleep(7000)
  await ev(`(function(){ ['glassesSquare','headband','whaleHat','darkCloth'].forEach(function(k){ window.DSHPet.setProp(k,true) }); return 1 })()`)
  await sleep(1400)
  await shot('11-换装-方眼镜发箍头顶鲸深色桌布.png', '换装/皮肤')

  // 12) 工作模式被戳：她抬头看你（工作模式的专属互动）
  await ev('window.DSHPet.resetEverything()')
  await sleep(400)
  await ev(`fetch('/__events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[
    {t:'turn-start',turn:2},{t:'step-start',turn:2,step:1},
    {t:'tool-call',callId:'w1',name:'read',label:'读文件',args:'{"file_path":"docs/report.pdf"}'}],gap:150})}).then(function(){return 1})`)
  await sleep(2000)
  await ev(`(function(){
    var r = document.querySelector('#dsh-live2d-pet .dshp-stage').getBoundingClientRect();
    for (var i=1;i<=12;i++) for (var j=1;j<=12;j++) {
      var x=r.left+r.width*i/13, y=r.top+r.height*j/13;
      if (window.DSHPet.hitTest(x,y)) {
        var o={bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:1,pointerId:3,isPrimary:true};
        document.dispatchEvent(new PointerEvent('pointerdown',o));
        document.dispatchEvent(new PointerEvent('pointerup',Object.assign({},o,{buttons:0})));
        return 1;
      }
    }
    return 0;})()`)
  await sleep(900)
  await shot('12-工作模式被戳-她抬头看你.png', '工作模式专属互动')

  console.log(`\n全部图片在：${OUT}\n`)
  ws.close()
}
main().catch((e) => { console.error('拍图失败:', e.message); process.exitCode = 1 })
  .finally(async () => {
    try { chrome.kill('SIGKILL') } catch (e) {}
    await sleep(200)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
    process.exit(process.exitCode || 0)
  })
