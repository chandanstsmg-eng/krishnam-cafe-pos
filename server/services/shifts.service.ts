/**
 * Cash drawer shifts. The till opens with a float, cash sales and paid-outs
 * move the expected amount, and at close the counted cash is compared with it.
 */
import { db, type Tx } from '../db/prisma.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { formatMoney } from '../../shared/money.js';
import type { SessionUser } from '../../shared/types.js';
import { audit } from './audit.service.js';
import { publish } from './events.service.js';
import { getSettings } from './settings.service.js';

export interface ShiftSummary {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedBy: string;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  cashSales: number;
  upiSales: number;
  cardSales: number;
  bankSales: number;
  totalSales: number;
  bills: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  closingNote: string | null;
  denominations: Record<string, number> | null;
  movements: { id: string; type: 'CASH_IN' | 'CASH_OUT'; amount: number; reason: string; by: string; at: string }[];
}

export async function summarize(shiftId: string, tx?: Tx): Promise<ShiftSummary> {
  const c = tx ?? db();
  const s = await c.shift.findUnique({
    where: { id: shiftId },
    include: {
      user: { select: { name: true } },
      closedBy: { select: { name: true } },
      transactions: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!s) throw notFound('Shift');
  const byMethod = await c.payment.groupBy({ by: ['method'], where: { shiftId, voided: false }, _sum: { amount: true } });
  const sum = (m: string) => byMethod.find((b) => b.method === m)?._sum.amount ?? 0;
  const refunds = await c.refund.aggregate({ where: { shiftId, method: 'CASH' }, _sum: { amount: true } });
  const bills = await c.invoice.count({ where: { shiftId, status: { not: 'VOID' } } });
  const cashIn = s.transactions.filter((t) => t.type === 'CASH_IN').reduce((a, t) => a + t.amount, 0);
  const cashOut = s.transactions.filter((t) => t.type === 'CASH_OUT').reduce((a, t) => a + t.amount, 0);
  const cashRefunds = refunds._sum.amount ?? 0;
  const expectedCash = s.openingCash + sum('CASH') - cashRefunds + cashIn - cashOut;
  return {
    id: s.id,
    status: s.status,
    openedBy: s.user.name,
    closedBy: s.closedBy?.name ?? null,
    openedAt: s.openedAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    openingCash: s.openingCash,
    cashSales: sum('CASH'),
    upiSales: sum('UPI'),
    cardSales: sum('CARD'),
    bankSales: sum('BANK_TRANSFER'),
    totalSales: sum('CASH') + sum('UPI') + sum('CARD') + sum('BANK_TRANSFER'),
    bills,
    cashRefunds,
    cashIn,
    cashOut,
    expectedCash: s.status === 'CLOSED' && s.expectedCash != null ? s.expectedCash : expectedCash,
    countedCash: s.countedCash,
    difference: s.difference,
    closingNote: s.closingNote,
    denominations: (s.denominations as Record<string, number> | null) ?? null,
    movements: s.transactions.map((t) => ({ id: t.id, type: t.type, amount: t.amount, reason: t.reason, by: t.user.name, at: t.createdAt.toISOString() })),
  };
}

export async function currentShift() {
  const s = await db().shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
  return s ? summarize(s.id) : null;
}

export async function openShift(user: SessionUser, openingCash: number) {
  if (openingCash < 0) throw badRequest('Opening cash cannot be negative.');
  const id = await db().$transaction(async (tx) => {
    const open = await tx.shift.findFirst({ where: { status: 'OPEN' } });
    if (open) throw conflict('A shift is already open. Close it first.');
    const s = await tx.shift.create({ data: { userId: user.id, openingCash } });
    await audit(user, { action: 'shift.open', entity: 'shift', entityId: s.id, summary: `Opened shift with ${formatMoney(openingCash)} in the drawer` }, tx);
    return s.id;
  });
  publish('shift');
  return summarize(id);
}

export async function addCashMovement(user: SessionUser, input: { type: 'CASH_IN' | 'CASH_OUT'; amount: number; reason: string; expenseId?: string }, tx?: Tx) {
  if (!(input.amount > 0)) throw badRequest('Enter an amount.');
  if (!input.reason?.trim()) throw badRequest('Enter a reason.');
  const c = tx ?? db();
  const shift = await c.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
  if (!shift) throw conflict('No cash shift is open.');
  await c.shiftTransaction.create({ data: { shiftId: shift.id, type: input.type, amount: input.amount, reason: input.reason.trim(), userId: user.id, expenseId: input.expenseId } });
  await audit(
    user,
    { action: input.type === 'CASH_IN' ? 'shift.cash_in' : 'shift.cash_out', entity: 'shift', entityId: shift.id, summary: `${input.type === 'CASH_IN' ? 'Added' : 'Took out'} ${formatMoney(input.amount)} ${input.type === 'CASH_IN' ? 'to' : 'from'} the drawer — ${input.reason.trim()}` },
    tx,
  );
  publish('shift');
  return shift.id;
}

export async function closeShift(user: SessionUser, input: { countedCash: number; denominations?: Record<string, number> | null; note?: string | null }) {
  const settings = await getSettings();
  const open = await db().shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
  if (!open) throw conflict('No cash shift is open.');
  const s = await summarize(open.id);
  const difference = input.countedCash - s.expectedCash;
  if (Math.abs(difference) > settings.shift.noteRequiredAbove && !input.note?.trim()) {
    throw badRequest(`Cash is ${difference < 0 ? 'short' : 'over'} by ${formatMoney(Math.abs(difference))}. Please write a short explanation.`, { note: 'Explanation required' });
  }
  await db().$transaction(async (tx) => {
    await tx.shift.update({
      where: { id: open.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: user.id,
        expectedCash: s.expectedCash,
        countedCash: input.countedCash,
        difference,
        closingNote: input.note?.trim() || null,
        denominations: input.denominations ?? undefined,
        summary: { ...s, countedCash: input.countedCash, difference } as object,
      },
    });
    await audit(
      user,
      {
        action: 'shift.close',
        entity: 'shift',
        entityId: open.id,
        summary: `Closed shift: expected ${formatMoney(s.expectedCash)}, counted ${formatMoney(input.countedCash)}${difference ? ` (${difference > 0 ? '+' : ''}${formatMoney(difference)})` : ' — matched'}`,
      },
      tx,
    );
  });
  publish('shift');
  return summarize(open.id);
}

/** Shift history. Closed shifts use the summary saved at closing (fast); open ones are worked out live. */
export async function listShifts(limit = 60): Promise<ShiftSummary[]> {
  const rows = await db().shift.findMany({
    orderBy: { openedAt: 'desc' },
    take: limit,
    include: { user: { select: { name: true } }, closedBy: { select: { name: true } } },
  });
  return Promise.all(
    rows.map(async (s) => {
      const sum = s.summary as Partial<ShiftSummary> | null;
      if (s.status === 'OPEN' || !sum) return summarize(s.id);
      const n = (v: unknown) => (typeof v === 'number' ? v : 0);
      return {
        id: s.id,
        status: s.status,
        openedBy: s.user.name,
        closedBy: s.closedBy?.name ?? null,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
        openingCash: s.openingCash,
        cashSales: n(sum.cashSales),
        upiSales: n(sum.upiSales),
        cardSales: n(sum.cardSales),
        bankSales: n(sum.bankSales),
        totalSales: n(sum.cashSales) + n(sum.upiSales) + n(sum.cardSales) + n(sum.bankSales),
        bills: n(sum.bills),
        cashRefunds: n(sum.cashRefunds),
        cashIn: n(sum.cashIn),
        cashOut: n(sum.cashOut),
        expectedCash: s.expectedCash ?? n(sum.expectedCash),
        countedCash: s.countedCash,
        difference: s.difference,
        closingNote: s.closingNote,
        denominations: (s.denominations as Record<string, number> | null) ?? null,
        movements: [],
      };
    }),
  );
}
