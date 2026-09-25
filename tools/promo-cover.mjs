#!/usr/bin/env node
/**
 * promo-cover.mjs —— 用浏览器把真机截图渲染成小红书尺寸（1080×1440，3:4）的成品封面。
 *
 * 为什么要这么做：小红书封面要竖图 + 大字标题，而我们的截图是窄的模型裁切。
 * 这里用 HTML 排版（PingFang SC 字体）再截图，出来的就是可以直接发的图，
 * 不需要用户自己再 P 字。
 *
 *   node tools/promo-cover.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'dist', 'promo')
const OUT = path.join(ROOT, 'dist', 'promo', 'covers')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9400 + Math.floor(Math.random() * 90)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const b64 = (f) => {
  const p = path.join(SRC, f)
  return fs.existsSync(p) ? 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') : ''
}

/** 封面清单：改这里就能改文案 */
const COVERS = [
  {
    file: '封面1-我给DeepSeek做了个桌宠.png',
    kick: 'DeepSeek Harness 插件',
    title: '我给 DeepSeek<br>做了个桌宠',
    sub: '不是贴图，她真的会跟着 AI 干活',
    img: '07-干活中-戴眼镜看资料.png',
    tags: ['#AI桌宠', '#DeepSeek'],
  },
  {
    file: '封面2-鲸鱼娘搬进桌面了.png',
    kick: '开源 · 免费 · 非商业',
    title: '鲸鱼娘<br>搬进电脑桌面了',
    sub: '常驻右下角，点一下就能跟 AI 说话',
    img: '02-菜单-表情页.png',
    tags: ['#live2d', '#桌宠'],
  },
  {
    file: '封面3-52个动作全部来自原作者.png',
    kick: '照原作者按键表做的',
    title: '换表情、摆场景<br>演小动作',
    sub: '表情 3 秒收回 · 装饰常驻 · 动作演完就没',
    img: '06-冒爱心.png',
    tags: ['#桌面美化', '#开源项目'],
  },
  {
    file: '封面6-烧掉几亿token就为了让她别老生气.png',
    kick: '用 DSH 给 DSH 写的插件',
    title: '烧掉几亿 token<br>就为了让她<br>别老生气',
    sub: '149 项静态检查 + 97 项浏览器检查，全是这么熬出来的',
    img: '09-收工庆祝-用时统计.png',
    tags: ['#AI编程', '#DeepSeek'],
  },
  {
    file: '封面5-GitHub怎么下载.png',
    kick: '不想用命令行也行',
    title: 'GitHub 下载<br>两种方式',
    sub: '会打字的用第 1 种，不想碰终端的用第 2 种',
    steps: [
      ['1', '打开仓库页面', 'github.com/Andersen216/dsh-whale-girl-live2d'],
      ['2', '方式一：一行命令', 'dsh plugin --profile web add github:Andersen216/dsh-whale-girl-live2d'],
      ['3', '方式二：Code → Download ZIP', '解压后进目录，再把它链接进 DSH（见正文）'],
      ['4', '重启 DSH + 刷新页面', '右下角出现鲸鱼娘就成功了'],
    ],
  },
  {
    file: '封面4-怎么装-三步.png',
    kick: '安装只要 3 步',
    title: '30 秒<br>装好这只鲸鱼娘',
    sub: '不用写代码，复制一行命令就行',
    steps: [
      ['1', '装 DSH（DeepSeek Harness）', '官网或 npm 装好，能打开界面就行'],
      ['2', '复制一行命令', 'dsh plugin --profile web add github:Andersen216/dsh-whale-girl-live2d'],
      ['3', '重启 DSH，刷新页面', '她就在右下角，拖动可以换位置'],
    ],
  },
]

const html = (c) => `<!doctype html><html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1080px;height:1440px;overflow:hidden;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    background:linear-gradient(160deg,#eef4ff 0%,#f7f0ff 45%,#eaf6ff 100%);
    display:flex;flex-direction:column;padding:70px 68px 54px;position:relative}
  .blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55}
  .b1{width:620px;height:620px;background:#bcd6ff;top:-190px;right:-160px}
  .b2{width:520px;height:520px;background:#e3ccff;bottom:-180px;left:-150px}
  .kick{position:relative;display:inline-flex;align-items:center;gap:10px;align-self:flex-start;
    background:#fff;border:3px solid #1f2430;border-radius:999px;padding:12px 26px;
    font-size:30px;font-weight:800;color:#1f2430;box-shadow:6px 6px 0 #1f2430}
  h1{position:relative;margin-top:38px;font-size:96px;line-height:1.14;font-weight:900;
    letter-spacing:-2px;color:#141a2b}
  .sub{position:relative;margin-top:26px;font-size:38px;line-height:1.45;font-weight:600;color:#4a5573}
  .stage{position:relative;flex:1;margin-top:34px;border-radius:44px;background:#fff;
    border:4px solid #1f2430;box-shadow:14px 16px 0 rgba(31,36,48,.16);
    display:flex;align-items:center;justify-content:center;overflow:hidden}
  .stage img{max-width:88%;max-height:88%;object-fit:contain;
    filter:drop-shadow(0 18px 34px rgba(20,26,43,.22))}
  .steps{position:relative;flex:1;margin-top:34px;border-radius:44px;background:#fff;
    border:4px solid #1f2430;box-shadow:14px 16px 0 rgba(31,36,48,.16);
    padding:44px 40px;display:flex;flex-direction:column;gap:26px;justify-content:center}
  .step{display:flex;gap:22px;align-items:flex-start}
  .n{flex:0 0 76px;height:76px;border-radius:22px;background:#1f2430;color:#fff;
    font-size:40px;font-weight:900;display:flex;align-items:center;justify-content:center}
  .st{font-size:34px;font-weight:800;color:#141a2b;line-height:1.35}
  .sd{font-size:25px;font-weight:500;color:#5b6785;line-height:1.5;margin-top:8px;word-break:break-all}
  .foot{position:relative;margin-top:30px;display:flex;align-items:center;justify-content:space-between;gap:20px}
  .tags{display:flex;gap:14px}
  .tag{background:#1f2430;color:#fff;border-radius:999px;padding:11px 24px;font-size:28px;font-weight:800}
  .credit{font-size:21px;color:#6b7690;line-height:1.45;text-align:right}
</style></head><body>
  <div class="blob b1"></div><div class="blob b2"></div>
  <div class="kick">🐋 ${c.kick}</div>
  <h1>${c.title}</h1>
  <div class="sub">${c.sub}</div>
  ${c.steps
    ? `<div class="steps">${c.steps.map(([n, t, d]) => `<div class="step"><div class="n">${n}</div><div><div class="st">${t}</div><div class="sd">${d}</div></div></div>`).join('')}</div>`
    : `<div class="stage"><img src="${b64(c.img)}"></div>`}
  <div class="foot">
    <div class="tags">${(c.tags || []).map((t) => `<span class="tag">${t}</span>`).join('')}</div>
    <div class="credit">插件作者 Andersen216<br>模型 氵六青 ／ 角色 上善无形 · ZipZipPipe<br>开源免费 · 非商业</div>
  </div>
</body></html>`

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-cover-'))}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--no-sandbox', '--disable-gpu-sandbox', '--no-zygote', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1080,1440', 'about:blank',
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
  ws.addEventListener('message', (e) => {
    const raw = typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')
    let m; try { m = JSON.parse(raw) } catch (err) { return }
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  })
  const send = (method, params, sid, to = 30000) => new Promise((resolve, reject) => {
    const i = ++id
    const t = setTimeout(() => { pend.delete(i); reject(new Error('CDP 超时 ' + method)) }, to)
    pend.set(i, (m) => { clearTimeout(t); m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result) })
    const msg = { id: i, method, params: params || {} }
    if (sid) msg.sessionId = sid
    ws.send(JSON.stringify(msg))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1440, deviceScaleFactor: 1, mobile: false }, sessionId, 5000)
  console.log('\n渲染小红书封面（1080×1440，3:4）：')
  for (const c of COVERS) {
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html(c)) }, sessionId, 15000)
    await sleep(900)
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId, 20000)
    const f = path.join(OUT, c.file)
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    console.log(`  ✅ ${c.file}  → ${(fs.statSync(f).size / 1024).toFixed(0)} KB`)
  }
  console.log(`\n封面在：${OUT}\n`)
  ws.close()
}
main().catch((e) => { console.error('渲染失败:', e.message); process.exitCode = 1 })
  .finally(async () => { try { chrome.kill('SIGKILL') } catch (e) {} ; await sleep(200); process.exit(process.exitCode || 0) })
