/** Database rows → the DTOs the screens use. */
import type { Prisma } from '@prisma/client';
import type { InvoiceDTO, OrderDTO, OrderItemDTO, OrderModifier } from '../../shared/types.js';

export const orderInclude = {
  items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  tickets: { orderBy: { round: 'asc' } },
  table: { select: { name: true } },
  createdBy: { select: { name: true } },
  invoice: { select: { id: true } },
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderDTO(o: OrderRow): OrderDTO {
  return {
    id: o.id,
    number: o.number,
    type: o.type,
    status: o.status,
    tableId: o.tableId,
    tableName: o.table?.name ?? null,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    deliveryAddress: o.deliveryAddress,
    guests: o.guests,
    note: o.note,
    discount: o.discountType && o.discountValue ? { type: o.discountType, value: o.discountValue, reason: o.discountReason } : null,
    billPrintedAt: o.billPrintedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    createdByName: o.createdBy?.name ?? null,
    items: o.items.map(
      (i): OrderItemDTO => ({
        id: i.id,
        menuItemId: i.menuItemId,
        name: i.name,
        basePrice: i.basePrice,
        unitPrice: i.unitPrice,
        modifiers: (i.modifiers as unknown as OrderModifier[]) ?? [],
        qty: i.qty,
        sentQty: i.sentQty,
        note: i.note,
        taxRate: i.taxRate,
        kitchen: i.kitchen,
      }),
    ),
    tickets: o.tickets.map((t) => ({ id: t.id, round: t.round, status: t.status, createdAt: t.createdAt.toISOString() })),
    invoiceId: o.invoice?.id ?? null,
  };
}

export const invoiceInclude = {
  items: true,
  payments: { where: { voided: false }, orderBy: { createdAt: 'asc' } },
  cashier: { select: { name: true } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export function toInvoiceDTO(inv: InvoiceRow): InvoiceDTO {
  return {
    id: inv.id,
    number: inv.number,
    orderId: inv.orderId,
    orderNumber: inv.orderNumber,
    orderType: inv.orderType,
    tableName: inv.tableName,
    customerName: inv.customerName,
    customerPhone: inv.customerPhone,
    subtotal: inv.subtotal,
    discount: inv.discount,
    discountLabel: inv.discountLabel,
    taxable: inv.taxable,
    tax: inv.tax,
    taxInclusive: inv.taxInclusive,
    roundOff: inv.roundOff,
    total: inv.total,
    paid: inv.paid,
    change: inv.change,
    refunded: inv.refunded,
    status: inv.status,
    cashierName: inv.cashier?.name ?? null,
    createdAt: inv.createdAt.toISOString(),
    reprintCount: inv.reprintCount,
    offline: inv.createdOffline,
    voidReason: inv.voidReason,
    items: inv.items.map((i) => ({
      name: i.name,
      modifiersText: i.modifiersText,
      note: i.note,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      taxRate: i.taxRate,
    })),
    payments: inv.payments.map((p) => ({ method: p.method, amount: p.amount, tendered: p.tendered, change: p.change, reference: p.reference })),
  };
}
