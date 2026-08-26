<#
.SYNOPSIS
  Registers (or re-registers) the Scheduled Task that keeps n8n running.

.DESCRIPTION
  Run once:
      powershell -ExecutionPolicy Bypass -File .\automation\n8n\install-watchdog.ps1

  Creates a task under your own account with three triggers:

    1. At logon              -- n8n comes back after a reboot or sign-out.
    2. Every 5 minutes       -- recovers from a crash, and from sleep (the first
                               tick after waking restarts it).
    3. Daily at 11:50, with  -- asks Windows to wake the machine just before the
       "wake to run"           12:00 posting window.

  Settings chosen deliberately:
    StartWhenAvailable      run a missed trigger as soon as possible
    AllowStartIfOnBatteries } without these, Windows silently refuses to run
    DontStopIfGoingOnBatteries } the task on an unplugged laptop
    MultipleInstances Ignore  never start a second copy while one is running

  Remove it again with:
      Unregister-ScheduledTask -TaskName "TradingSocial n8n watchdog" -Confirm:$false
#>

$ErrorActionPreference = 'Stop'

$taskName = 'TradingSocial n8n watchdog'
$here     = Split-Path -Parent $MyInvocation.MyCommand.Definition
$watchdog = Join-Path $here 'watchdog.ps1'

if (-not (Test-Path $watchdog)) { throw "Cannot find $watchdog" }

# Launched through conhost --headless so nothing flashes on screen.
#
# -WindowStyle Hidden alone is not enough. Task Scheduler creates the console
# host for an Interactive-logon task in the desktop session BEFORE powershell.exe
# starts, so the window is already up by the time the flag is read. With this
# task firing every 5 minutes and exiting in milliseconds whenever n8n is
# already listening, that showed as a window blinking open and shut all day.
#
# --headless gives the child a pseudoconsole with no visible window at all, and
# unlike the S4U principal noted below it needs no elevation to register.
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$action = New-ScheduledTaskAction -Execute $conhost `
    -Argument "--headless powershell.exe -ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$watchdog`""

$triggers = @()

# 1. At logon (this user only)
$triggers += New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# 2. Every 5 minutes, forever. Anchored in the past so it is active immediately.
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(-1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
$triggers += $repeat

# 3. Daily wake-up shortly before the posting window.
$wake = New-ScheduledTaskTrigger -Daily -At '11:50'
$triggers += $wake

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -WakeToRun

# Interactive keeps n8n tied to a signed-in session, which is what we want on a
# personal laptop -- there is no point serving localhost:5678 when nobody is
# here. The flashing window is solved by the conhost wrapper above, not here.
#
# To keep n8n alive while signed out, re-register with -LogonType S4U instead.
# That needs an ELEVATED PowerShell, and n8n then runs in session 0 where you
# cannot see it or stop it from your own desktop.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed the previous task." -ForegroundColor Yellow
}

Register-ScheduledTask -TaskName $taskName `
    -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
    -Description 'Starts n8n if it is not already listening on port 5678. Keeps the TradingSocial marketing auto-poster alive across sleep, crashes and reboots.' | Out-Null

Write-Host "Registered '$taskName'." -ForegroundColor Green
Get-ScheduledTask -TaskName $taskName |
    Select-Object TaskName, State |
    Format-Table -AutoSize

Write-Host "Triggers:"
(Get-ScheduledTask -TaskName $taskName).Triggers | ForEach-Object {
    "  - " + $_.CimClass.CimClassName + $(if ($_.StartBoundary) { " at $($_.StartBoundary)" })
}

Write-Host ""
Write-Host "WakeToRun only works from sleep, not hibernate or shutdown, and only if" -ForegroundColor DarkGray
Write-Host "wake timers are enabled in the active power plan. Check with:" -ForegroundColor DarkGray
Write-Host "  powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE" -ForegroundColor DarkGray
