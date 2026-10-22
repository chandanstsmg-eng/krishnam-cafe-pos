/**
 * The café's working day, end to end, through the real HTTP API:
 * orders, kitchen, payments, offline replay, voids, refunds, discounts,
 * permissions, stock, shift closing, day closing and reports.
 */
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import '../server/config.js';
import type { CatalogItem, OrderDTO, PosBootstrap, SyncCommand } from '../shared/types.js';

process.env.DATABASE_URL = inject('testDbUrl');

let app: Express;
const agents: Record<string, ReturnType<typeof request.agent>> = {};
let boot: PosBootstrap;
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

async function signIn(username: string) {
  const a = request.agent(app);
  const r = await a.post('/api/auth/login').send({ username, password: process.env.DEMO_PASSWORD });
  expect(r.status, `login ${username}`).toBe(200);
  return a;
}

function line(item: CatalogItem, qty = 1, mods: { groupName: string; name: string; priceDelta: number }[] = []) {
  return {
    id: uuid(),
    menuItemId: item.id,
    name: item.name,
    basePrice: item.price,
    unitPrice: item.price + mods.reduce((a, m) => a + m.priceDelta, 0),
    modifiers: mods,
    qty,
    note: null,
    taxRate: item.taxRate,
    kitchen: item.sendToKitchen,
  };
}

const item = (name: string) => boot.items.find((i) => i.name === name)!;
/** A table with no running order right now (a table takes one order until it is paid). */
async function freeTable() {
  const { openOrders } = (await agents.cashier.get('/api/pos/bootstrap')).body as PosBootstrap;
  return boot.tables.find((t) => !openOrders.some((o) => o.tableId === t.id) && t.hold === 'NONE')!;
}

async function sync(who: string, ...commands: SyncCommand[]) {
  const r = await agents[who].post('/api/pos/sync').send({ commands });
  expect(r.status).toBe(200);
  return r.body.results as { id: string; ok: boolean; error?: string; code?: string; order?: OrderDTO; invoice?: { id: string; number: string; total: number } }[];
}

function saveCmd(order: { id: string; type: 'DINE_IN' | 'TAKEAWAY'; tableId: string | null; items: ReturnType<typeof line>[]; discount?: { type: 'PERCENT' | 'AMOUNT'; value: number } | null }, extra: Partial<{ sendToKitchen: boolean; discountApproval: string; offline: boolean }> = {}): SyncCommand {
  return {
    id: uuid(),
    type: 'order.save',
    at: now(),
    offline: extra.offline,
    payload: {
      order: { id: order.id, type: order.type, tableId: order.tableId, customerName: null, customerPhone: null, deliveryAddress: null, guests: 2, note: null, discount: order.discount ?? null, createdAt: now(), items: order.items },
      sendToKitchen: extra.sendToKitchen ?? true,
      ticketId: uuid(),
      discountApproval: extra.discountApproval ?? null,
    },
  };
}

function payCmd(orderId: string, amount: number, method: 'CASH' | 'UPI' = 'CASH', extra: Partial<{ tendered: number; offlineNumber: string; offline: boolean }> = {}): SyncCommand {
  return {
    id: uuid(),
    type: 'order.pay',
    at: now(),
    offline: extra.offline,
    payload: { orderId, invoiceId: uuid(), offlineNumber: extra.offlineNumber ?? null, payments: [{ method, amount, tendered: extra.tendered ?? null }], paidAt: now(), expectedTotal: amount },
  };
}

beforeAll(async () => {
  const { createApp } = await import('../server/app.js');
  app = await createApp({ serveClient: false });
  for (const u of ['cashier', 'manager', 'admin', 'kitchen']) agents[u] = await signIn(u);
  boot = (await agents.cashier.get('/api/pos/bootstrap')).body;
});

afterAll(async () => {
  const { disconnect } = await import('../server/db/prisma.js');
  await disconnect();
});

describe('a normal day at the counter', () => {
  it('rejects wrong passwords without saying which part was wrong', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'cashier', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Username or password is incorrect.');
  });

  it('accepts only 4-digit PINs', async () => {
    const staff = (await request(app).get('/api/auth/staff')).body.staff as { id: string }[];
    for (const pin of ['12345', '123456', '123']) {
      const r = await request(app).post('/api/auth/pin').send({ userId: staff[0].id, pin });
      expect(r.status, `sign-in with ${pin}`).toBe(400);
    }
    expect((await agents.cashier.post('/api/auth/approve').send({ pin: '22222', permission: 'discounts.apply' })).status).toBe(400);
    const roles = (await agents.admin.get('/api/staff')).body.roles as { id: string; key: string }[];
    const r = await agents.admin.post('/api/staff').send({ name: 'Five Digit', username: 'fivedigit', roleId: roles.find((x) => x.key === 'waiter')!.id, password: 'Waiter@1234', pin: '12345' });
    expect(r.status).toBe(400);
  });

  it('keeps kitchen staff away from billing and cashiers away from settings', async () => {
    expect((await agents.kitchen.post('/api/pos/sync').send({ commands: [] })).status).toBe(403);
    expect((await agents.cashier.put('/api/settings/billing').send({})).status).toBe(403);
    expect((await agents.cashier.get('/api/staff')).status).toBe(403);
  });

  it('takes a dine-in order with options, sends it to the kitchen and takes cash with change', async () => {
    const table = await freeTable();
    const dosa = item('Masala Dosa');
    const butter = dosa.modifierGroups[0].options.find((o) => o.name === 'Butter')!;
    const order = { id: uuid(), type: 'DINE_IN' as const, tableId: table.id, items: [line(dosa, 2, [{ groupName: 'Style', name: 'Butter', priceDelta: butter.priceDelta }]), line(item('Tea'), 2)] };
    const [saved] = await sync('cashier', saveCmd(order));
    expect(saved.ok).toBe(true);
    expect(saved.order!.number).toBeGreaterThan(1000);
    expect(saved.order!.tickets).toHaveLength(1);

    const tickets = (await agents.kitchen.get('/api/kitchen/tickets')).body as { id: string; orderId: string; items: { name: string; qty: number }[] }[];
    const tk = tickets.find((t) => t.orderId === order.id)!;
    expect(tk.items).toEqual([expect.objectContaining({ name: 'Masala Dosa', qty: 2 })]); // tea is made at the counter
    expect((await agents.kitchen.patch(`/api/kitchen/tickets/${tk.id}`).send({ status: 'PREPARING' })).status).toBe(200);
    expect((await agents.kitchen.patch(`/api/kitchen/tickets/${tk.id}`).send({ status: 'READY' })).status).toBe(200);

    // (70 × 2 + 15 × 2) = 170 + 5% GST 8.50 = 178.50 → rounded 179
    const [paid] = await sync('cashier', payCmd(order.id, 17900, 'CASH', { tendered: 50000 }));
    expect(paid.ok, paid.error).toBe(true);
    expect(paid.invoice!.total).toBe(17900);
    expect(paid.invoice!.number).toMatch(/^INV-\d{6}$/);
    const inv = (await agents.cashier.get(`/api/invoices/${paid.invoice!.id}`)).body;
    expect(inv.change).toBe(50000 - 17900);
  });

  it('adds items to a running order as a second kitchen ticket', async () => {
    const order = { id: uuid(), type: 'DINE_IN' as const, tableId: (await freeTable()).id, items: [line(item('Idli'), 1)] };
    await sync('cashier', saveCmd(order));
    order.items[0].qty = 3;
    order.items.push(line(item('Vada'), 1));
    const [r] = await sync('cashier', saveCmd(order));
    expect(r.order!.tickets).toHaveLength(2);
    const tickets = (await agents.kitchen.get('/api/kitchen/tickets')).body as { orderId: string; round: number; items: { name: string; qty: number }[] }[];
    const second = tickets.find((t) => t.orderId === order.id && t.round === 2)!;
    expect(second.items).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Idli', qty: 2 }), expect.objectContaining({ name: 'Vada', qty: 1 })]));
  });

  it('holds a table for its running order until it is paid', async () => {
    const tableId = (await freeTable()).id;
    const first = { id: uuid(), type: 'DINE_IN' as const, tableId, items: [line(item('Tea'), 1)] };
    await sync('cashier', saveCmd(first));
    const [clash] = await sync('cashier', saveCmd({ id: uuid(), type: 'DINE_IN', tableId, items: [line(item('Coffee'), 1)] }));
    expect(clash.ok).toBe(false);
    expect(clash.code).toBe('CONFLICT');
    // Moving another running order onto it is refused too.
    const other = { id: uuid(), type: 'DINE_IN' as const, tableId: (await freeTable()).id, items: [line(item('Tea'), 1)] };
    await sync('cashier', saveCmd(other));
    const [move] = await sync('cashier', saveCmd({ ...other, tableId }));
    expect(move.ok).toBe(false);
    // Adding to the running order itself still works.
    first.items.push(line(item('Vada'), 2));
    const [more] = await sync('cashier', saveCmd(first));
    expect(more.ok).toBe(true);
    expect(more.order!.items).toHaveLength(2);
  });

  it('refuses a payment that is short, and a bill whose total changed', async () => {
    const order = { id: uuid(), type: 'TAKEAWAY' as const, tableId: null, items: [line(item('Coffee'), 1)] };
    await sync('cashier', saveCmd(order));
    const [short] = await sync('cashier', { ...payCmd(order.id, 1000), payload: { ...(payCmd(order.id, 1000).payload as object), expectedTotal: 2100 } } as SyncCommand);
    expect(short.ok).toBe(false);
    expect(short.error).toMatch(/short/i);
    const [changed] = await sync('cashier', payCmd(order.id, 9999));
    expect(changed.code).toBe('TOTAL_CHANGED');
  });

  it('does not bill twice when the till repeats a payment (lost Wi-Fi reply)', async () => {
    const order = { id: uuid(), type: 'TAKEAWAY' as const, tableId: null, items: [line(item('Samosa'), 2)] };
    await sync('cashier', saveCmd(order));
    const cmd = payCmd(order.id, 4200, 'UPI');
    const [first] = await sync('cashier', cmd);
    const [again] = await sync('cashier', cmd);
    expect(first.ok && again.ok).toBe(true);
    const bills = (await agents.cashier.get(`/api/invoices?q=${first.invoice!.number}`)).body;
    expect(bills).toHaveLength(1);
  });

  it('accepts bills taken while offline, keeping the offline bill number', async () => {
    const order = { id: uuid(), type: 'TAKEAWAY' as const, tableId: null, items: [line(item('Water Bottle'), 1)] };
    const results = await sync('cashier', saveCmd(order, { offline: true }), payCmd(order.id, 2000, 'CASH', { offlineNumber: 'OFL-TST-0001', offline: true }));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[1].invoice!.number).toBe('OFL-TST-0001');
  });

  it('asks for manager approval above the cashier discount limit', async () => {
    const order = { id: uuid(), type: 'DINE_IN' as const, tableId: (await freeTable()).id, items: [line(item('Meals'), 2)], discount: { type: 'PERCENT' as const, value: 25 } };
    const [r] = await sync('cashier', saveCmd(order));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('APPROVAL_REQUIRED');
    const bad = await agents.cashier.post('/api/auth/approve').send({ pin: '0000', permission: 'discounts.apply' });
    expect(bad.status).toBe(403);
    const ok = await agents.cashier.post('/api/auth/approve').send({ pin: process.env.DEMO_PIN_MANAGER, permission: 'discounts.apply' });
    expect(ok.status).toBe(200);
    const [approved] = await sync('cashier', saveCmd(order, { discountApproval: ok.body.token }));
    expect(approved.ok, approved.error).toBe(true);
    const log = (await agents.admin.get('/api/audit?action=order.discount')).body;
    expect(log.rows[0].summary).toMatch(/approved by Suresh Gowda/);
  });

  it('voids a bill only with a reason and approval, and keeps it out of sales', async () => {
    const order = { id: uuid(), type: 'TAKEAWAY' as const, tableId: null, items: [line(item('Idli'), 1)] };
    await sync('cashier', saveCmd(order));
    const [paid] = await sync('cashier', payCmd(order.id, 4200));
    const id = paid.invoice!.id;
    expect((await agents.cashier.post(`/api/invoices/${id}/void`).send({ reason: 'Wrong order' })).status).toBe(403);
    const token = (await agents.cashier.post('/api/auth/approve').send({ pin: process.env.DEMO_PIN_MANAGER, permission: 'bills.void' })).body.token;
    const v = await agents.cashier.post(`/api/invoices/${id}/void`).send({ reason: 'Wrong order', approvalToken: token });
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('VOID');
    // reprint is fine and does not create a sale
    const before = (await agents.admin.get('/api/dashboard')).body.today.bills;
    expect((await agents.cashier.post(`/api/invoices/${id}/print`).send({ reprint: true })).body.invoice.reprintCount).toBe(1);
    expect((await agents.admin.get('/api/dashboard')).body.today.bills).toBe(before);
  });

  it('records a partial refund against the cash drawer', async () => {
    const order = { id: uuid(), type: 'TAKEAWAY' as const, tableId: null, items: [line(item('Meals'), 1)] };
    await sync('cashier', saveCmd(order));
    const [paid] = await sync('cashier', payCmd(order.id, 10500));
    const shiftBefore = (await agents.manager.get('/api/shifts/current')).body;
    const r = await agents.manager.post(`/api/invoices/${paid.invoice!.id}/refund`).send({ amount: 5000, method: 'CASH', reason: 'Item not served' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('PARTIALLY_REFUNDED');
    const tooMuch = await agents.manager.post(`/api/invoices/${paid.invoice!.id}/refund`).send({ amount: 9000, method: 'CASH', reason: 'x' });
    expect(tooMuch.status).toBe(400);
    const shiftAfter = (await agents.manager.get('/api/shifts/current')).body;
    expect(shiftAfter.expectedCash).toBe(shiftBefore.expectedCash - 5000);
  });

  it('cancels an order the kitchen started only with a manager', async () => {
    const order = { id: uuid(), type: 'DINE_IN' as const, tableId: (await freeTable()).id, items: [line(item('Poori'), 1)] };
    await sync('cashier', saveCmd(order));
    const [denied] = await sync('cashier', { id: uuid(), type: 'order.cancel', at: now(), payload: { orderId: order.id, reason: 'Customer left' } });
    expect(denied.code).toBe('APPROVAL_REQUIRED');
    const [ok] = await sync('manager', { id: uuid(), type: 'order.cancel', at: now(), payload: { orderId: order.id, reason: 'Customer left' } });
    expect(ok.ok).toBe(true);
    const tickets = (await agents.kitchen.get('/api/kitchen/tickets')).body as { orderId: string }[];
    expect(tickets.some((t) => t.orderId === order.id)).toBe(false);
  });

  it('deducts stock by recipe when a bill is paid', async () => {
    const stock = async () => ((await agents.admin.get('/api/inventory')).body as { name: string; currentStock: number }[]).find((i) => i.name === 'Water Bottles (1 L)')!.currentStock;
    const before = await stock();
    const order = { id: uuid(), type: 'TAKEAWAY' as const, tableId: null, items: [line(item('Water Bottle'), 3)] };
    await sync('cashier', saveCmd(order));
    await sync('cashier', payCmd(order.id, 6000));
    expect(await stock()).toBe(before - 3);
  });

  it('records price changes with old and new price', async () => {
    const tea = item('Tea');
    const r = await agents.admin.patch(`/api/menu/${tea.id}`).send({ price: 2000 });
    expect(r.status).toBe(200);
    const history = (await agents.admin.get('/api/menu/price-changes')).body;
    expect(history[0]).toMatchObject({ item: 'Tea', oldPrice: 1500, newPrice: 2000, by: 'Ravi Kumar' });
    // a cashier may mark an item sold out, but not change its price
    expect((await agents.cashier.patch(`/api/menu/${tea.id}`).send({ available: false })).status).toBe(200);
    expect((await agents.cashier.patch(`/api/menu/${tea.id}`).send({ price: 100 })).status).toBe(403);
  });

  it('records an expense paid from the drawer', async () => {
    const before = (await agents.manager.get('/api/shifts/current')).body.expectedCash;
    const r = await agents.admin.post('/api/expenses').send({ category: 'Gas', description: 'Gas cylinder', amount: 125000, date: boot.businessDate, paymentMethod: 'CASH', fromDrawer: true });
    expect(r.status).toBe(201);
    expect((await agents.manager.get('/api/shifts/current')).body.expectedCash).toBe(before - 125000);
  });

  it('closes the shift, explaining a shortage', async () => {
    const s = (await agents.manager.get('/api/shifts/current')).body;
    const noNote = await agents.manager.post('/api/shifts/close').send({ countedCash: s.expectedCash - 10000 });
    expect(noNote.status).toBe(400);
    const closed = await agents.manager.post('/api/shifts/close').send({ countedCash: s.expectedCash - 10000, note: 'Change given twice' });
    expect(closed.status).toBe(200);
    expect(closed.body.difference).toBe(-10000);
    const noShift = await sync('cashier', payCmd(boot.openOrders[0].id, 1));
    expect(noShift[0].code).toBe('NO_SHIFT');
    expect((await agents.cashier.post('/api/shifts/open').send({ openingCash: 300000 })).status).toBe(200);
  });

  it('builds every report, with totals that agree with the dashboard', async () => {
    const d = boot.businessDate;
    const dash = (await agents.admin.get('/api/dashboard')).body.today;
    const sales = (await agents.admin.get(`/api/reports/sales?from=${d}&to=${d}`)).body;
    expect(sales.totals.total).toBe(dash.sales);
    expect(sales.totals.bills).toBe(dash.bills);
    const pay = (await agents.admin.get(`/api/reports/payments?from=${d}&to=${d}`)).body;
    expect(pay.totals.cash).toBe(dash.cash);
    for (const k of ['items', 'categories', 'expenses', 'inventory', 'tax', 'discounts', 'voids', 'cashiers', 'shifts', 'closings']) {
      const r = await agents.admin.get(`/api/reports/${k}?from=2026-08-01&to=${d}`);
      expect(r.status, k).toBe(200);
    }
    const csv = await agents.admin.get(`/api/reports/sales?from=${d}&to=${d}&format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
  });

  it('closes the day once, and only once', async () => {
    const d = boot.businessDate;
    const blocked = await agents.admin.post('/api/closing').send({ date: d });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Close the cash shift/);
    const s = (await agents.manager.get('/api/shifts/current')).body;
    expect((await agents.manager.post('/api/shifts/close').send({ countedCash: s.expectedCash })).status).toBe(200);
    const first = await agents.admin.post('/api/closing').send({ date: d, note: 'test' });
    expect(first.status).toBe(200);
    expect(first.body.closed).not.toBeNull();
    expect((await agents.admin.post('/api/closing').send({ date: d })).status).toBe(409);
  });

  it('never leaks technical details in errors', async () => {
    const r = await agents.cashier.post('/api/pos/sync').send({ commands: [{ nonsense: true }] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|prisma|at \w+ \(/i);
  });
});
