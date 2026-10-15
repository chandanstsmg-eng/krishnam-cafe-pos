import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { can } from '../middleware/auth.js';
import { audit } from '../services/audit.service.js';
import { publish } from '../services/events.service.js';
import * as menu from '../services/menu.service.js';
import { forbidden } from '../utils/errors.js';
import { id, optText, paise } from '../validators/common.js';

const itemBody = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  code: z.string().trim().max(12).nullish(),
  description: optText(240),
  categoryId: id,
  price: paise,
  taxRateId: id.nullish(),
  isVeg: z.boolean().optional(),
  available: z.boolean().optional(),
  active: z.boolean().optional(),
  sendToKitchen: z.boolean().optional(),
  imageUrl: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().optional(),
});

export const list = async (_req: Request, res: Response) => res.json(await menu.catalog());
export const admin = async (_req: Request, res: Response) => res.json(await menu.adminMenu());

export async function create(req: Request, res: Response) {
  res.status(201).json(await menu.createItem(req.user!, itemBody.parse(req.body)));
}

/**
 * One endpoint, three levels of access: anyone who takes orders may mark an
 * item sold out; price-only changes need "Change prices"; anything else needs
 * "Manage menu".
 */
export async function update(req: Request, res: Response) {
  const body = itemBody.partial().parse(req.body);
  const keys = Object.keys(body);
  const onlyAvailability = keys.every((k) => k === 'available');
  const onlyPrice = keys.every((k) => k === 'price');
  const u = req.user;
  const allowed = can(u, 'menu.manage') || (onlyPrice && can(u, 'menu.prices')) || (onlyAvailability && can(u, 'orders.take'));
  if (!allowed) throw forbidden();
  res.json(await menu.updateItem(req.user!, String(req.params.id), body));
}

export async function remove(req: Request, res: Response) {
  res.json(await menu.deleteItem(req.user!, String(req.params.id)));
}

export async function modifiers(req: Request, res: Response) {
  const body = z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        required: z.boolean(),
        multiple: z.boolean(),
        options: z.array(z.object({ name: z.string().trim().min(1).max(40), priceDelta: z.number().int().min(-10_000_00).max(10_000_00), isDefault: z.boolean() })).max(12),
      }),
    )
    .max(6)
    .parse(req.body);
  await menu.setModifiers(req.user!, String(req.params.id), body);
  res.json({ ok: true });
}

export async function recipe(req: Request, res: Response) {
  const body = z.array(z.object({ inventoryItemId: id, quantity: z.number().min(0).max(100000) })).max(30).parse(req.body);
  await menu.setRecipe(req.user!, String(req.params.id), body);
  res.json({ ok: true });
}

export const priceHistory = async (req: Request, res: Response) => res.json(await menu.priceHistory(200, typeof req.query.itemId === 'string' ? req.query.itemId : undefined));

// ── Categories ──

const categoryBody = z.object({ name: z.string().trim().min(1).max(40), icon: z.string().max(40).nullish(), sortOrder: z.number().int().optional(), active: z.boolean().optional() });

export async function createCategory(req: Request, res: Response) {
  const body = categoryBody.parse(req.body);
  const max = await db().menuCategory.aggregate({ _max: { sortOrder: true } });
  const c = await db().menuCategory.create({ data: { ...body, sortOrder: body.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } });
  await audit(req.user!, { action: 'menu.category', entity: 'category', entityId: c.id, summary: `Added category ${c.name}` });
  publish('menu');
  res.status(201).json(c);
}

export async function updateCategory(req: Request, res: Response) {
  const body = categoryBody.partial().parse(req.body);
  const c = await db().menuCategory.update({ where: { id: String(req.params.id) }, data: body });
  await audit(req.user!, { action: 'menu.category', entity: 'category', entityId: c.id, summary: `Updated category ${c.name}` });
  publish('menu');
  res.json(c);
}

export async function deleteCategory(req: Request, res: Response) {
  const cid = String(req.params.id);
  const count = await db().menuItem.count({ where: { categoryId: cid } });
  if (count) {
    const c = await db().menuCategory.update({ where: { id: cid }, data: { active: false } });
    publish('menu');
    return res.json({ deleted: false, hidden: true, message: `${c.name} still has ${count} items, so it was hidden instead of deleted.` });
  }
  const c = await db().menuCategory.delete({ where: { id: cid } });
  await audit(req.user!, { action: 'menu.category', entity: 'category', entityId: cid, summary: `Deleted category ${c.name}` });
  publish('menu');
  res.json({ deleted: true });
}

export async function reorderCategories(req: Request, res: Response) {
  const ids = z.array(id).parse(req.body);
  await db().$transaction(ids.map((cid, i) => db().menuCategory.update({ where: { id: cid }, data: { sortOrder: i } })));
  publish('menu');
  res.json({ ok: true });
}

// ── Tax rates ──

const taxBody = z.object({ name: z.string().trim().min(1).max(40), rate: z.number().min(0).max(40), active: z.boolean().optional() });

export async function listTaxes(_req: Request, res: Response) {
  res.json(await db().taxRate.findMany({ orderBy: { rate: 'asc' } }));
}

export async function createTax(req: Request, res: Response) {
  const t = await db().taxRate.create({ data: taxBody.parse(req.body) });
  await audit(req.user!, { action: 'settings.tax', entity: 'tax', entityId: t.id, summary: `Added tax rate ${t.name} (${t.rate}%)` });
  publish('menu');
  res.status(201).json(t);
}

export async function updateTax(req: Request, res: Response) {
  const before = await db().taxRate.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  const t = await db().taxRate.update({ where: { id: before.id }, data: taxBody.partial().parse(req.body) });
  await audit(req.user!, { action: 'settings.tax', entity: 'tax', entityId: t.id, summary: `Changed tax ${before.name} ${before.rate}% → ${t.name} ${t.rate}%${t.active ? '' : ' (turned off)'}` });
  publish('menu');
  res.json(t);
}

/** Owner's quick price list: change many prices in one go. */
export async function bulkPrices(req: Request, res: Response) {
  const body = z.array(z.object({ id, price: paise })).min(1).max(300).parse(req.body);
  let changed = 0;
  for (const row of body) {
    const cur = await db().menuItem.findUnique({ where: { id: row.id }, select: { price: true } });
    if (cur && cur.price !== row.price) {
      await menu.updateItem(req.user!, row.id, { price: row.price });
      changed++;
    }
  }
  res.json({ changed, message: changed ? `${changed} price${changed > 1 ? 's' : ''} updated.` : 'No prices changed.' });
}
