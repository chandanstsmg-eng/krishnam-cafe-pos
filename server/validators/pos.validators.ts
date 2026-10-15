import { z } from 'zod';
import { id, optText, paise, payMethod, phone } from './common.js';

const modifier = z.object({ groupName: z.string().max(60), name: z.string().max(60), priceDelta: z.number().int() });

const orderItem = z.object({
  id: z.string().uuid(),
  menuItemId: id,
  name: z.string().max(120),
  basePrice: paise,
  unitPrice: paise,
  modifiers: z.array(modifier).max(10),
  qty: z.number().int().min(1).max(999),
  note: optText(140),
  taxRate: z.number().min(0).max(40),
  kitchen: z.boolean(),
});

const discount = z
  .object({ type: z.enum(['PERCENT', 'AMOUNT']), value: z.number().min(0), reason: optText(120) })
  .nullable();

const orderSave = z.object({
  order: z.object({
    id: z.string().uuid(),
    type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
    tableId: id.nullable(),
    customerName: optText(80),
    customerPhone: phone,
    deliveryAddress: optText(240),
    guests: z.number().int().min(1).max(99).nullish(),
    note: optText(200),
    discount,
    createdAt: z.string().datetime(),
    items: z.array(orderItem).max(200),
  }),
  sendToKitchen: z.boolean(),
  ticketId: z.string().uuid().optional(),
  printBill: z.boolean().optional(),
  discountApproval: z.string().max(2000).nullish(),
  removalApproval: z.string().max(2000).nullish(),
  removedItemIds: z.array(z.string().uuid()).max(500).optional(),
});

const orderPay = z.object({
  orderId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  offlineNumber: z.string().max(40).nullish(),
  payments: z
    .array(z.object({ method: payMethod, amount: paise, tendered: paise.nullish(), reference: optText(60) }))
    .min(1)
    .max(6),
  customerName: optText(80),
  customerPhone: phone,
  paidAt: z.string().datetime(),
  expectedTotal: z.number().int(),
});

const base = { id: z.string().uuid(), at: z.string().datetime(), offline: z.boolean().optional() };

export const syncCommand = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('order.save'), payload: orderSave }),
  z.object({ ...base, type: z.literal('order.pay'), payload: orderPay }),
  z.object({ ...base, type: z.literal('order.cancel'), payload: z.object({ orderId: z.string().uuid(), reason: z.string().trim().min(1).max(200), approvalToken: z.string().max(2000).nullish() }) }),
  z.object({ ...base, type: z.literal('order.served'), payload: z.object({ orderId: z.string().uuid(), status: z.literal('SERVED') }) }),
]);

export const syncBody = z.object({ commands: z.array(syncCommand).min(1).max(200) });
export const orderSaveBody = orderSave;
export const orderPayBody = orderPay.omit({ orderId: true });
