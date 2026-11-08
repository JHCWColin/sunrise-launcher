param(
  [string]$Out = 'docs\tmp\printwindow.png'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SunrisePrintWindow {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
[SunrisePrintWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '旭日东升' } | Select-Object -First 1
if (-not $p) { throw 'Sunrise window not found' }
$hwnd = $p.MainWindowHandle
$r = New-Object SunrisePrintWindow+RECT
[SunrisePrintWindow]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$width = $r.Right - $r.Left
$height = $r.Bottom - $r.Top
if ($width -le 0 -or $height -le 0) { throw 'Invalid window rect' }
$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [SunrisePrintWindow]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$full = Join-Path (Get-Location) $Out
$dir = Split-Path -Parent $full
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $full ($width x $height) ok=$ok"
