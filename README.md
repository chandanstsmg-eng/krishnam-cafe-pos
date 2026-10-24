# Annapoorna POS

Point of sale, billing, kitchen display, stock, expenses and back office for a café or small
hotel restaurant. Built for everyday counters in Karnataka: Cash + UPI + Card, 58/80 mm thermal
receipts, GST, and it keeps billing when the internet goes down.

One folder, one command. The web screens, the API and a private PostgreSQL database all run
from this folder, so there is nothing else to install besides Node.js.

---

## Start it

**First time** (needs internet once, ~2 minutes):

```
cd C:\annapoorna-pos
npm install
npm start
```

Open **http://localhost:4100**. Tablets and phones on the same Wi-Fi use the address printed in
the terminal (for example `http://192.168.1.20:4100`).

**Every day:** double-click **`START-POS.bat`**. It starts the server and opens the till in its
own window with **silent printing** (receipts go straight to the default printer, no print dialog).

| Command | What it does |
|---|---|
| `npm start` | Runs everything on port 4100 (builds the screens automatically when the code changed) |
| `npm run dev` | Same, with live reload for development |
| `npm test` | Billing maths + a full day at the counter against a throw-away database |
| `npm run backup` | Makes a backup now (`-- --list`, `-- --restore <file>`) |
| `npm run reset` | Wipes everything and loads fresh demo data (asks first; backs up first) |
| `npm run db:stop` | Stops the built-in database if it was left running |
| `npm run typecheck` | TypeScript check for screens and server |

Stop with **Ctrl+C** — the database shuts down cleanly. If the PC loses power, PostgreSQL's
write-ahead log protects every bill that was saved.

## Demo sign-in

The demo café is **Krishnam Cafe**, with 60 days of simulated trading.
The password and PINs are in the `.env` file (`DEMO_PASSWORD`, `DEMO_PIN_*`), not in the code.

| Username | Role | PIN | Lands on |
|---|---|---|---|
| `admin` | Owner (Ravi Kumar) | `DEMO_PIN_ADMIN` | Back office |
| `manager` | Manager (Suresh Gowda) | `DEMO_PIN_MANAGER` | Back office |
| `cashier` | Cashier (Lakshmi N) | `DEMO_PIN_CASHIER` | Tables |
| `kitchen` | Kitchen (Mahadevappa) | `DEMO_PIN_KITCHEN` | Kitchen display |
| `manju` | Waiter (Manju) | `DEMO_PIN_WAITER` | Tables (orders go to the cashier) |
| `prakash` | Cashier | password only | |

Staff normally sign in by tapping their name and typing their PIN. Managers approve voids,
big discounts and removing items already cooked by typing their PIN on the cashier's screen.

**Before going live:** change every password and PIN (Back office → Staff), enter the real
business details and GSTIN (Settings → Business details), and set your own prices.
Menu prices in the demo are examples only.

---

## How the café uses it

**Counter (one screen):** Tables → tap a table → tap items → *Send to kitchen* → *Cash / UPI / Card*
→ change is shown in large figures → receipt prints. Takeaway skips the table. Everything a
normal bill needs is on the order screen. Shortcuts: `/` search menu (type an item code like
`MD` + Enter), `F8` cash, `F9` UPI, `F10` card, `F4` print bill, `Ctrl+Enter` send to kitchen,
`Ctrl+K` search bills/orders/customers.

**Kitchen:** New → Start → Ready → Served, large text, a chime for new orders, add-on tickets
marked. Works on any tablet or old PC browser.

**Owner:** Dashboard ("How is my business doing today?"), Sales by day / payment method /
item / category, 12 reports (PDF, CSV, print), menu & quick price list (every change logged),
stock with recipes and low-stock alerts, expenses, cash shifts with note counting, day closing,
staff & permissions, activity log.

## Works without internet

The till talks to the server on the café's own PC, so an **internet outage changes nothing** —
billing, UPI recording, printing and reports all keep working.

If a *tablet* loses Wi-Fi, or the server PC restarts, that till switches to **Offline**:
it keeps taking orders and payments, saves them on the device and prints receipts with an
offline bill number (`OFL-XXX-0001`). When the connection returns, the queued changes are sent
in order; the server recognises repeats, so nothing is ever billed twice. Voids, refunds and
manager approvals wait for the connection.

> The full offline reload (opening the page while disconnected) works on the PC itself
> (`localhost`). Browsers only allow it over `https`, so tablets on plain `http://192.168…`
> keep working offline as long as the page is already open.

## Waiters

Waiters sign in on their phone (tap their name, type their PIN) and land on **Tables**. They
take the order, press **Send to kitchen**, and later **Send bill to cashier**. They never see
payment buttons and their phone never prints. The cashier gets a pop-up with a chime for each
new order, each extra round of items and each bill request, with an **Open** button. The
waiter gets a pop-up when the kitchen marks their food ready. Table cards show who took the
order. A waiter and the cashier can work on the same table at once: nothing either of them
adds is lost.

## Hosting on a server

Two ways to run it. Pick one before going live:

* **A PC or mini-server inside the café (recommended for one outlet).** Same as above. Billing,
  kitchen and waiters keep working when the internet is down, and network printers on the
  café Wi-Fi work.
* **A cloud server (VPS).** The owner can open reports from anywhere, but **every device
  depends on the café's internet**. When it drops, tills switch to offline billing and catch up
  later, but waiter orders stop reaching the kitchen and cashier until it returns. The server
  cannot reach printers inside the café, so use USB printers on the counter PC (browser
  printing). Keep a mobile hotspot as a backup connection.

**Windows Server:** follow [deploy/DEPLOY-WINDOWS.md](deploy/DEPLOY-WINDOWS.md). It covers the
one-command install with Caddy (https), a clean start with only an owner account, and updates.

Checklist for a Linux cloud server:

1. Linux (Ubuntu 22.04+), Node.js 20+, 2 GB RAM. Run the app as a normal user, **not root**
   (the built-in PostgreSQL refuses to start as root).
2. `npm ci`, then `npm start` under a service manager (systemd or pm2) so it restarts after a
   reboot or crash.
3. Put **Nginx or Caddy** in front with **https** (Let's Encrypt). Needed for secure sign-in
   cookies and for tablets to open the app offline. Forward to `localhost:4100`, and for
   `/api/events` turn buffering off and allow long reads (`proxy_buffering off;
   proxy_read_timeout 1h;`). Only open ports 80/443 in the firewall, never 4100 or 54329.
4. Behind Cloudflare or a cloud load balancer, set `TRUST_PROXY=1` in `.env`.
5. **Before anyone outside can reach it:** change the password and PIN of every staff member
   in Back office → Staff (the demo password is in `.env.example`, which anyone with the code
   can read). Deactivate demo staff you don't use, and replace the demo menu, prices and
   business details. The demo sales history stays in reports until you wipe the database.
6. Copy `data/backups` off the server every day (e.g. `rclone` to Google Drive). A backup on
   the same disk is lost with the disk.
7. The counter PC no longer runs the server. Instead of `START-POS.bat`, make a shortcut:
   `msedge --app=https://your-domain --kiosk-printing` for silent receipt printing.

## Printing

* **USB thermal printer (most common):** install the printer's Windows driver, set it as the
  default printer, choose paper 80 mm (or 58 mm) in Back office → Settings → Printer, press
  *Test print*. Starting with `START-POS.bat` prints without the dialog.
* **Network (LAN/Wi-Fi) thermal printer:** Settings → Printer → *Network printer*, enter its IP
  address (port 9100 is the default). The server sends the receipt directly.
* **Cash drawer:** connect it to the printer and switch on *Open the cash drawer on cash payments*.
* **Kitchen tickets:** turn on the kitchen printer and *Print kitchen tickets* under Counter settings.

Reprints are marked **DUPLICATE COPY**, counted, logged, and never create a second sale.

## Backups

Automatic every 6 hours (and at start-up) into `data\backups` (last 40 kept). Settings →
Backups has *Backup now*. **Copy the `data\backups` folder to a pen drive every week.**
Restore: stop the app, then `npm run backup -- --restore <file name>`.

## Hardware

Any Windows 10/11 PC or laptop with 4 GB RAM, an 80 mm thermal printer, optional cash drawer,
optional Android tablets for waiters/kitchen. No POS terminal or cloud subscription needed.

---

## For the technician / developer

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS 4 + Lucide · Node.js + Express 5 ·
Prisma 6 + PostgreSQL 18 (built-in via `embedded-postgres`, or your own via `DATABASE_URL`).

```
server/          API — thin controllers, business logic in services
  controllers/   HTTP handlers (validation with zod, permission checks)
  routes/        every endpoint and who may call it (routes/index.ts)
  services/      orders, sync (offline replay), invoices, kitchen, shifts, inventory,
                 reports, dashboard, closing, printing (ESC/POS), backup, audit
  middleware/    auth (sessions), errors (friendly messages, logged details)
  db/            built-in PostgreSQL launcher, Prisma client
shared/          pure logic used by BOTH screens and server:
                 billing.ts (GST, discounts, round-off), receipt.ts (58/80 mm layout),
                 dates.ts (IST business day), permissions.ts, types.ts
src/             screens
  features/pos   order screen, menu grid, order panel     features/billing  payment, bills, receipts
  features/tables, kitchen, shifts, reports, menu, inventory, expenses, staff, settings, audit …
  services/      sync.ts (offline queue), print.ts, events.ts (live updates)
  components/ui  design system (Button, Field, Dialog, Badge, …)
  i18n/          en.ts + en/*.ts, kn.ts (Kannada — falls back to English per word)
prisma/          schema.prisma, migrations, seed.ts (demo café)
tests/           vitest: billing unit tests + end-to-end API flow on a throw-away database
data/            database, logs, backups (not in git)
```

**Key design points**

* Money is integer **paise** everywhere; the bill is computed by one shared function on the
  till and the server, so an offline bill always matches what the server records.
* Every till action is a **command with a client id** (`/api/pos/sync`). Commands are applied on
  screen immediately, queued in IndexedDB, and replayed in order; the server stores processed ids
  (`sync_commands`) so replays are no-ops. REST equivalents exist (`POST /api/orders`,
  `/api/orders/:id/pay`, …) and use the same code path.
* Business day is always IST (`shared/dates.ts`), independent of the PC clock settings.
* Live updates use Server-Sent Events (`/api/events`) — no extra services.
* Security: scrypt password/PIN hashing, httpOnly session cookies stored server-side,
  role permissions checked on every route, signed short-lived manager approvals, rate-limited
  sign-in, Helmet headers + CSP, zod validation, generated secrets in `.env`, errors shown to
  staff never contain technical details (full detail in `data/logs/app.log` with a reference code).
* Price changes, discounts, voids, refunds, cancellations after cooking, stock corrections,
  expenses, staff and permission changes are written to the activity log (`audit_logs`).

**Database changes:** edit `prisma/schema.prisma`, then `npm run prisma -- migrate dev --name what_changed`.
`npm run prisma -- studio` opens a data browser.

**Adding Kannada:** fill in keys in `src/i18n/kn.ts` (same structure as `en.ts`); anything missing
shows in English. Switch in Settings → Language. Thermal printers print Kannada only via the
browser/Windows driver path, not the raw network path.

**Troubleshooting**

| Problem | Fix |
|---|---|
| "Port 4100 is being used by another program" | Close it, or set `PORT=4200` in `.env` |
| Database won't start | Another PostgreSQL on 54329? Change `PG_PORT` in `.env`. Log: `data/logs/postgres.log` |
| Receipts show a print dialog | Start with `START-POS.bat` (uses Edge `--kiosk-printing`) |
| Tablet can't open the page | Same Wi-Fi? Allow Node.js through Windows Firewall (private networks) |
| A cashier sees "Something went wrong (Ref ABC123)" | Search `ABC123` in `data/logs/app.log` |
