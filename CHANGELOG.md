# 更新日志 / Changelog

## 0.3.3 — 2026-09-25

> **English summary / 英文摘要**
>
> Fixed the eyes being frozen **closed** — a regression introduced in 0.3.2. The framework's
> `getParameterDefaultValue()` takes an *index*, not a parameter id; passing an id returned `undefined`, the
> fallback treated it as `0`, and the eye-open parameter was written as 0 and snapshotted for good. Ids are now
> converted to indices and skipped when unknown, plus a self-heal that restores the default when the eyes stay
> closed for 1.5 s with nobody claiming them. Blinking now runs on a natural schedule (every 2.6–5.4 s,
> ~0.19 s per blink, 15% double blinks, none while a motion or an eye-controlling expression is active).
> Bubbles, menus, the wallet and the composer are anchored to the top of her head (0–1 px off centre, pushed
> inside the viewport near a wall). Tests: 159 static + 99 in-browser, all green.

### 修：眼睛被永久冻成「闭着」（0.3.2 引入的，我的错）

0.3.2 里我加了「停动作时把参数复位到默认值」，但框架的 `getParameterDefaultValue(t)`
收的是**下标**不是 id —— 我传了 id，拿到 `undefined`，兜底又把它当成 0，
于是「睁眼」参数被写成 0（闭眼）并永久存进参数快照。现在：id 先转下标、取不到就**跳过**
（绝不猜 0），另外加了一层「眼睛自愈」兜底：没人认领眼睛参数、又闭了 1.5 秒以上，就按默认值纠回来。

### 眨眼：改成自然的节奏

框架自带的是「下次眨眼 = random × 7 秒」，有时连着眨两下、有时七八秒不眨。
现在自己控制：间隔 2.6~5.4 秒、单次约 0.19 秒（闭 60ms + 停 30ms + 睁 100ms）、
15% 概率连眨两下；**动作播放中或表情在管眼睛时不眨**。实测 12 秒眨 3 次。
（判断「动作在播」不能用框架的 `isFinished()`，它空闲时也返回「没结束」——
这就是第一版眨眼一次都不眨的原因，改成我们自己按动作时长记账。）

### 聊天框对准她的头顶

以前面板以「根节点中心」居中，而根节点包含整张书桌场景，中心 ≠ 脑袋中心，所以看着总偏。
现在用测量出来的头部重心当锚点：中间时**偏差 0~1px**，靠左/右墙时自动往屏内让，不会被墙切掉。
眼神跟随鼠标这一套完全没动（幅度 58%、限速 1.6/秒）。


## 0.3.2 — 2026-09-25

> **English summary / 英文摘要**
>
> Two real bugs. **(1)** After using the omurice action it stayed on the desk forever, even after a
> reset: the framework snapshots parameters *after* motions write them, so a stopped motion's last frame was
> reloaded every frame. Stopping a motion now resets those parameters to the model defaults and re-saves the
> snapshot — the same fix covers phones and expressions that would not go away. **(2)** Popups opened left one
> time and right the next and were half-clipped at a wall; positioning is pure computation now. Also: the Speak
> button became a toggle, and dragging can no longer clip the bottom toolbar.

### 「蛋包饭永远挂着」的根因修掉了（真 bug，藏在框架里）

pixi-live2d-display 每帧的顺序是：动作写入 → `saveParameters()` 存快照 → 眨眼/视线/呼吸/物理
→ 我们的 rig → `update()` → `loadParameters()` 把快照装回来。
**快照是在动作写入之后存的**，所以动作一停，快照里留的就是它最后一帧的姿势，每帧都被装回来 ——
这就是主人看到的「用过蛋包饭之后它永远挂在桌上，连一键重置都没用」。
现在 `stopMotion()` 会顺手 `clearMotionPose()`：把动作写过的参数设回 `getParameterDefaultValue()`，
再重新存一次快照。手机 / 表情「回不去」这一整类问题都一起解决了。
回归测试直接读**模型参数**（不是我们自己的状态）：动画中 12 个参数被改动，结束后全部回到默认。

### 弹窗不再一次左一次右

旧写法是「把位移清零 → 量面板位置 → 据此设位移」，而位移本身有过渡动画，
量到动画中间态就会一次算左一次算右，靠墙时还会卡进墙里一半。
现在 `placePanel()` 是纯计算：桌宠在屏幕左半边就往右开、右半边就往左开，再兜底夹进视口。
气泡、菜单、钱包、输入框都走它。测试连开三次，位置必须逐个字符一致。

### 其它

- 「说话」按钮改成开关：点一次开、再点一次关（以前再点只会重新打开，像关不掉）。
- 气泡也支持纵向兜底位移，桌宠拖到屏幕顶端时不会被切掉。
- 竖直位置的安全夹（别让底下三个按钮被屏幕切掉）在拖动和惯性里也生效了。


## 0.3.1 — 2026-09-25

> **English summary / 英文摘要**
>
> All of these were reported by users: snapping is **side-only** (the vertical position stays exactly
> where you put her), the composer only opens from the Speak button (double-clicking the model no longer opens
> it), the wallet's × closes the wallet instead of the menu, right-click toggles it, and a freely-dropped pet is
> no longer pulled back to the wall after a reload.

### 交互修正（都是主人报的）

- **输入框不再乱弹**：以前双击模型会弹出输入框，现在只有点工具栏「说话」才开；
  双击仍然算戳她一下。
- **钱包的 × 修好了**：以前那个 × 一律去关菜单，钱包不是菜单管的，所以点了没反应。
- **右键变成开关**：点一次开钱包，再点一次收起（以前第二次右键会被「点外面就关」抢先关掉再被打开）。
- **只吸左右墙，不吸底部**：松手时靠左/右墙就吸过去，**竖直位置保持你放的高度**；
  离两侧都远就停在原地。竖直方向只做「别让底下三个按钮被屏幕切掉」的软夹。
  存档从 `corner`（左下/右下角）改成 `{edge, edgeY}`，老存档自动迁移。
- 顺带修掉：从墙边拖到自由位置后，存档里还留着旧的 `edge`，重载会被拉回墙上。


## 0.3.0 — 2026-09-25

> **English summary / 英文摘要**
>
> New: **right-click opens a wallet HUD** — remaining balance (DeepSeek's official `user/balance`
> endpoint), this turn's cost (auto-popped when a turn ends: money + tokens), today's total, peak hours in red /
> off-peak in green, and a countdown to the next price change. The accounting is computed inside the host and
> does **not** depend on `dsh-whale-widget`. The HUD never fights the chat for screen space. Host-side changes
> need a DSH restart.

### 右键 = 钱包 HUD（余额 / 本轮消耗 / 峰谷计价）

- **右键不再弹设置**，改成弹一个醒目的框：剩余余额、本轮消耗、今日已用、**峰（红）/谷（绿）**、距下一次峰谷切换还有多久。
- 每一轮结束**自动弹出**「本轮消耗」（金额 + tokens），9 秒后自己收；鼠标停上去不会被打断。
- **计价自己做在宿主里**，不依赖任何别的插件：DeepSeek 官方 `user/balance` 取余额
  （key 走 DSH 凭据服务 `DEEPSEEK_API_KEY`），峰谷按官方规则（工作日 9–12 / 14–18 为高峰，
  周末、调休上班日、法定节假日全天为谷），按 命中/未命中/输出 三个口径分别计价
  （Flash 0.02/1/4，高峰 ×2；Pro 为 3 倍）。
- 新增宿主接口 `GET /dsh-pet/hud` 与 SSE 事件 `hud-turn`。
- 前端优先读自己的接口；装了 `dsh-whale-widget` 时回退用它的账本对账（实测那个插件被停用后其接口是 404，所以才要自带）。
- **不与对话抢屏幕**：开菜单时 HUD 自动收起、点击别处/`Esc` 可关、面板会被夹回视口内不会被切掉。
- 测试：静态/宿主 **158 项**、浏览器端 **127 项**（含「计价公式正确」「宿主接口挂了要能降级」）。


## 0.2.0 — 2026-09-25

> **English summary / 英文摘要**
>
> First release: the Live2D whale girl as a desktop pet inside the DeepSeek Harness Web UI. A
> four-tab menu — expressions / accessories / scenes / actions, with temporary / persistent / persistent /
> one-shot lifetimes — every one of them mapped from the original model author's 52-hotkey sheet. One-click
> reset, and she no longer gets angry from casual clicking. Code MIT © 2026 Andersen216; artwork
> CC BY-NC-SA 4.0, non-commercial, credited to 上善无形 / ZipZipPipe / 氵六青.

这一版把「菜单里点了没用」「工作模式卡死」「老是生气」这几个体验问题集中修掉了，
并且**把动作表整个换成原作者自己的按键表**。

### 按原作者的按键表重建了动作体系

- 读了模型包里的 `按键表.txt` 与 `c_0120.vtube.json`（52 条热键），逐条对照后重排菜单：
  **表情 / 装饰 / 场景 / 动作** 四页，规矩分别是「临时 3~4 秒 / 常驻 / 常驻 / 一次性」。
  逐条对照见 [`docs/作者按键表-对照.md`](docs/作者按键表-对照.md)。
- **装饰**：四副眼镜、三张贴纸、情绪花花、单边马尾、发箍、头顶鲸鱼 —— 一直存在，同类互斥。
- **场景**：深色桌布、鲸鱼放桌上、巴菲、粉/白魔爪、掏出手机、手机换色 —— 一直存在。
- **动作**（新增一批）：猫爪摆手、喵喵手、双手比耶、冒爱心、心跳、MoeMoeQ~、
  橡皮擦、撤回、蛋包饭、自拍、快速自拍、鲸鱼喷水 —— 演一遍就消失。
- 照搬作者的前置依赖：**白魔爪 → 粉魔爪**、**手机换色 / 自拍 / 快速自拍 → 掏出手机**
  （点的时候自动补前置，不会再出现「素材没亮所以看不出效果」）。
- 自带表情变化的动画（自拍、喷水、番茄酱、猫爪）**不再叠一张我们的脸**，
  交还给动画本身，避免「冲突 / 覆盖」。
- 作者把「鲸鱼喷水」绑在左键上，所以戳她的时候也会偶尔喷一下水。
- 「闭眼口水」按作者按键表（Alt+T）恢复；呆呆眼 / 晕晕 / 泡泡糖 / 重锤出击仍然不上。

### 菜单表情改成「临时」

- 点菜单里的表情只演 **3.6 秒**（一次性层），到点自己让位，平常状态永远是**平常脸**。
- 期间她自己的表情、agent 事件、或者你再点一个，都会立刻把它顶掉。
- 不再使用 30 秒的手动常驻层；「表情」页按**表情**去重（星星眼只出现一次）。

### 修掉「工作模式卡死」（主人报的 bug）

- 病根：一键重置**没有停掉干活轮播**，9~14 秒后底层状态又被推回「看资料 + 星星眼」，
  看起来就是「重置也救不回来」。
- 现在重置 = 停轮播 + 清空所有道具层（含手机）+ 清掉临时表演 + 脸回平常，
  重置后 8 秒内的采样必须一直是「本子 + 笔 + 平常脸」（回归测试盯着）。
- 蛋包饭按主人要求做成**一次性**：挤完番茄酱就消失，绝不留在桌上。

### 点她不再动不动就生气

- 旧的连点判定是「两次点击间隔 < 1.8 秒就累加」，于是每 1.5 秒点一下，第三下就炸毛。
- 现在是**滑动窗口 + 平均间隔**的真速率判定：
  ≤ 2 次/秒 永远是可爱反应；2.4 次/秒以上只是撒娇抗议；3.8 次/秒以上且窗口内 ≥7 下才真炸毛，
  而且炸毛后有 6 秒冷静期。
- 平常戳身子池里已经没有任何「生气的脸」；摸头池里「被叫胖」那条权重压到 0.4。
- 待机不再无缘无故摆生气脸（换成了流汗）。

### UI

- **底下三个按钮**原来被 `left:50%` 挤成 104px 宽、文字折行后高 66px；现在
  `width:max-content` + 缩小一号 → 48×20，排成一行。
- **大小滑块现在可以一路拖到底**：拖的时候冻结 UI 缩放，滑块轨道不会再从鼠标底下跑掉。
- 菜单面板不再被屏幕边缘切掉（自动夹回视口内），`Esc` 可关，顶部多了「现在是什么状态」。
- 每个菜单项都有配好的台词（鼠标悬停能看到她会说什么）。

### 发布相关

- 插件改名为 **`dsh-whale-girl-live2d`**（中文名「鲸鱼娘桌宠 —— DSH 里的 Live2D 鲸鱼娘」）。
  原因：`dsh-whale-girl` / `dsh-whale-girl-pet` / `dsh-whale-pet` 在 npm 上**都已被别人的
  鲸鱼娘桌宠占用**，撞名会导致市场装错包。
- 署名：**Andersen216**（插件作者）；模型/角色：上善无形、ZipZipPipe、氵六青（CC BY-NC-SA 4.0，非商业）。
- 新增 `AUTHORS.md`、`docs/发布到插件市场.md`、`docs/投稿条目.yml`、
  `npm run publish` / `npm run publish:check`（一条命令建仓库 + 推代码 + 提市场 PR）。

### 新增测试与工具

- `npm run test:catalog`：把 44 个表情 / 11 个装饰 / 6 个场景 / 12 个动作逐个点一遍，
  用像素差客观测「点了到底有没有反应」（现在 0 个哑按钮）。
- `npm run test:e2e:ui`：用 CDP 真鼠标事件验证滑块拖拽与按钮尺寸。
- `npm run repro:stuck`：复现「工作模式 + 互动 + 一键重置」那条链路的时序。
- 回归测试总数：静态 149 项、浏览器端 97 项，全绿。

## 0.1.0 — 2026-09-24

- 第一版：模型常驻 DSH Web GUI，由 agent 事件驱动表情与动作，气泡说话，
  点击/拖拽/贴边、右键菜单、一键重置、隐藏与找回、按 mtime 热更新。
