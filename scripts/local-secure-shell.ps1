$ErrorActionPreference = "Stop"
$runner = Join-Path $PSScriptRoot "local-secure-run.ps1"
& powershell.exe -NoProfile -File $runner "/bin/bash" "--noprofile" "--norc"
exit $LASTEXITCODE
