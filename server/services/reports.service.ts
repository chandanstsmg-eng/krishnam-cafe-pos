/**
 * Reports. Each report returns a table description the report screen can show,
 * print and export (CSV / PDF) without knowing anything report-specific.
 */
import { db } from '../db/prisma.js';
import { badRequest } from '../utils/errors.js';
import { dateOnly, istDayStart, addDays, businessDate, formatDateTime } from '../../shared/dates.js';

export type ColType = 'text' | 'money' | 'number' | 'qty' | 'percent' | 'date' | 'datetime';
export interface ReportColumn {
  key: string;
  label: string;
  type: ColType;
}
export interface Report {
  key: string;
  title: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  summary?: { label: string; value: number; type: ColType }[];
  note?: string;
}

export const REPORTS = [
  { key: 'sales', title: 'Sales report' },
  { key: 'payments', title: 'Payment report' },
  { key: 'items', title: 'Item sales report' },
  { key: 'categories', title: 'Category sales report' },
  { key: 'expenses', title: 'Expense report' },
  { key: 'inventory', title: 'Stock report' },
  { key: 'tax', title: 'GST / tax report' },
  { key: 'discounts', title: 'Discount report' },
  { key: 'voids', title: 'Void & cancellation report' },
  { key: 'cashiers', title: 'Cashier report' },
  { key: 'shifts', title: 'Shift report' },
  { key: 'closings', title: 'Daily closing report' },
  { key: 'tables', title: 'Table report' },
  { key: 'bookings', title: 'Booking report' },
] as const;

const n = (v: unknown) => (v == null ? 0 : typeof v === 'bigint' ? Number(v) : Number(v));
const sumCol = (rows: Record<string, unknown>[], key: string) => rows.reduce((a, r) => a + n(r[key]), 0);

function range(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('Choose a valid date range.');
  if (from > to) throw badRequest('The start date is after the end date.');
  return { f: dateOnly(from), t: dateOnly(to), start: istDayStart(from), end: istDayStart(addDays(to, 1)) };
}

export async function runReport(key: string, from: string, to: string): Promise<Report> {
  const r = range(from, to);
  const base = { key, from, to, title: REPORTS.find((x) => x.key === key)?.title ?? 'Report' };
  const q = db();

  switch (key) {
    case 'sales': {
      const rows = await q.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char("businessDate", 'YYYY-MM-DD') AS date,
               count(*) FILTER (WHERE status <> 'VOID') AS bills,
               coalesce(sum(subtotal) FILTER (WHERE status <> 'VOID'), 0) AS gross,
               coalesce(sum(discount) FILTER (WHERE status <> 'VOID'), 0) AS discount,
               coalesce(sum(tax) FILTER (WHERE status <> 'VOID'), 0) AS tax,
               coalesce(sum(total) FILTER (WHERE status <> 'VOID'), 0) AS total,
               coalesce(sum(refunded) FILTER (WHERE status <> 'VOID'), 0) AS refunded,
               count(*) FILTER (WHERE status = 'VOID') AS voids
        FROM invoices i
        WHERE "businessDate" BETWEEN ${from}::date AND ${to}::date
        GROUP BY "businessDate" ORDER BY "businessDate"`;
      const out = rows.map((x) => ({
        date: String(x.date),
        bills: n(x.bills),
        gross: n(x.gross),
        discount: n(x.discount),
        tax: n(x.tax),
        total: n(x.total),
        refunded: n(x.refunded),
        net: n(x.total) - n(x.refunded),
        avg: n(x.bills) ? Math.round(n(x.total) / n(x.bills)) : 0,
        voids: n(x.voids),
      }));
      const bills = sumCol(out, 'bills');
      const total = sumCol(out, 'total');
      return {
        ...base,
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'bills', label: 'Bills', type: 'number' },
          { key: 'gross', label: 'Item total', type: 'money' },
          { key: 'discount', label: 'Discount', type: 'money' },
          { key: 'tax', label: 'Tax', type: 'money' },
          { key: 'total', label: 'Sales', type: 'money' },
          { key: 'refunded', label: 'Refunds', type: 'money' },
          { key: 'net', label: 'Net sales', type: 'money' },
          { key: 'avg', label: 'Avg bill', type: 'money' },
          { key: 'voids', label: 'Voids', type: 'number' },
        ],
        rows: out,
        totals: {
          date: 'Total',
          bills,
          gross: sumCol(out, 'gross'),
          discount: sumCol(out, 'discount'),
          tax: sumCol(out, 'tax'),
          total,
          refunded: sumCol(out, 'refunded'),
          net: sumCol(out, 'net'),
          avg: bills ? Math.round(total / bills) : 0,
          voids: sumCol(out, 'voids'),
        },
        summary: [
          { label: 'Sales', value: total, type: 'money' },
          { label: 'Bills', value: bills, type: 'number' },
          { label: 'Average bill', value: bills ? Math.round(total / bills) : 0, type: 'money' },
          { label: 'Refunds', value: sumCol(out, 'refunded'), type: 'money' },
        ],
      };
    }

    case 'payments': {
      const rows = await q.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(i."businessDate", 'YYYY-MM-DD') AS date,
          coalesce(sum(p.amount) FILTER (WHERE p.method = 'CASH'), 0) AS cash,
          coalesce(sum(p.amount) FILTER (WHERE p.method = 'UPI'), 0) AS upi,
          coalesce(sum(p.amount) FILTER (WHERE p.method = 'CARD'), 0) AS card,
          coalesce(sum(p.amount) FILTER (WHERE p.method = 'BANK_TRANSFER'), 0) AS bank,
          coalesce(sum(p.amount), 0) AS total,
          count(DISTINCT i.id) FILTER (WHERE (SELECT count(*) FROM payments p2 WHERE p2."invoiceId" = i.id AND NOT p2.voided) > 1) AS mixed
        FROM payments p JOIN invoices i ON i.id = p."invoiceId"
        WHERE NOT p.voided AND i."businessDate" BETWEEN ${from}::date AND ${to}::date
        GROUP BY i."businessDate" ORDER BY i."businessDate"`;
      const out = rows.map((x) => ({ date: String(x.date), cash: n(x.cash), upi: n(x.upi), card: n(x.card), bank: n(x.bank), total: n(x.total), mixed: n(x.mixed) }));
      const total = sumCol(out, 'total');
      const pct = (k: string) => (total ? Math.round((sumCol(out, k) / total) * 1000) / 10 : 0);
      return {
        ...base,
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'cash', label: 'Cash', type: 'money' },
          { key: 'upi', label: 'UPI', type: 'money' },
          { key: 'card', label: 'Card', type: 'money' },
          { key: 'bank', label: 'Bank transfer', type: 'money' },
          { key: 'total', label: 'Total received', type: 'money' },
          { key: 'mixed', label: 'Split bills', type: 'number' },
        ],
        rows: out,
        totals: { date: 'Total', cash: sumCol(out, 'cash'), upi: sumCol(out, 'upi'), card: sumCol(out, 'card'), bank: sumCol(out, 'bank'), total, mixed: sumCol(out, 'mixed') },
        summary: [
          { label: 'Cash share', value: pct('cash'), type: 'percent' },
          { label: 'UPI share', value: pct('upi'), type: 'percent' },
          { label: 'Card share', value: pct('card'), type: 'percent' },
          { label: 'Total received', value: total, type: 'money' },
        ],
      };
    }

    case 'items':
    case 'categories': {
      const byCat = key === 'categories';
      const rows = byCat
        ? await q.$queryRaw<Record<string, unknown>[]>`
            SELECT coalesce(ii."categoryName", 'Other') AS name, sum(ii.qty) AS qty,
                   sum(ii."lineTotal" - ii."discountShare") AS sales, count(DISTINCT ii."menuItemId") AS items,
                   sum(ii."costEstimate") AS cost
            FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId"
            WHERE i.status <> 'VOID' AND i."businessDate" BETWEEN ${from}::date AND ${to}::date
            GROUP BY 1 ORDER BY sales DESC`
        : await q.$queryRaw<Record<string, unknown>[]>`
            SELECT ii.name AS name, coalesce(max(ii."categoryName"), 'Other') AS category, sum(ii.qty) AS qty,
                   sum(ii."lineTotal" - ii."discountShare") AS sales, sum(ii."costEstimate") AS cost,
                   bool_and(ii."costEstimate" IS NOT NULL) AS costed
            FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId"
            WHERE i.status <> 'VOID' AND i."businessDate" BETWEEN ${from}::date AND ${to}::date
            GROUP BY ii.name ORDER BY qty DESC, sales DESC`;
      const total = rows.reduce((a, x) => a + n(x.sales), 0);
      const out = rows.map((x, idx) => ({
        rank: idx + 1,
        name: String(x.name),
        ...(byCat ? { items: n(x.items) } : { category: String(x.category) }),
        qty: n(x.qty),
        sales: n(x.sales),
        share: total ? Math.round((n(x.sales) / total) * 1000) / 10 : 0,
        cost: x.cost == null || (!byCat && !x.costed) ? null : n(x.cost),
      }));
      return {
        ...base,
        columns: [
          { key: 'rank', label: '#', type: 'number' },
          { key: 'name', label: byCat ? 'Category' : 'Item', type: 'text' },
          byCat ? { key: 'items', label: 'Items sold', type: 'number' } : { key: 'category', label: 'Category', type: 'text' },
          { key: 'qty', label: 'Qty sold', type: 'number' },
          { key: 'sales', label: 'Sales (after discount)', type: 'money' },
          { key: 'share', label: 'Share', type: 'percent' },
          { key: 'cost', label: 'Est. food cost', type: 'money' },
        ],
        rows: out,
        totals: { rank: '', name: 'Total', qty: sumCol(out, 'qty'), sales: total, share: 100, cost: sumCol(out, 'cost') },
        note: 'Food cost is estimated from recipes and current purchase prices, and is shown only where a recipe is set up.',
      };
    }

    case 'expenses': {
      const rows = await q.expense.findMany({
        where: { date: { gte: r.f, lte: r.t }, deletedAt: null },
        include: { createdBy: { select: { name: true } }, supplier: { select: { name: true } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      const out = rows.map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        category: e.category,
        description: e.description,
        supplier: e.supplier?.name ?? '',
        method: e.paymentMethod === 'BANK_TRANSFER' ? 'Bank' : e.paymentMethod[0] + e.paymentMethod.slice(1).toLowerCase(),
        by: e.createdBy.name,
        amount: e.amount,
      }));
      const cats = new Map<string, number>();
      out.forEach((e) => cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount));
      return {
        ...base,
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'description', label: 'Details', type: 'text' },
          { key: 'supplier', label: 'Paid to', type: 'text' },
          { key: 'method', label: 'Paid by', type: 'text' },
          { key: 'by', label: 'Entered by', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'money' },
        ],
        rows: out,
        totals: { date: 'Total', amount: sumCol(out, 'amount') },
        summary: [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, value]) => ({ label, value, type: 'money' as const })),
      };
    }

    case 'inventory': {
      const items = await q.inventoryItem.findMany({ where: { active: true }, include: { supplier: { select: { name: true } } }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
      const moves = await q.inventoryTransaction.groupBy({
        by: ['itemId', 'type'],
        where: { createdAt: { gte: r.start, lt: r.end } },
        _sum: { quantity: true },
      });
      const mv = (id: string, t: string) => Math.abs(n(moves.find((m) => m.itemId === id && m.type === t)?._sum.quantity));
      const out = items.map((i) => ({
        name: i.name,
        category: i.category,
        unit: i.unit,
        purchased: mv(i.id, 'PURCHASE'),
        used: mv(i.id, 'CONSUMPTION'),
        wasted: mv(i.id, 'WASTE'),
        stock: i.currentStock,
        min: i.minStock,
        status: i.currentStock <= 0 ? 'Out of stock' : i.currentStock <= i.minStock ? 'Low' : 'OK',
        value: Math.round(i.currentStock * i.purchasePrice),
      }));
      return {
        ...base,
        columns: [
          { key: 'name', label: 'Item', type: 'text' },
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'unit', label: 'Unit', type: 'text' },
          { key: 'purchased', label: 'Purchased', type: 'qty' },
          { key: 'used', label: 'Used', type: 'qty' },
          { key: 'wasted', label: 'Wasted', type: 'qty' },
          { key: 'stock', label: 'In stock now', type: 'qty' },
          { key: 'min', label: 'Minimum', type: 'qty' },
          { key: 'status', label: 'Status', type: 'text' },
          { key: 'value', label: 'Stock value', type: 'money' },
        ],
        rows: out,
        totals: { name: 'Total', value: sumCol(out, 'value') },
        summary: [
          { label: 'Stock value', value: sumCol(out, 'value'), type: 'money' },
          { label: 'Low stock items', value: out.filter((o) => o.status !== 'OK').length, type: 'number' },
        ],
        note: 'Purchased / used / wasted are for the selected dates. Stock and value are as of now.',
      };
    }

    case 'tax': {
      const rows = await q.$queryRaw<Record<string, unknown>[]>`
        SELECT to_char(i."businessDate", 'YYYY-MM-DD') AS date, ii."taxRate" AS rate,
               sum(ii."lineTotal" - ii."discountShare") AS value, sum(ii."taxAmount") AS tax, bool_or(i."taxInclusive") AS incl
        FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId"
        WHERE i.status <> 'VOID' AND i."businessDate" BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2 ORDER BY 1, 2`;
      const out = rows.map((x) => {
        const tax = n(x.tax);
        const taxable = x.incl ? n(x.value) - tax : n(x.value);
        const cgst = Math.round(tax / 2);
        return { date: String(x.date), rate: n(x.rate), taxable, cgst, sgst: tax - cgst, tax, gross: taxable + tax };
      });
      return {
        ...base,
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'rate', label: 'GST rate %', type: 'number' },
          { key: 'taxable', label: 'Taxable value', type: 'money' },
          { key: 'cgst', label: 'CGST', type: 'money' },
          { key: 'sgst', label: 'SGST', type: 'money' },
          { key: 'tax', label: 'Total tax', type: 'money' },
          { key: 'gross', label: 'Invoice value', type: 'money' },
        ],
        rows: out,
        totals: { date: 'Total', taxable: sumCol(out, 'taxable'), cgst: sumCol(out, 'cgst'), sgst: sumCol(out, 'sgst'), tax: sumCol(out, 'tax'), gross: sumCol(out, 'gross') },
        note: 'Round-off is not included. Check figures with your accountant before filing.',
      };
    }

    case 'discounts': {
      const rows = await q.invoice.findMany({
        where: { businessDate: { gte: r.f, lte: r.t }, discount: { gt: 0 } },
        include: { cashier: { select: { name: true } }, order: { select: { discountReason: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const out = rows.map((i) => ({
        at: i.createdAt.toISOString(),
        bill: i.number,
        where: i.tableName ?? i.orderType.replace('_', '-').toLowerCase(),
        subtotal: i.subtotal,
        label: i.discountLabel ?? '',
        discount: i.discount,
        reason: i.order.discountReason ?? '',
        cashier: i.cashier.name,
        status: i.status === 'VOID' ? 'Void' : '',
      }));
      return {
        ...base,
        columns: [
          { key: 'at', label: 'Date & time', type: 'datetime' },
          { key: 'bill', label: 'Bill', type: 'text' },
          { key: 'where', label: 'Table', type: 'text' },
          { key: 'subtotal', label: 'Item total', type: 'money' },
          { key: 'label', label: 'Type', type: 'text' },
          { key: 'discount', label: 'Discount', type: 'money' },
          { key: 'reason', label: 'Reason', type: 'text' },
          { key: 'cashier', label: 'Cashier', type: 'text' },
          { key: 'status', label: '', type: 'text' },
        ],
        rows: out,
        totals: { at: 'Total', discount: out.filter((o) => !o.status).reduce((a, o) => a + o.discount, 0) },
      };
    }

    case 'voids': {
      const voided = await q.invoice.findMany({
        where: { status: 'VOID', voidedAt: { gte: r.start, lt: r.end } },
        include: { cashier: { select: { name: true } } },
      });
      const voiders = await q.user.findMany({ where: { id: { in: voided.map((v) => v.voidedById!).filter(Boolean) } }, select: { id: true, name: true } });
      const cancelled = await q.order.findMany({
        where: { status: 'CANCELLED', cancelledAt: { gte: r.start, lt: r.end }, invoice: null },
        include: { items: true, table: true },
      });
      const cancellers = await q.user.findMany({ where: { id: { in: cancelled.map((c) => c.cancelledById!).filter(Boolean) } }, select: { id: true, name: true } });
      const out = [
        ...voided.map((v) => ({
          at: v.voidedAt!.toISOString(),
          kind: 'Bill voided',
          ref: v.number,
          where: v.tableName ?? v.orderType.replace('_', '-').toLowerCase(),
          amount: v.total,
          reason: v.voidReason ?? '',
          by: voiders.find((u) => u.id === v.voidedById)?.name ?? '',
        })),
        ...cancelled.map((o) => ({
          at: o.cancelledAt!.toISOString(),
          kind: 'Order cancelled',
          ref: `#${o.number}`,
          where: o.table?.name ?? o.type.replace('_', '-').toLowerCase(),
          amount: o.items.reduce((a, i) => a + i.unitPrice * i.qty, 0),
          reason: o.cancelReason ?? '',
          by: cancellers.find((u) => u.id === o.cancelledById)?.name ?? '',
        })),
      ].sort((a, b) => a.at.localeCompare(b.at));
      return {
        ...base,
        columns: [
          { key: 'at', label: 'Date & time', type: 'datetime' },
          { key: 'kind', label: 'What', type: 'text' },
          { key: 'ref', label: 'Bill / order', type: 'text' },
          { key: 'where', label: 'Table', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'money' },
          { key: 'reason', label: 'Reason', type: 'text' },
          { key: 'by', label: 'Done by', type: 'text' },
        ],
        rows: out,
        totals: { at: 'Total', amount: sumCol(out, 'amount') },
        summary: [
          { label: 'Bills voided', value: voided.length, type: 'number' },
          { label: 'Orders cancelled', value: cancelled.length, type: 'number' },
          { label: 'Value', value: sumCol(out, 'amount'), type: 'money' },
        ],
      };
    }

    case 'cashiers': {
      const rows = await q.$queryRaw<Record<string, unknown>[]>`
        SELECT u.name AS name,
          count(*) FILTER (WHERE i.status <> 'VOID') AS bills,
          coalesce(sum(i.total) FILTER (WHERE i.status <> 'VOID'), 0) AS sales,
          coalesce(sum(i.discount) FILTER (WHERE i.status <> 'VOID'), 0) AS discount,
          count(*) FILTER (WHERE i.discount > 0 AND i.status <> 'VOID') AS discounted,
          count(*) FILTER (WHERE i.status = 'VOID') AS voids,
          coalesce(sum(i.refunded), 0) AS refunded,
          coalesce(sum(i."reprintCount"), 0) AS reprints
        FROM invoices i JOIN users u ON u.id = i."cashierId"
        WHERE i."businessDate" BETWEEN ${from}::date AND ${to}::date
        GROUP BY u.name ORDER BY sales DESC`;
      const out = rows.map((x) => ({
        name: String(x.name),
        bills: n(x.bills),
        sales: n(x.sales),
        avg: n(x.bills) ? Math.round(n(x.sales) / n(x.bills)) : 0,
        discounted: n(x.discounted),
        discount: n(x.discount),
        voids: n(x.voids),
        refunded: n(x.refunded),
        reprints: n(x.reprints),
      }));
      return {
        ...base,
        columns: [
          { key: 'name', label: 'Cashier', type: 'text' },
          { key: 'bills', label: 'Bills', type: 'number' },
          { key: 'sales', label: 'Sales', type: 'money' },
          { key: 'avg', label: 'Avg bill', type: 'money' },
          { key: 'discounted', label: 'Bills with discount', type: 'number' },
          { key: 'discount', label: 'Discount given', type: 'money' },
          { key: 'voids', label: 'Voids', type: 'number' },
          { key: 'refunded', label: 'Refunds', type: 'money' },
          { key: 'reprints', label: 'Reprints', type: 'number' },
        ],
        rows: out,
        totals: { name: 'Total', bills: sumCol(out, 'bills'), sales: sumCol(out, 'sales'), discount: sumCol(out, 'discount'), voids: sumCol(out, 'voids'), refunded: sumCol(out, 'refunded') },
      };
    }

    case 'shifts': {
      const shifts = await q.shift.findMany({
        where: { openedAt: { gte: r.start, lt: r.end } },
        include: { user: { select: { name: true } }, closedBy: { select: { name: true } } },
        orderBy: { openedAt: 'asc' },
      });
      const out = shifts.map((s) => {
        const sum = (s.summary ?? {}) as Record<string, number>;
        return {
          opened: s.openedAt.toISOString(),
          closed: s.closedAt?.toISOString() ?? null,
          by: s.user.name,
          opening: s.openingCash,
          cashSales: n(sum.cashSales),
          otherSales: n(sum.upiSales) + n(sum.cardSales) + n(sum.bankSales),
          cashOut: n(sum.cashOut) + n(sum.cashRefunds) - n(sum.cashIn),
          expected: s.expectedCash,
          counted: s.countedCash,
          difference: s.difference,
          note: s.status === 'OPEN' ? 'Still open' : (s.closingNote ?? ''),
        };
      });
      return {
        ...base,
        columns: [
          { key: 'opened', label: 'Opened', type: 'datetime' },
          { key: 'closed', label: 'Closed', type: 'datetime' },
          { key: 'by', label: 'Cashier', type: 'text' },
          { key: 'opening', label: 'Opening cash', type: 'money' },
          { key: 'cashSales', label: 'Cash sales', type: 'money' },
          { key: 'otherSales', label: 'UPI / card', type: 'money' },
          { key: 'cashOut', label: 'Paid out (net)', type: 'money' },
          { key: 'expected', label: 'Expected', type: 'money' },
          { key: 'counted', label: 'Counted', type: 'money' },
          { key: 'difference', label: 'Difference', type: 'money' },
          { key: 'note', label: 'Note', type: 'text' },
        ],
        rows: out,
        totals: { opened: 'Total', cashSales: sumCol(out, 'cashSales'), otherSales: sumCol(out, 'otherSales'), difference: sumCol(out, 'difference') },
      };
    }

    case 'closings': {
      const rows = await q.dailyClosing.findMany({
        where: { businessDate: { gte: r.f, lte: r.t } },
        include: { closedBy: { select: { name: true } } },
        orderBy: { businessDate: 'asc' },
      });
      const out = rows.map((c) => {
        const t = c.totals as Record<string, number>;
        return {
          date: c.businessDate.toISOString().slice(0, 10),
          bills: n(t.bills),
          sales: n(t.sales),
          cash: n(t.cash),
          upi: n(t.upi),
          card: n(t.card) + n(t.bank),
          expenses: n(t.expenses),
          refunds: n(t.refunds),
          net: n(t.sales) - n(t.expenses) - n(t.refunds),
          by: c.closedBy.name,
          at: c.closedAt.toISOString(),
        };
      });
      return {
        ...base,
        columns: [
          { key: 'date', label: 'Business day', type: 'date' },
          { key: 'bills', label: 'Bills', type: 'number' },
          { key: 'sales', label: 'Sales', type: 'money' },
          { key: 'cash', label: 'Cash', type: 'money' },
          { key: 'upi', label: 'UPI', type: 'money' },
          { key: 'card', label: 'Card / bank', type: 'money' },
          { key: 'expenses', label: 'Expenses', type: 'money' },
          { key: 'refunds', label: 'Refunds', type: 'money' },
          { key: 'net', label: 'Balance', type: 'money' },
          { key: 'by', label: 'Closed by', type: 'text' },
          { key: 'at', label: 'Closed at', type: 'datetime' },
        ],
        rows: out,
        totals: { date: 'Total', bills: sumCol(out, 'bills'), sales: sumCol(out, 'sales'), cash: sumCol(out, 'cash'), upi: sumCol(out, 'upi'), card: sumCol(out, 'card'), expenses: sumCol(out, 'expenses'), refunds: sumCol(out, 'refunds'), net: sumCol(out, 'net') },
      };
    }

    case 'tables': {
      // Every table (idle ones too), with its dine-in bills, guests, time occupied and bookings.
      const rows = await q.$queryRaw<Record<string, unknown>[]>`
        WITH s AS (
          SELECT o."tableId" AS tid,
                 count(*) AS bills,
                 coalesce(sum(o.guests), 0) AS guests,
                 coalesce(sum(i.total), 0) AS sales,
                 avg(extract(epoch FROM (i."createdAt" - o."createdAt")) / 60) AS mins
          FROM invoices i JOIN orders o ON o.id = i."orderId"
          WHERE i.status <> 'VOID' AND i."orderType" = 'DINE_IN'
            AND i."businessDate" BETWEEN ${from}::date AND ${to}::date
          GROUP BY o."tableId"
        ), c AS (
          SELECT "tableId" AS tid, count(*) AS cancelled FROM orders
          WHERE status = 'CANCELLED' AND type = 'DINE_IN' AND "createdAt" >= ${r.start} AND "createdAt" < ${r.end}
          GROUP BY "tableId"
        ), b AS (
          SELECT "tableId" AS tid, count(*) AS bookings FROM reservations
          WHERE date BETWEEN ${from}::date AND ${to}::date AND "tableId" IS NOT NULL
          GROUP BY "tableId"
        )
        SELECT t.name, coalesce(t.area, '') AS area, t.capacity,
               coalesce(s.bills, 0) AS bills, coalesce(s.guests, 0) AS guests, coalesce(s.sales, 0) AS sales,
               s.mins, coalesce(b.bookings, 0) AS bookings, coalesce(c.cancelled, 0) AS cancelled
        FROM tables t
        LEFT JOIN s ON s.tid = t.id LEFT JOIN c ON c.tid = t.id LEFT JOIN b ON b.tid = t.id
        WHERE t.active OR s.tid IS NOT NULL
        ORDER BY coalesce(s.sales, 0) DESC, t."sortOrder", t.name`;
      const totalSales = rows.reduce((a, x) => a + n(x.sales), 0);
      const out = rows.map((x) => {
        const bills = n(x.bills);
        const guests = n(x.guests);
        const sales = n(x.sales);
        return {
          name: String(x.name),
          area: String(x.area),
          seats: n(x.capacity),
          bills,
          guests,
          sales,
          avg: bills ? Math.round(sales / bills) : 0,
          perGuest: guests ? Math.round(sales / guests) : 0,
          minutes: x.mins == null ? null : Math.round(n(x.mins)),
          share: totalSales ? Math.round((sales / totalSales) * 1000) / 10 : 0,
          bookings: n(x.bookings),
          cancelled: n(x.cancelled),
        };
      });
      const bills = sumCol(out, 'bills');
      const guests = sumCol(out, 'guests');
      // Average time weighted by bills, so a table used once doesn't count as much as one used 30 times.
      const minutes = bills ? Math.round(out.reduce((a, x) => a + (x.minutes ?? 0) * x.bills, 0) / bills) : 0;
      const busiest = out.find((x) => x.bills > 0);
      return {
        ...base,
        columns: [
          { key: 'name', label: 'Table', type: 'text' },
          { key: 'area', label: 'Area', type: 'text' },
          { key: 'seats', label: 'Seats', type: 'number' },
          { key: 'bills', label: 'Bills', type: 'number' },
          { key: 'guests', label: 'Guests', type: 'number' },
          { key: 'sales', label: 'Sales', type: 'money' },
          { key: 'avg', label: 'Avg bill', type: 'money' },
          { key: 'perGuest', label: 'Per guest', type: 'money' },
          { key: 'minutes', label: 'Avg time (min)', type: 'number' },
          { key: 'share', label: 'Share', type: 'percent' },
          { key: 'bookings', label: 'Bookings', type: 'number' },
          { key: 'cancelled', label: 'Cancelled orders', type: 'number' },
        ],
        rows: out,
        totals: {
          name: 'Total',
          bills,
          guests,
          sales: totalSales,
          avg: bills ? Math.round(totalSales / bills) : 0,
          perGuest: guests ? Math.round(totalSales / guests) : 0,
          minutes: bills ? minutes : null,
          share: totalSales ? 100 : 0,
          bookings: sumCol(out, 'bookings'),
          cancelled: sumCol(out, 'cancelled'),
        },
        summary: [
          { label: 'Dine-in sales', value: totalSales, type: 'money' },
          { label: 'Table bills', value: bills, type: 'number' },
          { label: 'Guests served', value: guests, type: 'number' },
          { label: 'Avg time at table (min)', value: minutes, type: 'number' },
        ],
        note: `Dine-in bills only. Time at table = from the first order to payment.${busiest ? ` Busiest table: ${busiest.name}.` : ''} Guests are counted only when entered on the order.`,
      };
    }

    case 'bookings': {
      const list = await q.reservation.findMany({
        where: { date: { gte: r.f, lte: r.t } },
        include: { table: { select: { name: true } }, createdBy: { select: { name: true } } },
        orderBy: [{ date: 'asc' }, { time: 'asc' }],
      });
      const today = businessDate();
      const to12h = (hhmm: string) => {
        const [h, m] = hhmm.split(':').map(Number);
        return Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : hhmm;
      };
      const out = list.map((b) => {
        const date = b.date.toISOString().slice(0, 10);
        const open = b.status === 'PENDING' || b.status === 'CONFIRMED';
        const status = b.status === 'COMPLETED' ? 'Came' : b.status === 'CANCELLED' ? 'Cancelled' : open && date < today ? 'Not marked (no-show?)' : b.status === 'CONFIRMED' ? 'Confirmed' : 'Booked';
        return {
          date,
          time: to12h(b.time),
          name: b.customerName,
          phone: b.phone ?? '',
          guests: b.guests,
          table: b.table?.name ?? '',
          status,
          notes: b.notes ?? '',
          by: b.createdBy?.name ?? '',
          bookedOn: b.createdAt.toISOString(),
        };
      });
      const count = (s: string) => out.filter((x) => x.status === s).length;
      const came = count('Came');
      const cancelled = count('Cancelled');
      const noShow = count('Not marked (no-show?)');
      const decided = came + cancelled + noShow;
      return {
        ...base,
        columns: [
          { key: 'date', label: 'Date', type: 'date' },
          { key: 'time', label: 'Time', type: 'text' },
          { key: 'name', label: 'Customer', type: 'text' },
          { key: 'phone', label: 'Phone', type: 'text' },
          { key: 'guests', label: 'Guests', type: 'number' },
          { key: 'table', label: 'Table', type: 'text' },
          { key: 'status', label: 'Status', type: 'text' },
          { key: 'notes', label: 'Notes', type: 'text' },
          { key: 'by', label: 'Booked by', type: 'text' },
          { key: 'bookedOn', label: 'Booked on', type: 'datetime' },
        ],
        rows: out,
        totals: { date: 'Total', guests: sumCol(out, 'guests'), name: `${out.length} bookings` },
        summary: [
          { label: 'Bookings', value: out.length, type: 'number' },
          { label: 'Guests booked', value: sumCol(out, 'guests'), type: 'number' },
          { label: 'Came', value: came, type: 'number' },
          { label: 'Show-up rate', value: decided ? Math.round((came / decided) * 1000) / 10 : 0, type: 'percent' },
        ],
        note: `Cancelled: ${cancelled}. Not marked after the date (possible no-shows): ${noShow}. Show-up rate = came ÷ (came + cancelled + not marked).`,
      };
    }
  }
  throw badRequest('Unknown report.');
}

export function reportToCsv(r: Report) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmt = (v: unknown, t: ColType) =>
    v == null || v === '' ? '' : t === 'money' && typeof v === 'number' ? (v / 100).toFixed(2) : t === 'datetime' && typeof v === 'string' && v.includes('T') ? formatDateTime(v) : v;
  const lines = [r.columns.map((c) => esc(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(fmt(row[c.key], c.type))).join(','));
  if (r.totals) lines.push(r.columns.map((c) => esc(fmt(r.totals![c.key], c.type))).join(','));
  return '﻿' + lines.join('\r\n');
}

