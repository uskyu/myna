param(
  [int]$Port = 3456,
  [string]$DataDir = "$env:APPDATA\Myna",
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Backend = Join-Path $Root "backend"
$Python = Join-Path $Root "runtime\python\python.exe"

if (!(Test-Path $Python)) {
  $Python = Join-Path $Root ".venv\Scripts\python.exe"
}

if (!(Test-Path $Python)) {
  $Python = "python"
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "db") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "uploads") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "workspaces") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "hermes\profiles") | Out-Null

$env:PORT = "$Port"
$env:MYNA_DATA_DIR = $DataDir
$env:MYNA_DB_DIR = Join-Path $DataDir "db"
$env:MYNA_WORKSPACES_ROOT = Join-Path $DataDir "workspaces"
$env:MYNA_PROFILES_DIR = Join-Path $DataDir "hermes\profiles"
$env:HERMES_PATH = Join-Path $Root "vendor\hermes-agent"

$url = "http://127.0.0.1:$Port"
Write-Host "Starting Myna on $url"
Write-Host "Data directory: $DataDir"

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Port $Port is already in use. Start with another port, for example:" -ForegroundColor Yellow
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\windows\start-myna.ps1 -Port 3457" -ForegroundColor Yellow
  exit 1
}

if (!$NoBrowser) {
  Start-Job -ScriptBlock {
    param($Url)
    Start-Sleep -Seconds 2
    Start-Process $Url
  } -ArgumentList $url | Out-Null
}

Push-Location $Backend
try {
  & $Python "main.py"
}
finally {
  Pop-Location
}
