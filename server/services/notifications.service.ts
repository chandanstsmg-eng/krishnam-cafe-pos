/**
 * The few alerts worth interrupting someone for. Computed on request, so
 * there is nothing to mark as read — an alert disappears once it is dealt with.
 */
import { db } from '../db/prisma.js';
import { addDays, businessDate, dateOnly, formatDateLong, formatDuration, minutesSince } from '../../shared/dates.js';
import type { SessionUser } from '../../shared/types.js';
import { getSettings } from './settings.service.js';

export interface Notice {
  id: string;
  kind: 'low_stock' | 'table_waiting' | 'payment_pending' | 'shift_open' | 'day_open';
  title: string;
  detail: string;
  link: string;
}

export async function notifications(user: SessionUser): Promise<Notice[]> {
  const q = db();
  const settings = await getSettings();
  const has = (p: string) => user.permissions.includes(p);
  const out: Notice[] = [];

  if (has('orders.take') || has('bills.create')) {
    const open = await q.order.findMany({
      where: { status: { in: ['NEW', 'PREPARING', 'READY', 'SERVED'] } },
      include: { table: true, tickets: true },
    });
    for (const o of open) {
      const where = o.table ? `Table ${o.table.name}` : `Order #${o.number}`;
      const waiting = o.tickets.filter((t) => t.status === 'NEW' || t.status === 'PREPARING');
      const oldest = waiting.length ? Math.max(...waiting.map((t) => minutesSince(t.createdAt))) : 0;
      if (oldest >= 20) {
        out.push({ id: `wait-${o.id}`, kind: 'table_waiting', title: `${where} waiting for food`, detail: `Ordered ${formatDuration(oldest)} ago`, link: `/pos?order=${o.id}` });
      }
      if (o.billPrintedAt && minutesSince(o.billPrintedAt) >= settings.pos.billWarnMinutes) {
        out.push({ id: `pay-${o.id}`, kind: 'payment_pending', title: `${where} — payment pending`, detail: `Bill given ${formatDuration(minutesSince(o.billPrintedAt))} ago`, link: `/pos?order=${o.id}` });
      }
    }
  }

  if (has('inventory.manage')) {
    const low = await q.$queryRaw<{ name: string; currentStock: number; unit: string }[]>`
      SELECT name, "currentStock", unit FROM inventory_items WHERE active AND "currentStock" <= "minStock" ORDER BY name`;
    if (low.length) {
      out.push({
        id: 'low-stock',
        kind: 'low_stock',
        title: `${low.length} item${low.length > 1 ? 's' : ''} running low`,
        detail: low.slice(0, 3).map((l) => `${l.name} (${+l.currentStock.toFixed(2)} ${l.unit})`).join(', ') + (low.length > 3 ? '…' : ''),
        link: '/admin/inventory?filter=low',
      });
    }
  }

  const today = businessDate();
  if (has('shifts.manage')) {
    const shift = await q.shift.findFirst({ where: { status: 'OPEN' }, include: { user: true } });
    if (shift && businessDate(shift.openedAt) < today) {
      out.push({ id: 'shift-open', kind: 'shift_open', title: 'Cash shift not closed', detail: `${shift.user.name}'s shift has been open since ${formatDateLong(shift.openedAt)}`, link: '/pos/shift' });
    }
  }

  if (has('day.close')) {
    const yesterday = addDays(today, -1);
    const [hadSales, closed] = await Promise.all([
      q.invoice.count({ where: { businessDate: dateOnly(yesterday) } }),
      q.dailyClosing.findUnique({ where: { businessDate: dateOnly(yesterday) } }),
    ]);
    if (hadSales && !closed) {
      out.push({ id: 'day-open', kind: 'day_open', title: 'Yesterday is not closed', detail: `Close ${formatDateLong(yesterday)} to lock in its totals`, link: `/admin/closing?date=${yesterday}` });
    }
  }
  return out;
}
