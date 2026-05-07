param(
  [switch]$CheckOnly,
  [switch]$NoDocker,
  [switch]$Commit,
  [switch]$Push
)

$ErrorActionPreference = "Stop"

function Get-StableVersions {
  $versionsJson = npm view 9router versions --json
  $versions = $versionsJson | ConvertFrom-Json
  return @($versions | Where-Object { $_ -match '^\d+\.\d+\.\d+$' } | Sort-Object { [version]$_ })
}

function Get-LocalRouterVersion {
  $packageJson = Get-Content "packages/@zh/router/upstream/package.json" -Raw | ConvertFrom-Json
  return [string]$packageJson.version
}

function Remove-TrackedOAuthDefaults {
  $files = @(
    "packages/@zh/router/upstream/open-sse/config/providers.js",
    "packages/@zh/router/upstream/src/lib/oauth/constants/oauth.js",
    "packages/@zh/router/upstream/open-sse/services/usage.js"
  )

  foreach ($file in $files) {
    if (-not (Test-Path $file)) {
      continue
    }

    $content = Get-Content $file -Raw
    $content = $content -replace 'clientId:\s*"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com"', 'clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || ""'
    $googleSecretPrefix = "GOC" + "SPX-"
    $content = $content -replace "clientSecret:\s*`"$([regex]::Escape($googleSecretPrefix))[^`"]+`"", 'clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || ""'
    Set-Content -Path $file -Value $content -NoNewline
  }
}

$stableVersions = Get-StableVersions
if ($stableVersions.Count -eq 0) {
  throw "No stable 9Router versions found on npm."
}

$latestStable = [string]$stableVersions[-1]
$localVersion = Get-LocalRouterVersion

Write-Host "9Router local:  $localVersion"
Write-Host "9Router stable: $latestStable"

if ([version]$localVersion -ge [version]$latestStable) {
  Write-Host "9Router is already on the latest stable version."
  exit 0
}

if ($CheckOnly) {
  Write-Host "Stable update available: $localVersion -> $latestStable"
  exit 2
}

$dirty = git status --porcelain
if ($dirty) {
  throw "Working tree must be clean before updating 9Router. Commit or stash current changes first."
}

powershell -ExecutionPolicy Bypass -File scripts/sync-upstream.ps1 router
Remove-TrackedOAuthDefaults

$updatedVersion = Get-LocalRouterVersion
Write-Host "9Router updated source: $updatedVersion"

if ([version]$updatedVersion -lt [version]$latestStable) {
  throw "Upstream sync completed, but local version is $updatedVersion while latest stable is $latestStable."
}

if (-not $NoDocker) {
  docker compose -p zero-human up -d --build 9router zh-router-adapter zh-brain-adapter zero-human
}

if ($Commit) {
  git add packages/@zh/router/upstream patches/router config scripts package.json pnpm-lock.yaml
  $pending = git status --porcelain
  if ($pending) {
    git commit -m "Update 9Router to v$updatedVersion"
    if ($Push) {
      git push origin HEAD
    }
  } else {
    Write-Host "No git changes to commit."
  }
}
