/** Tables, reservations and customers. */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { audit } from '../services/audit.service.js';
import { publish } from '../services/events.service.js';
import { tablesForPos } from './pos.controller.js';
import { badRequest, notFound } from '../utils/errors.js';
import { id, optText, phone, ymd } from '../validators/common.js';
import { businessDate, dateOnly, formatDateLong } from '../../shared/dates.js';
import { invoiceInclude, toInvoiceDTO } from '../services/mappers.js';

export const posTables = async (_req: Request, res: Response) => res.json(await tablesForPos());

export async function adminTables(_req: Request, res: Response) {
  const rows = await db().diningTable.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { orders: { where: { status: { in: ['NEW', 'PREPARING', 'READY', 'SERVED'] } } } } } },
  });
  res.json(rows.map(({ _count, ...t }) => ({ ...t, openOrders: _count.orders })));
}

const tableBody = z.object({
  name: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
  area: optText(40),
  capacity: z.number().int().min(1).max(40),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function createTable(req: Request, res: Response) {
  const body = tableBody.parse(req.body);
  const max = await db().diningTable.aggregate({ _max: { sortOrder: true } });
  const t = await db().diningTable.create({ data: { ...body, sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } });
  await audit(req.user!, { action: 'table.create', entity: 'table', entityId: t.id, summary: `Added table ${t.name} (${t.capacity} seats)` });
  publish('tables');
  res.status(201).json(t);
}

export async function updateTable(req: Request, res: Response) {
  const body = tableBody.partial().extend({ hold: z.enum(['NONE', 'RESERVED', 'CLEANING']).optional() }).parse(req.body);
  const tid = String(req.params.id);
  if (body.active === false) {
    const busy = await db().order.count({ where: { tableId: tid, status: { in: ['NEW', 'PREPARING', 'READY', 'SERVED'] } } });
    if (busy) throw badRequest('This table has an open order. Close it before turning the table off.');
  }
  const t = await db().diningTable.update({ where: { id: tid }, data: body });
  if (Object.keys(body).some((k) => k !== 'hold')) {
    await audit(req.user!, { action: 'table.update', entity: 'table', entityId: t.id, summary: `Updated table ${t.name}${body.active === false ? ' (turned off)' : ''}` });
  }
  publish('tables');
  res.json(t);
}

export async function deleteTable(req: Request, res: Response) {
  const tid = String(req.params.id);
  const used = await db().order.count({ where: { tableId: tid } });
  if (used) {
    const t = await db().diningTable.update({ where: { id: tid }, data: { active: false } });
    publish('tables');
    return res.json({ deleted: false, message: `${t.name} has past orders, so it was turned off instead of deleted.` });
  }
  const t = await db().diningTable.delete({ where: { id: tid } });
  await audit(req.user!, { action: 'table.delete', entity: 'table', entityId: tid, summary: `Deleted table ${t.name}` });
  publish('tables');
  res.json({ deleted: true });
}

// ── Reservations ──

const reservationBody = z.object({
  customerName: z.string().trim().min(1, 'Enter the guest name').max(80),
  phone,
  date: ymd,
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Use a valid time'),
  guests: z.number().int().min(1).max(99),
  tableId: id.nullish(),
  notes: optText(240),
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
});

const reservationDTO = (r: { id: string; customerName: string; phone: string | null; date: Date; time: string; guests: number; tableId: string | null; table: { name: string } | null; notes: string | null; status: string; createdAt: Date }) => ({
  id: r.id,
  customerName: r.customerName,
  phone: r.phone,
  date: r.date.toISOString().slice(0, 10),
  time: r.time,
  guests: r.guests,
  tableId: r.tableId,
  tableName: r.table?.name ?? null,
  notes: r.notes,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});

export async function listReservations(req: Request, res: Response) {
  const from = typeof req.query.from === 'string' ? req.query.from : businessDate();
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const rows = await db().reservation.findMany({
    where: { date: to ? { gte: dateOnly(from), lte: dateOnly(to) } : { gte: dateOnly(from) } },
    include: { table: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
    take: 300,
  });
  res.json(rows.map(reservationDTO));
}

export async function createReservation(req: Request, res: Response) {
  const body = reservationBody.parse(req.body);
  const r = await db().reservation.create({
    data: { ...body, date: dateOnly(body.date), createdById: req.user!.id },
    include: { table: { select: { name: true } } },
  });
  await audit(req.user!, { action: 'reservation.create', entity: 'reservation', entityId: r.id, summary: `Reservation for ${r.customerName}, ${r.guests} guests on ${formatDateLong(body.date)} ${r.time}` });
  publish('tables');
  res.status(201).json(reservationDTO(r));
}

export async function updateReservation(req: Request, res: Response) {
  const body = reservationBody.partial().parse(req.body);
  const r = await db().reservation.update({
    where: { id: String(req.params.id) },
    data: { ...body, ...(body.date ? { date: dateOnly(body.date) } : {}) },
    include: { table: { select: { name: true } } },
  });
  publish('tables');
  res.json(reservationDTO(r));
}

// ── Customers ──

export async function listCustomers(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await db().$queryRaw<{ id: string; name: string | null; phone: string | null; visits: bigint; spent: bigint | null; last: Date | null }[]>`
    SELECT c.id, c.name, c.phone, count(i.id) AS visits, sum(i.total) AS spent, max(i."createdAt") AS last
    FROM customers c LEFT JOIN invoices i ON i."customerId" = c.id AND i.status <> 'VOID'
    WHERE (${q} = '' OR c.name ILIKE ${'%' + q + '%'} OR c.phone LIKE ${'%' + q + '%'})
    GROUP BY c.id ORDER BY last DESC NULLS LAST LIMIT 200`;
  res.json(rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, visits: Number(r.visits), spent: Number(r.spent ?? 0), lastVisit: r.last?.toISOString() ?? null })));
}

export async function customerDetail(req: Request, res: Response) {
  const c = await db().customer.findUnique({ where: { id: String(req.params.id) } });
  if (!c) throw notFound('Customer');
  const invoices = await db().invoice.findMany({ where: { customerId: c.id }, include: invoiceInclude, orderBy: { createdAt: 'desc' }, take: 100 });
  const valid = invoices.filter((i) => i.status !== 'VOID');
  const itemCounts = new Map<string, number>();
  valid.forEach((i) => i.items.forEach((it) => itemCounts.set(it.name, (itemCounts.get(it.name) ?? 0) + it.qty)));
  res.json({
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    since: c.createdAt.toISOString(),
    visits: valid.length,
    spent: valid.reduce((a, i) => a + i.total, 0),
    favourites: [...itemCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
    invoices: invoices.map(toInvoiceDTO),
  });
}

export async function updateCustomer(req: Request, res: Response) {
  const body = z.object({ name: optText(80), notes: optText(400) }).parse(req.body);
  const c = await db().customer.update({ where: { id: String(req.params.id) }, data: body });
  res.json(c);
}

export async function lookupCustomer(req: Request, res: Response) {
  const p = String(req.query.phone ?? '').replace(/\D/g, '').slice(-10);
  if (p.length !== 10) return res.json(null);
  const c = await db().customer.findUnique({ where: { phone: p } });
  if (!c) return res.json(null);
  const visits = await db().invoice.count({ where: { customerId: c.id, status: { not: 'VOID' } } });
  res.json({ id: c.id, name: c.name, phone: c.phone, visits });
}
