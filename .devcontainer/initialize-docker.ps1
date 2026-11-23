$ErrorActionPreference = 'Continue'

$timeoutSeconds = 90
$deadline = (Get-Date).AddSeconds($timeoutSeconds)

function Test-DockerEngine {
    & docker info *> $null 2>&1
    return $LASTEXITCODE -eq 0
}

if (-not (Test-DockerEngine)) {
    & docker desktop start *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to start Docker Desktop.'
    }
}

while (-not (Test-DockerEngine)) {
    if ((Get-Date) -ge $deadline) {
        throw "Docker Desktop did not become ready within $timeoutSeconds seconds."
    }
    Start-Sleep -Seconds 2
}

Write-Output 'Docker Desktop is ready.'
