$ErrorActionPreference = "SilentlyContinue"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$overlayExe = Join-Path $root "FellowshipTrinketsOverlay.exe"
$overlayProcessName = "FellowshipTrinketsOverlay"
$gameProcessName = "fellowship"

while ($true) {
  $game = Get-Process -Name $gameProcessName -ErrorAction SilentlyContinue
  $overlay = Get-Process -Name $overlayProcessName -ErrorAction SilentlyContinue

  if ($game -and !$overlay -and (Test-Path -LiteralPath $overlayExe)) {
    Start-Process -FilePath $overlayExe -WorkingDirectory $root -WindowStyle Hidden
  }

  Start-Sleep -Seconds 3
}
