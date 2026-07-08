# Fellowship Trinkets Overlay

Overlay Windows pour **Fellowship**.

L'application affiche les trinkets/relics du groupe directement au-dessus du jeu, avec leurs icones et leurs timers de recharge quand ils sont utilises.

## Fonctionnalites

- Affichage des joueurs du groupe detectes dans les logs de combat.
- Affichage du Spirit actuel des joueurs quand l'information est disponible.
- Affichage des trinkets/relics equipes avec leurs vraies icones.
- Timer de cooldown quand un trinket/relic est utilise.
- Feed des derniers interrupts/kicks avec le joueur, le sort interrompu et le timer du kick quand son cooldown est connu.
- Support des trinkets FellowsGuide connus.
- Fonctionne aussi en solo pour tester l'overlay sur des mannequins.
- Fenetre d'overlay deplacable.
- Mode click-through pour jouer sans que l'overlay bloque la souris.
- Reglages simples directement en jeu.
- Bouton de mise a jour depuis l'application, avec remplacement de l'installation existante.
- Fermeture automatique de l'overlay quand Fellowship se ferme.

## Installation

1. Va dans l'onglet **Releases** du projet GitHub.
2. Telecharge le fichier :

   `FellowshipTrinketsOverlay-win32-x64.zip`

3. Dezippe le fichier ou tu veux sur ton PC.
4. Lance :

   `FellowshipTrinketsOverlay.exe`

Il n'y a rien d'autre a installer si tu utilises la version `.exe`.

## Utilisation

L'overlay lit automatiquement le dernier combat log de Fellowship dans :

`F:\SteamLibrary\steamapps\common\Fellowship\fellowship\Saved\CombatLogs`

Raccourcis :

- `F8` : activer/desactiver l'interaction avec l'overlay.
- `F10` : afficher/masquer l'overlay.
- `F11` : ouvrir/fermer les reglages.

Dans les reglages, tu peux :

- choisir le dossier des logs ;
- changer la taille de l'overlay ;
- changer le layout ;
- activer/desactiver le click-through.
- choisir le dossier d'installation ;
- installer la derniere mise a jour disponible dans ce dossier.
- activer/desactiver la fermeture automatique avec Fellowship.

La mise a jour telecharge la derniere release, ferme l'application, remplace les fichiers dans le dossier d'installation choisi, puis relance `FellowshipTrinketsOverlay.exe`.

Les versions publiees avant l'ajout du bouton de mise a jour doivent etre remplacees manuellement une derniere fois. Ensuite, les mises a jour suivantes peuvent se faire directement depuis l'application.

## Notes

L'overlay se base sur les logs de combat du jeu. Si le jeu n'ecrit pas encore une information dans les logs, l'overlay ne peut pas l'inventer.

Les timers de trinkets sont bases sur les IDs connus des relics/trinkets Fellowship. Si un nouveau trinket apparait dans le jeu, il faudra peut-etre ajouter son mapping dans les donnees de l'application.

## Developpement

Installer les dependances :

```powershell
.\Install-Dependencies.cmd
```

Lancer en mode developpement :

```powershell
.\Start-Overlay.cmd
```

Generer une version portable Windows :

```powershell
npm run build:portable
```

Le build est genere ici :

`dist\FellowshipTrinketsOverlay-win32-x64\FellowshipTrinketsOverlay.exe`
