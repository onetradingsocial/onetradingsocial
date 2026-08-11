<#
.SYNOPSIS
  Starts n8n if it isn't already listening. Safe to run every few minutes.

.DESCRIPTION
  Registered as a Scheduled Task by install-watchdog.ps1. Three triggers:
  at logon, every 5 minutes, and once before the posting window with the
  machine allowed to wake for it.

  Exits immediately if n8n is already up, so repeated runs are cheap and
  cannot start a second instance.

  Appends to watchdog.log next to this script.
#>

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Definition
$starter = Join-Path $here 'start-n8n.ps1'
$logFile = Join-Path $here 'watchdog.log'
$port    = 5678

function Write-Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    try {
        Add-Content -Path $logFile -Value $line -Encoding utf8
        # Keep the log from growing without bound.
        $lines = @(Get-Content $logFile -ErrorAction SilentlyContinue)
        if ($lines.Count -gt 2000) {
            Set-Content -Path $logFile -Value ($lines | Select-Object -Last 1000) -Encoding utf8
        }
    } catch { }
}

# Is anything already serving on the port? Get-NetTCPConnection is cheaper and
# more reliable here than an HTTP probe, which would block while n8n boots.
$listening = $null
try {
    $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
} catch { }

if ($listening) { exit 0 }

if (-not (Test-Path $starter)) {
    Write-Log "MISSING $starter -- cannot start n8n"
    exit 1
}
if (-not (Test-Path (Join-Path $here '.env'))) {
    Write-Log "MISSING .env -- start-n8n.ps1 would refuse to start"
    exit 1
}

Write-Log "n8n not listening on $port -- starting it"

# Detached and hidden so the task can exit while n8n keeps running.
# n8n's own console output is redirected to a file -- without this a startup
# failure is invisible, since there is no window to read.
$outLog = Join-Path $here 'n8n-console.log'
$errLog = Join-Path $here 'n8n-console.err.log'

Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-ExecutionPolicy', 'Bypass', '-File', "`"$starter`"" `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

# Confirm it actually came up rather than reporting success blindly.
$up = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $up = $true; break }
}

if ($up) { Write-Log "n8n is up (took about $((($i + 1) * 3)) seconds)" }
else      { Write-Log "n8n did NOT come up within 180s -- check the n8n console output" }
