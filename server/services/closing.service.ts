import { db } from '../db/prisma.js';
import { badRequest, conflict } from '../utils/errors.js';
import { businessDate, dateOnly, formatDateLong } from '../../shared/dates.js';
import { formatMoney } from '../../shared/money.js';
import type { SessionUser } from '../../shared/types.js';
import { audit } from './audit.service.js';
import { dayTotals } from './dashboard.service.js';

export async function closingPreview(ymd: string) {
  const totals = await dayTotals(ymd);
  const existing = await db().dailyClosing.findUnique({ where: { businessDate: dateOnly(ymd) }, include: { closedBy: { select: { name: true } } } });
  const openOrders = await db().order.count({ where: { status: { in: ['NEW', 'PREPARING', 'READY', 'SERVED'] } } });
  const openShift = await db().shift.findFirst({ where: { status: 'OPEN' }, include: { user: { select: { name: true } } } });
  const shifts = await db().shift.findMany({
    where: { closedAt: { not: null }, invoices: { some: { businessDate: dateOnly(ymd) } } },
    select: { difference: true },
  });
  const warnings: string[] = [];
  if (openOrders) warnings.push(`${openOrders} order${openOrders > 1 ? 's are' : ' is'} still open.`);
  if (openShift) warnings.push(`${openShift.user.name}'s cash shift is still open.`);
  return {
    date: ymd,
    totals,
    cashDifference: shifts.reduce((a, s) => a + (s.difference ?? 0), 0),
    warnings,
    closed: existing
      ? { at: existing.closedAt.toISOString(), by: existing.closedBy.name, note: existing.note, totals: existing.totals }
      : null,
  };
}

export async function closeDay(user: SessionUser, ymd: string, note?: string | null) {
  if (ymd > businessDate()) throw badRequest('You cannot close a future day.');
  const exists = await db().dailyClosing.findUnique({ where: { businessDate: dateOnly(ymd) } });
  if (exists) throw conflict(`${formatDateLong(ymd)} is already closed.`);
  const preview = await closingPreview(ymd);
  const openShift = await db().shift.findFirst({ where: { status: 'OPEN' } });
  if (openShift && ymd === businessDate()) throw conflict('Close the cash shift before closing the day.');
  const t = preview.totals;
  await db().$transaction(async (tx) => {
    await tx.dailyClosing.create({
      data: {
        businessDate: dateOnly(ymd),
        totals: { ...t, cashDifference: preview.cashDifference },
        note: note?.trim() || null,
        closedById: user.id,
      },
    });
    await audit(user, { action: 'day.close', entity: 'closing', entityId: ymd, summary: `Closed ${formatDateLong(ymd)} — sales ${formatMoney(t.sales)}, ${t.bills} bills` }, tx);
  });
  return closingPreview(ymd);
}

export async function listClosings(limit = 30) {
  const rows = await db().dailyClosing.findMany({ orderBy: { businessDate: 'desc' }, take: limit, include: { closedBy: { select: { name: true } } } });
  return rows.map((r) => ({ date: r.businessDate.toISOString().slice(0, 10), totals: r.totals, by: r.closedBy.name, at: r.closedAt.toISOString(), note: r.note }));
}
