@echo off
setlocal
cd /d "%~dp0"

if exist "%CD%\node_modules\.bin\electron.cmd" (
  call "%CD%\node_modules\.bin\electron.cmd" .
  exit /b %ERRORLEVEL%
)

echo Electron n'est pas installe dans ce dossier.
echo Lance d'abord Install-Dependencies.cmd, puis relance ce fichier.
pause
exit /b 1
