# 桌面版（仅 macOS）· Desktop shell for macOS

> **这是「额外的一层壳」，不是替代品。**
> 插件的本体（模型、联动、菜单、钱包）还是网页版那一份 —— 桌宠壳只是把她的页面
> 放进一个**透明、无边框、永远置顶**的原生窗口里，让她从浏览器标签页里搬到你桌面上。

---

## 一句话区分两种用法 / Which one do I want?

| | 🖥 **网页版**（主线） | 🐋 **桌面版**（macOS 附加） |
| --- | --- | --- |
| 她住在哪 | DSH Web 界面右下角（浏览器标签页里） | **你的桌面上**，独立窗口，切桌面/开全屏她都在 |
| 支持平台 | **Windows / macOS / Linux** 都能用 | **只有 macOS** |
| 怎么装 | 装插件就行（见主 README 的「安装」） | **① 先装插件** ② 再下载这个 App |
| 需要开着什么 | DSH 在跑 + 浏览器标签页开着 | DSH 在跑就行，浏览器标签页可以关 |
| 额外能力 | — | 点击穿透（不挡你干活）、拖她=拖窗口、贴边悬浮球、菜单栏 🐋、设置里「彻底关闭 App」 |
| 适合谁 | 大多数人 | 想把桌宠真放到桌面上、且用 Mac 的人 |

> 两个**可以同时用**，也可以只用其中一个。桌面版不会替代网页版，插件升级两边一起受益。

---

## 装桌面版（三步）

**① 先确认插件装好了、DSH 在跑**

```bash
dsh plugin --profile web add github:Andersen216/dsh-whale-girl-live2d
# 装完重启 DSH，然后确认这一行返回 401（= 已挂载）
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/dsh-pet/pet.js
```

**② 下载 App**

到 [Releases](https://github.com/Andersen216/dsh-whale-girl-live2d/releases) 下载
`DS-WhaleGirl-Pet-macOS-*.zip`，解压后把 **`DS 鲸鱼娘桌宠.app`** 拖进「应用程序」。

> 第一次打开若提示「无法验证开发者」：右键 → 打开（本仓库的 App 是本地编译 + 临时签名，
> 没有 Apple 开发者证书；也可以自己编译，见下面）。

**③ 打开**

双击即可。菜单栏会出现一个 **🐋** 图标 —— 那是她的控制入口：
重新加载 / 回到右下角 / **收起成贴边小球** / 展开 / 小球大小 / 低性能模式 / 保存截图 / 彻底退出。

---

## 自己编译（不想下载现成的 / 想改）

需要 **macOS 13+** 和 Xcode Command Line Tools（`xcode-select --install`），不依赖任何第三方库：

```bash
cd <插件目录>
bash tools/build-desktop-mac.sh          # 编译 + 安装到 ~/Applications（只留这一份）
bash tools/build-desktop-mac.sh --kill   # 关掉正在跑的桌宠
bash tools/build-desktop-mac.sh --uninstall
```

编译产物只有一个位置：**`~/Applications/DS 鲸鱼娘桌宠.app`**（刻意不在仓库里留第二份，
避免出现「两个 App 不知道点哪个」）。

代码在 [`desktop/macos/`](macos/)：`main.swift`（窗口/点击穿透/透明/键盘焦点）+ `ball.swift`（贴边悬浮球）。

---

## 它是怎么工作的（以及为什么必须装插件）

App 本身**不带模型**，它只是一个窗口，里面加载
`http://127.0.0.1:3080/dsh-pet/standalone` —— 也就是插件提供的那一页。
所以：

- **必须装了插件、且 DSH 在跑**，否则窗口是空的（App 每 5 秒会自动重试，DSH 起来她就出现）
- 所有功能（跟 agent 联动、说话、菜单、钱包）都还是插件在提供，两边永远一致
- 关闭 DSH 她就联系不上 agent 了（就像浏览器版一样）

### 两个只有桌面版需要知道的技术点

1. **本机通行证**：`/dsh-pet/*` 全部要过 DSH 的信任栅栏（认浏览器 cookie）。
   桌面壳是全新 WebView、一个 cookie 都没有，所以插件会生成一张随机通行证写在
   `~/.dsh/dsh-live2d-pet-desktop.json`（权限 600），壳子把它当 cookie 带上。
   只认「回环地址 + 令牌」，别的网页（CSRF）依然进不来。
2. **透明窗口**：`WKWebView` 关白底用的是私有键 `_setDrawsBackground:`（KVC 名 `drawsBackground`），
   另外要递归清掉内部 `NSScrollView` 的白底 —— 否则你会看到一个「大白框」。
   出问题看日志：`~/.dsh/whalegirlpet.log`（页面的 console、JS 报错、每 20 秒健康检查、
   透明量测都在里面；透明窗口「看不见」和「没启动」长得一样，只能靠这套日志区分）。
