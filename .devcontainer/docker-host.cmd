@echo off
setlocal

set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"

if not exist "%DOCKER_EXE%" (
  echo Docker CLI not found at "%DOCKER_EXE%". 1>&2
  exit /b 1
)

if /I not "%~1"=="version" goto run_docker

"%DOCKER_EXE%" version >nul 2>&1
if not errorlevel 1 goto run_docker

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0initialize-docker.ps1"
if errorlevel 1 exit /b 1

:run_docker
"%DOCKER_EXE%" %*
set "DOCKER_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %DOCKER_EXIT_CODE%
