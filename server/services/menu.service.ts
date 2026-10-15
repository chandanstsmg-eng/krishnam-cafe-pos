import type { Prisma } from '@prisma/client';
import { db } from '../db/prisma.js';
import { badRequest, notFound } from '../utils/errors.js';
import { formatMoney } from '../../shared/money.js';
import type { CatalogCategory, CatalogItem, SessionUser } from '../../shared/types.js';
import { audit } from './audit.service.js';
import { publish } from './events.service.js';

export async function catalog(): Promise<{ categories: CatalogCategory[]; items: CatalogItem[] }> {
  const [cats, items] = await Promise.all([
    db().menuCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    db().menuItem.findMany({
      where: { active: true, category: { active: true } },
      include: { taxRate: true, modifierGroups: { include: { options: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);
  return {
    categories: cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon, sortOrder: c.sortOrder })),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      code: i.code,
      categoryId: i.categoryId,
      price: i.price,
      taxRate: i.taxRate?.active ? i.taxRate.rate : 0,
      isVeg: i.isVeg,
      available: i.available,
      sendToKitchen: i.sendToKitchen,
      imageUrl: i.imageUrl,
      modifierGroups: i.modifierGroups.map((g) => ({
        id: g.id,
        name: g.name,
        required: g.required,
        multiple: g.multiple,
        options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta, isDefault: o.isDefault })),
      })),
    })),
  };
}

export async function adminMenu() {
  const [categories, items, taxRates] = await Promise.all([
    db().menuCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { items: true } } } }),
    db().menuItem.findMany({
      include: {
        taxRate: true,
        modifierGroups: { include: { options: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } },
        recipe: { include: { inventoryItem: { select: { id: true, name: true, unit: true, purchasePrice: true } } } },
        priceChanges: { orderBy: { createdAt: 'desc' }, take: 1, include: { changedBy: { select: { name: true } } } },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    db().taxRate.findMany({ orderBy: { rate: 'asc' } }),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon, sortOrder: c.sortOrder, active: c.active, itemCount: c._count.items })),
    taxRates: taxRates.map((t) => ({ id: t.id, name: t.name, rate: t.rate, active: t.active })),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      code: i.code,
      description: i.description,
      categoryId: i.categoryId,
      price: i.price,
      taxRateId: i.taxRateId,
      isVeg: i.isVeg,
      available: i.available,
      active: i.active,
      sendToKitchen: i.sendToKitchen,
      imageUrl: i.imageUrl,
      sortOrder: i.sortOrder,
      modifierGroups: i.modifierGroups.map((g) => ({
        id: g.id,
        name: g.name,
        required: g.required,
        multiple: g.multiple,
        options: g.options.map((o) => ({ id: o.id, name: o.name, priceDelta: o.priceDelta, isDefault: o.isDefault })),
      })),
      recipe: i.recipe.map((r) => ({ inventoryItemId: r.inventoryItemId, name: r.inventoryItem.name, unit: r.inventoryItem.unit, quantity: r.quantity, cost: Math.round(r.quantity * r.inventoryItem.purchasePrice) })),
      unitCost: i.recipe.length ? Math.round(i.recipe.reduce((a, r) => a + r.quantity * r.inventoryItem.purchasePrice, 0)) : null,
      lastPriceChange: i.priceChanges[0]
        ? { oldPrice: i.priceChanges[0].oldPrice, newPrice: i.priceChanges[0].newPrice, at: i.priceChanges[0].createdAt.toISOString(), by: i.priceChanges[0].changedBy?.name ?? null }
        : null,
    })),
  };
}

export interface ItemInput {
  name: string;
  code?: string | null;
  description?: string | null;
  categoryId: string;
  price: number;
  taxRateId?: string | null;
  isVeg?: boolean;
  available?: boolean;
  active?: boolean;
  sendToKitchen?: boolean;
  imageUrl?: string | null;
  sortOrder?: number;
}

export async function createItem(user: SessionUser, input: ItemInput) {
  const item = await db().menuItem.create({
    data: { ...input, name: input.name.trim(), code: input.code?.trim().toUpperCase() || null },
  });
  await audit(user, { action: 'menu.create', entity: 'menu_item', entityId: item.id, summary: `Added ${item.name} to the menu at ${formatMoney(item.price)}` });
  publish('menu');
  return item;
}

export async function updateItem(user: SessionUser, id: string, input: Partial<ItemInput>) {
  const before = await db().menuItem.findUnique({ where: { id }, include: { category: true, taxRate: true } });
  if (!before) throw notFound('Menu item');
  const data: Prisma.MenuItemUncheckedUpdateInput = { ...input };
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.code !== undefined) data.code = input.code?.trim().toUpperCase() || null;

  const item = await db().$transaction(async (tx) => {
    const updated = await tx.menuItem.update({ where: { id }, data, include: { category: true, taxRate: true } });
    if (input.price !== undefined && input.price !== before.price) {
      await tx.priceChange.create({ data: { menuItemId: id, oldPrice: before.price, newPrice: input.price, changedById: user.id } });
      await audit(user, { action: 'menu.price_change', entity: 'menu_item', entityId: id, summary: `Changed ${before.name} price ${formatMoney(before.price)} → ${formatMoney(input.price)}`, details: { old: before.price, new: input.price } }, tx);
    }
    const changes: string[] = [];
    if (input.name !== undefined && updated.name !== before.name) changes.push(`name to "${updated.name}"`);
    if (input.categoryId !== undefined && updated.categoryId !== before.categoryId) changes.push(`category to ${updated.category.name}`);
    if (input.taxRateId !== undefined && updated.taxRateId !== before.taxRateId) changes.push(`tax to ${updated.taxRate ? updated.taxRate.name : 'none'}`);
    if (input.active !== undefined && updated.active !== before.active) changes.push(updated.active ? 'back on the menu' : 'removed from the menu');
    if (changes.length) await audit(user, { action: 'menu.update', entity: 'menu_item', entityId: id, summary: `Updated ${before.name}: ${changes.join(', ')}` }, tx);
    if (input.available !== undefined && updated.available !== before.available) {
      await audit(user, { action: 'menu.availability', entity: 'menu_item', entityId: id, summary: `Marked ${before.name} as ${updated.available ? 'available' : 'sold out'}` }, tx);
    }
    return updated;
  });
  publish('menu');
  return item;
}

export async function deleteItem(user: SessionUser, id: string) {
  const item = await db().menuItem.findUnique({ where: { id } });
  if (!item) throw notFound('Menu item');
  const sold = await db().invoiceItem.count({ where: { menuItemId: id } });
  const onOrder = await db().orderItem.count({ where: { menuItemId: id } });
  if (sold || onOrder) {
    await db().menuItem.update({ where: { id }, data: { active: false } });
    await audit(user, { action: 'menu.update', entity: 'menu_item', entityId: id, summary: `Removed ${item.name} from the menu (kept for past bills)` });
    publish('menu');
    return { deleted: false, deactivated: true };
  }
  await db().menuItem.delete({ where: { id } });
  await audit(user, { action: 'menu.delete', entity: 'menu_item', entityId: id, summary: `Deleted ${item.name} from the menu` });
  publish('menu');
  return { deleted: true, deactivated: false };
}

export async function setModifiers(
  user: SessionUser,
  id: string,
  groups: { name: string; required: boolean; multiple: boolean; options: { name: string; priceDelta: number; isDefault: boolean }[] }[],
) {
  const item = await db().menuItem.findUnique({ where: { id } });
  if (!item) throw notFound('Menu item');
  for (const g of groups) if (!g.options.length) throw badRequest(`Add at least one option to "${g.name}".`);
  await db().$transaction(async (tx) => {
    await tx.menuModifierGroup.deleteMany({ where: { menuItemId: id } });
    for (const [gi, g] of groups.entries()) {
      await tx.menuModifierGroup.create({
        data: {
          menuItemId: id,
          name: g.name.trim(),
          required: g.required,
          multiple: g.multiple,
          sortOrder: gi,
          options: { create: g.options.map((o, oi) => ({ name: o.name.trim(), priceDelta: o.priceDelta, isDefault: o.isDefault, sortOrder: oi })) },
        },
      });
    }
    await audit(user, { action: 'menu.modifiers', entity: 'menu_item', entityId: id, summary: `Updated options for ${item.name}` }, tx);
  });
  publish('menu');
}

export async function setRecipe(user: SessionUser, id: string, lines: { inventoryItemId: string; quantity: number }[]) {
  const item = await db().menuItem.findUnique({ where: { id } });
  if (!item) throw notFound('Menu item');
  await db().$transaction(async (tx) => {
    await tx.recipeLine.deleteMany({ where: { menuItemId: id } });
    const clean = lines.filter((l) => l.quantity > 0);
    if (clean.length) await tx.recipeLine.createMany({ data: clean.map((l) => ({ menuItemId: id, inventoryItemId: l.inventoryItemId, quantity: l.quantity })) });
    await audit(user, { action: 'menu.recipe', entity: 'menu_item', entityId: id, summary: `Updated stock usage for ${item.name}` }, tx);
  });
  publish('menu');
}

export async function priceHistory(limit = 200, itemId?: string) {
  const rows = await db().priceChange.findMany({
    where: itemId ? { menuItemId: itemId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { menuItem: { select: { name: true } }, changedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, menuItemId: r.menuItemId, item: r.menuItem.name, oldPrice: r.oldPrice, newPrice: r.newPrice, by: r.changedBy?.name ?? null, at: r.createdAt.toISOString() }));
}
