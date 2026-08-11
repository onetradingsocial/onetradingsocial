<#
.SYNOPSIS
  Loads automation/n8n/.env into the process environment and starts n8n.

.DESCRIPTION
  n8n does not read a .env file on its own when run outside Docker, so this
  script does it. Run it from anywhere:

      powershell -ExecutionPolicy Bypass -File .\automation\n8n\start-n8n.ps1

  Then open http://localhost:5678
#>

$ErrorActionPreference = 'Stop'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Definition
$envFile = Join-Path $here '.env'

if (-not (Test-Path $envFile)) {
    Write-Host "No .env found at $envFile" -ForegroundColor Red
    Write-Host "Copy .env.example to .env and fill it in first." -ForegroundColor Yellow
    exit 1
}

$loaded = 0
foreach ($line in Get-Content $envFile) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }

    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }

    $name  = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()

    # Strip one layer of surrounding quotes if present.
    if ($value.Length -ge 2) {
        $first = $value[0]; $last = $value[$value.Length - 1]
        if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
            $value = $value.Substring(1, $value.Length - 2)
        }
    }

    # Set-Item on an empty value deletes the variable — skip blanks instead.
    if ($value -eq '') { continue }

    Set-Item -Path "Env:$name" -Value $value
    $loaded++
}

Write-Host "Loaded $loaded settings from .env" -ForegroundColor Green

# Sanity-check the one setting whose absence causes a confusing runtime failure.
if (-not $env:NODE_FUNCTION_ALLOW_BUILTIN) {
    Write-Host "WARNING: NODE_FUNCTION_ALLOW_BUILTIN is not set. Code nodes will not be able to read the content queue." -ForegroundColor Yellow
}

$n8n = Get-Command n8n -ErrorAction SilentlyContinue
if ($n8n) {
    Write-Host "Starting n8n -> http://localhost:$($env:N8N_PORT)" -ForegroundColor Cyan
    & $n8n.Source start
} else {
    Write-Host "n8n is not on PATH; falling back to npx." -ForegroundColor Yellow
    Write-Host "Starting n8n -> http://localhost:$($env:N8N_PORT)" -ForegroundColor Cyan
    & npx n8n start
}
