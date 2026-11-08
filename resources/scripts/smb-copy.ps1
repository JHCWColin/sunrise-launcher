param()

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$nasHost   = $env:SUNRISE_NAS_HOST
$user      = $env:SUNRISE_NAS_USER
$pass      = $env:SUNRISE_NAS_PASS
$remote    = $env:SUNRISE_REMOTE_PATH
$destPart  = $env:SUNRISE_DEST_PART
$shareRoot = $env:SUNRISE_SHARE_ROOT

$created = $false
try {
    if (-not $nasHost -or -not $remote -or -not $destPart -or -not $shareRoot) {
        throw 'SMB 参数不完整'
    }

    $existing = Get-SmbMapping -RemotePath $shareRoot -ErrorAction SilentlyContinue
    if (-not $existing) {
        New-SmbMapping -RemotePath $shareRoot -UserName $user -Password $pass -Persistent $false -ErrorAction Stop | Out-Null
        $created = $true
    }

    if (-not (Test-Path -LiteralPath $remote)) {
        throw "共享盘上找不到文件：$remote"
    }

    $item = Get-Item -LiteralPath $remote -ErrorAction Stop
    Write-Output "SIZE $($item.Length)"

    $dir = Split-Path -Parent $destPart
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    Copy-Item -LiteralPath $remote -Destination $destPart -Force -ErrorAction Stop

    $copied = Get-Item -LiteralPath $destPart -ErrorAction Stop
    if ($copied.Length -ne $item.Length) {
        throw "文件大小校验失败（期望 $($item.Length)，实际 $($copied.Length)）"
    }

    Write-Output 'OK'
    exit 0
} catch {
    Write-Output "ERR $($_.Exception.Message)"
    exit 1
} finally {
    if ($created) {
        Remove-SmbMapping -RemotePath $shareRoot -Force -ErrorAction SilentlyContinue
    }
}
