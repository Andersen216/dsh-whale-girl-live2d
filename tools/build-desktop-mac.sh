#!/bin/bash
# 编译 / 打包 macOS 原生桌宠壳（方案 A）
#
#   bash tools/build-desktop-mac.sh            # 编译 → dist/desktop/DS 鲸鱼娘桌宠.app
#   bash tools/build-desktop-mac.sh --run      # 编译完直接打开
#   bash tools/build-desktop-mac.sh --kill     # 关掉正在跑的桌宠
#
# 只依赖系统自带的 Swift（Xcode Command Line Tools），不需要 Xcode、不需要 npm 装东西。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/desktop/macos/main.swift"
PLIST="$ROOT/desktop/macos/Info.plist"
# 只装一个地方：「应用程序」。以前 dist/desktop 里还留一份，结果主人有两个 App
# 不知道点哪个 —— 现在构建先写临时目录，最后只往 ~/Applications 放一份。
APP_NAME="DS 鲸鱼娘桌宠.app"
APP="$HOME/Applications/$APP_NAME"
TMP_APP="$ROOT/.build/$APP_NAME"
BIN="WhaleGirlPet"
BUNDLE_ID="com.andersen216.dsh.whalegirlpet"

if [ "${1:-}" = "--kill" ]; then
  pkill -f "$BIN" 2>/dev/null && echo "已关掉桌宠" || echo "桌宠没在跑"
  exit 0
fi

echo "① 准备 App 骨架（先建在临时目录）"
rm -rf "$TMP_APP"
mkdir -p "$TMP_APP/Contents/MacOS" "$TMP_APP/Contents/Resources"
cp "$PLIST" "$TMP_APP/Contents/Info.plist"
printf 'APPL????' > "$TMP_APP/Contents/PkgInfo"

echo "② 编译（swiftc，只有系统框架）"
swiftc -O -swift-version 5 \
  -target "$(uname -m)-apple-macos13.0" \
  -framework Cocoa -framework WebKit \
  -o "$TMP_APP/Contents/MacOS/$BIN" "$SRC" "$ROOT/desktop/macos/ball.swift"

echo "③ 图标（蓝底圆角框 + 她的平常脸立绘）"
ICON="$ROOT/desktop/icon-source.png"          # 从她的实拍里裁的 Q 版正脸
[ -f "$ICON" ] || ICON="$ROOT/assets/model/icon.png"
if [ -f "$ICON" ] && command -v swiftc >/dev/null; then
  TMPICON="$(mktemp -d)"
  if swiftc -O -o "$TMPICON/mkicon" "$ROOT/tools/make-appicon.swift" 2>/dev/null; then
    "$TMPICON/mkicon" "$ICON" "$TMPICON" >/dev/null 2>&1
    if iconutil -c icns "$TMPICON/icon.iconset" -o "$TMP_APP/Contents/Resources/icon.icns" 2>/dev/null; then
      echo "   ✓ 图标已生成"
    else
      echo "   · iconutil 失败，用默认图标"
    fi
  else
    echo "   · 图标工具编译失败，用默认图标"
  fi
  rm -rf "$TMPICON"
fi

echo "④ 临时签名（本机自己编译的，不需要开发者证书）"
codesign --force --sign - --identifier "$BUNDLE_ID" "$TMP_APP" 2>/dev/null \
  && echo "   ✓ 已签名" || echo "   · 跳过签名"

echo "⑤ 安装到「应用程序」（只保留这一份）"
mkdir -p "$HOME/Applications"
pkill -f "$BIN" 2>/dev/null || true
sleep 0.4
rm -rf "$APP"
cp -R "$TMP_APP" "$APP"
rm -rf "$TMP_APP" "$ROOT/dist/desktop"      # 不留第二份，免得主人不知道点哪个
rmdir "$ROOT/.build" 2>/dev/null || true

echo
echo "完成：$APP"
du -sh "$APP" | awk '{print "体积：" $1}'
echo "（只有这一份。启动台/聚焦搜「鲸鱼娘」双击即可打开）"

if [ "${1:-}" = "--run" ] || [ "${1:-}" = "" ]; then
  pkill -f "$BIN" 2>/dev/null || true
  sleep 0.4
  open "$APP" && echo "已启动"
fi
if [ "${1:-}" = "--uninstall" ]; then
  pkill -f "$BIN" 2>/dev/null || true
  rm -rf "$APP" && echo "已卸载"
fi
