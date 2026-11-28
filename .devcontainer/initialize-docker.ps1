$ErrorActionPreference = 'Continue'

$timeoutSeconds = 180
$deadline = (Get-Date).AddSeconds($timeoutSeconds)

function Test-DockerEngine {
    & docker info *> $null 2>&1
    return $LASTEXITCODE -eq 0
}

if (-not (Test-DockerEngine)) {
    & docker desktop start *> $null
    if ($LASTEXITCODE -ne 0) {
        $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (-not (Test-Path -LiteralPath $dockerDesktop)) {
            throw 'Failed to start Docker Desktop with the CLI, and Docker Desktop.exe was not found.'
        }

        Start-Process -FilePath $dockerDesktop -ErrorAction Stop
    }
}

while (-not (Test-DockerEngine)) {
    if ((Get-Date) -ge $deadline) {
        throw "Docker Desktop did not become ready within $timeoutSeconds seconds."
    }
    Start-Sleep -Seconds 2
}

Write-Output 'Docker Desktop is ready.'
