<#
  Annapoorna POS - install a new version on the Windows Server.

  1. In the app (Back office > Settings > Backups) press "Backup now".
  2. Copy the new code over the app folder. Do NOT overwrite .env or the data folder.
  3. In an elevated (Run as administrator) Windows PowerShell, from the app folder:

       powershell -ExecutionPolicy Bypass -File deploy\update-windows.ps1

  Stops the app and its database, installs packages, starts again (the screens
  are rebuilt and database changes applied automatically on start).
#>
param([string]$TaskName = 'Annapoorna POS')
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node).Source
Set-Location $AppDir

Write-Host '==> Stopping the app and its database' -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $TaskName
Start-Sleep 3
& $node 'node_modules\tsx\dist\cli.mjs' 'scripts\db-stop.ts'

Write-Host '==> Installing packages (npm ci)' -ForegroundColor Cyan
& npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed (see above). The app is stopped; fix the error and run this again.' }

# Copied files keep their old dates, so don't trust them to trigger a rebuild.
Remove-Item (Join-Path $AppDir 'dist\.build-stamp') -ErrorAction SilentlyContinue

Write-Host '==> Starting (rebuilding the screens takes 1-2 minutes)' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName
$up = $false
for ($i = 0; $i -lt 90 -and -not $up; $i++) {
  Start-Sleep 2
  try { $up = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4100/api/health' -TimeoutSec 3).StatusCode -eq 200 } catch {}
}
if ($up) { Write-Host 'Updated and running.' -ForegroundColor Green }
else { Write-Host "Not answering yet - check $AppDir\data\logs\app.log" -ForegroundColor Yellow; exit 1 }
