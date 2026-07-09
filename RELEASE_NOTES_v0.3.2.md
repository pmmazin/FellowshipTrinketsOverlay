# Fellowship Trinkets Overlay v0.3.2

Patch correctif pour le bouton **Mise a jour**.

## Correction

- La mise a jour ne se limite plus au telechargement : elle attend maintenant la fermeture complete de l'overlay, copie les fichiers dans le dossier d'installation, puis relance l'application.
- Le dossier d'installation est reverifie avant installation pour eviter d'ecrire dans un ancien chemin invalide.
- Ajout de tentatives de copie en cas de fichier encore verrouille par Windows.
- Ajout d'un log `portable-update.log` pour diagnostiquer une erreur d'installation.

## Note

Cette version remplace la logique d'installation de la mise a jour. Les utilisateurs ayant une version ou le bouton telecharge sans installer doivent installer cette version manuellement une fois.
