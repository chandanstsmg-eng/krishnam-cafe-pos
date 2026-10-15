/**
 * "How is my business doing today?" — numbers for the owner's dashboard and
 * the sales analytics page.
 */
import { db } from '../db/prisma.js';
import { addDays, businessDate, dateOnly, istDayStart } from '../../shared/dates.js';

const n = (v: unknown) => (v == null ? 0 : Number(v));

export async function dayTotals(ymd: string) {
  const q = db();
  const d = dateOnly(ymd);
  const [inv] = await q.$queryRaw<Record<string, unknown>[]>`
    SELECT count(*) FILTER (WHERE status <> 'VOID') AS bills,
           coalesce(sum(total) FILTER (WHERE status <> 'VOID'), 0) AS sales,
           coalesce(sum(discount) FILTER (WHERE status <> 'VOID'), 0) AS discount,
           coalesce(sum(tax) FILTER (WHERE status <> 'VOID'), 0) AS tax,
           coalesce(sum("costEstimate") FILTER (WHERE status <> 'VOID'), 0) AS cost,
           coalesce(sum(total) FILTER (WHERE status <> 'VOID' AND "costEstimate" IS NOT NULL), 0) AS "costedSales",
           count(*) FILTER (WHERE status = 'VOID') AS voids,
           coalesce(sum(total) FILTER (WHERE status = 'VOID'), 0) AS "voidValue"
    FROM invoices WHERE "businessDate" = ${ymd}::date`;
  const methods = await q.$queryRaw<{ method: string; amount: unknown }[]>`
    SELECT p.method::text AS method, coalesce(sum(p.amount), 0) AS amount
    FROM payments p JOIN invoices i ON i.id = p."invoiceId"
    WHERE NOT p.voided AND i."businessDate" = ${ymd}::date GROUP BY p.method`;
  const m = (k: string) => n(methods.find((x) => x.method === k)?.amount);
  const exp = await q.expense.aggregate({ where: { date: d, deletedAt: null }, _sum: { amount: true } });
  const refunds = await q.refund.aggregate({ where: { createdAt: { gte: istDayStart(ymd), lt: istDayStart(addDays(ymd, 1)) } }, _sum: { amount: true } });
  const sales = n(inv.sales);
  const bills = n(inv.bills);
  return {
    date: ymd,
    sales,
    bills,
    avgBill: bills ? Math.round(sales / bills) : 0,
    discount: n(inv.discount),
    tax: n(inv.tax),
    cash: m('CASH'),
    upi: m('UPI'),
    card: m('CARD'),
    bank: m('BANK_TRANSFER'),
    expenses: n(exp._sum.amount),
    refunds: n(refunds._sum.amount),
    voids: n(inv.voids),
    voidValue: n(inv.voidValue),
    foodCost: n(inv.cost),
    /** share of sales (0–1) whose items all have a recipe cost */
    costCoverage: sales ? n(inv.costedSales) / sales : 0,
  };
}

export async function dashboard() {
  const q = db();
  const today = businessDate();
  const t = await dayTotals(today);
  const lastWeek = await dayTotals(addDays(today, -7));
  // Fair comparison: last week's sales up to this same time of day.
  const [soFar] = await q.$queryRaw<{ sales: unknown; bills: unknown }[]>`
    SELECT coalesce(sum(total), 0) AS sales, count(*) AS bills FROM invoices
    WHERE status <> 'VOID' AND "businessDate" = ${addDays(today, -7)}::date AND "createdAt" <= ${new Date(Date.now() - 7 * 86400_000)}`;

  const hourly = await q.$queryRaw<{ hour: number; sales: unknown; bills: unknown }[]>`
    SELECT extract(hour FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int AS hour, sum(total) AS sales, count(*) AS bills
    FROM invoices WHERE status <> 'VOID' AND "businessDate" = ${today}::date GROUP BY 1 ORDER BY 1`;

  const week = await q.$queryRaw<{ date: string; sales: unknown; bills: unknown }[]>`
    SELECT to_char("businessDate", 'YYYY-MM-DD') AS date, sum(total) AS sales, count(*) AS bills
    FROM invoices WHERE status <> 'VOID' AND "businessDate" BETWEEN ${addDays(today, -13)}::date AND ${today}::date
    GROUP BY 1 ORDER BY 1`;

  const top = await q.$queryRaw<{ name: string; qty: unknown; sales: unknown }[]>`
    SELECT ii.name, sum(ii.qty) AS qty, sum(ii."lineTotal") AS sales
    FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId"
    WHERE i.status <> 'VOID' AND i."businessDate" = ${today}::date
    GROUP BY ii.name ORDER BY qty DESC, sales DESC LIMIT 5`;

  const open = await q.order.findMany({
    where: { status: { in: ['NEW', 'PREPARING', 'READY', 'SERVED'] } },
    include: { items: { select: { unitPrice: true, qty: true } } },
  });
  const tables = await q.diningTable.count({ where: { active: true } });
  const busy = new Set(open.filter((o) => o.tableId).map((o) => o.tableId)).size;

  const low = await q.$queryRaw<{ id: string; name: string; unit: string; currentStock: number; minStock: number }[]>`
    SELECT id, name, unit, "currentStock", "minStock" FROM inventory_items
    WHERE active AND "currentStock" <= "minStock" ORDER BY ("currentStock" / NULLIF("minStock", 0)) NULLS FIRST LIMIT 8`;

  const days: { date: string; sales: number; bills: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const row = week.find((w) => w.date === d);
    days.push({ date: d, sales: n(row?.sales), bills: n(row?.bills) });
  }

  return {
    today: t,
    sameDayLastWeek: { sales: lastWeek.sales, bills: lastWeek.bills },
    sameTimeLastWeek: { sales: n(soFar.sales), bills: n(soFar.bills) },
    estimatedNet: t.sales - t.expenses - t.refunds,
    hourly: hourly.map((h) => ({ hour: h.hour, sales: n(h.sales), bills: n(h.bills) })),
    days,
    topItems: top.map((x) => ({ name: x.name, qty: n(x.qty), sales: n(x.sales) })),
    open: {
      orders: open.length,
      value: open.reduce((a, o) => a + o.items.reduce((b, i) => b + i.unitPrice * i.qty, 0), 0),
      tablesBusy: busy,
      tablesTotal: tables,
    },
    lowStock: low,
  };
}

type Period = 'today' | 'week' | 'month' | 'year';

export async function analytics(period: Period) {
  const q = db();
  const today = businessDate();
  const span = { today: 0, week: 6, month: 29, year: 364 }[period];
  const from = addDays(today, -span);
  const prevFrom = addDays(from, -(span + 1));
  const prevTo = addDays(from, -1);

  const totals = async (a: string, b: string) => {
    const [r] = await q.$queryRaw<Record<string, unknown>[]>`
      SELECT coalesce(sum(total), 0) AS sales, count(*) AS bills FROM invoices
      WHERE status <> 'VOID' AND "businessDate" BETWEEN ${a}::date AND ${b}::date`;
    return { sales: n(r.sales), bills: n(r.bills) };
  };
  const cur = await totals(from, today);
  const prev = await totals(prevFrom, prevTo);

  let series: { label: string; key: string; sales: number; bills: number }[];
  if (period === 'today') {
    const rows = await q.$queryRaw<{ k: number; sales: unknown; bills: unknown }[]>`
      SELECT extract(hour FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::int AS k, sum(total) AS sales, count(*) AS bills
      FROM invoices WHERE status <> 'VOID' AND "businessDate" = ${today}::date GROUP BY 1`;
    series = [];
    for (let h = 6; h <= 23; h++) {
      const r = rows.find((x) => x.k === h);
      series.push({ key: String(h), label: `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`, sales: n(r?.sales), bills: n(r?.bills) });
    }
  } else if (period === 'year') {
    const rows = await q.$queryRaw<{ k: string; sales: unknown; bills: unknown }[]>`
      SELECT to_char("businessDate", 'YYYY-MM') AS k, sum(total) AS sales, count(*) AS bills
      FROM invoices WHERE status <> 'VOID' AND "businessDate" BETWEEN ${from}::date AND ${today}::date GROUP BY 1 ORDER BY 1`;
    series = [];
    const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
    for (let i = 0; i < 13; i++) {
      const k = d.toISOString().slice(0, 7);
      if (k > today.slice(0, 7)) break;
      const r = rows.find((x) => x.k === k);
      series.push({ key: k, label: k, sales: n(r?.sales), bills: n(r?.bills) });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else {
    const rows = await q.$queryRaw<{ k: string; sales: unknown; bills: unknown }[]>`
      SELECT to_char("businessDate", 'YYYY-MM-DD') AS k, sum(total) AS sales, count(*) AS bills
      FROM invoices WHERE status <> 'VOID' AND "businessDate" BETWEEN ${from}::date AND ${today}::date GROUP BY 1`;
    series = [];
    for (let i = span; i >= 0; i--) {
      const k = addDays(today, -i);
      const r = rows.find((x) => x.k === k);
      series.push({ key: k, label: k, sales: n(r?.sales), bills: n(r?.bills) });
    }
  }

  const methods = await q.$queryRaw<{ method: string; amount: unknown; count: unknown }[]>`
    SELECT p.method::text AS method, sum(p.amount) AS amount, count(*) AS count
    FROM payments p JOIN invoices i ON i.id = p."invoiceId"
    WHERE NOT p.voided AND i."businessDate" BETWEEN ${from}::date AND ${today}::date GROUP BY 1 ORDER BY 2 DESC`;

  const items = await q.$queryRaw<{ name: string; category: string; qty: unknown; sales: unknown }[]>`
    SELECT ii.name, coalesce(max(ii."categoryName"), 'Other') AS category, sum(ii.qty) AS qty, sum(ii."lineTotal" - ii."discountShare") AS sales
    FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId"
    WHERE i.status <> 'VOID' AND i."businessDate" BETWEEN ${from}::date AND ${today}::date
    GROUP BY ii.name ORDER BY qty DESC LIMIT 10`;

  const categories = await q.$queryRaw<{ name: string; qty: unknown; sales: unknown }[]>`
    SELECT coalesce(ii."categoryName", 'Other') AS name, sum(ii.qty) AS qty, sum(ii."lineTotal" - ii."discountShare") AS sales
    FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId"
    WHERE i.status <> 'VOID' AND i."businessDate" BETWEEN ${from}::date AND ${today}::date
    GROUP BY 1 ORDER BY sales DESC`;

  const orderTypes = await q.$queryRaw<{ type: string; sales: unknown; bills: unknown }[]>`
    SELECT "orderType"::text AS type, sum(total) AS sales, count(*) AS bills FROM invoices
    WHERE status <> 'VOID' AND "businessDate" BETWEEN ${from}::date AND ${today}::date GROUP BY 1 ORDER BY 2 DESC`;

  return {
    period,
    from,
    to: today,
    current: { ...cur, avgBill: cur.bills ? Math.round(cur.sales / cur.bills) : 0 },
    previous: { ...prev, avgBill: prev.bills ? Math.round(prev.sales / prev.bills) : 0 },
    series,
    methods: methods.map((m) => ({ method: m.method, amount: n(m.amount), count: n(m.count) })),
    topItems: items.map((i) => ({ name: i.name, category: i.category, qty: n(i.qty), sales: n(i.sales) })),
    categories: categories.map((c) => ({ name: c.name, qty: n(c.qty), sales: n(c.sales) })),
    orderTypes: orderTypes.map((o) => ({ type: o.type, sales: n(o.sales), bills: n(o.bills) })),
  };
}
