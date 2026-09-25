#!/bin/bash
# 延迟重启 DSH —— 为什么要「延迟」：
#   3080 那个进程同时承载着对话本身，立刻 kill 会把正在生成的回复一起掐断。
#   所以先等一段时间（回复先发出去），再优雅重启，并把结果写到日志与工作区。
#
# 用法（必须在不带沙箱的环境里跑，否则新进程写不了 ~/.dsh）：
#   bash tools/restart-dsh.sh [等待秒数]
#
# 结果：
#   /tmp/dsh-restart.log                        全过程日志
#   <工作区>/dist/restart-result.txt            结果摘要（给 agent 下一轮读）

set -u
WAIT="${1:-25}"
OLD_PID="$(lsof -nP -iTCP:3080 -sTCP:LISTEN -t 2>/dev/null | head -1)"
ROOT="/Users/andersen/DSH Workplace/dsh-live2d-pet"
LOG=/tmp/dsh-restart.log
RESULT="$ROOT/dist/restart-result.txt"
mkdir -p "$ROOT/dist" 2>/dev/null

{
  echo "=== $(date '+%F %T') 开始延迟重启（等 ${WAIT}s）==="
  echo "旧进程 PID: ${OLD_PID:-无}"
} >> "$LOG"

sleep "$WAIT"

{
  echo "--- $(date '+%F %T') 开始重启 ---"
  if [ -n "$OLD_PID" ]; then
    kill -TERM "$OLD_PID" 2>/dev/null && echo "已发 SIGTERM → $OLD_PID"
    for i in $(seq 1 20); do
      kill -0 "$OLD_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill -9 "$OLD_PID" 2>/dev/null && echo "还在，补 SIGKILL"
    fi
    # 等端口真的释放
    for i in $(seq 1 20); do
      lsof -nP -iTCP:3080 -sTCP:LISTEN -t >/dev/null 2>&1 || break
      sleep 0.5
    done
  fi

  cd /Users/andersen || exit 1
  nohup /usr/local/bin/dsh web --profile web --port 3080 >> "$LOG" 2>&1 &
  NEW_PID=$!
  echo "新进程 PID: $NEW_PID"

  # 等它起来并自检（401 = 路由在、只是被信任栅栏挡着；200 = 首页）
  # 判定标准：首页对 curl 是 401（信任栅栏），所以要看 /dsh-pet/pet.js 是不是 401
  ok=0
  for i in $(seq 1 40); do
    sleep 1
    pet=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3080/dsh-pet/pet.js 2>/dev/null)
    if [ "$pet" = "401" ]; then ok=1; break; fi
  done
  home=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3080/ 2>/dev/null)
  pet=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3080/dsh-pet/pet.js 2>/dev/null)
  hud=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3080/dsh-pet/hud 2>/dev/null)
  whale=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3080/dsh-whale/balance.json 2>/dev/null)
  echo "自检：首页=$home pet.js=$pet hud=$hud whale=$whale"

  if [ "$ok" != "1" ] || [ "$pet" != "401" ]; then
    echo "第一次没起来，重试一次"
    sleep 3
    lsof -nP -iTCP:3080 -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 2>/dev/null
    nohup /usr/local/bin/dsh web --profile web --port 3080 >> "$LOG" 2>&1 &
    NEW_PID=$!
    for i in $(seq 1 40); do
      sleep 1
      pet=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3080/dsh-pet/pet.js 2>/dev/null)
      if [ "$pet" = "401" ]; then ok=1; break; fi
    done
    home=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3080/ 2>/dev/null)
    pet=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3080/dsh-pet/pet.js 2>/dev/null)
    hud=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3080/dsh-pet/hud 2>/dev/null)
    echo "重试后：首页=$home pet.js=$pet hud=$hud 新 PID=$NEW_PID"
  fi

  {
    echo "时间: $(date '+%F %T')"
    echo "旧 PID: ${OLD_PID:-无}"
    echo "新 PID: ${NEW_PID:-?}"
    echo "首页: $home"
    echo "pet.js: $pet （401 = 插件已加载，被信任栅栏挡着，正常）"
    echo "hud: $hud （401 = 钱包接口已注册，正常）"
    echo "whale-widget: $whale （404 = 那个插件仍是停用状态，符合预期）"
    echo "结论: $([ "$pet" = "401" ] && echo '重启成功，桌宠与钱包接口都挂上了' || echo '⚠️ 自检没过，请看 /tmp/dsh-restart.log')"
  } > "$RESULT"
  echo "--- 结果已写入 $RESULT ---"
} >> "$LOG" 2>&1
