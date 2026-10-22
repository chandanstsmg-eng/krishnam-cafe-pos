/** Shifts, reports, dashboard, daily closing, audit log, search, notifications. */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import * as shifts from '../services/shifts.service.js';
import { analytics, dashboard, hourlySales, topItems } from '../services/dashboard.service.js';
import { badRequest } from '../utils/errors.js';
import { REPORTS, reportToCsv, runReport } from '../services/reports.service.js';
import { closeDay, closingPreview, listClosings } from '../services/closing.service.js';
import { notifications } from '../services/notifications.service.js';
import { searchInvoices } from '../services/invoices.service.js';
import { paise, ymd } from '../validators/common.js';
import { addDays, businessDate } from '../../shared/dates.js';
import { can } from '../middleware/auth.js';

// ── Shifts ──
export const currentShift = async (_req: Request, res: Response) => res.json(await shifts.currentShift());
export const listShifts = async (_req: Request, res: Response) => res.json(await shifts.listShifts());
export const shiftDetail = async (req: Request, res: Response) => res.json(await shifts.summarize(String(req.params.id)));

export async function openShift(req: Request, res: Response) {
  const { openingCash } = z.object({ openingCash: paise }).parse(req.body);
  res.json(await shifts.openShift(req.user!, openingCash));
}

export async function cashMovement(req: Request, res: Response) {
  const b = z.object({ type: z.enum(['CASH_IN', 'CASH_OUT']), amount: paise.min(1), reason: z.string().trim().min(1).max(160) }).parse(req.body);
  await shifts.addCashMovement(req.user!, b);
  res.json(await shifts.currentShift());
}

export async function closeShift(req: Request, res: Response) {
  const b = z
    .object({ countedCash: paise, denominations: z.record(z.string(), z.number().int().min(0)).nullish(), note: z.string().trim().max(300).nullish() })
    .parse(req.body);
  res.json(await shifts.closeShift(req.user!, b));
}

// ── Dashboard & analytics ──
export const getDashboard = async (_req: Request, res: Response) => res.json(await dashboard());

/** from/to for a dashboard card filter: defaults to today, at most a year. */
function cardRange(query: Request['query']) {
  const today = businessDate();
  const q = z.object({ from: ymd.default(today), to: ymd.default(today) }).parse(query);
  if (q.from > q.to) throw badRequest('The start date is after the end date.');
  if (q.from < addDays(q.to, -366)) throw badRequest('Choose a range of one year or less.');
  return q;
}

export async function getHourly(req: Request, res: Response) {
  const { from, to } = cardRange(req.query);
  res.json(await hourlySales(from, to));
}

export async function getTopItems(req: Request, res: Response) {
  const { from, to } = cardRange(req.query);
  const by = z.enum(['qty', 'sales']).catch('qty').parse(req.query.by);
  const limit = z.coerce.number().int().min(1).max(50).catch(10).parse(req.query.limit);
  res.json(await topItems(from, to, by, limit));
}

export async function getAnalytics(req: Request, res: Response) {
  const period = z.enum(['today', 'week', 'month', 'year']).catch('week').parse(req.query.period);
  res.json(await analytics(period));
}

// ── Reports ──
export const reportList = (_req: Request, res: Response) => res.json(REPORTS);

export async function report(req: Request, res: Response) {
  const q = z.object({ from: ymd.default(businessDate()), to: ymd.default(businessDate()), format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
  const r = await runReport(String(req.params.key), q.from, q.to);
  if (q.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.key}-${q.from}-to-${q.to}.csv"`);
    return res.send(reportToCsv(r));
  }
  res.json(r);
}

// ── Daily closing ──
export async function closing(req: Request, res: Response) {
  const date = ymd.catch(businessDate()).parse(req.query.date ?? businessDate());
  res.json({ ...(await closingPreview(date)), history: await listClosings(14) });
}

export async function doClose(req: Request, res: Response) {
  const b = z.object({ date: ymd, note: z.string().trim().max(300).nullish() }).parse(req.body);
  res.json(await closeDay(req.user!, b.date, b.note));
}

// ── Audit log ──
export async function auditLog(req: Request, res: Response) {
  const q = z
    .object({ q: z.string().max(60).optional(), action: z.string().max(40).optional(), from: ymd.optional(), to: ymd.optional(), page: z.coerce.number().int().min(1).default(1) })
    .parse(req.query);
  const where = {
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.q ? { OR: [{ summary: { contains: q.q, mode: 'insensitive' as const } }, { userName: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    ...(q.from || q.to
      ? { at: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86400_000) } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db().auditLog.findMany({ where, orderBy: { at: 'desc' }, take: 50, skip: (q.page - 1) * 50 }),
    db().auditLog.count({ where }),
  ]);
  res.json({ total, page: q.page, pages: Math.max(1, Math.ceil(total / 50)), rows: rows.map((r) => ({ id: r.id, at: r.at.toISOString(), user: r.userName, action: r.action, summary: r.summary })) });
}

// ── Global search ──
export async function search(req: Request, res: Response) {
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ invoices: [], orders: [], items: [], customers: [], tables: [] });
  const u = req.user!;
  const [invoices, orders, items, customers, tables] = await Promise.all([
    can(u, 'receipts.print') || can(u, 'reports.view') ? searchInvoices({ q, limit: 8 }) : [],
    db().order.findMany({
      where: {
        status: { in: ['NEW', 'PREPARING', 'READY', 'SERVED'] },
        OR: [...(/^\d+$/.test(q) ? [{ number: Number(q) }] : []), { customerName: { contains: q, mode: 'insensitive' } }, { customerPhone: { contains: q } }],
      },
      include: { table: true, items: true },
      take: 6,
    }),
    db().menuItem.findMany({ where: { active: true, OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { equals: q.toUpperCase() } }] }, take: 6, include: { category: true } }),
    can(u, 'customers.view') ? db().customer.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }, take: 6 }) : [],
    db().diningTable.findMany({ where: { active: true, name: { contains: q.toUpperCase().replace(/^TABLE\s*/, '') } }, take: 4 }),
  ]);
  res.json({
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, total: i.total, method: i.payments.map((p) => p.method).join(' + '), tableName: i.tableName, orderType: i.orderType, createdAt: i.createdAt, status: i.status })),
    orders: orders.map((o) => ({ id: o.id, number: o.number, tableName: o.table?.name ?? null, type: o.type, total: o.items.reduce((a, i) => a + i.unitPrice * i.qty, 0), status: o.status })),
    items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, category: i.category.name, available: i.available })),
    customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
    tables: tables.map((t) => ({ id: t.id, name: t.name })),
  });
}

export const getNotifications = async (req: Request, res: Response) => res.json(await notifications(req.user!));
