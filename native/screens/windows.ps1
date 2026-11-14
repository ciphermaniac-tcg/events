# Installs the Windows app from its NSIS installer and screenshots it in light
# and dark: the first seconds of a cold launch, home, sign-in and an event
# page. The menus stay shut: on a hosted runner neither injected clicks,
# posted keys nor UI Automation opened them. Each page is its own launch, opened on that page through the
# app's last-page file (src-tauri/src/last_page.rs), whose rewrite on each
# page load also times the launch. Writes windows-<theme>-<step>.png (the
# window) and windows-<theme>-<step>-screen.png (the whole screen) plus
# timings.txt.
# Usage: windows.ps1 -Installer <setup.exe> -Out <dir>; EVENT_CODE names the event page.
param(
  [Parameter(Mandatory)] [string] $Installer,
  [Parameter(Mandatory)] [string] $Out
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
  public static bool IsCloaked(IntPtr hWnd) {
    int cloaked;
    return DwmGetWindowAttribute(hWnd, 14, out cloaked, 4) == 0 && cloaked != 0;
  }
}
'@
[void][Win]::SetProcessDPIAware()

$eventCode = if ($env:EVENT_CODE) { $env:EVENT_CODE } else { 'ZZZZZZ' }
$site = 'https://events.ciphermaniac.com'
$data = Join-Path $env:APPDATA 'com.ciphermaniac.events'
$webData = Join-Path $env:LOCALAPPDATA 'com.ciphermaniac.events'
$lastPage = Join-Path $data 'last-page'
$stale = [datetime]'2000-01-01'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$timings = Join-Path $Out 'timings.txt'
Set-Content -Path $timings -Value ''

function Write-Timing([string] $line) {
  Write-Host $line
  Add-Content -Path $timings -Value $line
}

function Install-App {
  Start-Process -FilePath $Installer -ArgumentList '/S' -Wait
  $dir = Join-Path $env:LOCALAPPDATA 'Ciphermaniac Events'
  $script:exe = Get-ChildItem -Path $dir -Filter '*.exe' |
    Where-Object { $_.Name -notlike 'uninstall*' } |
    Select-Object -First 1 -ExpandProperty FullName
  Write-Host "installed: $script:exe"
}

function Set-Theme([string] $theme) {
  $light = [int]($theme -eq 'light')
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
  New-Item -Path $key -Force -ErrorAction SilentlyContinue | Out-Null
  Set-ItemProperty -Path $key -Name AppsUseLightTheme -Value $light -Type DWord
  Set-ItemProperty -Path $key -Name SystemUsesLightTheme -Value $light -Type DWord
  $script:theme = $theme
}

# Opens the next launch on $path, or on home with no saved state at all.
function Open-On([string] $path) {
  if (-not $path) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path $data, $webData
    return
  }
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  Set-Content -Path $lastPage -Value "$site$path" -NoNewline
  (Get-Item $lastPage).LastWriteTime = $stale
}

function Test-PageLoaded {
  (Test-Path $lastPage) -and (Get-Item $lastPage).LastWriteTime -gt $stale.AddDays(1)
}

# The app's main window once it shows; before that the process's main window
# is a 16 px helper at the screen's corner.
function Get-Window {
  $script:process.Refresh()
  $handle = $script:process.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero -or -not [Win]::IsWindowVisible($handle) -or [Win]::IsCloaked($handle)) {
    return [IntPtr]::Zero
  }
  if ((Get-Frame $handle).Width -lt 100) { return [IntPtr]::Zero }
  return $handle
}

function Save-Area([System.Drawing.Rectangle] $area, [string] $name) {
  $bitmap = New-Object System.Drawing.Bitmap $area.Width, $area.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($area.Location, [System.Drawing.Point]::Empty, $area.Size)
  $bitmap.Save((Join-Path $Out "windows-$script:theme-$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Save-Screen([string] $name) {
  Save-Area ([System.Windows.Forms.SystemInformation]::VirtualScreen) $name
}

# The window's visible frame, without the invisible resize border.
function Get-Frame([IntPtr] $handle) {
  $rect = New-Object Win+RECT
  [void][Win]::DwmGetWindowAttribute($handle, 9, [ref] $rect, 16)
  [System.Drawing.Rectangle]::FromLTRB($rect.Left, $rect.Top, $rect.Right, $rect.Bottom)
}

function Save-Shot([string] $name) {
  Save-Screen "$name-screen"
  $handle = Get-Window
  if ($handle -eq [IntPtr]::Zero) {
    Write-Host "no window on screen for $name"
    return
  }
  Save-Area (Get-Frame $handle) $name
}

function Start-App {
  $script:clock = [Diagnostics.Stopwatch]::StartNew()
  $script:process = Start-Process -FilePath $script:exe -PassThru
}

function Stop-App {
  Stop-Process -Id $script:process.Id -Force -ErrorAction SilentlyContinue
  $script:process.WaitForExit(10000) | Out-Null
  Start-Sleep -Seconds 1
}

# Screenshots the screen about 300 ms, 1 s and 2 s after launch.
function Save-Cold {
  foreach ($at in 300, 1000, 2000) {
    while ($script:clock.ElapsedMilliseconds -lt $at) { Start-Sleep -Milliseconds 20 }
    Save-Screen ('cold-{0:d4}ms' -f $at)
    $handle = Get-Window
    $frame = if ($handle -ne [IntPtr]::Zero) { Get-Frame $handle } else { 'none' }
    Write-Timing "$script:theme cold $at ms shot taken at $($script:clock.ElapsedMilliseconds) ms, visible window: $frame"
  }
}

# Waits for the window to show and the page to load, noting how long each took.
function Wait-Load([string] $step) {
  $shown = $null
  $loaded = $null
  while ($script:clock.ElapsedMilliseconds -lt 30000 -and ($null -eq $shown -or $null -eq $loaded)) {
    if ($null -eq $shown -and (Get-Window) -ne [IntPtr]::Zero) { $shown = $script:clock.ElapsedMilliseconds }
    if ($null -eq $loaded -and (Test-PageLoaded)) { $loaded = $script:clock.ElapsedMilliseconds }
    Start-Sleep -Milliseconds 50
  }
  Write-Timing "$script:theme ${step}: launch to window $(if ($shown) { $shown } else { 'never' }) ms, to page load $(if ($loaded) { $loaded } else { 'never' }) ms"
  Start-Sleep -Seconds 2
}

function Invoke-Theme([string] $theme) {
  Set-Theme $theme
  Open-On ''
  Start-App
  Save-Cold
  Wait-Load 'home'
  Save-Shot 'home'
  Stop-App
  Open-On '/sign-in'
  Start-App
  Wait-Load 'sign-in'
  Save-Shot 'sign-in'
  Stop-App
  Open-On "/t/$eventCode"
  Start-App
  Wait-Load 'event'
  Save-Shot 'event'
  Stop-App
}

try {
  Set-DisplayResolution -Width 1920 -Height 1080 -Force
} catch {
  Write-Host "could not set the resolution: $_"
}
Write-Timing "screen: $([System.Windows.Forms.SystemInformation]::VirtualScreen)"
Install-App
Invoke-Theme 'light'
Invoke-Theme 'dark'
