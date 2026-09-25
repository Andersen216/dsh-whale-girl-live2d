#!/usr/bin/env node
/**
 * install-cards.mjs —— 把「零基础装 DSH + 桌宠」做成小红书图文的成套卡片（1080×1440）。
 *   node tools/install-cards.mjs
 * 输出：dist/help/install-cards/
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist', 'help', 'install-cards')
fs.mkdirSync(OUT, { recursive: true })
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9600 + Math.floor(Math.random() * 80)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 每张卡片：blocks 里 kind 可选 step / cmd / cols / note */
const CARDS = [
  {
    file: '00-封面.png',
    kick: '零基础教程 · 一步一步',
    title: '零基础<br>装好 DSH<br>和鲸鱼娘桌宠',
    sub: 'Windows 和 Mac 都有，照着点就行',
    img: '01-待机-本子加笔.png',
    emojiBig: '🐋',
    note: '手机装不了，要用电脑。全程就是复制几行命令 + 点几下鼠标。',
    tags: ['#DeepSeek', '#新手教程'],
  },
  {
    file: '01-打开终端.png',
    kick: '第 1 步',
    title: '打开「终端」',
    sub: '它是待会儿敲命令的窗口，别怕，就一个黑框',
    cols: [
      ['Windows', ['按键盘上的 Win 键', '输入 powershell', '回车，跳出蓝底或黑底的窗口']],
      ['Mac', ['按 Command + 空格', '输入「终端」两个字', '回车，跳出白底或黑底的窗口']],
    ],
    note: '后面所有命令都粘到这个窗口里。\n粘贴：Windows 用右键或 Ctrl+V，Mac 用 Command+V，粘完按回车。',
  },
  {
    file: '02-装Node.png',
    kick: '第 2 步',
    title: '先装 Node',
    sub: 'DSH 要靠它才能跑，所以得先有它',
    steps: [
      ['1', '浏览器打开 nodejs.org', ''],
      ['2', '点写着 LTS 的那个大按钮', '下载安装包'],
      ['3', '双击安装包，一路点「下一步」', '两个系统都一样'],
      ['4', '装完把终端窗口关掉，重新开一个', '这步别省'],
    ],
    note: '装过 Node 的跳过这步。不放心就在终端输入 node -v 回车，\n能蹦出版本号（像 v22.14.0）就说明有。',
  },
  {
    file: '03-装DSH.png',
    kick: '第 3 步',
    title: '装 DSH',
    sub: 'Windows 和 Mac 都是这一行',
    cmd: 'npm install -g @deepseek-ai/dsh',
    cols: [
      ['Windows', ['一般直接用上面这行', '若提示「不是内部或外部命令」', '说明第 2 步没弄好，回去重装']],
      ['Mac', ['若报权限错误（带 EACCES）', '改成下面这行：', 'sudo npm install -g @deepseek-ai/dsh']],
    ],
    note: 'Mac 上加 sudo 会要开机密码。输的时候屏幕上不显示字符，\n这是正常的，不是键盘坏了，输完直接回车。',
  },
  {
    file: '04-启动.png',
    kick: '第 4 步',
    title: '启动 DSH',
    sub: '在终端里输入这行，回车',
    cmd: 'dsh web',
    steps: [
      ['1', '浏览器会自己打开一个页面', '那就是 DSH'],
      ['2', 'Windows 可能弹防火墙提示', '点「允许」就行'],
      ['3', '以后要用，就再敲一次 dsh web', ''],
    ],
    note: '页面地址是 127.0.0.1:3080，关掉浏览器不要紧，\n只要终端那个窗口还开着，重新打开这个地址就能回来。',
  },
  {
    file: '05-拿钥匙.png',
    kick: '第 5 步 · 上半',
    title: '去拿一把钥匙',
    sub: 'DSH 自己不带钱，得给它一把 DeepSeek 的钥匙',
    steps: [
      ['1', '浏览器打开 platform.deepseek.com', '注册并登录'],
      ['2', '左边菜单点「API keys」', ''],
      ['3', '点「创建」，名字随便写', ''],
      ['4', '马上复制 sk- 开头那一串', '它只显示这一次！'],
    ],
    note: '先粘到「记事本」里存着。前面后面都不要有空格，也别只复制一半。',
  },
  {
    file: '06-填钥匙.png',
    kick: '第 5 步 · 下半',
    title: '把钥匙填进 DSH',
    sub: '就在刚才打开的那个页面里操作',
    steps: [
      ['1', '点左下角「设置」→ 选「模型」', ''],
      ['2', '找到 DeepSeek，点「编辑」', ''],
      ['3', '把 sk- 那串粘进「API 密钥」', '用右键粘贴，别手打'],
      ['4', '点「保存」', ''],
      ['5', '完全关掉 DSH 再重新打开', '终端里按 Ctrl+C，再敲 dsh web'],
    ],
    note: '顺手看一眼充值页：DeepSeek 是先充值后用的，最低充 10 元，能用挺久。',
  },
  {
    file: '07-装桌宠.png',
    kick: '第 6 步',
    title: '装桌宠',
    sub: '终端里输入这行，Windows 和 Mac 都一样',
    cmd: 'dsh plugin --profile web add github:Andersen216/dsh-whale-girl-live2d',
    steps: [
      ['1', '等它自己跑完（刷几行字是正常的）', ''],
      ['2', '关掉 DSH 再重新打开', '终端里 Ctrl+C，再敲 dsh web'],
      ['3', '刷新一下页面', '右下角就出现鲸鱼娘了'],
    ],
    note: '她会跟着 AI 干活换表情，点一下会跟你互动，右键能看余额和每轮花了多少钱。',
  },
  {
    file: '08-怎么确认装好.png',
    kick: '第 7 步 · 验证',
    title: '怎么知道装好了',
    sub: '浏览器地址栏输入这一行，回车',
    cmd: '127.0.0.1:3080/dsh-pet/pet.js',
    cols: [
      ['显示 401', ['说明装好了 ✅', '这个 401 是正常的，', '它只是不让人随便访问']],
      ['显示 404', ['说明没装上 ❌', '看下面第 2 条', '多半是忘了重启 DSH']],
    ],
    note: '看不到桌宠，第一件事就是：重启 DSH。光刷新页面是不够的。',
  },
  {
    file: '09-常见坑.png',
    kick: '第 8 步 · 排错',
    title: '四个最常见的坑',
    sub: '90% 的问题都在这四条里',
    steps: [
      ['1', '装完必须重启 DSH', '只刷新页面看不到桌宠，很多人卡在这'],
      ['2', '以前装过、这次没出来', '先跑 update 再重启：dsh plugin --profile web update dsh-whale-girl-live2d'],
      ['3', '红字「API 密钥无效」', '钥匙复制错了或带了空格，回第 5 步重拿一把'],
      ['4', '红字「余额不足」', '账号没钱，去 platform.deepseek.com 充值'],
    ],
    note: '红字跟桌宠没关系：钥匙不对的时候，聊天和桌宠会一起报错，\n看着像桌宠坏了，其实不是。',
  },
  {
    file: '10-结尾.png',
    kick: '装好了？',
    title: '卡住就<br>把截图发我',
    sub: '终端窗口或页面的截图都行，我一条条帮你看',
    steps: [
      ['🐋', '她会跟着 AI 干活', '思考时低头、查资料戴眼镜掏手机、说完伸懒腰'],
      ['💬', '点一下就能跟 AI 说话', '点她会跟你互动，右键还有菜单'],
      ['💰', '右键看钱包', '余额、本轮消耗、峰谷计价（峰红谷绿）'],
    ],
    note: '免费开源，非商业分享。\n模型 氵六青 ／ 角色原作 上善无形 ／ 二次设计 ZipZipPipe',
    tags: ['#DeepSeek', '#桌宠'],
  },
]

/** 真机截图（放在 dist/promo/）转 data URI，直接内联进卡片 */
const PROMO = path.join(ROOT, 'dist', 'promo')
const b64 = (f) => {
  const p = path.join(PROMO, f)
  return fs.existsSync(p) ? 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') : ''
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = (c, i) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1080px;height:1440px;overflow:hidden;display:flex;flex-direction:column;padding:58px 56px 40px;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    background:linear-gradient(160deg,#eef4ff 0%,#f7f0ff 45%,#eaf6ff 100%);position:relative}
  .blob{position:absolute;border-radius:50%;filter:blur(62px);opacity:.5}
  .b1{width:600px;height:600px;background:#bcd6ff;top:-180px;right:-150px}
  .b2{width:520px;height:520px;background:#e3ccff;bottom:-170px;left:-140px}
  .top{display:flex;justify-content:space-between;align-items:center;position:relative}
  .kick{background:#fff;border:3px solid #1f2430;border-radius:999px;padding:10px 24px;font-size:28px;
    font-weight:800;color:#1f2430;box-shadow:6px 6px 0 #1f2430}
  .page{font-size:26px;font-weight:800;color:#8a93ab;letter-spacing:1px}
  h1{position:relative;margin-top:26px;font-size:${c.title.length > 16 ? 76 : 90}px;line-height:1.16;
    font-weight:900;letter-spacing:-2px;color:#141a2b}
  .sub{position:relative;margin-top:18px;font-size:33px;font-weight:600;color:#4a5573;line-height:1.45}
  .mid{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:18px;min-height:0}
  .card{position:relative;background:#fff;border:4px solid #1f2430;border-radius:38px;
    box-shadow:12px 14px 0 rgba(31,36,48,.15);padding:32px 28px;display:flex;flex-direction:column;
    gap:16px;overflow:hidden}
  .step{display:flex;gap:16px;align-items:flex-start}
  .n{flex:0 0 62px;height:62px;border-radius:19px;background:#1f2430;color:#fff;font-size:32px;font-weight:900;
    display:flex;align-items:center;justify-content:center}
  .t{font-size:30px;font-weight:800;color:#141a2b;line-height:1.3}
  .d{font-size:23px;font-weight:500;color:#5b6785;line-height:1.42;margin-top:5px;word-break:break-all}
  .cmd{background:#1f2430;color:#e8ecf6;border-radius:20px;padding:20px 22px;font-size:25px;font-weight:700;
    line-height:1.45;word-break:break-all;font-family:"SF Mono",Menlo,Consolas,monospace}
  .cols{display:flex;gap:16px}
  .col{flex:1;border:3px solid #1f2430;border-radius:22px;padding:16px 18px;background:#f7f9ff}
  .ch{font-size:27px;font-weight:900;color:#1f2430;margin-bottom:8px}
  .cl{font-size:23px;font-weight:500;color:#4a5573;line-height:1.5}
  .note{position:relative;background:#fff6e6;border:3px solid #1f2430;border-radius:24px;
    padding:18px 22px;font-size:25px;font-weight:700;color:#7a4a00;line-height:1.5;white-space:pre-wrap}
  .foot{position:relative;margin-top:16px;display:flex;justify-content:space-between;align-items:center}
  .tags{display:flex;gap:10px}
  .tag{background:#1f2430;color:#fff;border-radius:999px;padding:9px 18px;font-size:24px;font-weight:800}
  .credit{font-size:20px;color:#6b7690;text-align:right;line-height:1.4}
  /* 真机截图本身是深色界面，给它一个深色圆角框，看起来像模像样而不是「白卡里糊了一块黑」 */
  .shot{min-height:0;flex:0 1 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;
    background:linear-gradient(150deg,#141a2b,#232a44);border:3px solid #1f2430;border-radius:24px;padding:14px}
  .shot img{max-width:100%;max-height:520px;object-fit:contain;
    filter:drop-shadow(0 14px 26px rgba(0,0,0,.45))}
  .big{position:absolute;right:44px;top:120px;font-size:150px;opacity:.14}
</style></head><body>
  <div class="blob b1"></div><div class="blob b2"></div>
  <div class="top"><div class="kick">🐋 ${esc(c.kick)}</div><div class="page">${i + 1} / ${CARDS.length}</div></div>
  <h1>${c.title}</h1>
  <div class="sub">${esc(c.sub)}</div>
  ${c.emojiBig ? `<div class="big">${c.emojiBig}</div>` : ''}
  <div class="mid">
  <div class="card">
    ${(c.steps || []).map(([n, t, d]) => `<div class="step"><div class="n">${esc(n)}</div><div><div class="t">${esc(t)}</div>${d ? `<div class="d">${esc(d)}</div>` : ''}</div></div>`).join('')}
    ${c.cmd ? `<div class="cmd">${esc(c.cmd)}</div>` : ''}
    ${c.img ? `<div class="shot"><img src="${b64(c.img)}"></div>` : ''}
    ${c.cols ? `<div class="cols">${c.cols.map(([h, ls]) => `<div class="col"><div class="ch">${esc(h)}</div>${ls.map((l) => `<div class="cl">${esc(l)}</div>`).join('')}</div>`).join('')}</div>` : ''}
  </div>
  ${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}
  </div>
  <div class="foot">
    <div class="tags">${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="credit">鲸鱼娘桌宠 · 零基础安装<br>作者 Andersen216</div>
  </div>
</body></html>`

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'dshp-inst-'))}`,
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
  console.log(`\n渲染安装教程卡片（共 ${CARDS.length} 张）：`)
  for (let i = 0; i < CARDS.length; i++) {
    const c = CARDS[i]
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html(c, i)) }, sessionId, 15000)
    await sleep(700)
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
