$ErrorActionPreference = "Stop"

$sources = @(
  @{ Name = "router"; Display = "9Router"; Path = "packages/@zh/router/upstream"; Repo = "https://github.com/decolua/9router.git" },
  @{ Name = "brain"; Display = "Hermes Agent"; Path = "packages/@zh/brain/upstream"; Repo = "https://github.com/NousResearch/hermes-agent.git" },
  @{ Name = "hr"; Display = "Paperclip"; Path = "packages/@zh/hr/upstream"; Repo = "https://github.com/paperclipai/paperclip.git" }
)

$sources | ForEach-Object {
  $exists = Test-Path $_.Path
  [PSCustomObject]@{
    Name = $_.Display
    Present = $exists
    Path = $_.Path
    Repository = $_.Repo
  }
} | Format-Table -AutoSize
