<#
  Annapoorna POS - install on Windows Server behind Caddy (https).

  Run once, in an elevated (Run as administrator) Windows PowerShell, from the app folder:

    powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1 -Domain pos.yourcompany.com

  -Domain is optional; without it Caddy is installed but not started until you
  put the real domain in C:\caddy\Caddyfile (then: Restart-Service caddy).

  What it does (safe to run again - existing .env, data and Caddyfile are kept):
    1. npm ci (installs exactly the versions in package-lock.json)
    2. .env with fresh secrets, HOST=127.0.0.1, FIRST_RUN_DATA=clean, owner password
    3. a local Windows account "annapoorna-pos" (not an administrator) that runs the app
       - the built-in PostgreSQL refuses to run with administrator rights
    4. a scheduled task "Annapoorna POS": starts at boot, restarts within a minute if it stops
    5. Caddy as a Windows service "caddy" (downloaded if C:\caddy\caddy.exe is missing)
    6. firewall: inbound TCP 80 and 443 open (the app port 4100 stays closed)
#>
param(
  [string]$Domain = '',
  [string]$CaddyDir = 'C:\caddy',
  [string]$ServiceUser = 'annapoorna-pos',
  [string]$TaskName = 'Annapoorna POS'
)
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Done($m) { Write-Host "    $m" -ForegroundColor Green }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this in PowerShell opened with "Run as administrator".' }

# -- Node.js --
Step 'Checking Node.js'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is not installed. Install Node.js 22 LTS (or newer) for all users from https://nodejs.org, then open a new PowerShell and run this again.' }
$major = [int]((& $node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { throw "Node.js $(& $node -v) is too old. Install Node.js 22 LTS or newer." }
if ($node -like "$env:USERPROFILE*") { throw "Node.js is installed only for your user ($node). Install it for all users (default installer, C:\Program Files\nodejs) so the service account can run it." }
Done "Node.js $(& $node -v) at $node"

# Decide now whether this is a fresh setup: stopping the database below loads the app's
# config, which writes a demo-default .env if there is none.
$envFile = Join-Path $AppDir '.env'
$hadEnv = Test-Path $envFile

# -- Stop a running copy (re-install): Windows can't replace files of a running database --
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Step 'Stopping the running app and its database'
  Stop-ScheduledTask -TaskName $TaskName
  Start-Sleep 3
}
if (Test-Path (Join-Path $AppDir 'node_modules\tsx\dist\cli.mjs')) {
  Push-Location $AppDir
  try { & $node 'node_modules\tsx\dist\cli.mjs' 'scripts\db-stop.ts' } finally { Pop-Location }
}
if (-not $hadEnv) { Remove-Item $envFile -ErrorAction SilentlyContinue }

# -- Packages --
Step 'Installing packages (npm ci)'
Push-Location $AppDir
try {
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed (see above).' }
} finally { Pop-Location }
# Copied files keep their old dates; make the first start rebuild the screens.
Remove-Item (Join-Path $AppDir 'dist\.build-stamp') -ErrorAction SilentlyContinue
Done 'Packages installed'

# -- .env --
Step 'Configuration (.env)'
function Secret { $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function Set-EnvLine([string]$text, [string]$key, [string]$value) {
  $line = "$key=$value"
  $re = New-Object Text.RegularExpressions.Regex "(?m)^[ \t]*#?[ \t]*$key=[^\r\n]*"
  if ($re.IsMatch($text)) { return $re.Replace($text, [Text.RegularExpressions.MatchEvaluator] { param($m) $line }, 1) }
  return $text.TrimEnd() + "`r`n$line`r`n"
}
if ($hadEnv -and (Test-Path $envFile)) {
  $text = [IO.File]::ReadAllText($envFile)
  Done '.env already exists - keeping its secrets'
} else {
  $text = [IO.File]::ReadAllText((Join-Path $AppDir '.env.example'))
  $text = [regex]::Replace($text, '__generate__', [Text.RegularExpressions.MatchEvaluator] { param($m) Secret })
  $text = Set-EnvLine $text 'FIRST_RUN_DATA' 'clean'
  Write-Host '    Choose the owner password for signing in as "admin" (8+ characters).'
  Write-Host '    Leave empty to generate one (it will be written to data\FIRST-LOGIN.txt).'
  $sec = Read-Host '    Owner password' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if ($plain.Length -gt 0 -and $plain.Length -lt 8) { throw 'The owner password must be at least 8 characters.' }
  if ($plain) { $text = Set-EnvLine $text 'ADMIN_PASSWORD' $plain }
  Done '.env created with new secrets (clean start: one owner account, no demo data)'
}
$text = Set-EnvLine $text 'HOST' '127.0.0.1'
[IO.File]::WriteAllText($envFile, $text)
Done 'HOST=127.0.0.1 - only Caddy on this server can reach the app'

# -- Service account --
Step "Service account '$ServiceUser'"
# Long random password nobody needs to know; Task Scheduler stores it.
$pw = (Secret) + 'aA1!'
$secPw = ConvertTo-SecureString $pw -AsPlainText -Force
if (Get-LocalUser -Name $ServiceUser -ErrorAction SilentlyContinue) {
  Set-LocalUser -Name $ServiceUser -Password $secPw -PasswordNeverExpires $true
  Done 'Account exists - password rotated'
} else {
  New-LocalUser -Name $ServiceUser -Password $secPw -PasswordNeverExpires -UserMayNotChangePassword -Description 'Runs Annapoorna POS' | Out-Null
  Done 'Account created (standard user, not an administrator)'
}
# By SID, and with the name Windows itself reports: %COMPUTERNAME% can differ from the
# account database's name (e.g. a renamed PC not yet restarted), which breaks name lookups.
$sid = (Get-LocalUser -Name $ServiceUser).SID
$account = $sid.Translate([Security.Principal.NTAccount]).Value
& icacls $AppDir /grant "*$($sid.Value):(OI)(CI)M" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not give the service account access to the app folder.' }
Done "Account $account can read and write $AppDir"

# A task that runs while nobody is signed in needs "Log on as a batch job". Registering
# the task from a script doesn't grant it, and without it the task never starts.
$inf = Join-Path $env:TEMP 'annapoorna-rights.inf'
$sdb = Join-Path $env:TEMP 'annapoorna-rights.sdb'
& secedit /export /cfg $inf /areas USER_RIGHTS /quiet | Out-Null
$rights = [IO.File]::ReadAllText($inf)
$me = "*$($sid.Value)"
$line = [regex]::Match($rights, '(?m)^SeBatchLogonRight[ \t]*=[ \t]*([^\r\n]*)')
if (-not $line.Success) {
  $rights = $rights.Replace('[Privilege Rights]', "[Privilege Rights]`r`nSeBatchLogonRight = $me")
} elseif ($line.Groups[1].Value -notmatch [regex]::Escape($me)) {
  $others = $line.Groups[1].Value.Trim()
  $rights = $rights.Remove($line.Index, $line.Length).Insert($line.Index, "SeBatchLogonRight = $(if ($others) { "$others,$me" } else { $me })")
}
[IO.File]::WriteAllText($inf, $rights, [Text.Encoding]::Unicode)
& secedit /configure /db $sdb /cfg $inf /areas USER_RIGHTS /quiet | Out-Null
$ok = $LASTEXITCODE -eq 0
Remove-Item $inf, $sdb -ErrorAction SilentlyContinue
if (-not $ok) { throw 'Could not give the service account the "Log on as a batch job" right.' }
Done 'Account may run as a background task (Log on as a batch job)'

# -- Scheduled task --
Step "Startup task '$TaskName'"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$action = New-ScheduledTaskAction -Execute $node -Argument '"node_modules\tsx\dist\cli.mjs" "server\index.ts"' -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -User $account -Password $pw -RunLevel Limited `
  -Description 'Annapoorna POS (app + built-in database). Logs: data\logs\app.log' | Out-Null
$pw = $null
Done 'Registered: starts at boot, restarts after 1 minute if it stops'

Step 'Starting the app (first start builds the screens and the database: 1-5 minutes)'
Start-ScheduledTask -TaskName $TaskName
$up = $false
for ($i = 0; $i -lt 150 -and -not $up; $i++) {
  Start-Sleep 2
  try { $up = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4100/api/health' -TimeoutSec 3).StatusCode -eq 200 } catch {}
}
if (-not $up) {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  $task = Get-ScheduledTask -TaskName $TaskName
  Write-Host "    The app did not answer. Task state: $($task.State), last result: $($info.LastTaskResult) (0x$('{0:X}' -f $info.LastTaskResult))" -ForegroundColor Yellow
  $log = Join-Path $AppDir 'data\logs\app.log'
  if (Test-Path $log) { Write-Host '    Last lines of data\logs\app.log:' -ForegroundColor Yellow; Get-Content $log -Tail 15 | ForEach-Object { Write-Host "      $_" } }
  else { Write-Host '    data\logs\app.log does not exist: the app never started (the task could not run).' -ForegroundColor Yellow }
} else {
  Done 'App is running on http://127.0.0.1:4100'
  # The owner account exists now; don't leave its password lying in .env.
  $t = [IO.File]::ReadAllText($envFile)
  $t2 = [regex]::Replace($t, '(?m)^ADMIN_PASSWORD=[^\r\n]*', '# ADMIN_PASSWORD=')
  if ($t2 -ne $t) { [IO.File]::WriteAllText($envFile, $t2); Done 'Owner password removed from .env' }
}

# -- Caddy --
Step "Caddy (https) in $CaddyDir"
New-Item -ItemType Directory -Force -Path (Join-Path $CaddyDir 'logs') | Out-Null
$caddy = Join-Path $CaddyDir 'caddy.exe'
if (-not (Test-Path $caddy)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $rel = Invoke-RestMethod 'https://api.github.com/repos/caddyserver/caddy/releases/latest'
  $asset = $rel.assets | Where-Object { $_.name -like '*_windows_amd64.zip' } | Select-Object -First 1
  $zip = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $zip
  Expand-Archive $zip -DestinationPath $CaddyDir -Force
  Remove-Item $zip
  Done "Downloaded Caddy $($rel.tag_name)"
}
$caddyfile = Join-Path $CaddyDir 'Caddyfile'
if (-not (Test-Path $caddyfile)) { Copy-Item (Join-Path $PSScriptRoot 'Caddyfile') $caddyfile }
if ($Domain) {
  $cf = [IO.File]::ReadAllText($caddyfile).Replace('pos.example.com', $Domain)
  [IO.File]::WriteAllText($caddyfile, $cf)
}
# Caddy prints normal "info" lines on stderr; Windows PowerShell would treat them as errors.
$prevPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$check = & $caddy validate --config $caddyfile --adapter caddyfile 2>&1
$valid = $LASTEXITCODE -eq 0
$ErrorActionPreference = $prevPref
if (-not $valid) { $check | ForEach-Object { Write-Host "    $_" }; throw "Caddyfile has an error: $caddyfile" }
Done 'Caddyfile is valid'
if (-not (Get-Service caddy -ErrorAction SilentlyContinue)) {
  New-Service -Name caddy -DisplayName 'Caddy (Annapoorna POS https)' -StartupType Automatic `
    -BinaryPathName "`"$caddy`" run --config `"$caddyfile`" --adapter caddyfile" | Out-Null
  & sc.exe failure caddy reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null
  Done 'Windows service "caddy" created (automatic start, restarts on failure)'
}
$configured = -not ([IO.File]::ReadAllText($caddyfile) -match 'pos\.example\.com')
if ($configured) { Restart-Service caddy; Done 'Caddy running - it fetches the https certificate on the first visit (needs DNS + ports 80/443 open)' }
else { Write-Host "    Caddy is installed but NOT started: put the real domain in $caddyfile, then run: Restart-Service caddy" -ForegroundColor Yellow }

# -- Firewall --
Step 'Firewall'
foreach ($p in 80, 443) {
  $name = "Annapoorna POS https ($p)"
  if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow | Out-Null
  }
}
Done 'Inbound TCP 80 and 443 allowed (4100 and 54329 are not opened)'

Write-Host "`nDone." -ForegroundColor Green
$first = Join-Path $AppDir 'data\FIRST-LOGIN.txt'
if (Test-Path $first) { Write-Host "Owner sign-in is in $first - sign in, change it, then delete that file." -ForegroundColor Yellow }
else { Write-Host 'Sign in as "admin" with the owner password you chose.' }
Write-Host 'Next: Back office > Settings (business name, GSTIN), Menu, Tables, Staff (with PINs).'
