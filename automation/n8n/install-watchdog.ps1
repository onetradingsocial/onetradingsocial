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

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$watchdog`""

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
