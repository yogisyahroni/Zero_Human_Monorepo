param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

Write-Host "=== Zero-Human Monorepo Setup ==="

foreach ($cmd in @("git", "pnpm", "docker")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd is required"
  }
}

New-Item -ItemType Directory -Force -Path "packages/@zh", "patches/router", "patches/brain", "patches/hr", "config", "worktrees" | Out-Null

$remotes = @{
  "upstream-router" = "https://github.com/decolua/9router.git"
  "upstream-brain" = "https://github.com/NousResearch/hermes-agent.git"
  "upstream-hr" = "https://github.com/paperclipai/paperclip.git"
}

foreach ($remote in $remotes.GetEnumerator()) {
  git remote get-url $remote.Key *> $null
  if ($LASTEXITCODE -ne 0) {
    git remote add $remote.Key $remote.Value
    Write-Host "Added $($remote.Key)"
  }
}

if (-not $SkipInstall) {
  pnpm install
  pnpm build
}

Write-Host "=== Setup Complete ==="
Write-Host "Run: docker compose up --build"
