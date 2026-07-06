@echo off
setlocal
cd /d "%~dp0"

set "CODEX_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd"
set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "ELECTRON_CACHE=%CD%\.electron-cache"
set "electron_config_cache=%CD%\.electron-cache"

if not exist "%CODEX_PNPM%" (
  echo pnpm was not found at:
  echo %CODEX_PNPM%
  pause
  exit /b 1
)

call "%CODEX_PNPM%" install

if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" "%CD%\node_modules\electron\install.js"
)

pause
