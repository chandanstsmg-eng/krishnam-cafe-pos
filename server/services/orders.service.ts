/**
 * Order life cycle: save (with optional kitchen ticket), pay, cancel.
 *
 * Every POS action arrives as a command with an id chosen by the terminal (see
 * sync.service.ts). The functions here are written so that the same command
 * can safely be applied twice, which is what makes offline billing safe.
 */
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db, type Tx } from '../db/prisma.js';
import { AppError, approvalNeeded, badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { readApproval } from '../utils/crypto.js';
import { computeBill, discountAmount, discountLabel, settle } from '../../shared/billing.js';
import { businessDate, dateOnly } from '../../shared/dates.js';
import { deriveOrderStatus } from '../../shared/orderStatus.js';
import { formatMoney } from '../../shared/money.js';
import type { InvoiceDTO, OrderCancelPayload, OrderDTO, OrderModifier, OrderPayPayload, OrderSavePayload, SessionUser } from '../../shared/types.js';
import { can } from '../middleware/auth.js';
import { audit } from './audit.service.js';
import { formatInvoiceNo, nextNumber } from './counters.service.js';
import { publish } from './events.service.js';
import { consumeForSale, unitCosts } from './inventory.service.js';
import { invoiceInclude, orderInclude, toInvoiceDTO, toOrderDTO, type OrderRow } from './mappers.js';
import { getSettings } from './settings.service.js';

interface CommandContext {
  offline: boolean;
  at: Date;
}

const OPEN_STATUSES = ['NEW', 'PREPARING', 'READY', 'SERVED'] as const;

export async function getOrder(id: string, tx?: Tx): Promise<OrderDTO | null> {
  const row = await (tx ?? db()).order.findUnique({ where: { id }, include: orderInclude });
  return row ? toOrderDTO(row) : null;
}

export async function listOpenOrders(): Promise<OrderDTO[]> {
  const rows = await db().order.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    include: orderInclude,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toOrderDTO);
}

export async function refreshOrderStatus(tx: Tx, orderId: string) {
  const o = await tx.order.findUnique({ where: { id: orderId }, include: { tickets: true, items: true } });
  if (!o || !OPEN_STATUSES.includes(o.status as (typeof OPEN_STATUSES)[number])) return;
  const hasUnsent = o.items.some((i) => i.kitchen && i.qty > i.sentQty);
  const status = deriveOrderStatus(o.tickets, hasUnsent);
  if (status !== o.status) await tx.order.update({ where: { id: orderId }, data: { status } });
}

const modifiersText = (m: OrderModifier[]) => m.map((x) => x.name).join(', ');

/**
 * Current catalog price for an item + chosen modifiers. Used for items added
 * while online so a tampered request cannot bill at a made-up price.
 */
async function catalogPrice(tx: Tx, menuItemId: string, modifiers: OrderModifier[]) {
  const item = await tx.menuItem.findUnique({
    where: { id: menuItemId },
    include: { modifierGroups: { include: { options: true } }, taxRate: true, category: { select: { name: true } } },
  });
  if (!item) return null;
  const resolved: OrderModifier[] = [];
  for (const m of modifiers) {
    const group = item.modifierGroups.find((g) => g.name === m.groupName);
    const opt = group?.options.find((o) => o.name === m.name);
    if (!group || !opt) return { item, invalid: true as const };
    resolved.push({ groupName: group.name, name: opt.name, priceDelta: opt.priceDelta });
  }
  const unitPrice = item.price + resolved.reduce((a, m) => a + m.priceDelta, 0);
  return { item, invalid: false as const, basePrice: item.price, unitPrice, modifiers: resolved, taxRate: item.taxRate?.active ? item.taxRate.rate : 0 };
}

export async function saveOrder(user: SessionUser, p: OrderSavePayload, ctx: CommandContext): Promise<OrderDTO | null> {
  if (!can(user, 'orders.take')) throw forbidden('You are not allowed to take orders.');
  const input = p.order;
  const settings = await getSettings();

  const result = await db().$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id: input.id }, include: { items: true, table: true, tickets: true } });
    if (existing && !OPEN_STATUSES.includes(existing.status as (typeof OPEN_STATUSES)[number])) {
      if (existing.status === 'COMPLETED' && ctx.offline) return existing.id; // already settled from another till
      throw conflict(existing.status === 'CANCELLED' ? 'This order was cancelled.' : 'This order has already been paid.');
    }

    // ── Table ──
    let tableId: string | null = null;
    if (input.type === 'DINE_IN') {
      if (!input.tableId) throw badRequest('Choose a table for a dine-in order.');
      const table = await tx.diningTable.findUnique({ where: { id: input.tableId } });
      if (!table || !table.active) throw badRequest('That table is not available.');
      // One running order per table until it is paid. (Offline tills can't see
      // each other, so a clash made offline is accepted rather than lost.)
      if (!ctx.offline && existing?.tableId !== table.id) {
        // Two tills saving the same table at the same moment: the second waits here and then sees the first.
        await tx.$executeRaw`SELECT 1 FROM "tables" WHERE id = ${table.id} FOR UPDATE`;
        const other = await tx.order.findFirst({ where: { tableId: table.id, id: { not: input.id }, status: { in: [...OPEN_STATUSES] } }, select: { number: true } });
        if (other) throw conflict(`Table ${table.name} already has order #${other.number}. Open the table to add items to that order.`);
      }
      tableId = table.id;
      if (table.hold !== 'NONE') await tx.diningTable.update({ where: { id: table.id }, data: { hold: 'NONE' } });
    }

    // ── Items ──
    const before = new Map(existing?.items.map((i) => [i.id, i]) ?? []);
    const items: Prisma.OrderItemCreateManyInput[] = [];
    for (const [idx, it] of input.items.entries()) {
      if (!(it.qty >= 1 && it.qty <= 999 && Number.isInteger(it.qty))) throw badRequest(`Check the quantity for ${it.name}.`);
      const prev = before.get(it.id);
      let name = it.name;
      let basePrice = it.basePrice;
      let unitPrice = it.unitPrice;
      let modifiers = it.modifiers;
      let taxRate = it.taxRate;
      let kitchen = it.kitchen;
      if (prev) {
        // price snapshot is fixed once the item is on the order
        ({ name, basePrice, unitPrice, taxRate, kitchen } = prev);
        modifiers = prev.modifiers as unknown as OrderModifier[];
      } else if (!ctx.offline) {
        const cat = await catalogPrice(tx, it.menuItemId, it.modifiers);
        if (!cat) throw badRequest(`${it.name} is no longer on the menu.`);
        if (cat.invalid) throw badRequest(`The options chosen for ${it.name} have changed. Please add it again.`);
        if (!cat.item.active) throw badRequest(`${cat.item.name} is no longer on the menu.`);
        ({ basePrice, unitPrice, modifiers, taxRate } = cat);
        name = cat.item.name;
        kitchen = cat.item.sendToKitchen;
      }
      items.push({
        id: it.id,
        orderId: input.id,
        menuItemId: it.menuItemId,
        name,
        basePrice,
        unitPrice,
        modifiers: modifiers as unknown as Prisma.InputJsonValue,
        qty: it.qty,
        sentQty: Math.min(prev?.sentQty ?? 0, it.qty),
        note: it.note?.trim() || null,
        taxRate,
        kitchen,
        sortOrder: idx,
      });
    }

    // Several devices can work on one order (waiter's tablet, cashier's till).
    // Keep lines added elsewhere that this device never saw, rather than
    // treating them as deleted.
    if (p.removedItemIds) {
      const removed = new Set(p.removedItemIds);
      const sent = new Set(items.map((i) => i.id));
      for (const prev of before.values()) {
        if (sent.has(prev.id) || removed.has(prev.id)) continue;
        items.push({
          id: prev.id,
          orderId: input.id,
          menuItemId: prev.menuItemId,
          name: prev.name,
          basePrice: prev.basePrice,
          unitPrice: prev.unitPrice,
          modifiers: prev.modifiers as Prisma.InputJsonValue,
          qty: prev.qty,
          sentQty: prev.sentQty,
          note: prev.note,
          taxRate: prev.taxRate,
          kitchen: prev.kitchen,
          sortOrder: items.length,
        });
      }
    }

    // Items already sent to the kitchen that are being removed or reduced.
    const pulled: string[] = [];
    for (const prev of before.values()) {
      const now = items.find((i) => i.id === prev.id);
      const lost = prev.sentQty - (now ? Math.min(now.qty, prev.sentQty) : 0);
      if (prev.kitchen && lost > 0) pulled.push(`${lost} × ${prev.name}`);
    }
    if (pulled.length && !ctx.offline && !can(user, 'bills.void')) {
      const ok = readApproval(p.removalApproval, 'bills.void');
      if (!ok) throw approvalNeeded('These items were already sent to the kitchen. A manager must approve removing them.');
    }

    if (!items.length) {
      if (!existing) return null;
      if (existing.items.some((i) => i.sentQty > 0 && i.kitchen)) {
        throw badRequest('Items were already sent to the kitchen — use Cancel Order instead.');
      }
      await tx.order.delete({ where: { id: existing.id } });
      return null;
    }

    // ── Discount ──
    const subtotal = items.reduce((a, i) => a + i.unitPrice * i.qty, 0);
    const disc = input.discount && input.discount.value > 0 ? input.discount : null;
    const prevDisc = existing?.discountType ? { type: existing.discountType, value: existing.discountValue ?? 0 } : null;
    const discChanged = JSON.stringify(disc ? [disc.type, disc.value] : null) !== JSON.stringify(prevDisc ? [prevDisc.type, prevDisc.value] : null);
    let approvedBy: string | null = null;
    if (disc && discChanged) {
      if (disc.type === 'PERCENT' && disc.value > 100) throw badRequest('Discount cannot be more than 100%.');
      const pct = subtotal ? (discountAmount(subtotal, disc) / subtotal) * 100 : 0;
      const allowed = can(user, 'discounts.apply') && pct <= user.maxDiscountPercent + 0.001;
      if (!allowed && !ctx.offline) {
        const ok = readApproval(p.discountApproval, 'discounts.apply');
        if (!ok) throw approvalNeeded(can(user, 'discounts.apply') ? `Discounts above ${user.maxDiscountPercent}% need manager approval.` : 'A manager must approve this discount.');
        approvedBy = ok.byName;
      }
    }

    // ── Customer ──
    const phone = input.customerPhone?.replace(/\D/g, '').slice(-10) || null;
    let customerId: string | null = existing?.customerId ?? null;
    if (phone && phone.length === 10) {
      const c = await tx.customer.upsert({
        where: { phone },
        create: { phone, name: input.customerName?.trim() || null },
        update: input.customerName?.trim() ? { name: input.customerName.trim() } : {},
      });
      customerId = c.id;
    }

    const header = {
      type: input.type,
      tableId,
      customerId,
      customerName: input.customerName?.trim() || null,
      customerPhone: phone,
      deliveryAddress: input.type === 'DELIVERY' ? input.deliveryAddress?.trim() || null : null,
      guests: input.guests ?? null,
      note: input.note?.trim() || null,
      discountType: disc?.type ?? null,
      discountValue: disc?.value ?? null,
      discountReason: disc ? (input.discount?.reason?.trim() || null) : null,
      ...(p.printBill ? { billPrintedAt: ctx.at } : {}),
    };

    if (existing) {
      await tx.order.update({ where: { id: existing.id }, data: header });
      await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
    } else {
      const number = await nextNumber(tx, 'order', 1001);
      await tx.order.create({
        data: { id: input.id, number, ...header, createdById: user.id, createdOffline: ctx.offline, createdAt: new Date(input.createdAt) },
      });
    }
    await tx.orderItem.createMany({ data: items });

    // ── Kitchen ticket ──
    if (p.sendToKitchen) {
      const toSend = items.filter((i) => i.qty > (i.sentQty ?? 0));
      const kitchenLines = toSend.filter((i) => i.kitchen);
      if (kitchenLines.length) {
        const ticketId = p.ticketId ?? crypto.randomUUID();
        const already = await tx.kitchenTicket.findUnique({ where: { id: ticketId } });
        if (!already) {
          const round = (existing?.tickets.length ?? 0) + 1;
          await tx.kitchenTicket.create({
            data: {
              id: ticketId,
              orderId: input.id,
              round,
              status: settings.pos.kitchenDisplay ? 'NEW' : 'SERVED',
              servedAt: settings.pos.kitchenDisplay ? null : ctx.at,
              note: round === 1 ? header.note : null,
              createdAt: ctx.at,
              items: kitchenLines.map((i) => ({
                name: i.name,
                qty: i.qty - (i.sentQty ?? 0),
                modifiers: modifiersText(i.modifiers as unknown as OrderModifier[]) || null,
                note: i.note,
              })),
            },
          });
        }
      }
      for (const i of toSend) await tx.orderItem.update({ where: { id: i.id }, data: { sentQty: i.qty } });
    }
    await refreshOrderStatus(tx, input.id);

    // ── Audit ──
    const number = existing?.number ?? (await tx.order.findUnique({ where: { id: input.id }, select: { number: true } }))!.number;
    if (disc && discChanged) {
      await audit(
        user,
        {
          action: 'order.discount',
          entity: 'order',
          entityId: input.id,
          summary: `Discount ${disc.type === 'PERCENT' ? `${disc.value}%` : formatMoney(disc.value)} on order #${number}${input.discount?.reason ? ` — ${input.discount.reason}` : ''}${approvedBy ? ` (approved by ${approvedBy})` : ''}${ctx.offline && !approvedBy ? ' (offline)' : ''}`,
        },
        tx,
      );
    }
    if (pulled.length) {
      await audit(user, { action: 'order.item_removed', entity: 'order', entityId: input.id, summary: `Removed ${pulled.join(', ')} from order #${number} after sending to kitchen` }, tx);
    }
    if (existing && existing.tableId && tableId && existing.tableId !== tableId) {
      const to = await tx.diningTable.findUnique({ where: { id: tableId } });
      await audit(user, { action: 'order.table_moved', entity: 'order', entityId: input.id, summary: `Moved order #${number} from ${existing.table?.name} to ${to?.name}` }, tx);
    }
    return input.id;
  });

  publish('orders', 'tables', ...(p.sendToKitchen ? (['kitchen'] as const) : []));
  return result ? getOrder(result) : null;
}

export async function payOrder(user: SessionUser, p: OrderPayPayload, ctx: CommandContext): Promise<{ invoice: InvoiceDTO; order: OrderDTO }> {
  if (!can(user, 'payments.accept')) throw forbidden('You are not allowed to take payments.');
  const settings = await getSettings();

  // Two tills paying the same order at the same moment: the database allows
  // one bill per order, so the second one lands here.
  const alreadyPaid = (err: unknown): never => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && /orderId/i.test(String(err.meta?.target))) {
      throw conflict('This order has just been paid on another till.');
    }
    throw err;
  };

  const invoiceId = await db().$transaction(async (tx) => {
    const done = await tx.invoice.findUnique({ where: { id: p.invoiceId } });
    if (done) return done.id; // replayed command

    const order: OrderRow | null = await tx.order.findUnique({ where: { id: p.orderId }, include: orderInclude });
    if (!order) throw notFound('Order');
    if (order.status === 'CANCELLED') throw conflict('This order was cancelled.');
    if (order.status === 'COMPLETED' || order.invoice) throw conflict('This order has already been paid.');
    if (!order.items.length) throw badRequest('The order has no items.');

    const shift = await tx.shift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    if (!shift && settings.pos.requireShift && !ctx.offline) throw new AppError(409, 'Open a cash shift before taking payments.', 'NO_SHIFT');

    const bill = computeBill(
      order.items.map((i) => ({ key: i.id, unitPrice: i.unitPrice, qty: i.qty, taxRate: i.taxRate })),
      order.discountType ? { type: order.discountType, value: order.discountValue ?? 0 } : null,
      settings.billing,
    );
    if (bill.total !== p.expectedTotal && !ctx.offline) {
      throw new AppError(409, `The bill total changed to ${formatMoney(bill.total)}. Please check the bill and take payment again.`, 'TOTAL_CHANGED');
    }

    const payments = p.payments.filter((x) => x.amount > 0);
    if (!payments.length && bill.total > 0) throw badRequest('Enter the payment amount.');
    for (const x of payments) {
      if (!Number.isInteger(x.amount) || x.amount < 0) throw badRequest('Payment amount is not valid.');
      if (x.tendered != null && x.tendered < x.amount) throw badRequest('Cash received is less than the amount.');
    }
    const s = settle(bill.total, payments);
    if (s.due > 0 && !ctx.offline) throw badRequest(`Payment is short by ${formatMoney(s.due)}.`);
    if (s.over > 0 && !ctx.offline) throw badRequest(`Payments add up to more than the bill by ${formatMoney(s.over)}.`);

    let number = p.offlineNumber?.trim() || null;
    if (number && (await tx.invoice.findUnique({ where: { number } }))) number = null;
    if (!number) number = formatInvoiceNo(settings.billing.invoicePrefix, await nextNumber(tx, 'invoice', 1));

    const menuItems = await tx.menuItem.findMany({
      where: { id: { in: order.items.map((i) => i.menuItemId) } },
      select: { id: true, categoryId: true, category: { select: { name: true } } },
    });
    const costs = await unitCosts(tx, order.items.map((i) => i.menuItemId));
    const lineCost = (menuItemId: string, qty: number) => (costs.has(menuItemId) ? Math.round(costs.get(menuItemId)! * qty) : null);
    const costKnown = order.items.every((i) => costs.has(i.menuItemId));

    const phone = p.customerPhone?.replace(/\D/g, '').slice(-10) || order.customerPhone;
    let customerId = order.customerId;
    const customerName = p.customerName?.trim() || order.customerName;
    if (phone && phone.length === 10 && !customerId) {
      customerId = (await tx.customer.upsert({ where: { phone }, create: { phone, name: customerName || null }, update: customerName ? { name: customerName } : {} })).id;
    }

    // Online, the server's clock decides the bill's day; a tablet with a wrong date can't misfile it.
    const paidAt = ctx.offline ? new Date(p.paidAt) : new Date();
    const inv = await tx.invoice.create({
      data: {
        id: p.invoiceId,
        number,
        orderId: order.id,
        orderNumber: order.number,
        orderType: order.type,
        tableName: order.table?.name ?? null,
        customerId,
        customerName: customerName ?? null,
        customerPhone: phone ?? null,
        subtotal: bill.subtotal,
        discount: bill.discount,
        discountLabel: discountLabel(order.discountType ? { type: order.discountType, value: order.discountValue ?? 0 } : null),
        taxable: bill.taxable,
        tax: bill.tax,
        taxInclusive: bill.taxInclusive,
        roundOff: bill.roundOff,
        total: bill.total,
        paid: s.paid,
        change: s.change,
        costEstimate: costKnown ? order.items.reduce((a, i) => a + (lineCost(i.menuItemId, i.qty) ?? 0), 0) : null,
        cashierId: user.id,
        shiftId: shift?.id ?? null,
        businessDate: dateOnly(businessDate(paidAt)),
        createdOffline: ctx.offline,
        createdAt: paidAt,
        items: {
          create: order.items.map((i, idx) => {
            const mi = menuItems.find((m) => m.id === i.menuItemId);
            return {
              menuItemId: i.menuItemId,
              categoryId: mi?.categoryId ?? null,
              categoryName: mi?.category.name ?? null,
              name: i.name,
              modifiersText: modifiersText(i.modifiers as unknown as OrderModifier[]) || null,
              note: i.note,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: bill.lines[idx].gross,
              discountShare: bill.lines[idx].discountShare,
              taxRate: i.taxRate,
              taxAmount: bill.lines[idx].tax,
              costEstimate: lineCost(i.menuItemId, i.qty),
            };
          }),
        },
        payments: {
          create: payments.map((x) => ({
            method: x.method,
            amount: x.amount,
            tendered: x.method === 'CASH' ? (x.tendered ?? x.amount) : null,
            change: x.method === 'CASH' && x.tendered ? x.tendered - x.amount : null,
            reference: x.reference?.trim() || null,
            shiftId: shift?.id ?? null,
            receivedById: user.id,
            createdAt: paidAt,
          })),
        },
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'COMPLETED', completedAt: paidAt, customerId, customerName: customerName ?? null, customerPhone: phone ?? null },
    });
    await consumeForSale(tx, order.items.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty })), number, user.id);

    if (ctx.offline && (s.due > 0 || s.over > 0)) {
      await audit(user, { action: 'invoice.offline_mismatch', entity: 'invoice', entityId: inv.id, summary: `Bill ${number} was taken offline and its payments differ from the total by ${formatMoney(s.paid - bill.total)}` }, tx);
    }
    return inv.id;
  }).catch(alreadyPaid);

  publish('orders', 'tables', 'invoices', 'kitchen');
  const inv = await db().invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceInclude });
  return { invoice: toInvoiceDTO(inv), order: (await getOrder(inv.orderId))! };
}

export async function cancelOrder(user: SessionUser, p: OrderCancelPayload, ctx: CommandContext) {
  const reason = p.reason?.trim();
  if (!reason) throw badRequest('Choose a reason for cancelling.');
  const res = await db().$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: p.orderId }, include: { items: true } });
    if (!order) return null; // never reached the server — nothing to cancel
    if (order.status === 'CANCELLED') return order.id;
    if (order.status === 'COMPLETED') throw conflict('This order is already paid. Void the bill instead.');
    const started = order.items.some((i) => i.kitchen && i.sentQty > 0) || !!order.billPrintedAt;
    let approvedBy: string | null = null;
    if (started && !can(user, 'bills.void') && !ctx.offline) {
      const ok = readApproval(p.approvalToken, 'bills.void');
      if (!ok) throw approvalNeeded('This order was already sent to the kitchen. A manager must approve cancelling it.');
      approvedBy = ok.byName;
    }
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: ctx.at, cancelledById: user.id },
    });
    await tx.kitchenTicket.updateMany({ where: { orderId: order.id, status: { in: ['NEW', 'PREPARING', 'READY'] } }, data: { status: 'CANCELLED' } });
    const total = order.items.reduce((a, i) => a + i.unitPrice * i.qty, 0);
    await audit(
      user,
      {
        action: 'order.cancel',
        entity: 'order',
        entityId: order.id,
        summary: `Cancelled order #${order.number} (${formatMoney(total)}) — ${reason}${approvedBy ? ` (approved by ${approvedBy})` : ''}`,
      },
      tx,
    );
    return order.id;
  });
  publish('orders', 'tables', 'kitchen');
  return res ? getOrder(res) : null;
}

export async function markServed(user: SessionUser, orderId: string) {
  if (!can(user, 'orders.take') && !can(user, 'kitchen.view')) throw forbidden();
  await db().$transaction(async (tx) => {
    await tx.kitchenTicket.updateMany({ where: { orderId, status: { in: ['READY', 'PREPARING', 'NEW'] } }, data: { status: 'SERVED', servedAt: new Date() } });
    await refreshOrderStatus(tx, orderId);
  });
  publish('orders', 'kitchen', 'tables');
  return getOrder(orderId);
}
