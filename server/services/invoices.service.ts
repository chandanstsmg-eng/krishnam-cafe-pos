import type { PaymentMethod, Prisma } from '@prisma/client';
import { db } from '../db/prisma.js';
import { approvalNeeded, badRequest, conflict, notFound } from '../utils/errors.js';
import { readApproval } from '../utils/crypto.js';
import { formatMoney } from '../../shared/money.js';
import { businessDate, dateOnly } from '../../shared/dates.js';
import type { SessionUser } from '../../shared/types.js';
import { can } from '../middleware/auth.js';
import { audit } from './audit.service.js';
import { publish } from './events.service.js';
import { consumeForSale } from './inventory.service.js';
import { invoiceInclude, toInvoiceDTO } from './mappers.js';
import { getSettings } from './settings.service.js';

export async function getInvoice(id: string) {
  const inv = await db().invoice.findFirst({ where: { OR: [{ id }, { number: id }] }, include: invoiceInclude });
  if (!inv) throw notFound('Bill');
  return toInvoiceDTO(inv);
}

export interface InvoiceSearch {
  q?: string;
  date?: string;
  from?: string;
  to?: string;
  status?: string;
  method?: PaymentMethod;
  limit?: number;
}

export async function searchInvoices(s: InvoiceSearch) {
  const where: Prisma.InvoiceWhereInput = {};
  if (s.date) where.businessDate = dateOnly(s.date);
  else if (s.from || s.to) where.businessDate = { ...(s.from ? { gte: dateOnly(s.from) } : {}), ...(s.to ? { lte: dateOnly(s.to) } : {}) };
  if (s.status) where.status = s.status as Prisma.InvoiceWhereInput['status'];
  if (s.method) where.payments = { some: { method: s.method, voided: false } };
  const q = s.q?.trim();
  if (q) {
    const digits = q.replace(/[^\d.]/g, '');
    const or: Prisma.InvoiceWhereInput[] = [
      { number: { contains: q, mode: 'insensitive' } },
      { tableName: { equals: q.toUpperCase().startsWith('T') ? q.toUpperCase() : `T${q.padStart(2, '0')}` } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { customerPhone: { contains: q } },
    ];
    if (/^\d+$/.test(q)) or.push({ orderNumber: Number(q) });
    if (digits && /^\d+(\.\d{1,2})?$/.test(digits)) or.push({ total: Math.round(Number(digits) * 100) });
    where.OR = or;
  }
  const rows = await db().invoice.findMany({ where, include: invoiceInclude, orderBy: { createdAt: 'desc' }, take: Math.min(s.limit ?? 100, 500) });
  return rows.map(toInvoiceDTO);
}

export async function recentInvoices(limit = 80) {
  const today = businessDate();
  const rows = await db().invoice.findMany({
    where: { businessDate: dateOnly(today) },
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(toInvoiceDTO);
}

/** Records a reprint. Reprinting never creates a sale. */
export async function markReprint(user: SessionUser, id: string) {
  const inv = await db().invoice.update({ where: { id }, data: { reprintCount: { increment: 1 } } });
  await audit(user, { action: 'invoice.reprint', entity: 'invoice', entityId: id, summary: `Reprinted bill ${inv.number} (copy ${inv.reprintCount})` });
  return getInvoice(id);
}

function checkApproval(user: SessionUser, perm: 'bills.void' | 'refunds.create', token: string | null | undefined, requireForAll: boolean) {
  const own = can(user, perm);
  if (own && !requireForAll) return null;
  if (own && ['admin', 'manager'].includes(user.roleKey)) return null;
  const ok = readApproval(token, perm);
  if (!ok) throw approvalNeeded(perm === 'bills.void' ? 'A manager must approve voiding this bill.' : 'A manager must approve this refund.');
  return ok.byName;
}

export async function voidInvoice(user: SessionUser, id: string, reason: string, approvalToken?: string | null) {
  if (!reason?.trim()) throw badRequest('A reason is required to void a bill.');
  const settings = await getSettings();
  const approvedBy = checkApproval(user, 'bills.void', approvalToken, settings.billing.requireApprovalForVoid);

  await db().$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
    if (!inv) throw notFound('Bill');
    if (inv.status === 'VOID') throw conflict('This bill is already void.');
    if (inv.refunded > 0) throw conflict('This bill has a refund. Void is not possible — refund the rest instead.');
    await tx.invoice.update({ where: { id }, data: { status: 'VOID', voidedAt: new Date(), voidReason: reason.trim(), voidedById: user.id } });
    await tx.payment.updateMany({ where: { invoiceId: id }, data: { voided: true } });
    await tx.order.update({ where: { id: inv.orderId }, data: { status: 'CANCELLED', cancelReason: `Bill voided: ${reason.trim()}`, cancelledAt: new Date(), cancelledById: user.id } });
    await consumeForSale(tx, inv.items.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty })), inv.number, user.id, -1);
    await audit(
      user,
      {
        action: 'invoice.void',
        entity: 'invoice',
        entityId: id,
        summary: `Voided bill ${inv.number} (${formatMoney(inv.total)}) — ${reason.trim()}${approvedBy ? ` (approved by ${approvedBy})` : ''}`,
      },
      tx,
    );
  });
  publish('invoices', 'orders', 'inventory');
  return getInvoice(id);
}

export async function refundInvoice(
  user: SessionUser,
  id: string,
  input: { amount: number; method: PaymentMethod; reason: string; approvalToken?: string | null },
) {
  if (!input.reason?.trim()) throw badRequest('A reason is required for a refund.');
  if (!(input.amount > 0)) throw badRequest('Enter the refund amount.');
  const approvedBy = checkApproval(user, 'refunds.create', input.approvalToken, false);

  await db().$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id } });
    if (!inv) throw notFound('Bill');
    if (inv.status === 'VOID') throw conflict('This bill is void.');
    const left = inv.total - inv.refunded;
    if (input.amount > left) throw badRequest(`You can refund at most ${formatMoney(left)} on this bill.`);
    const shift = input.method === 'CASH' ? await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } }) : null;
    await tx.refund.create({
      data: { invoiceId: id, amount: input.amount, method: input.method, reason: input.reason.trim(), byId: user.id, shiftId: shift?.id ?? null },
    });
    const refunded = inv.refunded + input.amount;
    await tx.invoice.update({ where: { id }, data: { refunded, status: refunded >= inv.total ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    await audit(
      user,
      {
        action: 'invoice.refund',
        entity: 'invoice',
        entityId: id,
        summary: `Refunded ${formatMoney(input.amount)} by ${input.method.toLowerCase().replace('_', ' ')} on bill ${inv.number} — ${input.reason.trim()}${approvedBy ? ` (approved by ${approvedBy})` : ''}`,
        details: { businessDate: businessDate() },
      },
      tx,
    );
  });
  publish('invoices', 'shift');
  return getInvoice(id);
}
