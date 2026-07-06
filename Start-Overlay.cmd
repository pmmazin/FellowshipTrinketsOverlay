@echo off
setlocal
cd /d "%~dp0"

if exist "%CD%\node_modules\.bin\electron.cmd" (
  call "%CD%\node_modules\.bin\electron.cmd" .
  exit /b %ERRORLEVEL%
)

echo Electron is not installed in this folder.
echo Run Install-Dependencies.cmd first.
pause
exit /b 1
