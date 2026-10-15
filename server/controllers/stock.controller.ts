/** Stock items, stock movements and suppliers. */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { audit } from '../services/audit.service.js';
import { publish } from '../services/events.service.js';
import { moveStock, recordMovement } from '../services/inventory.service.js';
import { id, optText, paise, phone } from '../validators/common.js';
import { formatMoney } from '../../shared/money.js';

export async function listItems(_req: Request, res: Response) {
  const items = await db().inventoryItem.findMany({
    include: { supplier: { select: { id: true, name: true } }, _count: { select: { recipeLines: true } } },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
  const since = new Date(Date.now() - 7 * 86400_000);
  const usage = await db().inventoryTransaction.groupBy({ by: ['itemId'], where: { type: 'CONSUMPTION', createdAt: { gte: since } }, _sum: { quantity: true } });
  res.json(
    items.map((i) => {
      const used7 = Math.abs(usage.find((u) => u.itemId === i.id)?._sum.quantity ?? 0);
      const perDay = used7 / 7;
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        unit: i.unit,
        currentStock: i.currentStock,
        minStock: i.minStock,
        purchasePrice: i.purchasePrice,
        supplierId: i.supplierId,
        supplierName: i.supplier?.name ?? null,
        active: i.active,
        usedInRecipes: i._count.recipeLines,
        usePerDay: Math.round(perDay * 100) / 100,
        daysLeft: perDay > 0 ? Math.floor(i.currentStock / perDay) : null,
        status: i.currentStock <= 0 ? 'OUT' : i.currentStock <= i.minStock ? 'LOW' : 'OK',
      };
    }),
  );
}

const itemBody = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  category: z.string().trim().min(1).max(40),
  unit: z.string().trim().min(1).max(12),
  minStock: z.number().min(0).max(1e6),
  purchasePrice: paise,
  supplierId: id.nullish(),
  active: z.boolean().optional(),
  openingStock: z.number().min(0).max(1e6).optional(),
});

export async function createItem(req: Request, res: Response) {
  const { openingStock, ...body } = itemBody.parse(req.body);
  const item = await db().$transaction(async (tx) => {
    const it = await tx.inventoryItem.create({ data: body });
    if (openingStock) await moveStock(tx, it.id, 'OPENING', openingStock, { note: 'Opening stock', userId: req.user!.id, unitCost: body.purchasePrice });
    await audit(req.user!, { action: 'inventory.create', entity: 'inventory', entityId: it.id, summary: `Added stock item ${it.name}${openingStock ? ` with ${openingStock} ${it.unit}` : ''}` }, tx);
    return it;
  });
  publish('inventory');
  res.status(201).json(item);
}

export async function updateItem(req: Request, res: Response) {
  const { openingStock: _ignored, ...body } = itemBody.partial().parse(req.body);
  const before = await db().inventoryItem.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  const it = await db().inventoryItem.update({ where: { id: before.id }, data: body });
  const changes: string[] = [];
  if (body.purchasePrice !== undefined && body.purchasePrice !== before.purchasePrice) changes.push(`cost ${formatMoney(before.purchasePrice)} → ${formatMoney(body.purchasePrice)}`);
  if (body.minStock !== undefined && body.minStock !== before.minStock) changes.push(`minimum ${before.minStock} → ${body.minStock} ${it.unit}`);
  if (body.active === false && before.active) changes.push('turned off');
  await audit(req.user!, { action: 'inventory.update', entity: 'inventory', entityId: it.id, summary: `Updated ${it.name}${changes.length ? `: ${changes.join(', ')}` : ''}` });
  publish('inventory');
  res.json(it);
}

const moveBody = z.object({
  itemId: id,
  type: z.enum(['PURCHASE', 'CONSUMPTION', 'WASTE', 'ADJUSTMENT', 'RETURN']),
  quantity: z.number().min(0).max(1e6),
  unitCost: paise.nullish(),
  note: optText(200),
  supplierId: id.nullish(),
});

export async function adjust(req: Request, res: Response) {
  res.json(await recordMovement(req.user!, moveBody.parse(req.body)));
}

export async function movements(req: Request, res: Response) {
  const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const rows = await db().inventoryTransaction.findMany({
    where: { ...(itemId ? { itemId } : {}), ...(type ? { type: type as never } : {}) },
    include: { item: { select: { name: true, unit: true } }, user: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: itemId ? 300 : 200,
  });
  res.json(
    rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      item: r.item.name,
      unit: r.item.unit,
      type: r.type,
      quantity: r.quantity,
      balanceAfter: r.balanceAfter,
      unitCost: r.unitCost,
      note: r.note,
      reference: r.reference,
      supplier: r.supplier?.name ?? null,
      by: r.user?.name ?? null,
    })),
  );
}

// ── Suppliers ──

const supplierBody = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  contactPerson: optText(60),
  phone,
  address: optText(240),
  gstin: z.string().trim().max(15).nullish(),
  notes: optText(400),
  active: z.boolean().optional(),
});

export async function listSuppliers(_req: Request, res: Response) {
  const rows = await db().supplier.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { inventoryItems: true } }, expenses: { where: { deletedAt: null }, select: { amount: true, date: true } } },
  });
  res.json(
    rows.map((s) => ({
      id: s.id,
      name: s.name,
      contactPerson: s.contactPerson,
      phone: s.phone,
      address: s.address,
      gstin: s.gstin,
      notes: s.notes,
      active: s.active,
      items: s._count.inventoryItems,
      totalPaid: s.expenses.reduce((a, e) => a + e.amount, 0),
      lastPaid: s.expenses.map((e) => e.date.toISOString().slice(0, 10)).sort().pop() ?? null,
    })),
  );
}

export async function createSupplier(req: Request, res: Response) {
  const s = await db().supplier.create({ data: supplierBody.parse(req.body) });
  await audit(req.user!, { action: 'supplier.create', entity: 'supplier', entityId: s.id, summary: `Added supplier ${s.name}` });
  publish('inventory');
  res.status(201).json(s);
}

export async function updateSupplier(req: Request, res: Response) {
  const s = await db().supplier.update({ where: { id: String(req.params.id) }, data: supplierBody.partial().parse(req.body) });
  await audit(req.user!, { action: 'supplier.update', entity: 'supplier', entityId: s.id, summary: `Updated supplier ${s.name}` });
  publish('inventory');
  res.json(s);
}
