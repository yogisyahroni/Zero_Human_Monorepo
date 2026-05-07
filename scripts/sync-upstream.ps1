param(
  [ValidateSet("router", "brain", "hr")]
  [string]$Package
)

$ErrorActionPreference = "Stop"

$map = @{
  router = @{ Prefix = "packages/@zh/router"; Remote = "upstream-router"; Branch = "main" }
  brain = @{ Prefix = "packages/@zh/brain"; Remote = "upstream-brain"; Branch = "main" }
  hr = @{ Prefix = "packages/@zh/hr"; Remote = "upstream-hr"; Branch = "main" }
}

$target = $map[$Package]
git fetch $target.Remote
git subtree pull --prefix=$($target.Prefix) $target.Remote $target.Branch --squash

$patchDir = "patches/$Package"
if (Test-Path $patchDir) {
  Get-ChildItem $patchDir -Filter "*.patch" | Sort-Object Name | ForEach-Object {
    git apply $_.FullName
    Write-Host "Applied $($_.Name)"
  }
}

pnpm --filter "@zh/$Package" build
