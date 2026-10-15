/**
 * API routes. Each line states who may call it; the controllers do the rest.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePermission as allow } from '../middleware/auth.js';
import { handler as h } from '../middleware/asyncHandler.js';
import { subscribe } from '../services/events.service.js';
import * as auth from '../controllers/auth.controller.js';
import * as pos from '../controllers/pos.controller.js';
import * as inv from '../controllers/invoices.controller.js';
import * as kitchen from '../controllers/kitchen.controller.js';
import * as menu from '../controllers/menu.controller.js';
import * as floor from '../controllers/floor.controller.js';
import * as stock from '../controllers/stock.controller.js';
import * as expenses from '../controllers/expenses.controller.js';
import * as staff from '../controllers/staff.controller.js';
import * as office from '../controllers/office.controller.js';
import * as settings from '../controllers/settings.controller.js';

const r = Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  // Every device in the café shares one internet address: only wrong attempts count.
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again.', code: 'RATE_LIMIT' },
});
const pinLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many PIN attempts. Please wait a few minutes.', code: 'RATE_LIMIT' },
});

r.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Sign in ──
r.post('/auth/login', loginLimiter, h(auth.login));
r.post('/auth/pin', pinLimiter, h(auth.pinLogin));
r.get('/auth/staff', h(auth.staffList));
r.get('/auth/me', h(auth.me));
r.post('/auth/logout', h(auth.logout));

r.use(requireAuth);
r.post('/auth/approve', pinLimiter, h(auth.approve));
r.post('/auth/password', h(auth.changePassword));
r.get('/events', subscribe);

// ── Counter ──
const counter = allow('orders.take', 'bills.create', 'payments.accept');
r.get('/pos/bootstrap', allow('orders.take', 'bills.create', 'payments.accept', 'kitchen.view', 'reports.view'), h(pos.bootstrap));
r.post('/pos/sync', counter, h(pos.sync));
r.get('/orders', counter, h(pos.listOrders));
r.get('/orders/:id', counter, h(pos.getOne));
r.post('/orders', allow('orders.take'), h(pos.createOrder));
r.patch('/orders/:id', allow('orders.take'), h(pos.updateOrder));
r.post('/orders/:id/pay', allow('payments.accept'), h(pos.payOrder));
r.post('/orders/:id/cancel', allow('orders.take'), h(pos.cancelOrder));
r.post('/orders/:id/served', allow('orders.take', 'kitchen.view'), h(pos.servedOrder));

r.get('/invoices', allow('receipts.print', 'reports.view'), h(inv.search));
r.get('/invoices/:id', allow('receipts.print', 'reports.view'), h(inv.one));
r.post('/invoices/:id/print', allow('receipts.print'), h(inv.print));
r.post('/invoices/:id/void', allow('bills.void', 'bills.create', 'receipts.print'), h(inv.voidBill));
r.post('/invoices/:id/refund', allow('refunds.create', 'bills.create', 'receipts.print'), h(inv.refund));

r.get('/kitchen/tickets', allow('kitchen.view', 'orders.take'), h(kitchen.tickets));
r.patch('/kitchen/tickets/:id', allow('kitchen.view', 'orders.take'), h(kitchen.setStatus));
r.post('/kitchen/tickets/:id/print', allow('kitchen.view', 'orders.take'), h(settings.printKot));

r.get('/shifts/current', h(office.currentShift));
r.post('/shifts/open', allow('shifts.manage'), h(office.openShift));
r.post('/shifts/cash', allow('shifts.manage'), h(office.cashMovement));
r.post('/shifts/close', allow('shifts.manage'), h(office.closeShift));
r.get('/shifts', allow('shifts.manage', 'reports.view'), h(office.listShifts));
r.get('/shifts/:id', allow('shifts.manage', 'reports.view'), h(office.shiftDetail));

r.get('/search', h(office.search));
r.get('/notifications', h(office.getNotifications));
r.post('/print/document', allow('receipts.print', 'bills.create', 'settings.manage'), h(settings.printDocument));

// ── Menu ──
r.get('/menu', h(menu.list));
r.get('/menu/admin', allow('menu.manage', 'menu.prices'), h(menu.admin));
r.get('/menu/price-changes', allow('menu.manage', 'menu.prices', 'audit.view'), h(menu.priceHistory));
r.post('/menu', allow('menu.manage'), h(menu.create));
r.patch('/menu/prices', allow('menu.prices', 'menu.manage'), h(menu.bulkPrices));
r.patch('/menu/:id', allow('menu.manage', 'menu.prices', 'orders.take'), h(menu.update));
r.delete('/menu/:id', allow('menu.manage'), h(menu.remove));
r.put('/menu/:id/modifiers', allow('menu.manage'), h(menu.modifiers));
r.put('/menu/:id/recipe', allow('menu.manage', 'inventory.manage'), h(menu.recipe));
r.post('/categories', allow('menu.manage'), h(menu.createCategory));
r.put('/categories/order', allow('menu.manage'), h(menu.reorderCategories));
r.patch('/categories/:id', allow('menu.manage'), h(menu.updateCategory));
r.delete('/categories/:id', allow('menu.manage'), h(menu.deleteCategory));
r.get('/tax-rates', allow('settings.manage', 'menu.manage', 'menu.prices'), h(menu.listTaxes));
r.post('/tax-rates', allow('settings.manage'), h(menu.createTax));
r.patch('/tax-rates/:id', allow('settings.manage'), h(menu.updateTax));

// ── Floor ──
r.get('/tables', h(floor.posTables));
r.get('/tables/admin', allow('tables.manage', 'settings.manage'), h(floor.adminTables));
r.post('/tables', allow('settings.manage'), h(floor.createTable));
r.patch('/tables/:id', allow('tables.manage', 'settings.manage'), h(floor.updateTable));
r.delete('/tables/:id', allow('settings.manage'), h(floor.deleteTable));
r.get('/reservations', allow('tables.manage'), h(floor.listReservations));
r.post('/reservations', allow('tables.manage'), h(floor.createReservation));
r.patch('/reservations/:id', allow('tables.manage'), h(floor.updateReservation));
r.get('/customers', allow('customers.view'), h(floor.listCustomers));
r.get('/customers/lookup', allow('orders.take', 'customers.view'), h(floor.lookupCustomer));
r.get('/customers/:id', allow('customers.view'), h(floor.customerDetail));
r.patch('/customers/:id', allow('customers.view'), h(floor.updateCustomer));

// ── Stock & money out ──
r.get('/inventory', allow('inventory.manage', 'reports.view', 'menu.manage'), h(stock.listItems));
r.post('/inventory', allow('inventory.manage'), h(stock.createItem));
r.patch('/inventory/:id', allow('inventory.manage'), h(stock.updateItem));
r.post('/inventory/adjust', allow('inventory.manage'), h(stock.adjust));
r.get('/inventory/movements', allow('inventory.manage', 'reports.view'), h(stock.movements));
r.get('/suppliers', allow('inventory.manage', 'expenses.manage'), h(stock.listSuppliers));
r.post('/suppliers', allow('inventory.manage', 'expenses.manage'), h(stock.createSupplier));
r.patch('/suppliers/:id', allow('inventory.manage', 'expenses.manage'), h(stock.updateSupplier));
r.get('/expenses', allow('expenses.manage', 'reports.view'), h(expenses.list));
r.post('/expenses', allow('expenses.manage'), h(expenses.create));
r.patch('/expenses/:id', allow('expenses.manage'), h(expenses.update));
r.delete('/expenses/:id', allow('expenses.manage'), h(expenses.remove));

// ── Owner ──
r.get('/dashboard', allow('reports.view'), h(office.getDashboard));
r.get('/analytics', allow('reports.view'), h(office.getAnalytics));
r.get('/reports', allow('reports.view'), office.reportList);
r.get('/reports/:key', allow('reports.view'), h(office.report));
r.get('/closing', allow('day.close', 'reports.view'), h(office.closing));
r.post('/closing', allow('day.close'), h(office.doClose));
r.get('/audit', allow('audit.view'), h(office.auditLog));
r.get('/staff', allow('staff.manage'), h(staff.list));
r.post('/staff', allow('staff.manage'), h(staff.create));
r.patch('/staff/:id', allow('staff.manage'), h(staff.update));
r.post('/roles', allow('staff.manage'), h(staff.createRole));
r.patch('/roles/:id', allow('staff.manage'), h(staff.updateRole));
r.get('/settings', h(settings.get));
r.put('/settings/:section', allow('settings.manage'), h(settings.update));
r.put('/printers/:id', allow('settings.manage'), h(settings.updatePrinter));
r.post('/printers/:id/test', allow('settings.manage'), h(settings.testPrint));
r.get('/backups', allow('settings.manage'), h(settings.backups));
r.post('/backups', allow('settings.manage'), h(settings.backupNow));

r.use((_req, res) => res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' }));

export default r;
