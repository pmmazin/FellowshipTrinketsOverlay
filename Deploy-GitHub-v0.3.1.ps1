$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $root "dist\FellowshipTrinketsOverlay-win32-x64.zip"
$notesPath = Join-Path $root "RELEASE_NOTES_v0.3.1.md"

Set-Location $root

if (!(Test-Path -LiteralPath $zipPath)) {
  throw "Archive introuvable : $zipPath. Lance d'abord npm run build:portable."
}

if (!(Test-Path -LiteralPath $notesPath)) {
  throw "Notes de version introuvables : $notesPath"
}

git push origin main
git push origin v0.3.1

if (gh release view v0.3.1 *> $null) {
  gh release edit v0.3.1 --title "Fellowship Trinkets Overlay v0.3.1" --notes-file "$notesPath"
  gh release upload v0.3.1 "$zipPath" --clobber
  Write-Host "Release v0.3.1 mise a jour sur GitHub."
} else {
  gh release create v0.3.1 `
    "$zipPath" `
    --title "Fellowship Trinkets Overlay v0.3.1" `
    --notes-file "$notesPath"

  Write-Host "Release v0.3.1 publiee sur GitHub."
}
