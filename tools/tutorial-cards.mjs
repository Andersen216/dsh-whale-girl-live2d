#!/usr/bin/env node
/**
 * tutorial-cards.mjs —— 给「一点电脑都不懂」的人看的步骤图（1080×1440，小红书/微信都好发）。
 *   node tools/tutorial-cards.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist', 'help')
fs.mkdirSync(OUT, { recursive: true })
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9500 + Math.floor(Math.random() * 80)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CARDS = [
  {
    file: '新手1-先去拿一把API密钥.png',
    kick: '第 1 步 · 一共 3 步',
    title: '先去拿一把<br>API 密钥',
    sub: '它就是「让 AI 能回你话」的钥匙',
    steps: [
      ['1', '浏览器打开 platform.deepseek.com', '地址栏里一个字一个字敲，回车'],
      ['2', '注册并登录', '手机号或者微信都行'],
      ['3', '左边点「API keys」', '找不到就点左上角三条杠展开菜单'],
      ['4', '点「创建 API key」', '名字随便写，比如 abc'],
      ['5', '马上复制 sk- 开头那一长串', '它只显示这一次！关掉页面就再也看不到了'],
    ],
    note: '复制完先粘到「记事本」里存着。\n⚠️ 前后不要有空格，也不要只复制一半。',
    tags: ['#DeepSeek', '#新手教程'],
  },
  {
    file: '新手2-把钥匙填进DSH.png',
    kick: '第 2 步 · 一共 3 步',
    title: '把钥匙<br>填进 DSH',
    sub: '就是把那串 sk- 开头的字，粘贴到 DSH 里',
    steps: [
      ['1', '打开 DSH（你现在这个界面）', ''],
      ['2', '点左下角「设置」，再点「模型」', ''],
      ['3', '找到 DeepSeek，点「编辑」', ''],
      ['4', '把 sk- 那串粘进「API 密钥」', '用右键「粘贴」，别手打'],
      ['5', '点「保存」', ''],
      ['6', '完全关掉 DSH，再重新打开一次', '这一步很多人漏掉'],
    ],
    note: '报「API 密钥缺失」= 根本没填上。\n报「API 密钥无效」= 填了但不对（回第 1 步重新拿一把）。',
    tags: ['#DeepSeek', '#新手教程'],
  },
  {
    file: '新手3-还是红色的报错.png',
    kick: '第 3 步 · 一共 3 步',
    title: '还是红色报错？<br>照这张表看',
    sub: '先让 AI 能正常聊天，再装桌宠',
    steps: [
      ['①', '「API 密钥无效」', '说明钥匙不对：重新复制一把新的，注意别带空格、别少几位'],
      ['②', '「余额不足 / Insufficient Balance」', '账号没钱了：去 platform.deepseek.com 充值，最少 10 元起'],
      ['③', '填了还是不行', '可能电脑里以前配过一把旧钥匙（环境变量）在抢它先：把截图发我，我告诉你怎么处理'],
      ['④', '确认能正常聊天了', '再去装桌宠（另一张安装教程图）'],
    ],
    note: '顺序很重要：钥匙 → 能聊天 → 再装桌宠。\n钥匙不对的时候，桌宠也会跟着报错，看起来像「桌宠坏了」，其实不是。',
    tags: ['#DeepSeek', '#新手教程'],
  },
  {
    file: '新手4-桌宠装不上先做这两件事.png',
    kick: '装桌宠 · 排错',
    title: '桌宠装不上？<br>先做这两件事',
    sub: '90% 的「装了没反应」都是这两条',
    steps: [
      ['1', '装完一定要「重启 DSH」', '插件是 DSH 启动的时候加载的，光刷新页面不够'],
      ['2', '以前装过的，要「更新」一次', '重新装不会更新，必须执行：dsh plugin --profile web update dsh-whale-girl-live2d'],
      ['3', '怎么确认装好了', '浏览器打开 127.0.0.1:3080/dsh-pet/pet.js —— 显示 401 就是好了'],
      ['4', '还是不行', '把 dsh 那行命令的报错截图发我，我一条条帮你看'],
    ],
    note: '命令在「终端」里跑：\nmacOS = 启动台搜「终端」；Windows = 开始菜单搜「PowerShell」。',
    tags: ['#桌宠', '#排错'],
  },
]

const html = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1080px;height:1440px;overflow:hidden;display:flex;flex-direction:column;padding:64px 60px 46px;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    background:linear-gradient(160deg,#eef4ff 0%,#f7f0ff 45%,#eaf6ff 100%);position:relative}
  .blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.5}
  .b1{width:600px;height:600px;background:#bcd6ff;top:-180px;right:-150px}
  .b2{width:520px;height:520px;background:#e3ccff;bottom:-170px;left:-140px}
  .kick{position:relative;align-self:flex-start;background:#fff;border:3px solid #1f2430;border-radius:999px;
    padding:11px 24px;font-size:29px;font-weight:800;color:#1f2430;box-shadow:6px 6px 0 #1f2430}
  h1{position:relative;margin-top:30px;font-size:86px;line-height:1.16;font-weight:900;letter-spacing:-2px;color:#141a2b}
  .sub{position:relative;margin-top:20px;font-size:34px;font-weight:600;color:#4a5573;line-height:1.45}
  .card{position:relative;flex:1;margin-top:26px;background:#fff;border:4px solid #1f2430;border-radius:40px;
    box-shadow:12px 14px 0 rgba(31,36,48,.15);padding:34px 30px;display:flex;flex-direction:column;gap:18px;justify-content:center;overflow:hidden}
  .step{display:flex;gap:18px;align-items:flex-start}
  .n{flex:0 0 66px;height:66px;border-radius:20px;background:#1f2430;color:#fff;font-size:34px;font-weight:900;
    display:flex;align-items:center;justify-content:center}
  .t{font-size:31px;font-weight:800;color:#141a2b;line-height:1.3}
  .d{font-size:24px;font-weight:500;color:#5b6785;line-height:1.45;margin-top:6px;word-break:break-all}
  .note{position:relative;margin-top:20px;background:#fff6e6;border:3px solid #1f2430;border-radius:26px;
    padding:20px 24px;font-size:26px;font-weight:700;color:#7a4a00;line-height:1.5;white-space:pre-wrap}
  .foot{position:relative;margin-top:18px;display:flex;justify-content:space-between;align-items:center}
  .tags{display:flex;gap:12px}
  .tag{background:#1f2430;color:#fff;border-radius:999px;padding:10px 20px;font-size:26px;font-weight:800}
  .credit{font-size:20px;color:#6b7690;text-align:right;line-height:1.45}
</style></head><body>
  <div class="blob b1"></div><div class="blob b2"></div>
  <div class="kick">🐋 ${c.kick}</div>
  <h1>${c.title}</h1>
  <div class="sub">${c.sub}</div>
  <div class="card">
    ${c.steps.map(([n, t, d]) => `<div class="step"><div class="n">${n}</div><div><div class="t">${t}</div>${d ? `<div class="d">${d}</div>` : ''}</div></div>`).join('')}
  </div>
  ${c.note ? `<div class="note">${c.note}</div>` : ''}
  <div class="foot">
    <div class="tags">${(c.tags || []).map((t) => `<span class="tag">${t}</span>`).join('')}</div>
    <div class="credit">鲸鱼娘桌宠 · 新手教程<br>作者 Andersen216</div>
  </div>
</body></html>`

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-help-'))}`,
  '--no-first-run', '--hide-scrollbars', '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1080,1440', 'about:blank'],
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1440, deviceScaleFactor: 1, mobile: false }, sessionId, 5000)
  console.log('\n渲染新手步骤图：')
  for (const c of CARDS) {
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html(c)) }, sessionId, 15000)
    await sleep(800)
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId, 20000)
    const f = path.join(OUT, c.file)
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    console.log(`  ✅ ${c.file}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`)
  }
  console.log(`\n图在：${OUT}\n`)
  ws.close()
}
main().catch((e) => { console.error('渲染失败:', e.message); process.exitCode = 1 })
  .finally(async () => { try { chrome.kill('SIGKILL') } catch (e) {} ; await sleep(200); process.exit(process.exitCode || 0) })
