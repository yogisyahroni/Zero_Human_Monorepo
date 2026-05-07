param(
  [switch]$RemoveVolumes
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$args = @("compose", "-p", "zero-human", "down")
if ($RemoveVolumes) { $args += "-v" }

& docker @args
