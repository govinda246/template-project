$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$wslScript = (& wsl.exe -e wslpath -a -u $scriptRoot).Trim()

if ($args.Count -eq 0) {
  throw "A command is required, for example: --offline npm run typecheck"
}

if ($LASTEXITCODE -ne 0 -or -not $wslScript) {
  throw "WSL path conversion failed. WSL 2 is required for local secure tasks."
}

& wsl.exe -e bash "$wslScript/local-secure-run.sh" @args
exit $LASTEXITCODE
