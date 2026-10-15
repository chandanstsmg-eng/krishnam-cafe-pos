import type { InventoryTxnType } from '@prisma/client';
import { db, type Tx } from '../db/prisma.js';
import { badRequest, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { publish } from './events.service.js';
import type { SessionUser } from '../../shared/types.js';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Applies a signed stock change and records it. */
export async function moveStock(
  tx: Tx,
  itemId: string,
  type: InventoryTxnType,
  delta: number,
  meta: { note?: string | null; reference?: string | null; unitCost?: number | null; supplierId?: string | null; userId?: string | null; at?: Date },
) {
  const item = await tx.inventoryItem.update({
    where: { id: itemId },
    data: { currentStock: { increment: round3(delta) } },
  });
  const balance = round3(item.currentStock);
  if (balance !== item.currentStock) await tx.inventoryItem.update({ where: { id: itemId }, data: { currentStock: balance } });
  await tx.inventoryTransaction.create({
    data: {
      itemId,
      type,
      quantity: round3(delta),
      balanceAfter: balance,
      note: meta.note ?? null,
      reference: meta.reference ?? null,
      unitCost: meta.unitCost ?? null,
      supplierId: meta.supplierId ?? null,
      userId: meta.userId ?? null,
      createdAt: meta.at,
    },
  });
  return { ...item, currentStock: balance };
}

/** Deducts recipe ingredients for the items on a paid bill. */
export async function consumeForSale(tx: Tx, lines: { menuItemId: string | null; qty: number }[], reference: string, userId: string, sign: 1 | -1 = 1) {
  const ids = [...new Set(lines.map((l) => l.menuItemId).filter(Boolean) as string[])];
  if (!ids.length) return;
  const recipe = await tx.recipeLine.findMany({ where: { menuItemId: { in: ids } } });
  if (!recipe.length) return;
  const need = new Map<string, number>();
  for (const l of lines) {
    for (const r of recipe) if (r.menuItemId === l.menuItemId) need.set(r.inventoryItemId, (need.get(r.inventoryItemId) ?? 0) + r.quantity * l.qty);
  }
  for (const [itemId, qty] of need) {
    await moveStock(tx, itemId, sign === 1 ? 'CONSUMPTION' : 'ADJUSTMENT', -sign * qty, {
      reference,
      note: sign === 1 ? 'Sold' : 'Bill voided — stock returned',
      userId,
    });
  }
  publish('inventory');
}

/** Estimated ingredient cost (paise) of one unit of each menu item, where a recipe exists. */
export async function unitCosts(tx: Tx, menuItemIds: string[]) {
  const recipe = await tx.recipeLine.findMany({
    where: { menuItemId: { in: menuItemIds } },
    include: { inventoryItem: { select: { purchasePrice: true } } },
  });
  const cost = new Map<string, number>();
  for (const r of recipe) cost.set(r.menuItemId, (cost.get(r.menuItemId) ?? 0) + r.quantity * r.inventoryItem.purchasePrice);
  return cost;
}

const TYPE_SIGN: Record<string, 1 | -1 | 0> = { PURCHASE: 1, RETURN: -1, WASTE: -1, CONSUMPTION: -1, ADJUSTMENT: 0, OPENING: 0 };
const TYPE_LABEL: Record<string, string> = {
  PURCHASE: 'Purchased',
  RETURN: 'Returned to supplier',
  WASTE: 'Wasted',
  CONSUMPTION: 'Used',
  ADJUSTMENT: 'Stock corrected',
};

/**
 * Manual stock entry from the back office.
 * For ADJUSTMENT the quantity is the new counted stock, not a difference.
 */
export async function recordMovement(
  user: SessionUser,
  input: { itemId: string; type: InventoryTxnType; quantity: number; unitCost?: number | null; note?: string | null; supplierId?: string | null },
) {
  const result = await db().$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw notFound('Stock item');
    if (input.type === 'OPENING') throw badRequest('Opening stock is set when the item is created.');
    let delta: number;
    if (input.type === 'ADJUSTMENT') {
      if (input.quantity < 0) throw badRequest('Counted stock cannot be negative.');
      delta = input.quantity - item.currentStock;
    } else {
      if (!(input.quantity > 0)) throw badRequest('Enter a quantity greater than zero.');
      delta = TYPE_SIGN[input.type] * input.quantity;
    }
    const updated = await moveStock(tx, item.id, input.type, delta, {
      note: input.note,
      unitCost: input.unitCost,
      supplierId: input.supplierId ?? (input.type === 'PURCHASE' ? item.supplierId : null),
      userId: user.id,
    });
    if (input.type === 'PURCHASE' && input.unitCost && input.unitCost > 0 && input.unitCost !== item.purchasePrice) {
      await tx.inventoryItem.update({ where: { id: item.id }, data: { purchasePrice: input.unitCost } });
    }
    const q = `${round3(Math.abs(delta))} ${item.unit}`;
    await audit(
      user,
      {
        action: `inventory.${input.type.toLowerCase()}`,
        entity: 'inventory',
        entityId: item.id,
        summary:
          input.type === 'ADJUSTMENT'
            ? `Corrected ${item.name} stock ${round3(item.currentStock)} → ${round3(input.quantity)} ${item.unit}${input.note ? ` (${input.note})` : ''}`
            : `${TYPE_LABEL[input.type]} ${q} of ${item.name}${input.note ? ` (${input.note})` : ''}`,
      },
      tx,
    );
    return updated;
  });
  publish('inventory');
  return result;
}
