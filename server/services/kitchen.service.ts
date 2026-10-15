import { db } from '../db/prisma.js';
import { badRequest, notFound } from '../utils/errors.js';
import { publish } from './events.service.js';
import { refreshOrderStatus } from './orders.service.js';

export interface KitchenTicketDTO {
  id: string;
  orderId: string;
  orderNumber: number;
  orderType: string;
  tableName: string | null;
  customerName: string | null;
  round: number;
  status: string;
  note: string | null;
  items: { name: string; qty: number; modifiers: string | null; note: string | null }[];
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  paid: boolean;
}

export async function listTickets(): Promise<KitchenTicketDTO[]> {
  const recent = new Date(Date.now() - 30 * 60_000);
  const rows = await db().kitchenTicket.findMany({
    where: {
      OR: [{ status: { in: ['NEW', 'PREPARING'] } }, { status: 'READY', readyAt: { gte: new Date(Date.now() - 6 * 3600_000) } }, { status: 'SERVED', servedAt: { gte: recent } }],
    },
    include: { order: { include: { table: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((t) => ({
    id: t.id,
    orderId: t.orderId,
    orderNumber: t.order.number,
    orderType: t.order.type,
    tableName: t.order.table?.name ?? null,
    customerName: t.order.customerName,
    round: t.round,
    status: t.status,
    note: t.note,
    items: t.items as KitchenTicketDTO['items'],
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    readyAt: t.readyAt?.toISOString() ?? null,
    paid: t.order.status === 'COMPLETED',
  }));
}

const NEXT: Record<string, string[]> = {
  NEW: ['PREPARING', 'READY'],
  PREPARING: ['READY', 'NEW'],
  READY: ['SERVED', 'PREPARING'],
  SERVED: ['READY'],
};

export async function setTicketStatus(id: string, status: 'NEW' | 'PREPARING' | 'READY' | 'SERVED') {
  await db().$transaction(async (tx) => {
    const t = await tx.kitchenTicket.findUnique({ where: { id } });
    if (!t) throw notFound('Kitchen order');
    if (t.status === 'CANCELLED') throw badRequest('This order was cancelled.');
    if (t.status === status) return;
    if (!NEXT[t.status]?.includes(status)) throw badRequest('That step is not possible for this order.');
    const now = new Date();
    await tx.kitchenTicket.update({
      where: { id },
      data: {
        status,
        ...(status === 'PREPARING' ? { startedAt: t.startedAt ?? now, readyAt: null } : {}),
        ...(status === 'READY' ? { readyAt: now, servedAt: null } : {}),
        ...(status === 'SERVED' ? { servedAt: now } : {}),
        ...(status === 'NEW' ? { startedAt: null } : {}),
      },
    });
    await refreshOrderStatus(tx, t.orderId);
  });
  publish('kitchen', 'orders', 'tables');
}
