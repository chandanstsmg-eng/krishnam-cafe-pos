# Back-office UI brief (for contributors)

Project: `C:\annapoorna-pos` — Annapoorna POS, a café / small-hotel POS for rural Karnataka.
One app: Express + Prisma/PostgreSQL server (`server/`), React 19 + Vite + Tailwind v4 client (`src/`),
shared pure logic (`shared/`). Money is **integer paise** everywhere (₹1 = 100). Dates: IST, business
date strings `YYYY-MM-DD`.

## Product voice & look (non-negotiable)
- Must feel like a real commercial POS built by a product team — **not** an AI dashboard, template, or SaaS demo.
  No gradients, glassmorphism, emoji, decorative blobs, "hero" sections, oversized rounded cards, or meaningless charts.
- Warm paper background (`bg-paper`), white working surfaces (`bg-surface`), borders `border-line` / `border-line-2`,
  text `text-ink` / `text-ink-2` / `text-ink-3` / `text-ink-4`, brand `brand` (deep green, one strong colour), accent
  `accent` (turmeric — sparingly). Status: `ok`, `warn`, `danger`, `info`, `plum` with `-50` tints.
  Radius small (rounded-md / rounded-lg). Minimal shadow (`shadow-card`, `shadow-pop` for popovers only).
- Dense but readable tables; numbers use the `num` utility (tabular figures) and are right-aligned in tables.
- **Plain everyday English**: "Today's sales", "Expenses", "Menu", "Stock", "Pending payment" — never "Revenue analytics",
  "Operating expenditure", "Product catalog", "SKU", "KPI".
- Every status is shown with text (and optionally an icon) — never colour alone. Visible focus (already global).
  Buttons/inputs have labels or `aria-label`. Touch-friendly (≥ 40px targets).
- Never show technical errors: use `errorMessage(err)` from `src/api/client.ts` in toasts/inline errors.
- Skeletons while loading (`Skeleton`, `SkeletonRows`), never full-screen spinners. Empty states via `EmptyState`.
- Destructive actions confirm first (`confirm`, `confirmWithReason` from `components/ui/Confirm`).
- Must work at 1366×768 and 1920×1080, and be usable on a tablet / phone (tables scroll horizontally in an
  `overflow-x-auto` wrapper; forms stack).

## Building blocks (read these files before starting)
- `src/components/ui/Button.tsx` — `Button` (variant: primary | secondary | ghost | danger | danger-outline | subtle | dark;
  size sm|md|lg|xl; `icon`, `loading`, `block`), `IconButton` (requires `label`).
- `src/components/ui/Field.tsx` — `Field` (label/hint/error/optional), `Input` (size md|lg), `Textarea`, `Select`,
  `MoneyInput` (works in rupee strings; convert with `toPaise`/`rupeeInput` from `shared/money`), `Switch`, `Checkbox`.
- `src/components/ui/Dialog.tsx` — native `<dialog>` modal (`title`, `description`, `footer`, `size` sm|md|lg|xl|full).
- `src/components/ui/Misc.tsx` — `PageHeader`, `Panel`, `Stat`, `Money`, `EmptyState`, `Skeleton`, `SkeletonRows`, `Kbd`, `VegMark`.
- `src/components/ui/Badge.tsx` (`Badge`, `Dot`), `Segmented.tsx` (`Segmented`, `Tabs`), `DropdownMenu.tsx`, `Toast.tsx` (`toast.success/error/info/warning`), `Confirm.tsx`.
- `src/api/client.ts` — `api.get/post/patch/put/del`, `qs()`, `errorMessage()`.
- Data fetching: `@tanstack/react-query` (`useQuery`, `useMutation`, `useQueryClient`). Live refresh: `useLive(topics, [queryKeys])`
  from `src/hooks/useLive.ts` (topics: orders, kitchen, tables, menu, inventory, settings, shift, invoices).
- Permissions: `useCan()` from `src/features/auth/session.ts`.
- Formatting: `formatMoney` (`shared/money.ts`), `formatDate`, `formatDateLong`, `formatTime`, `formatDateTime`,
  `businessDate`, `addDays` (`shared/dates.ts`).
- Printing A4 pages: `printPage(title, html)` from `src/services/print.ts`. Receipts: `ReceiptPreview` in `src/features/billing/`.
- Look at `src/features/billing/BillsScreen.tsx`, `src/features/shifts/ShiftScreen.tsx` and
  `src/layouts/AdminLayout.tsx` for the house style. The admin layout already provides the sidebar, top bar
  and page padding — a page just renders `<PageHeader …/>` and its content.

## Text (i18n) — required
All visible text goes through `const t = useT()` (`src/i18n`). Put your strings in **your own file**
`src/i18n/en/<area>.ts`:
```ts
const en = { menuAdmin: { title: 'Menu', addItem: 'Add item', itemCount: '{n} items' } };
export default en;
```
Files in `src/i18n/en/` are merged automatically. Use a top-level namespace unique to your page(s) (e.g. `dashboard`,
`sales`, `reportsPage`, `closing`, `audit`, `menuAdmin`, `prices`, `stock`, `suppliers`, `expenses`, `floor`, `customers`,
`staff`, `shiftsPage`, `settings`). You may reuse existing keys in `src/i18n/en.ts` (`common.*`, `pay.*`, `orderType.*` …)
but **do not edit `src/i18n/en.ts`**.

## Rules
- Only create/edit files under your assigned pages' folders (`src/features/<area>/…`) and your `src/i18n/en/<area>.ts`.
  Each page file must `export default` its page component (lazy-loaded from `src/App.tsx`, which you must not edit).
- Do not edit shared UI components, `src/App.tsx`, layouts, `src/i18n/en.ts`, `server/`, `shared/`, `prisma/`.
  If you believe an API change is required, say so precisely in your final report instead.
- API shapes: read the server controller for each endpoint (`server/routes/index.ts` lists them all; handlers are in
  `server/controllers/*.ts`, logic in `server/services/*.ts`).
- Typecheck with `npx tsc -p tsconfig.json --noEmit` (from `C:\annapoorna-pos`) — must pass with zero errors.
- Optional visual check: start your own dev server with a unique port, e.g. in Git Bash
  `cd /c/annapoorna-pos && PORT=4201 npx tsx server/index.ts --dev` (run in background), sign in via
  `POST /api/auth/login {"username":"admin","password":<DEMO_PASSWORD from .env>}`; a headless browser
  (puppeteer-core + local Chrome) is available in `C:\Users\Hi\.lmstest` (see `tamp-shots.js` there for how it launches Chrome).
  **Stop your server before finishing** (kill the process listening on your port). Never use port 4100.
- Charts: use `recharts` (installed). Before writing any chart, invoke the `dataviz` skill and follow it.
  Charts must answer a real question; label axes/values in ₹ with Indian grouping; no 3D, no pie-chart soup.
