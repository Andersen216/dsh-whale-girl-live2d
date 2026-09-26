#!/bin/bash
# 小红书发布助手 —— 把文案按段落送到剪贴板，你只管粘贴
#
#   bash tools/xhs-copy.sh 步骤        # 打印发布步骤（第一次看这个）
#   bash tools/xhs-copy.sh 标题        # 标题 → 剪贴板
#   bash tools/xhs-copy.sh 正文        # 正文 → 剪贴板
#   bash tools/xhs-copy.sh 标签        # 标签 → 剪贴板
#   bash tools/xhs-copy.sh 评论        # 置顶评论（含下载链接）→ 剪贴板
#   bash tools/xhs-copy.sh 图片        # 打开配图文件夹
#
# 说明：这只是本机剪贴板操作，不碰小红书任何接口 —— 发布动作由你在 App/网页里完成。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMGDIR="$ROOT/dist/xhs-post"

TITLE='我给 DeepSeek 做了个鲸鱼娘桌宠'

BODY='在 DeepSeek 的网页界面右下角养了只鲸鱼娘。

一开始就想做个"活的"——不是一张 PNG 挂个气泡，是真的 Live2D：
44 个表情、8 个动作、有物理摆动、眼珠会跟着鼠标走。

最关键的是她真的在看我干活：
· 我在思考，她低头翻本子
· 我读文件，她戴上眼镜凑过来
· 我上网查东西，她把笔换成手机
· 我写代码，她奋笔疾书
· 工具报错，她脸黑一下（很短，不闹）
· 一轮干完，她伸懒腰比耶，还弹个"这轮花了多少钱"

做的过程中最上瘾的是"分寸"这件事：
她不能一直冒气泡刷屏，不能我一戳就生气，不能动作叠在一起变成面瘫。
所以写了个调度器——同一时刻只允许一张脸 + 一个动作，
闲着的时候她自己找点小事做（换视线、发句呆话），但绝不打扰我。

后来有朋友说"能不能不在浏览器里"，就做了 Mac 桌面版：
一个透明窗口贴在你桌面上，她真的在你的桌面上待着，
鼠标压在她身上才收点击，其它地方点一下就穿过去，不挡你干活。
关掉浏览器她也在；收起还能变成贴边的小圆球。

免费、开源、非商业。Mac 和 Windows 都能用（桌面版目前只有 Mac）。
下载和安装写在评论区置顶了。

模型来自 B 站 @氵六青，角色形象 @上善无形 / @ZipZipPipe，在此致谢。'

TAGS='#DeepSeek #DSH #桌宠 #Live2D #鲸鱼娘 #开源 #桌面宠物 #程序员日常 #AI编程'

COMMENT='下载 & 安装（免费开源，非商业）：

网页版（Windows/Mac 都能用）：
dsh plugin --profile web add github:Andersen216/dsh-whale-girl-live2d

Mac 桌面版（把她放到桌面上）：
https://github.com/Andersen216/dsh-whale-girl-live2d/releases/latest
下载那个 DS-WhaleGirl-Pet-macOS 的 zip，解压把 App 拖进「应用程序」就行。

一页说清楚两种用法（含完整步骤）：
https://andersen216.github.io/dsh-whale-girl-live2d/

装完要重启一次 DSH 她才出现；不出现就看那一页的「出问题怎么查」。'

put() { printf '%s' "$2" | pbcopy; echo "✅ 已复制到剪贴板：$1（${#2} 字）"; }

case "${1:-步骤}" in
  标题) put "标题" "$TITLE" ;;
  正文) put "正文" "$BODY" ;;
  标签) put "标签" "$TAGS" ;;
  评论) put "置顶评论" "$COMMENT" ;;
  图片) open "$IMGDIR" && echo "已打开配图文件夹：$IMGDIR" ;;
  步骤|*)
    cat <<'STEPS'
════════════════════════════════════════════════════════════
 小红书发布：5 步，约 2 分钟
════════════════════════════════════════════════════════════

【0】先截一张"桌面版实拍"（这张最关键，证明她不在浏览器里）
     · 打开桌面版 App（启动台搜「鲸鱼娘」）
     · 把别的窗口拉到旁边一起入镜
     · 按 Cmd + Shift + 4 框选截图 → 存进 dist/xhs-post/6-桌面版实拍.png

【1】打开小红书 → 右上角「+」→ 选「上传图文」
     配图按这个顺序选（在 dist/xhs-post/ 里，已按 1~6 命名好）：
       1-封面-平常状态.png     ← 封面
       2-戴眼镜看资料.png
       3-右键菜单四页.png
       4-钱包HUD.png
       5-收工庆祝.png
       6-桌面版实拍.png        ← 你自己截的那张

【2】粘贴标题：      bash tools/xhs-copy.sh 标题
【3】粘贴正文+标签： bash tools/xhs-copy.sh 正文
                     bash tools/xhs-copy.sh 标签   （粘到正文最后）
     封面图上可以加两行字：「她不是贴图 / 她在看我干活」

【4】点发布 → 发完后立刻自己发一条评论并【置顶】：
       bash tools/xhs-copy.sh 评论

【5】有人问"怎么装" → 让他看置顶评论；有人问"收费吗" → 回「完全免费，
      模型是原作者免费分享的，非商业」；有人问模型出处 → 回「B 站 @氵六青」

⚠️ 两个坑：
   · 正文里不要放链接（平台会限流），链接一律放置在顶评论
   · 一定要写署名（@氵六青 / @上善无形 / @ZipZipPipe）—— 这是授权条件

发布助手：bash tools/xhs-copy.sh 标题|正文|标签|评论|图片
════════════════════════════════════════════════════════════
STEPS
    ;;
esac
