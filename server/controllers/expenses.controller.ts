import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { audit } from '../services/audit.service.js';
import { addCashMovement } from '../services/shifts.service.js';
import { publish } from '../services/events.service.js';
import { badRequest, conflict } from '../utils/errors.js';
import { id, optText, paise, payMethod, ymd } from '../validators/common.js';
import { businessDate, dateOnly, formatDateLong } from '../../shared/dates.js';
import { formatMoney } from '../../shared/money.js';

export const EXPENSE_CATEGORIES = ['Ingredients', 'Gas', 'Electricity', 'Staff', 'Rent', 'Maintenance', 'Transport', 'Cleaning', 'Supplies', 'Other'];

const body = z.object({
  category: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1, 'Say what it was for').max(200),
  amount: paise.min(1, 'Enter the amount'),
  date: ymd,
  paymentMethod: payMethod,
  fromDrawer: z.boolean().default(false),
  supplierId: id.nullish(),
  reference: optText(60),
});

const dto = (e: { id: string; category: string; description: string; amount: number; date: Date; paymentMethod: string; fromDrawer: boolean; supplierId: string | null; supplier?: { name: string } | null; reference: string | null; createdBy: { name: string }; createdAt: Date }) => ({
  id: e.id,
  category: e.category,
  description: e.description,
  amount: e.amount,
  date: e.date.toISOString().slice(0, 10),
  paymentMethod: e.paymentMethod,
  fromDrawer: e.fromDrawer,
  supplierId: e.supplierId,
  supplierName: e.supplier?.name ?? null,
  reference: e.reference,
  createdBy: e.createdBy.name,
  createdAt: e.createdAt.toISOString(),
});

const include = { createdBy: { select: { name: true } }, supplier: { select: { name: true } } } as const;

export async function list(req: Request, res: Response) {
  const from = typeof req.query.from === 'string' ? req.query.from : businessDate().slice(0, 8) + '01';
  const to = typeof req.query.to === 'string' ? req.query.to : businessDate();
  const rows = await db().expense.findMany({
    where: { date: { gte: dateOnly(from), lte: dateOnly(to) }, deletedAt: null },
    include,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ from, to, categories: EXPENSE_CATEGORIES, expenses: rows.map(dto) });
}

export async function create(req: Request, res: Response) {
  const b = body.parse(req.body);
  if (b.fromDrawer && b.paymentMethod !== 'CASH') throw badRequest('Only cash can be paid from the drawer.');
  if (b.date > businessDate()) throw badRequest('The date cannot be in the future.');
  const e = await db().$transaction(async (tx) => {
    const created = await tx.expense.create({ data: { ...b, date: dateOnly(b.date), createdById: req.user!.id }, include });
    if (b.fromDrawer) {
      const shift = await tx.shift.findFirst({ where: { status: 'OPEN' } });
      if (!shift) throw conflict('No cash shift is open, so this cannot be paid from the drawer.');
      await tx.expense.update({ where: { id: created.id }, data: { shiftId: shift.id } });
      await addCashMovement(req.user!, { type: 'CASH_OUT', amount: b.amount, reason: `${b.category}: ${b.description}`, expenseId: created.id }, tx);
    }
    await audit(req.user!, { action: 'expense.create', entity: 'expense', entityId: created.id, summary: `Recorded expense ${formatMoney(b.amount)} — ${b.category}: ${b.description}` }, tx);
    return created;
  });
  publish('shift');
  res.status(201).json(dto(e));
}

export async function update(req: Request, res: Response) {
  const b = body.partial().parse(req.body);
  const before = await db().expense.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  if (before.fromDrawer && (b.amount !== undefined || b.paymentMethod !== undefined)) {
    throw badRequest('This was paid from the cash drawer — delete it and record it again to change the amount.');
  }
  const e = await db().expense.update({ where: { id: before.id }, data: { ...b, ...(b.date ? { date: dateOnly(b.date) } : {}) }, include });
  const what = b.amount !== undefined && b.amount !== before.amount ? ` amount ${formatMoney(before.amount)} → ${formatMoney(b.amount)}` : '';
  await audit(req.user!, { action: 'expense.update', entity: 'expense', entityId: e.id, summary: `Edited expense "${before.description}" (${formatDateLong(before.date.toISOString().slice(0, 10))})${what}` });
  res.json(dto(e));
}

export async function remove(req: Request, res: Response) {
  const e = await db().expense.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  await db().$transaction(async (tx) => {
    await tx.expense.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
    if (e.fromDrawer && e.shiftId) {
      const shift = await tx.shift.findUnique({ where: { id: e.shiftId } });
      if (shift?.status === 'OPEN') await tx.shiftTransaction.deleteMany({ where: { expenseId: e.id } });
    }
    await audit(req.user!, { action: 'expense.delete', entity: 'expense', entityId: e.id, summary: `Deleted expense ${formatMoney(e.amount)} — ${e.category}: ${e.description}` }, tx);
  });
  publish('shift');
  res.json({ ok: true });
}
