param(
  [switch]$Detached = $true,
  [switch]$NoBuild,
  [switch]$Pull
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required. Install Docker Desktop, start it, then run this script again."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker engine is not running. Start Docker Desktop first."
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

$args = @("compose", "-p", "zero-human", "up")
if ($Detached) { $args += "-d" }
if (-not $NoBuild) { $args += "--build" }
if ($Pull) { $args += "--pull", "missing" }

Write-Host "Starting Zero-Human stack..."
& docker @args

Write-Host ""
Write-Host "Zero-Human stack requested. Open these URLs after containers finish starting:"
Write-Host "  Control plane : http://localhost:3003"
Write-Host "  9Router       : http://localhost:20128"
Write-Host "  Hermes        : http://localhost:9119"
Write-Host "  Paperclip     : http://localhost:3100"
Write-Host ""
Write-Host "Status: .\scripts\status-zero-human.ps1"
Write-Host "Logs  : .\scripts\logs-zero-human.ps1"
