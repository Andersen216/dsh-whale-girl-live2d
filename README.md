# 鲸鱼娘桌宠 · Whale Girl Live2D —— DSH 里住着的 Live2D 鲸鱼娘

> **Whale Girl Live2D — the Live2D whale-girl desktop pet for DeepSeek Harness**

**插件作者：Andersen216**（<https://github.com/Andersen216>）· 代码 MIT · 模型素材非商业（CC BY-NC-SA 4.0）

---

## 这是干啥的 / What it does

**中文**：把 Live2D 模型「鲸鱼娘」挂进 DeepSeek Harness 的 Web 界面。她常驻在桌面角落，
不是一张静态贴图——她在跟着 **agent 的真实状态**动：思考时低头、查资料时戴上眼镜掏出手机、
逐字输出时嘴巴跟着动、报错时黑一下脸、一轮收工就伸懒腰庆祝。
点一下就直接给 agent 发消息，回复逐字冒进气泡里；拖动可以挪位置、松手自动贴边；
右键菜单能换表情、戴眼镜贴纸、摆桌面场景、演一次性小动作——**这些动作全部照模型作者
自己的按键表来**（52 条热键逐条对照，见 [`docs/作者按键表-对照.md`](docs/作者按键表-对照.md)），
所以互不冲突、不会互相覆盖、到点自己收回。
（英文见下方 [English](#english)。）

### 她跟 agent 的联动

| agent 在干什么 | 她的反应 |
| --- | --- |
| 主人在说话 / 正在思考 | 星星眼听着 / 低头想事，手里是本子+笔 |
| 调用工具 | 按工具换脸换动作：读文件=戴眼镜凑近看，上网=掏手机，写文件=奋笔疾书，跑命令=挽袖子 |
| 逐字输出回复 | 气泡逐字冒字 + 走路般的小幅度摆动 |
| 工具报错 / 整轮失败 | 黑一下脸（很短，不砸东西）；成功收工 = 伸懒腰 + 比耶 + 用时/花费统计 |
| 长时间没动静 | 她自己会动：换视线、换个表情几秒、自言自语、喊饿 |

## English

**Whale Girl Live2D** puts a Live2D model — the DeepSeek whale girl — inside the DeepSeek Harness
Web UI. She is not a static sticker: she follows **what the agent is actually doing** —
tilting her head while thinking, putting on glasses and pulling out a phone when the agent
reads or searches, moving her mouth as text streams in, darkening her face when a tool errors,
and stretching in celebration when a turn finishes. Click her to send the agent a message and
watch the reply stream into a speech bubble; drag her anywhere and she snaps to the nearest
edge; right-click for a menu of expressions, dress-up items, desk scenes and one-shot
animations. **Every action is mapped from the original model author's own hotkey sheet**
(52 hotkeys, item by item — see [`docs/作者按键表-对照.md`](docs/作者按键表-对照.md)), so
nothing overlaps, nothing is overwritten, and one-shot actions always expire by themselves.

> **Non-commercial notice**: the plugin *code* is MIT (© 2026 Andersen216), but the bundled
> **model artwork is NOT** — it is used under **CC BY-NC-SA 4.0** and must be credited to
> **上善无形 / ZipZipPipe / 氵六青**. This project is free and non-commercial.
> See [`AUTHORS.md`](AUTHORS.md).


把 `DS鲸鱼娘/` 里那套 VTube Studio 的 Live2D 模型，做成一个**跟 DSH 里的 agent 真正连着**的桌宠：
我（agent）在想什么、在跑什么工具、在往外吐什么字、干完了还是崩了，它脸上和身上都会跟着动；
点它一下能直接跟我说话，回复逐字显示在气泡里。

和原来那个「小鲸鱼挂件」的区别：那个是一张 PNG 加气泡文案，这个是活的 Live2D——44 个表情、
8 个动作、物理摆动、视线跟随，而且由**真实的 agent 事件流**驱动，不是轮播。

---

## 效果

**人设**（台词全在 `assets/pet.js` 顶部 `SAY` 表）：称呼「**主人**」，自称「人家」/「本鲸」；
傲娇嘴甜、聪明但懒爱摸鱼、贪吃白米、**不能被叫胖**。

### 常态：左手笔、右手本子，平常脸

默认什么都不演。**待机不放动作**，只有：看别处、自己换个表情（几秒收回）、
自言自语一句、偶尔喊饿或不胖——而且**过一会儿才来一次**，不是一直冒。

### 表演调度器（这一版的核心）

所有「一次性反应」都必须走 `act()`，它保证四条铁律：

1. **先归零再开始**：每次新表演之前，把上一次整个停掉、回到「本子+笔+平常脸」，然后才开始新的
2. **不重叠**：任何时刻 = 一个面部表情 + 至多一个动作 + 至多一个粒子特效。
   同一个参数同时只允许**一个**写入者（可观测：`state.exclusive.skipped`）
3. **待机只在真空闲时发生**：有任务时只有任务表演
4. **点了就覆盖**：点它一下，待机动作立刻被取消，换成这次点击的反应

### 什么时候有什么戏

| 触发 | 表现 | 时长 |
|---|---|---|
| **点击（摸头）** | 害羞+爱心 / 开心 / 爱心眼 / 傲娇 / 兴奋 / 吐舌 / 不胖，**每个表情配它自己那套台词，连着点不重复** | ~2.6 秒 |
| **点击（戳身子）** | 傲娇生气 / 喊痒 / 吐舌 / 缩成一团 / 歪头 / 拿本子挡 | ~2.6 秒 |
| **连点 3 下以上** | 炸毛 | ~2.6 秒 |
| **开始干活** | 「人家这就开始」 | — |
| **干活中** | 在「认真看资料 / 思考」之间**慢切换**（9–14 秒一次），**不卖萌** | — |
| **读文件/查文献** | **随机**戴圆眼镜 / 半框方眼镜 / 不戴，并低头看本子（走视线偏置，不硬写参数） | — |
| **搜索/查资料** | 手里的**笔换成小设备**（模型自带开盖动作），看完自动换回笔 | — |
| **完成** | 猫耳装饰 + 伸懒腰 + 带耗时/token 的统计气泡 | ~3 秒 |
| **工具报错** | 只是**黑一下脸** | ~1.6 秒 |
| **整轮失败 / 被打断** | 不高兴 / 「还没做完呢」 | ~3 秒 |
| **闲置很久** | 打哈欠 → 打瞌睡；一动就醒 | — |

**永久移除**：吹泡泡糖、大锤砸、呆呆眼、圈圈眼——代码里也拦死了（`BANNED_MOTIONS`），
菜单里都找不到。

### 工作优先级高于互动

干活时点她**不打断**——不改脸、不放动作，最多弹一下表示"知道了"。

### 菜单：表情 / 装饰 / 场景 / 动作（四页，规矩不一样）

右键（或工具栏的 `⋯`）打开菜单，四页各自守一条规矩——这是主人明确要求的：

| 页 | 内容 | 生命周期 |
| --- | --- | --- |
| **表情** | 按**表情**去重的一张脸（星星眼只出现一次） | **临时**：点一下演 3~4 秒，自己让位；平常状态永远是**平常脸**；期间她自己的表情 / agent 事件 / 你再点一个都会把它顶掉 |
| **装饰** | 眼镜、贴纸、花花、发箍、单边马尾、头顶鲸 | **常驻**：戴上就一直留着，再点一下摘掉（同类互斥） |
| **场景** | 深色桌布、鲸鱼放桌上、巴菲、粉/白魔爪、掏出手机、手机换色 | **常驻**：摆着不走，再点一下收 |
| **动作** | 猫爪摆手、喵喵手、比耶、冒爱心、心跳、MoeMoeQ~、橡皮、撤回、蛋包饭、自拍、快速自拍、喷水 | **一次性**：演一遍就消失，绝不写进常驻层 |

蛋包饭是个特例，主人特地交代过：**「蛋包饭不能一直存在，蛋包饭只是挤完酱以后就消失了」**——
所以它是「蛋包饭 + 挤番茄酱动画」合成的一次性表演。

这些动作**不是我们编的**，全部来自原作者自己的设计：
`DS鲸鱼娘/按键表.txt` 与模型里的 `c_0120.vtube.json`（52 条热键）。
逐条对照（含哪些动作没上、为什么）见 [`docs/作者按键表-对照.md`](docs/作者按键表-对照.md)。

### 一键重置

设置里有「**一键重置所有状态**」，预览页顶部也有一个。不管刚才点出了什么特效、
或者它卡在什么状态，一下回到「平常脸 + 正常坐姿 + 拿本子拿笔」。
它会**连同干活轮播一起停掉**、清空所有道具层（装饰 / 场景 / 手机）、把脸交还成平常——
不然几秒后干活轮播又会把状态推回去，看起来就像「重置没生效」。
隐藏了也能靠右下角的把手或预览页的「显示桌宠」叫回来。

## 安装

```bash
# 已经装好了（link 到本工作区，改代码即时生效）：
dsh plugin --profile web add "link:/Users/andersen/DSH Workplace/dsh-live2d-pet"
```

装完**重启 DSH Web** 才会加载（`dsh web`）。重启后右下角就会出现鲸鱼娘，
插件的路由挂在 `/dsh-pet/*`。

不想重启也能先看效果：

```bash
cd "DSH Workplace/dsh-live2d-pet"
node tools/preview-server.mjs          # 打开 http://127.0.0.1:5199
```

预览页左上角有三个按钮，可以假装 agent 在干活，把上面那张表全演一遍。

---

## 怎么用

- **点它一下** → 摸头 / 戳身子的随机反应（上身和下身反应不同）
- **双击** → 打开输入框，Enter 发送，Shift+Enter 换行；点「打断」可以中止当前这一轮
- **右键 / 点 `⋯`** → 菜单：表情、道具、场景、动作、设置
  - 表情互斥（选「平常」把脸交还给动作）
  - 道具粘性、同类自动互斥（眼镜只戴一副、贴纸只贴一张）
  - 场景是换整张桌子的布局（深色桌布 / 头顶鲸鱼 / 蛋包饭 / 粉魔爪 …）
  - 设置里有**取景**：整张桌子 / 上半身 / 只有头（这个模型是整张书桌场景，构图自己挑）
- **拖动** → 换位置（会记住）
- **点 `–`** → 隐藏，右下角留一个小把手点回来

---

## agent 主动指挥桌宠

除了自动联动，也可以让我主动表演。命令行：

```bash
cd "DSH Workplace/dsh-live2d-pet"
node tools/pet-ctl.mjs status          # 桌宠在不在、当前会话、连接数
node tools/pet-ctl.mjs mood happy      # 换情绪
node tools/pet-ctl.mjs expr 星星眼      # 直接指定表情
node tools/pet-ctl.mjs motion selfie   # 播动作
node tools/pet-ctl.mjs say "搞定了！"   # 弹一句话
node tools/pet-ctl.mjs prop 猫猫贴纸 on # 戴道具
node tools/pet-ctl.mjs ask "要继续吗？" # 弹话 + 打开面板提醒你
```

底层就是一个 HTTP 口，也可以直接打：

```bash
curl -X POST http://127.0.0.1:3080/dsh-pet/control \
  -H 'Content-Type: application/json' \
  -d '{"mood":"happy","motion":"selfie","say":"你好呀"}'
```

---

## 出问题怎么查

打开 **`http://127.0.0.1:3080/dsh-pet/diag`** —— 一条 URL 把启动过程、
模型原始尺寸、取景结果、可用表情/动作、被过滤的参数全列出来。
出问题时截图这一页就够了。

常用接口：

| 路径 | 作用 |
|---|---|
| `GET /dsh-pet/state` | 桌宠连接数、当前会话、agent 状态（JSON） |
| `GET /dsh-pet/events` | agent 活动 SSE 流 |
| `POST /dsh-pet/say` | `{text}` → 发进当前会话 |
| `POST /dsh-pet/cancel` | 打断当前轮次 |
| `POST /dsh-pet/control` | 表情 / 道具 / 动作 / 说话 |
| `GET /dsh-pet/standalone` | 只放桌宠的极简页（可当独立小窗） |

浏览器控制台里还有 `DSHPet` 对象可以直接玩：

```js
DSHPet.state              // 当前状态
DSHPet.setMood('angry')   // 换脸
DSHPet.playMotion('selfie')
DSHPet.setProp('glassesSun', true)
DSHPet.hitTest(x, y)      // 这个坐标算不算点在它身上
```

---

## 配置

默认值写在 `lib/index.js` 的 `DEFAULT_CONFIG`，用户覆盖写 `~/.dsh/dsh-live2d-pet.json`：

```json
{
  "enabled": true,
  "height": 340,
  "corner": "br",
  "lookAtCursor": true,
  "talkMouth": true,
  "sleepAfterMs": 180000,
  "showReasoning": false
}
```

`enabled: false` 会连注入脚本一起去掉（改完要重启）。

---

## 目录结构

```
dsh-live2d-pet/
├── package.json             DSH bundle 插件元数据（dsh.bundle.patch）
├── cordis.patch.yml         挂载声明
├── lib/index.js             宿主侧：静态资源 + SSE 事件桥 + prompt 反向通道 + 自检页
├── assets/
│   ├── pet.js               前端本体：Live2D 渲染 / 情绪 rig / 状态机 / 气泡 / 输入框
│   ├── vendor/              Live2D Cubism Core · PIXI 6.5.10 · pixi-live2d-display 0.4.0
│   └── model/               模型本体 + 由 tools/build-model.mjs 生成的清单
├── tools/
│   ├── build-model.mjs      把 VTube Studio 原始素材整理成可消费的形态
│   ├── preview-server.mjs   脱离 DSH 的预览 + 假 agent 事件发生器
│   ├── pet-ctl.mjs          agent/命令行驱动桌宠
│   ├── smoke.mjs            浏览器内功能自检（见「已知限制」）
│   └── shot.mjs             CDP 截图（见「已知限制」）
└── skill/SKILL.md           给 agent 看的用法说明，装到 ~/.dsh/skills/ 后自动生效
```

---

## 它内部是怎么动的

模型这套资产是给 VTube Studio 用的：44 个「表情」其实是 44 组参数开关（全是 Add 混合），
`model3.json` 里连 `Motions` 段都没有。所以做了三件事：

1. **补 model3.json**：把 8 个动作按独立 group 注册进去，标准 Live2D 运行时才播得动
   （`tools/build-model.mjs` 生成，可重跑）。
2. **自己写 rig，不用框架的 expressionManager**：挂在 `InternalModel` 的 `beforeModelUpdate`
   上——那是 `model.update()` 之前的最后一站，动作、眨眼、视线、物理都已经算完，我们加的参数
   一定生效；而每帧结尾 `loadParameters()` 会把参数还原，所以写入不跨帧累积。
   情绪（互斥）和道具（粘性）分开管；权重降到 0 的表达式就不再写参数，把脸交还给动作，
   这样「伸展」「自拍」这些自带表情的一次性动作才不会被抹平成面瘫。
3. **命中判定用 alpha 掩码**，不是包围盒：这个模型是一整张书桌场景，包围盒里大半是空气。
   点空气要让事件穿透到下面的 DSH 界面，点在人身上才吃掉事件。

事件侧：宿主监听 `ctx.on('session/event')`（轮次/步骤/工具/最终消息）和
`ctx.on('agent/assistant-stream')`（**真正的逐字流**），过滤出「人正在用的那个会话」后
用 SSE 推给前端。反向用官方的 `sessionController.prompt()`，跟你在界面上打字是同一条路。

---

## 已知限制

- **无头浏览器在本机不可用**：这台机器的无头 Chrome 起不了合成器，
  `Page.captureScreenshot` 和 `Runtime.evaluate` 全部超时（连纯 HTML 页面也一样）。
  所以 `tools/shot.mjs` 和 `tools/smoke.mjs` 在这里跑不出结果，视觉效果需要在真实浏览器里看。
  用 `/dsh-pet/diag` 代替。
- **模型里有两处参数引用是坏的**（原作者的遗留）：`喵喵手~喵~动画` 引用了模型里不存在的
  `ParamCheek51`/`ParamCheek61`；`番茄酱` 动作引用了 `keyboard`/`xbox`。
  前端启动时会自动过滤掉并在控制台说明（框架本身有兜底不会崩，但过滤掉更干净）。
- 桌宠显示在 DSH Web 页面里；关掉页面它就没了。想要常驻桌面可以用
  `/dsh-pet/standalone` + `open -na "Google Chrome" --args --app=http://127.0.0.1:3080/dsh-pet/standalone`。
- 模型没有音频资源，所以 `config.sound` 目前是占位，没有实现。

---

## 作者与致谢

**插件作者：Andersen216**（把模型接进 DSH Web GUI、写联动/菜单/交互/测试）。
代码 MIT，见 [`LICENSE`](LICENSE)。

模型与角色形象是**三重版权链**，都要署名（详见 [`AUTHORS.md`](AUTHORS.md)）：

| 版权所有人 | 贡献 | 主页 |
| --- | --- | --- |
| 上善无形（上善） | 鲸鱼娘角色形象原作，原创 OC「溟月」 | [B 站](https://space.bilibili.com/4456176) |
| ZipZipPipe | 加入 DeepSeek 元素的「女仆鲸鱼娘」二次设计 | [B 站](https://space.bilibili.com/4168597) |
| 氵六青 | 本仓库所用 Live2D 模型（绑定、动作、表情） | [B 站](https://space.bilibili.com/11272072) |

## 素材来源与许可

- **代码**（`lib/` `tools/` `cordis.patch.yml`）：MIT，Copyright © 2026 **Andersen216**。
- **美术素材**（`assets/model/**`：moc3 / 贴图 / 表情 / 动作）：**不适用 MIT**。
  按 **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)**
  （署名 — **非商业性使用** — 相同方式共享）使用，版权归上表三位所有。
- **本项目是非商业的**：完全免费，不收费、不带货、不接广告变现、不卖周边、
  不作为任何付费产品或服务的卖点。模型作者的无偿分享与转载授权，
  不解除角色形象本身的 NC / SA 条件。
- 模型包原《使用须知》原文、逐文件来源、以及权利主张方式见 [`PROVENANCE.md`](PROVENANCE.md)。
- Live2D Cubism Core 版权归 Live2D Inc.，按 Live2D 的许可条款使用。
- PIXI.js（MIT）与 pixi-live2d-display（MIT）。

## 装到别的 DSH 上 / 发布

```bash
# 从 GitHub 装
dsh plugin --profile web add github:Andersen216/dsh-pet-live2d

# 或本地 link（开发用）
dsh plugin --profile web add "link:/绝对路径/dsh-live2d-pet"
```

想发布到 **DSH 插件市场**（`dshmarket`）的话，看
[`docs/发布到插件市场.md`](docs/发布到插件市场.md)：里面有 npm 命名、
GitHub 推送、以及向精选列表提 PR 的完整步骤。
