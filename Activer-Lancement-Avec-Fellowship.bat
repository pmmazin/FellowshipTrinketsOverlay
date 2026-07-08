@echo off
setlocal
set "ROOT=%~dp0"
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FellowshipTrinketsOverlayWatcher.lnk"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = 'powershell.exe'; $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%ROOT%FellowshipOverlayWatcher.ps1""'; $shortcut.WorkingDirectory = '%ROOT%'; $shortcut.Save()"
echo Lancement automatique active.
echo L'overlay se lancera quand Fellowship demarrera.
pause
