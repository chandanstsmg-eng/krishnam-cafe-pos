import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { businessDate, dateOnly } from '../../shared/dates.js';
import type { CatalogTable, PosBootstrap, SyncCommand } from '../../shared/types.js';
import { catalog } from '../services/menu.service.js';
import { getPrinters, getSettings } from '../services/settings.service.js';
import { getOrder, listOpenOrders } from '../services/orders.service.js';
import { recentInvoices } from '../services/invoices.service.js';
import { processCommands } from '../services/sync.service.js';
import { notFound } from '../utils/errors.js';
import { orderPayBody, orderSaveBody, syncBody } from '../validators/pos.validators.js';

export async function tablesForPos(): Promise<CatalogTable[]> {
  const today = businessDate();
  const [tables, reservations] = await Promise.all([
    db().diningTable.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db().reservation.findMany({ where: { date: dateOnly(today), status: { in: ['PENDING', 'CONFIRMED'] }, tableId: { not: null } }, orderBy: { time: 'asc' } }),
  ]);
  return tables.map((t) => {
    const r = reservations.find((x) => x.tableId === t.id);
    return {
      id: t.id,
      name: t.name,
      area: t.area,
      capacity: t.capacity,
      hold: t.hold,
      reservation: r ? { name: r.customerName, time: r.time, guests: r.guests } : null,
    };
  });
}

export async function bootstrap(_req: Request, res: Response) {
  const [settings, printers, cat, tables, openOrders, invoices, shift] = await Promise.all([
    getSettings(),
    getPrinters(),
    catalog(),
    tablesForPos(),
    listOpenOrders(),
    recentInvoices(),
    db().shift.findFirst({ where: { status: 'OPEN' }, include: { user: { select: { name: true } } }, orderBy: { openedAt: 'desc' } }),
  ]);
  const body: PosBootstrap = {
    serverTime: new Date().toISOString(),
    businessDate: businessDate(),
    settings,
    printers,
    categories: cat.categories,
    items: cat.items,
    tables,
    openOrders,
    recentInvoices: invoices,
    shift: shift ? { id: shift.id, userName: shift.user.name, openedAt: shift.openedAt.toISOString(), openingCash: shift.openingCash } : null,
  };
  res.json(body);
}

export async function sync(req: Request, res: Response) {
  const { commands } = syncBody.parse(req.body);
  res.json({ results: await processCommands(req.user!, commands as SyncCommand[]) });
}

// ── REST equivalents of the POS commands (for integrations and scripts) ──

export async function listOrders(req: Request, res: Response) {
  const status = typeof req.query.status === 'string' ? req.query.status : 'open';
  if (status === 'open') return res.json(await listOpenOrders());
  const rows = await db().order.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 2 * 86400_000) } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true },
  });
  res.json(await Promise.all(rows.map((r) => getOrder(r.id))));
}

export async function getOne(req: Request, res: Response) {
  const o = await getOrder(String(req.params.id));
  if (!o) throw notFound('Order');
  res.json(o);
}

const cmd = (type: SyncCommand['type'], payload: unknown) => ({ id: crypto.randomUUID(), at: new Date().toISOString(), type, payload }) as SyncCommand;

async function runOne(req: Request, res: Response, c: SyncCommand) {
  const [r] = await processCommands(req.user!, [c]);
  if (!r.ok) return res.status(r.code === 'APPROVAL_REQUIRED' ? 403 : r.code === 'NOT_FOUND' ? 404 : 400).json({ error: r.error, code: r.code });
  res.json(r);
}

export async function createOrder(req: Request, res: Response) {
  const body = orderSaveBody.parse(req.body);
  await runOne(req, res, cmd('order.save', body));
}

export async function updateOrder(req: Request, res: Response) {
  const body = orderSaveBody.parse({ ...req.body, order: { ...req.body?.order, id: req.params.id } });
  await runOne(req, res, cmd('order.save', body));
}

export async function payOrder(req: Request, res: Response) {
  const body = orderPayBody.parse(req.body);
  await runOne(req, res, cmd('order.pay', { ...body, orderId: req.params.id }));
}

export async function cancelOrder(req: Request, res: Response) {
  const body = z.object({ reason: z.string().trim().min(1).max(200), approvalToken: z.string().nullish() }).parse(req.body);
  await runOne(req, res, cmd('order.cancel', { ...body, orderId: req.params.id }));
}

export async function servedOrder(req: Request, res: Response) {
  await runOne(req, res, cmd('order.served', { orderId: req.params.id, status: 'SERVED' }));
}
