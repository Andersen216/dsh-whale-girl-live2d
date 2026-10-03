#!/usr/bin/env bash
# DSH 网页版 · 一行命令部署
# ————————————————————————————————————————————————————————————
# 为什么写这个：DSH 的网页版要自己装 Node、装 CLI、起服务、再装插件，很多人不会。
# 这个脚本把这几步合成一条命令：
#
#   curl -fsSL https://raw.githubusercontent.com/Andersen216/dsh-whale-girl-live2d/main/tools/dsh-web-deploy.sh | bash
#
# 想要「连桌宠插件一起装好」：
#   ... | bash -s -- --with-pet
#
# 子命令：--doctor（只体检不起服务）｜stop（停止）｜status（看状态）
#
# 设计要点（来自实测）：
#  • 用 `npm exec` 免安装运行，不污染全局；已装 dsh 则复用
#  • 端口用 `--port 0` 让系统挑空闲端口（官方支持，比自己扫端口可靠）
#  • npm 缓存被 root 占用（EACCES）会真实发生 → 自动改用临时缓存重试
#  • 启动 URL 里带登录 token：只写进浏览器/剪贴板，**绝不**落盘到状态文件或日志
set -Eeuo pipefail

REPO="Andersen216/dsh-whale-girl-live2d"
ISSUE_URL="https://github.com/$REPO/issues"
PET_PLUGIN="github:$REPO"
STATE="$HOME/.dsh/.web-deploy.json"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
WITH_PET=0
ACTION="up"
LOG=""; PID=""

for a in "$@"; do
  case "$a" in
    --with-pet) WITH_PET=1 ;;
    --doctor)   ACTION="doctor" ;;
    stop)       ACTION="stop" ;;
    status)     ACTION="status" ;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
die()  { say "❌ $1"; [ -n "${2:-}" ] && say "   → 修复：$2"; exit "${3:-1}"; }

# ——— status / stop ————————————————————————————————————————————
if [ "$ACTION" = "status" ]; then
  [ -f "$STATE" ] || { say "还没有部署记录。运行一次部署即可。"; exit 0; }
  python3 - "$STATE" <<'PY' 2>/dev/null || cat "$STATE"
import json,sys,os
d=json.load(open(sys.argv[1])); pid=int(d.get('pid',0))
alive=False
try: os.kill(pid,0); alive=True
except Exception: pass
print(f"  端口: {d.get('port')}   进程: {pid}   {'✅ 正在运行' if alive else '⏹ 已停止'}   启动于: {d.get('started_at')}")
PY
  exit 0
fi
if [ "$ACTION" = "stop" ]; then
  [ -f "$STATE" ] || { say "没有部署记录。"; exit 0; }
  PID=$(python3 -c "import json,sys;print(json.load(open('$STATE')).get('pid',''))" 2>/dev/null || true)
  [ -n "$PID" ] && kill "$PID" 2>/dev/null && say "✅ 已停止 DSH 网页版（pid ${PID}）" || say "ℹ️  进程已经不在了"
  rm -f "$STATE"; exit 0
fi

# ——— ① 环境检查 ————————————————————————————————————————————————
DOCTOR_ONLY=$([ "$ACTION" = "doctor" ] && echo 1 || echo 0)
say "🐋 DSH 网页版 · 一键部署"
say ""

if ! command -v node >/dev/null 2>&1; then
  die "没找到 Node.js。" "去 https://nodejs.org 装 LTS（≥20）；macOS 也可以：brew install node" 10
fi
NODE_MAJ=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJ" -lt 20 ]; then
  die "Node 版本过低（当前 $(node -v)）。" "升级到 ≥20：https://nodejs.org" 10
fi
say "  ✓ Node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then die "没找到 npm（通常随 Node 一起装）。" "重装 Node LTS" 10; fi
say "  ✓ npm $(npm -v)"

# npm 缓存权限（实测会踩：root 拥有的 _cacache 会让一切 npm 命令 EACCES）
CACHE_OK=1
if [ -d "$HOME/.npm/_cacache" ] && [ ! -w "$HOME/.npm/_cacache" ]; then CACHE_OK=0; fi
if [ "$CACHE_OK" = 0 ]; then
  say "  ⚠️  npm 缓存目录权限有问题，本次会自动改用临时缓存"
  say "     想彻底修好：sudo chown -R \$(id -u):\$(id -g) ~/.npm"
  export npm_config_cache="$(mktemp -d)"
else
  say "  ✓ npm 缓存可写"
fi

if command -v dsh >/dev/null 2>&1; then
  say "  ✓ 已有 dsh $(dsh -V 2>/dev/null || echo '?')（会复用它）"
  RUN=(dsh)
else
  say "  ℹ️  未装 dsh —— 用 npm exec 免安装运行（首次约 60MB，走 registry.npmmirror.com 更快）"
  RUN=(npm exec --yes --registry=https://registry.npmmirror.com --package=@deepseek-ai/dsh@latest -- dsh)
fi

if [ "${DEEPSEEK_API_KEY:-}" = "" ] && [ ! -f "$DSH_HOME/.credentials.yaml" ] && [ ! -f "$DSH_HOME/.env" ] && [ ! -f "./.env" ]; then
  say "  ⚠️  没检测到 API Key —— 首次启动后需要你在网页里填一次"
  say "     想零交互：DEEPSEEK_API_KEY=sk-xxx bash 本脚本"
else
  say "  ✓ 检测到 API Key"
fi
say ""

if [ "$DOCTOR_ONLY" = 1 ]; then
  say "体检完毕：环境没问题，可以直接运行部署。"
  command -v pnpm >/dev/null 2>&1 || say "  ℹ️  没装 pnpm —— 只有装插件时才需要（--with-pet）；装法：npm i -g pnpm"
  exit 0
fi

# ——— ② 起服务（--port 0 = 系统挑空闲端口，官方支持）———————————————
PORT="${DSH_WEB_PORT:-0}"
LOG="$(mktemp -t dsh-web-log)"
say "  正在启动 DSH 网页版（端口：$([ "$PORT" = 0 ] && echo '自动选择' || echo "$PORT")）…"

start_server() {
  "${RUN[@]}" web --port "$PORT" --no-open >"$LOG" 2>&1 &
  PID=$!
}
start_server

URL=""
for _ in $(seq 1 90); do
  URL=$(grep -oE 'http://[0-9.]+:[0-9]+/\?token=[A-Za-z0-9_-]+' "$LOG" 2>/dev/null | head -1 || true)
  [ -n "$URL" ] && break
  if ! kill -0 "$PID" 2>/dev/null; then
    if grep -q 'EACCES.*_cacache' "$LOG" 2>/dev/null; then
      say "  ⚠️  命中 npm 缓存权限问题 —— 改用临时缓存重试…"
      export npm_config_cache="$(mktemp -d)"
      start_server
    else
      say "❌ 启动失败。原始日志（最后 20 行）："
      tail -20 "$LOG" | sed 's/^/     /'
      die "请把上面这段发到 $ISSUE_URL" "" 20
    fi
  fi
  sleep 1
done
[ -n "$URL" ] || { say "❌ 90 秒内没起来（网络慢？）。日志："; tail -20 "$LOG" | sed 's/^/     /'; exit 21; }

REAL_PORT=$(printf '%s' "$URL" | sed -E 's#.*:([0-9]+)/.*#\1#')
mkdir -p "$DSH_HOME"
printf '{"pid":%s,"port":"%s","started_at":"%s"}\n' "$PID" "$REAL_PORT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE"

# ——— ③ 桌宠插件（可选）————————————————————————————————————————
if [ "$WITH_PET" = 1 ]; then
  if command -v pnpm >/dev/null 2>&1; then
    say "  正在安装桌宠插件…"
    if "${RUN[@]}" plugin --profile web add "$PET_PLUGIN" >>"$LOG" 2>&1; then
      say "  ✓ 桌宠插件已装（下一步：刷新页面她就在右下角）"
    else
      say "  ⚠️  插件没装上，稍后可以手动：dsh plugin --profile web add $PET_PLUGIN"
    fi
  else
    say "  ⚠️  没装 pnpm，跳过插件安装。装好 pnpm 后执行："
    say "     npm i -g pnpm && dsh plugin --profile web add $PET_PLUGIN"
  fi
fi

# ——— ④ 打开浏览器（token 只在内存里传递，不落盘）———————————————
say ""
say "✅ DSH 网页版已启动"
say "   端口：$REAL_PORT"
say "   完整链接（含登录 token，请勿外发）：$URL"
say "   状态文件：${STATE}（不含 token）"
say ""
say "   停止：bash $0 stop     查看状态：bash $0 status"
if [ "${DSH_NO_OPEN:-}" != "1" ]; then
  if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
fi
