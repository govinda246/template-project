param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $PSScriptRoot "local-secure-run.ps1"
& powershell.exe -NoProfile -File $runner --project-path $ProjectPath "--offline" "/bin/bash" "--noprofile" "--norc"
exit $LASTEXITCODE
