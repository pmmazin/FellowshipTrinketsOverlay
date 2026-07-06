# Fellowship Trinkets Overlay

Overlay Electron inspire de `mrfarmad/FS_ovelay`.

## Lancer

Depuis ce dossier, utilise simplement :

```powershell
.\Start-Overlay.cmd
```

Si `node_modules` manque ou si Electron n'est pas installe :

```powershell
.\Install-Dependencies.cmd
```

Alternative avec le pnpm embarque de Codex :

```powershell
C:\Users\pierr\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd start
```

Hotkeys :

- `F8` : bascule interaction/click-through
- `F10` : affiche ou masque l'overlay
- `F11` : ouvre les reglages

L'overlay lit automatiquement le dernier fichier dans :

`F:\SteamLibrary\steamapps\common\Fellowship\fellowship\Saved\CombatLogs`

## Generer le .exe portable

```powershell
npm run build:portable
```

Le fichier genere se trouve ici :

`dist\FellowshipTrinketsOverlay-win32-x64\FellowshipTrinketsOverlay.exe`
