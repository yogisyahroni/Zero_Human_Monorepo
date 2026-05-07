param(
  [ValidateSet("router", "brain", "hr")]
  [string]$Package,
  [string]$Name = "local-integration"
)

$ErrorActionPreference = "Stop"

$map = @{
  router = "packages/@zh/router/upstream"
  brain = "packages/@zh/brain/upstream"
  hr = "packages/@zh/hr/upstream"
}

$prefix = $map[$Package]
$patchDir = "patches/$Package"
$safeName = $Name.ToLowerInvariant() -replace "[^a-z0-9._-]+", "-"
$patchPath = Join-Path $patchDir "999-$safeName.patch"

New-Item -ItemType Directory -Force -Path $patchDir | Out-Null

$diff = git diff -- $prefix
if ([string]::IsNullOrWhiteSpace($diff)) {
  Write-Host "No upstream changes found under $prefix; patch not written."
  exit 0
}

$diff | Set-Content -Path $patchPath -Encoding utf8
Write-Host "Wrote $patchPath"
