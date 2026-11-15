# ============================================================
#  旭日东升 · Sunrise Launcher —— 一键构建脚本
#  用法：在仓库根目录右键「使用 PowerShell 运行」，或执行：
#        .\build.ps1              # 安装依赖 + 打 NSIS 安装版 + 便携版
#        .\build.ps1 -SkipInstall # 跳过 npm install（已装好时）
# ============================================================
[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "    $text" -ForegroundColor Green }
function Write-Warn2($text){ Write-Host "    $text" -ForegroundColor Yellow }
function Write-Fail($text) { Write-Host "    $text" -ForegroundColor Red }

Write-Host "================================================" -ForegroundColor DarkCyan
Write-Host "  旭日东升 · Sunrise Launcher 一键构建"          -ForegroundColor DarkCyan
Write-Host "================================================" -ForegroundColor DarkCyan

# ---------- 1. 检查 Node.js ----------
Write-Step "检查 Node.js 环境"
try {
    $nodeVersion = (node --version) 2>$null
    if (-not $nodeVersion) { throw 'node 不可用' }
    Write-Ok "Node.js $nodeVersion"
}
catch {
    Write-Fail "未检测到 Node.js，请先安装 Node.js 20 或更高版本：https://nodejs.org/"
    exit 1
}

# ---------- 2. 安装依赖 ----------
if ($SkipInstall -and (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Step "跳过依赖安装（-SkipInstall）"
}
else {
    Write-Step "安装依赖（首次运行需要下载 Electron，可能要几分钟）"
    if (-not (Test-Path (Join-Path $root 'node_modules'))) {
        npm install
        if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install 失败'; exit 1 }
    }
    else {
        # package-lock 变化时自动同步
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Write-Fail 'npm install 失败'; exit 1 }
    }
    Write-Ok "依赖就绪"
}

# ---------- 3. 打包 ----------
# v1.9.0 起默认同时打 NSIS 安装版与便携版（--x64）。
$targets = @('--win', 'nsis', 'portable', '--x64')

Write-Step "开始打包（electron-builder $targets）"
$builder = Join-Path $root 'node_modules\.bin\electron-builder.CMD'
if (Test-Path $builder) {
    & $builder @targets
}
else {
    npx electron-builder @targets
}
if ($LASTEXITCODE -ne 0) { Write-Fail '打包失败，请检查上方错误信息'; exit 1 }

# ---------- 4. 结果 ----------
$dist = Join-Path $root 'dist'
Write-Step "构建完成"
if (Test-Path $dist) {
    Get-ChildItem $dist -File | ForEach-Object {
        $sizeMB = [math]::Round($_.Length / 1MB, 1)
        Write-Ok ("{0}  ({1} MB)" -f $_.Name, $sizeMB)
    }
    Write-Host ""
    Write-Warn2 "安装包位置：$dist"
    Write-Warn2 "把 SunriseLauncher-x64.exe 拷到一体机上双击安装；便携版直接双击即可运行。"
}
else {
    Write-Warn2 "未找到 dist 目录，请检查输出。"
}

Write-Host ""
Write-Host "按回车键退出…" -ForegroundColor DarkGray
Read-Host | Out-Null
