<#
  Makes annapoorna-pos-<date>.zip to copy to the server.

    powershell -ExecutionPolicy Bypass -File deploy\make-package.ps1

  Leaves out what must never travel: .env (this PC's secrets), data\ (this PC's
  database, logs and backups), node_modules and dist (rebuilt on the server).
#>
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$skipDirs = @('node_modules', 'data', 'dist', '.git', '.vscode', '.claude')
$skipFiles = @('.env')

$stage = Join-Path $env:TEMP ("annapoorna-pkg-" + [guid]::NewGuid().ToString('N'))
$dest = Join-Path $stage 'annapoorna-pos'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -LiteralPath $AppDir -Force | Where-Object {
  -not ($_.PSIsContainer -and $skipDirs -contains $_.Name) -and -not (-not $_.PSIsContainer -and $skipFiles -contains $_.Name) -and $_.Name -notlike '*.zip'
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force }

$zip = Join-Path $AppDir ("annapoorna-pos-" + (Get-Date -Format 'yyyyMMdd-HHmm') + '.zip')
Compress-Archive -Path $dest -DestinationPath $zip -Force
Remove-Item -Recurse -Force $stage
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "Created $zip ($mb MB)" -ForegroundColor Green
Write-Host 'On the server: unzip to e.g. C:\annapoorna-pos, then run deploy\install-windows.ps1 (first time) or deploy\update-windows.ps1.'
