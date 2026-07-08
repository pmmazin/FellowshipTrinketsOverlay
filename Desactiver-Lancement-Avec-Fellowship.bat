@echo off
setlocal
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FellowshipTrinketsOverlayWatcher.lnk"
if exist "%SHORTCUT%" del "%SHORTCUT%"
echo Lancement automatique desactive.
pause
