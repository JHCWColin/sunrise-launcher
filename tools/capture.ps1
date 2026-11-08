param(
  [string]$Out = 'docs\tmp\capture.png',
  [int]$PosX = 40,
  [int]$PosY = 40,
  [int]$WinWidth = 1440,
  [int]$WinHeight = 900,
  [switch]$NoMove
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SunriseCapture {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

[SunriseCapture]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
[SunriseCapture]::SetProcessDPIAware() | Out-Null

$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '旭日东升' } | Select-Object -First 1
if (-not $p) { throw 'Sunrise window not found' }
$hwnd = $p.MainWindowHandle

if (-not $NoMove) {
  [SunriseCapture]::SetWindowPos($hwnd, [IntPtr]::Zero, $PosX, $PosY, $WinWidth, $WinHeight, 0x0040) | Out-Null
}
[SunriseCapture]::ShowWindow($hwnd, 9) | Out-Null
[SunriseCapture]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 350

$r = New-Object SunriseCapture+RECT
[SunriseCapture]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$width = $r.Right - $r.Left
$height = $r.Bottom - $r.Top
if ($width -le 0 -or $height -le 0) { throw 'Invalid window rect' }

$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
$full = Join-Path (Get-Location) $Out
$dir = Split-Path -Parent $full
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $full ($width x $height)"
