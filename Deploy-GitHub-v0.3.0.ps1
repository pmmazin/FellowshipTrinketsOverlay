$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $root "dist\FellowshipTrinketsOverlay-win32-x64.zip"
$notesPath = Join-Path $root "RELEASE_NOTES_v0.3.0.md"

Set-Location $root

if (!(Test-Path -LiteralPath $zipPath)) {
  throw "Archive introuvable : $zipPath. Lance d'abord npm run build:portable."
}

if (!(Test-Path -LiteralPath $notesPath)) {
  throw "Notes de version introuvables : $notesPath"
}

git push origin main
git push origin v0.3.0

gh release create v0.3.0 `
  "$zipPath" `
  --title "Fellowship Trinkets Overlay v0.3.0" `
  --notes-file "$notesPath"

Write-Host "Release v0.3.0 publiee sur GitHub."
