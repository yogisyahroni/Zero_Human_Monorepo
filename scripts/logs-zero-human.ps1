param(
  [string]$Service = "",
  [int]$Tail = 120,
  [switch]$Follow
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$args = @("compose", "-p", "zero-human", "logs", "--tail", "$Tail")
if ($Follow) { $args += "-f" }
if ($Service) { $args += $Service }

& docker @args
