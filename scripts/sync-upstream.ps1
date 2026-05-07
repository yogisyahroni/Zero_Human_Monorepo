param(
  [ValidateSet("router", "brain", "hr")]
  [string]$Package,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$map = @{
  router = @{ Prefix = "packages/@zh/router/upstream"; Remote = "upstream-router"; Branch = "master"; Url = "https://github.com/decolua/9router.git" }
  brain = @{ Prefix = "packages/@zh/brain/upstream"; Remote = "upstream-brain"; Branch = "main"; Url = "https://github.com/NousResearch/hermes-agent.git" }
  hr = @{ Prefix = "packages/@zh/hr/upstream"; Remote = "upstream-hr"; Branch = "master"; Url = "https://github.com/paperclipai/paperclip.git" }
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
if (-not (git remote get-url $target.Remote 2>$null)) {
  Write-Host "Adding missing remote $($target.Remote): $($target.Url)"
  git remote add $target.Remote $target.Url
}
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
