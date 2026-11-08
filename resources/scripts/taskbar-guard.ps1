param(
  [int]$ParentPid = 0,
  [string]$StopFile = '',
  [string]$LogFile = '',
  [switch]$Restore
)

function Write-GuardLog([string]$Message) {
    if (-not $LogFile) { return }
    try {
        Add-Content -LiteralPath $LogFile -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss.fff'), $Message) -ErrorAction SilentlyContinue
    } catch {}
}

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$signature = @'
using System;
using System.Runtime.InteropServices;

public static class SunriseTaskbar {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    public static IntPtr[] GetBars() {
        System.Collections.Generic.List<IntPtr> list = new System.Collections.Generic.List<IntPtr>();
        IntPtr main = FindWindow("Shell_TrayWnd", null);
        if (main != IntPtr.Zero) list.Add(main);
        IntPtr child = IntPtr.Zero;
        while (true) {
            child = FindWindowEx(IntPtr.Zero, child, "Shell_SecondaryTrayWnd", null);
            if (child == IntPtr.Zero) break;
            list.Add(child);
        }
        return list.ToArray();
    }
}
'@

try { Add-Type -TypeDefinition $signature -ErrorAction Stop } catch {}

function Hide-Taskbars {
    foreach ($bar in [SunriseTaskbar]::GetBars()) {
        if ([SunriseTaskbar]::IsWindowVisible($bar)) {
            [void][SunriseTaskbar]::ShowWindow($bar, 0)
        }
    }
}

function Show-Taskbars {
    foreach ($bar in [SunriseTaskbar]::GetBars()) {
        [void][SunriseTaskbar]::ShowWindow($bar, 5)
    }
}

if ($Restore) {
    Show-Taskbars
    Write-Output 'RESTORED'
    exit 0
}

Write-GuardLog "start parent=$ParentPid stop=$StopFile"
$announced = $false
try {
    while ($true) {
        if ($StopFile -and (Test-Path -LiteralPath $StopFile)) {
            Write-GuardLog 'stop-file detected'
            break
        }
        if ($ParentPid -gt 0) {
            $parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
            if (-not $parent) {
                Write-GuardLog 'parent process not found'
                break
            }
        }
        Hide-Taskbars
        if (-not $announced) {
            $announced = $true
            Write-GuardLog 'hidden'
            Write-Output 'HIDDEN'
        }
        Start-Sleep -Milliseconds 700
    }
} catch {
    Write-GuardLog "error: $($_.Exception.Message)"
} finally {
    Show-Taskbars
    Write-GuardLog 'restored'
    Write-Output 'RESTORED'
}
