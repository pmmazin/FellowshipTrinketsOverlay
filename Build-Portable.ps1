$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronDist = Join-Path $root "node_modules\electron\dist"
$outputRoot = Join-Path $root "dist"
$appName = "FellowshipTrinketsOverlay"
$outputDir = Join-Path $outputRoot "$appName-win32-x64"
$appDir = Join-Path $outputDir "resources\app"

if (!(Test-Path (Join-Path $electronDist "electron.exe"))) {
  throw "Electron n'est pas installe. Lance Install-Dependencies.cmd avant de build."
}

if (Test-Path $outputDir) {
  Remove-Item -LiteralPath $outputDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
Copy-Item -LiteralPath $electronDist -Destination $outputDir -Recurse
Rename-Item -LiteralPath (Join-Path $outputDir "electron.exe") -NewName "$appName.exe"

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
foreach ($entry in @("src", "data", "Heroes", "icons_trink", "package.json", "README.md")) {
  $source = Join-Path $root $entry
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination $appDir -Recurse
  }
}

Write-Host "Build termine : $outputDir\$appName.exe"
