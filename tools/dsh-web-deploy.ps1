# DSH 网页版 · 一键部署（Windows / PowerShell）
# ⚠️ 说明：作者手上没有 Windows 机器，这个脚本按通用 PowerShell + npm 行为写成，**尚未在真机验证**。
#    有问题请开 issue：https://github.com/Andersen216/dsh-whale-girl-live2d/issues
# 用法（在 PowerShell 里）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-deploy.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\dsh-web-deploy.ps1 -WithPet
param([switch]$WithPet, [switch]$Doctor, [int]$Port = 0)

$ErrorActionPreference = 'Stop'
$Repo = 'Andersen216/dsh-whale-girl-live2d'
$IssueUrl = "https://github.com/$Repo/issues"
$State = Join-Path $env:USERPROFILE '.dsh\.web-deploy.json'

function Say($m) { Write-Host $m }

# ① 环境
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Say "❌ 没找到 Node.js。请到 https://nodejs.org 装 LTS（≥20）"; exit 10 }
$maj = [int](& node -p "process.versions.node.split('.')[0]")
if ($maj -lt 20) { Say "❌ Node 版本过低（当前 $(& node -v)）。需要 ≥20：https://nodejs.org"; exit 10 }
Say "  ✓ Node $(& node -v)"

# ② 复用已装的 dsh，否则用 npm exec 免安装运行
#    注意：Windows 全局 bin 在 %APPDATA%\npm，新装的可能还不在当前 PATH 里
$dshCmd = (Get-Command dsh -ErrorAction SilentlyContinue)
$globalDsh = Join-Path $env:APPDATA 'npm\dsh.cmd'
if ($dshCmd) { $run = @('dsh'); Say "  ✓ 已有 dsh（复用）" }
elseif (Test-Path $globalDsh) { $run = @($globalDsh); Say "  ✓ 找到全局 dsh（%APPDATA%\npm）" }
else { $run = @('npm', 'exec', '--yes', '--registry=https://registry.npmmirror.com', '--package=@deepseek-ai/dsh@latest', '--', 'dsh'); Say "  ℹ️  未装 dsh —— 将用 npm exec 免安装运行（首次约 60MB）" }

if ($Doctor) {
  Say "`n体检完毕：环境没问题。"
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Say "  ℹ️  没装 pnpm —— 只有装插件（-WithPet）才需要：npm i -g pnpm" }
  exit 0
}

# ③ 启动（--port 0 = 让系统挑空闲端口，官方支持）
$log = Join-Path $env:TEMP ("dsh-web-" + [guid]::NewGuid().ToString('N') + ".log")
Say "  正在启动 DSH 网页版（端口：$(if ($Port -eq 0) {'自动选择'} else {$Port})）…"
$args = @('web', '--port', "$Port", '--no-open')
$p = Start-Process -FilePath $run[0] -ArgumentList ($run[1..($run.Count-1)] + $args) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -NoNewWindow

$url = $null
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'http://[0-9.]+:[0-9]+/\?token=[A-Za-z0-9_-]+' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
  if ($p.HasExited) {
    Say "❌ 启动失败（退出码 $($p.ExitCode)）。日志："
    if (Test-Path $log)   { Get-Content $log -Tail 20 | ForEach-Object { Say "     $_" } }
    if (Test-Path "$log.err") { Get-Content "$log.err" -Tail 10 | ForEach-Object { Say "     $_" } }
    Say "   把上面这段发到 $IssueUrl"
    exit 20
  }
}
if (-not $url) {
  Say "❌ 90 秒内没起来。日志："
  if (Test-Path $log) { Get-Content $log -Tail 20 | ForEach-Object { Say "     $_" } }
  exit 21
}

$realPort = ([regex]::Match($url, ':(\d+)/')).Groups[1].Value
New-Item -ItemType Directory -Force -Path (Split-Path $State) | Out-Null
@{ pid = $p.Id; port = $realPort; started_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } |
  ConvertTo-Json -Compress | Set-Content -Encoding UTF8 $State

# ④ 可选：装桌宠插件
if ($WithPet) {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Say "  正在安装桌宠插件…"
    & $run[0] @($run[1..($run.Count-1)]) plugin --profile web add "github:$Repo" 2>&1 | ForEach-Object { Say "     $_" }
  } else {
    Say "  ⚠️  没装 pnpm，跳过插件。装好 pnpm 后执行：npm i -g pnpm; dsh plugin --profile web add github:$Repo"
  }
}

Say ""
Say "✅ DSH 网页版已启动"
Say "   端口：$realPort"
Say "   完整链接（含登录 token，请勿外发）：$url"
Say "   状态文件：$State（不含 token）"
Say "   停止：Stop-Process -Id $($p.Id)"
Start-Process $url
