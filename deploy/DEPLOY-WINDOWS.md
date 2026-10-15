# Deploying Annapoorna POS on Windows Server

Caddy serves the app over **https** with a free automatic certificate and forwards to the
app on `127.0.0.1:4100`. The app runs as a startup task under its own standard Windows
account, with its built-in PostgreSQL database in the `data` folder.

```
Browsers ──https──▶ Caddy (service "caddy", ports 80/443) ──▶ 127.0.0.1:4100 Annapoorna POS
                                                                   └─ PostgreSQL 127.0.0.1:54329
```

## Before you start

| Need | Notes |
|---|---|
| Windows Server 2016 or newer, 2 GB RAM free | Not a domain controller (the script creates a local account) |
| **Node.js 22 LTS**, installed for all users | Default installer → `C:\Program Files\nodejs` |
| A domain name, e.g. `pos.yourcompany.com` | DNS **A record → this server's public IP** |
| Ports **80 and 443** reachable from the internet | Also in any cloud/company firewall in front of the server. Let's Encrypt needs both to issue the certificate |
| Internet access from the server | For `npm ci` and downloading Caddy |

## First install

1. On the development PC, make the package:
   `powershell -ExecutionPolicy Bypass -File deploy\make-package.ps1`
   This creates `annapoorna-pos-<date>.zip`. It leaves out `.env`, `data`, `node_modules` and `dist`.
   **Never copy this PC's `.env` or `data` folder to the server:** they hold the demo database and this PC's secrets.
2. Copy the zip to the server and unzip it to `C:\annapoorna-pos`.
3. Open **Windows PowerShell as administrator** and run:
   ```
   cd C:\annapoorna-pos
   powershell -ExecutionPolicy Bypass -File deploy\install-windows.ps1 -Domain pos.yourcompany.com
   ```
   When asked, type the **owner password** (at least 8 characters). The script:
   - installs the packages;
   - writes `.env` with new secrets and `HOST=127.0.0.1`;
   - creates a **clean database** with a single owner account `admin`, and no demo staff, menu or sales;
   - creates the Windows account `annapoorna-pos`, which runs the app;
   - adds the startup task `Annapoorna POS`, which restarts the app within a minute if it stops;
   - installs Caddy as the service `caddy`;
   - opens ports 80 and 443.
4. Open `https://pos.yourcompany.com`. The first visit can take up to a minute while the certificate is issued.
5. Sign in as **admin**. If you left the password empty, it is in `C:\annapoorna-pos\data\FIRST-LOGIN.txt`; delete that file after signing in.

No domain yet? Run the script without `-Domain`. Later, edit `C:\caddy\Caddyfile`
(replace `pos.example.com`) and run `Restart-Service caddy`.

## Set up the outlet (Back office)

1. **Settings → Business details:** name, address, phone and GSTIN. These print on every bill.
2. **Settings → Printer:** choose **This computer — USB / Windows printer**. *Network printer
   (IP address)* does not work from a server outside the café, because the server cannot reach
   printers on the café's network.
3. **Menu:** categories, items, prices and GST rate.
4. **Tables & bookings:** the tables.
5. **Staff:** one account per person, with a **PIN** for waiters and cashiers. Give a manager
   role to whoever approves voids and discounts.
6. **Shift:** a cashier opens the cash shift before taking the first payment.

On the counter PC, make a desktop shortcut so receipts print without a dialog:
`"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=https://pos.yourcompany.com --kiosk-printing`

## Updating to a new version

1. In the app: **Settings → Backups → Backup now**.
2. On the development PC: `deploy\make-package.ps1`. Then on the server, unzip **over**
   `C:\annapoorna-pos`. The zip contains no `.env` or `data`, so nothing of the server's is overwritten.
3. In an administrator PowerShell: `powershell -ExecutionPolicy Bypass -File deploy\update-windows.ps1`

## Day to day

| Task | How |
|---|---|
| Is it running? | `Get-ScheduledTask "Annapoorna POS"` (State: Running) and `Get-Service caddy` |
| Restart the app | `Stop-ScheduledTask "Annapoorna POS"; Start-ScheduledTask "Annapoorna POS"` |
| App errors ("Ref ABC123") | Search for the code in `C:\annapoorna-pos\data\logs\app.log` |
| Database log | `C:\annapoorna-pos\data\logs\postgres.log` |
| https / certificate problems | `C:\caddy\logs\access.log`. Run `C:\caddy\caddy.exe run --config C:\caddy\Caddyfile` in a console to see errors live |
| Backups | Automatic every 6 hours into `C:\annapoorna-pos\data\backups`. **Copy them off the server daily**: a backup on the same disk is lost with the disk |
| Restore | `Stop-ScheduledTask "Annapoorna POS"`, then `npm run backup -- --restore <file>`, then `Start-ScheduledTask "Annapoorna POS"` |

Do **not** run `npm run reset` on the server: it wipes the database and loads the demo café.

## Good to know

- **Every device depends on the internet.** When the café's connection drops, tills switch to
  offline billing (bill numbers `OFL-…`) and sync when it returns. Waiter orders don't reach
  the cashier or kitchen until then. Keep a mobile hotspot as a backup.
- Only ports 80 and 443 are open. The app (4100) and database (54329) listen on 127.0.0.1 only.
- After 5 wrong PINs or passwords from one address, that address is locked for 15 minutes.
  Devices elsewhere can still sign in.
