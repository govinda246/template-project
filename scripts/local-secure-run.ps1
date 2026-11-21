$ErrorActionPreference = "Stop"

if ($args.Count -lt 2 -or $args[0] -ne "--project-path") {
  throw "usage: local-secure-run.ps1 --project-path <Windows workspace path> [--offline|--online] COMMAND [ARG...]"
}

$projectPath = [System.IO.Path]::GetFullPath($args[1])
if (-not [System.IO.Directory]::Exists($projectPath)) {
  throw "Workspace path does not exist: $projectPath"
}

$trustedScript = Join-Path $PSScriptRoot "local-secure-run.sh"
if (-not [System.IO.File]::Exists($trustedScript)) {
  throw "Trusted runner is missing: $trustedScript"
}

$wslProject = (& wsl.exe -e wslpath -a -u $projectPath).Trim()
$projectExitCode = $LASTEXITCODE
$wslScript = (& wsl.exe -e wslpath -a -u $trustedScript).Trim()
$scriptExitCode = $LASTEXITCODE
if ($projectExitCode -ne 0 -or $scriptExitCode -ne 0 -or -not $wslProject -or -not $wslScript) {
  throw "WSL path conversion failed. WSL 2 is required for local secure tasks."
}

if ($args.Count -lt 3) {
  throw "A command is required, for example: npm run typecheck (offline by default)"
}
$commandArgs = @($args[2..($args.Count - 1)])

& wsl.exe -e bash $wslScript --project-path $wslProject @commandArgs
exit $LASTEXITCODE
