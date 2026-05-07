param(
  [ValidateSet("router", "brain", "hr")]
  [string]$Package,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$map = @{
  router = @{ Prefix = "packages/@zh/router/upstream"; Remote = "upstream-router"; Branch = "master" }
  brain = @{ Prefix = "packages/@zh/brain/upstream"; Remote = "upstream-brain"; Branch = "main" }
  hr = @{ Prefix = "packages/@zh/hr/upstream"; Remote = "upstream-hr"; Branch = "master" }
}

$target = $map[$Package]
$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
$dryRunBranch = "sync-dryrun/$Package-$(Get-Date -Format yyyyMMddHHmmss)"

if ($DryRun) {
  if (-not ((git status --porcelain) -eq $null)) {
    throw "Dry-run requires a clean worktree so the temporary branch can be deleted safely."
  }
  Write-Host "Starting dry-run sync on temporary branch $dryRunBranch"
  git switch -c $dryRunBranch | Out-Host
}

try {
git fetch $target.Remote
git subtree pull --prefix=$($target.Prefix) $target.Remote $target.Branch --squash

$patchDir = "patches/$Package"
if (Test-Path $patchDir) {
  $failed = @()
  Get-ChildItem $patchDir -Filter "*.patch" | Sort-Object Name | ForEach-Object {
    try {
      git apply $_.FullName
      Write-Host "Applied $($_.Name)"
    } catch {
      $failed += $_.Name
      Write-Warning "Patch failed: $($_.Name)"
    }
  }
  if ($failed.Count -gt 0) {
    throw "Patch apply failed: $($failed -join ', ')"
  }
}

pnpm --filter "@zh/$Package" build

if ($DryRun) {
  Write-Host "Dry-run sync completed successfully for $Package. No changes will be kept."
}
} finally {
  if ($DryRun) {
    git switch $currentBranch | Out-Host
    git branch -D $dryRunBranch | Out-Host
  }
}
