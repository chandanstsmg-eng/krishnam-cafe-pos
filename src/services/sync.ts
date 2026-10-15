/**
 * Sync engine for the till.
 *
 * Every change a cashier makes becomes a command with its own id. Commands
 * are applied to the screen straight away, saved on this device, and sent to
 * the server in order. If the server can't be reached they wait in the queue
 * and are replayed when it comes back; the server ignores any command it has
 * already seen, so nothing is ever billed twice.
 */
import { del, get, set } from 'idb-keyval';
import { api, ApiError, isNetworkError } from '../api/client';
import { usePos, pendingOrderIds, type PosState } from '../features/pos/store';
import { useSession } from '../features/auth/session';
import { toast } from '../components/ui/Toast';
import { currentLanguage, setLanguage, t } from '../i18n';
import { onServerChange } from './events';
import { alertChanges } from './liveAlerts';
import { uuid, nextOfflineBillNo } from '../utils/id';
import { computeBill, discountLabel, settle, type PaymentInput } from '../../shared/billing';
import { businessDate } from '../../shared/dates';
import { deriveOrderStatus } from '../../shared/orderStatus';
import type { InvoiceDTO, OrderDTO, OrderSavePayload, PosBootstrap, SyncCommand, SyncResult } from '../../shared/types';

const K = { boot: 'pos.boot', orders: 'pos.orders', invoices: 'pos.invoices', outbox: 'pos.outbox' };

type Outcome = { result?: SyncResult; network?: boolean };
const waiters = new Map<string, (o: Outcome) => void>();

const setState = (p: Partial<PosState> | ((s: PosState) => Partial<PosState>)) => usePos.setState(p as never);
const state = () => usePos.getState();

// ───────────────────────── persistence ─────────────────────────

async function persistOutbox() {
  try {
    await set(K.outbox, state().outbox);
  } catch (err) {
    console.error('[sync] could not save queue', err);
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    const s = state();
    try {
      await Promise.all([s.boot ? set(K.boot, s.boot) : null, set(K.orders, s.orders), set(K.invoices, s.invoices)]);
    } catch (err) {
      console.warn('[sync] could not cache POS data', err);
    }
  }, 400);
}

export async function clearDeviceCache() {
  await Promise.all(Object.values(K).map((k) => del(k).catch(() => {})));
}

// ───────────────────────── connection ─────────────────────────

let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;

function markOnline() {
  retryDelay = 2000;
  const wasOffline = state().connection === 'offline';
  setState({ connection: state().outbox.length ? 'syncing' : 'online' });
  if (wasOffline) {
    if (state().outbox.length) toast.info(t('sync.backOnlineSyncing'));
    else toast.success(t('sync.backOnline'));
    void refresh();
  }
}

function markOffline() {
  if (state().connection !== 'offline') {
    setState({ connection: 'offline' });
    toast.warning(t('sync.offlineTitle'), t('sync.offlineDetail'));
  }
  scheduleRetry();
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    try {
      await api.get('/health', { timeoutMs: 4000 });
      markOnline();
      await flush();
    } catch {
      retryDelay = Math.min(retryDelay * 1.6, 15000);
      scheduleRetry();
    }
  }, retryDelay);
}

let unsubscribe: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function connectEvents(onChange: (topics: string[]) => void) {
  unsubscribe?.();
  unsubscribe = onServerChange(onChange, {
    onOpen: () => {
      if (state().connection === 'offline') markOnline();
      void flush();
    },
    // EventSource reconnects by itself; confirm with a real request before
    // telling the cashier we are offline.
    onError: () => void api.get('/health', { timeoutMs: 3000 }).catch(() => markOffline()),
  });
}

export function disconnectEvents() {
  unsubscribe?.();
  unsubscribe = null;
}

// ───────────────────────── bootstrap ─────────────────────────

let initialised = false;

/** Loads cached data, then the latest from the server, and starts syncing. */
export async function initPos() {
  if (initialised) return;
  initialised = true;
  try {
    const [boot, orders, invoices, outbox] = await Promise.all([
      get<PosBootstrap>(K.boot),
      get<Record<string, OrderDTO>>(K.orders),
      get<InvoiceDTO[]>(K.invoices),
      get<SyncCommand[]>(K.outbox),
    ]);
    if (boot) {
      const sameDay = boot.businessDate === businessDate();
      setState({
        boot,
        orders: orders ?? {},
        invoices: sameDay ? (invoices ?? []) : (invoices ?? []).filter((i) => i.offline),
        outbox: outbox ?? [],
        ready: true,
      });
    } else if (outbox?.length) setState({ outbox });
  } catch (err) {
    console.warn('[sync] no cached POS data', err);
  }
  usePos.subscribe((s, prev) => {
    if (s.orders !== prev.orders || s.invoices !== prev.invoices || s.boot !== prev.boot) persistSoon();
  });
  connectEvents((topics) => {
    if (topics.some((tp) => ['orders', 'tables', 'menu', 'settings', 'shift', 'invoices', 'kitchen'].includes(tp))) {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh(), 250);
    }
  });
  await refresh();
  void flush();
  window.addEventListener('online', () => scheduleRetry());
}

export function resetPosSession() {
  initialised = false;
  disconnectEvents();
}

/** Re-reads everything from the server and merges it with unsent local changes. */
export async function refresh() {
  let boot: PosBootstrap;
  try {
    boot = await api.get<PosBootstrap>('/pos/bootstrap', { timeoutMs: 15000 });
  } catch (err) {
    if (isNetworkError(err)) markOffline();
    else console.warn('[sync] bootstrap failed', err);
    return;
  }
  if (state().connection === 'offline') markOnline();
  if (boot.settings.language && boot.settings.language !== currentLanguage()) setLanguage(boot.settings.language);
  const s = state();
  const pending = pendingOrderIds(s.outbox);
  const orders: Record<string, OrderDTO> = {};
  for (const o of boot.openOrders) orders[o.id] = o;
  for (const id of pending) {
    if (s.orders[id]) orders[id] = s.orders[id];
    else if (!orders[id]) delete orders[id];
  }
  // Paid bills still waiting to reach the server stay visible.
  const pendingPays = new Set(s.outbox.filter((c) => c.type === 'order.pay').map((c) => (c.type === 'order.pay' ? c.payload.invoiceId : '')));
  for (const c of s.outbox) if (c.type === 'order.pay' || c.type === 'order.cancel') delete orders[c.payload.orderId];
  const serverIds = new Set(boot.recentInvoices.map((i) => i.id));
  const localOnly = s.invoices.filter((i) => pendingPays.has(i.id) && !serverIds.has(i.id));
  const { openOrders: _o, recentInvoices, ...rest } = boot;
  // Not on the first load: everything would look "new".
  if (s.lastSyncedAt !== null) alertChanges(s.orders, orders);

  let draft = s.draft;
  let dirty = s.dirty;
  if (draft && !dirty) {
    const fresh = orders[draft.id];
    if (fresh) draft = fresh;
    else if (draft.number !== null && !pending.has(draft.id)) {
      toast.info(t('pos.orderClosedElsewhere', { n: draft.number }));
      draft = null;
      dirty = false;
    }
  } else if (draft && dirty && orders[draft.id]) {
    const fresh = orders[draft.id];
    // Lines another device added while this one was mid-edit: show them here too.
    const have = new Set([...draft.items.map((l) => l.id), ...s.removedLines]);
    const added = fresh.items.filter((l) => !have.has(l.id));
    draft = { ...draft, number: fresh.number, status: fresh.status, tickets: fresh.tickets, tableName: draft.tableName ?? fresh.tableName, items: [...draft.items, ...added] };
  }

  setState({
    boot: { ...rest, openOrders: [], recentInvoices: [] } as PosBootstrap,
    orders,
    invoices: [...localOnly, ...recentInvoices],
    ready: true,
    draft,
    dirty,
    lastSyncedAt: Date.now(),
  });
}

// ───────────────────────── queue ─────────────────────────

let flushing = false;
let batchSize = 40;

/**
 * Nothing will reach the server for now: let everyone waiting (e.g. the payment
 * dialog) carry on offline. Their commands stay queued and are sent later.
 */
function releaseWaiters() {
  for (const [id, w] of waiters) {
    waiters.delete(id);
    w({ network: true });
  }
}

export async function flush(): Promise<void> {
  if (flushing) return;
  const outbox = state().outbox;
  if (!outbox.length) {
    if (state().connection === 'syncing') setState({ connection: 'online' });
    return;
  }
  if (useSession.getState().status !== 'authed') return releaseWaiters();
  flushing = true;
  const batch = outbox.slice(0, batchSize);
  try {
    if (state().connection !== 'offline') setState({ connection: 'syncing' });
    const { results } = await api.post<{ results: SyncResult[] }>('/pos/sync', { commands: batch }, { timeoutMs: 30000 });
    batchSize = 40;
    const done = new Set<string>();
    for (const r of results) {
      const cmd = batch.find((c) => c.id === r.id);
      if (!cmd) continue;
      done.add(r.id);
      applyResult(cmd, r);
      const w = waiters.get(r.id);
      if (w) {
        waiters.delete(r.id);
        w({ result: r });
      } else if (!r.ok) {
        toast.error(t('sync.changeFailed'), r.error);
      }
    }
    setState((s) => ({ outbox: s.outbox.filter((c) => !done.has(c.id)) }));
    await persistOutbox();
    if (results.some((r) => !r.ok)) void refresh();
    markOnline();
    flushing = false;
    if (state().outbox.length) return flush();
    setState({ connection: 'online', lastSyncedAt: Date.now() });
  } catch (err) {
    flushing = false;
    if (isNetworkError(err)) {
      // Not just this batch: a payment queued behind it would otherwise wait out the whole outage.
      releaseWaiters();
      markOffline();
      return;
    }
    if (err instanceof ApiError && err.status === 401) {
      releaseWaiters();
      toast.warning(t('sync.signInToSync'));
      return;
    }
    // A command the server cannot even read: find it and set it aside so the rest can go.
    if (batchSize > 1) {
      batchSize = 1;
      return flush();
    }
    const bad = batch[0];
    console.error('[sync] dropping unreadable command', bad, err);
    const w = waiters.get(bad.id);
    waiters.delete(bad.id);
    w?.({ result: { id: bad.id, ok: false, error: err instanceof ApiError ? err.message : t('errors.generic') } });
    if (!w) toast.error(t('sync.changeFailed'), err instanceof ApiError ? err.message : undefined);
    setState((s) => ({ outbox: s.outbox.filter((c) => c.id !== bad.id) }));
    await persistOutbox();
    void refresh();
    return flush();
  }
}

function applyResult(cmd: SyncCommand, r: SyncResult) {
  const orderId = cmd.type === 'order.save' ? cmd.payload.order.id : cmd.payload.orderId;
  setState((s) => {
    const orders = { ...s.orders };
    const stillPending = s.outbox.some((c) => c.id !== cmd.id && (c.type === 'order.save' ? c.payload.order.id : c.payload.orderId) === orderId);
    let invoices = s.invoices;
    if (r.ok) {
      const o = r.order;
      if (!stillPending) {
        if (o && ['NEW', 'PREPARING', 'READY', 'SERVED'].includes(o.status)) orders[o.id] = o;
        else delete orders[orderId];
      } else if (o && orders[o.id] && orders[o.id].number === null) {
        orders[o.id] = { ...orders[o.id], number: o.number };
      }
      if (r.invoice) invoices = [r.invoice, ...s.invoices.filter((i) => i.id !== r.invoice!.id)];
    }
    let draft = s.draft;
    if (draft?.id === orderId && r.ok) {
      const o = r.order;
      if (!o || !['NEW', 'PREPARING', 'READY', 'SERVED'].includes(o.status)) {
        if (!s.dirty && cmd.type !== 'order.save') draft = null;
      } else if (!s.dirty && !stillPending) draft = o;
      else draft = { ...draft, number: o.number, status: o.status, tickets: o.tickets };
    }
    return { orders, invoices, draft };
  });
}

function enqueue(cmd: SyncCommand, opts: { wait?: boolean } = {}): Promise<Outcome> {
  const promise = opts.wait ? new Promise<Outcome>((resolve) => waiters.set(cmd.id, resolve)) : Promise.resolve<Outcome>({});
  setState((s) => ({ outbox: [...s.outbox, cmd] }));
  void persistOutbox();
  if (state().connection === 'offline') {
    const w = waiters.get(cmd.id);
    if (w) {
      waiters.delete(cmd.id);
      w({ network: true });
    }
  } else void flush();
  return promise;
}

const command = <T extends SyncCommand['type']>(type: T, payload: Extract<SyncCommand, { type: T }>['payload']) =>
  ({ id: uuid(), type, at: new Date().toISOString(), offline: state().connection === 'offline', payload }) as Extract<SyncCommand, { type: T }>;

// ───────────────────────── local effects ─────────────────────────

function localOrderFromSave(p: OrderSavePayload, prev: OrderDTO | undefined): OrderDTO | null {
  if (!p.order.items.length) return null;
  const now = new Date().toISOString();
  const tables = state().boot?.tables ?? [];
  const prevSent = new Map(prev?.items.map((i) => [i.id, i.sentQty]) ?? []);
  const items = p.order.items.map((it) => ({ ...it, sentQty: p.sendToKitchen ? it.qty : Math.min(prevSent.get(it.id) ?? 0, it.qty) }));
  const tickets = [...(prev?.tickets ?? [])];
  const newKitchen = p.sendToKitchen && p.order.items.some((it) => it.kitchen && it.qty > (prevSent.get(it.id) ?? 0));
  if (newKitchen && p.ticketId) tickets.push({ id: p.ticketId, round: tickets.length + 1, status: state().boot?.settings.pos.kitchenDisplay === false ? 'SERVED' : 'NEW', createdAt: now });
  const hasUnsent = items.some((i) => i.kitchen && i.qty > i.sentQty);
  return {
    id: p.order.id,
    number: prev?.number ?? null,
    type: p.order.type,
    status: deriveOrderStatus(tickets, hasUnsent),
    tableId: p.order.tableId,
    tableName: tables.find((tb) => tb.id === p.order.tableId)?.name ?? null,
    customerName: p.order.customerName,
    customerPhone: p.order.customerPhone,
    deliveryAddress: p.order.deliveryAddress,
    guests: p.order.guests,
    note: p.order.note,
    discount: p.order.discount,
    billPrintedAt: p.printBill ? now : (prev?.billPrintedAt ?? null),
    createdAt: prev?.createdAt ?? p.order.createdAt,
    updatedAt: now,
    createdByName: prev?.createdByName ?? useSession.getState().user?.name ?? null,
    items,
    tickets,
    invoiceId: null,
  };
}

export function billFor(order: Pick<OrderDTO, 'items' | 'discount'>) {
  const settings = state().boot?.settings;
  return computeBill(
    order.items.map((i) => ({ key: i.id, unitPrice: i.unitPrice, qty: i.qty, taxRate: i.taxRate })),
    order.discount,
    settings?.billing ?? { taxMode: 'EXCLUSIVE', roundOff: true },
  );
}

function localInvoice(order: OrderDTO, invoiceId: string, number: string, payments: PaymentInput[], customer: { name?: string | null; phone?: string | null }): InvoiceDTO {
  const bill = billFor(order);
  const s = settle(bill.total, payments);
  return {
    id: invoiceId,
    number,
    orderId: order.id,
    orderNumber: order.number,
    orderType: order.type,
    tableName: order.tableName,
    customerName: customer.name || order.customerName,
    customerPhone: customer.phone || order.customerPhone,
    subtotal: bill.subtotal,
    discount: bill.discount,
    discountLabel: discountLabel(order.discount),
    taxable: bill.taxable,
    tax: bill.tax,
    taxInclusive: bill.taxInclusive,
    roundOff: bill.roundOff,
    total: bill.total,
    paid: s.paid,
    change: s.change,
    refunded: 0,
    status: 'PAID',
    cashierName: useSession.getState().user?.name ?? null,
    createdAt: new Date().toISOString(),
    reprintCount: 0,
    offline: true,
    voidReason: null,
    items: order.items.map((i, idx) => ({
      name: i.name,
      modifiersText: i.modifiers.map((m) => m.name).join(', ') || null,
      note: i.note,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: bill.lines[idx].gross,
      taxRate: i.taxRate,
    })),
    payments: payments.map((p) => ({ method: p.method, amount: p.amount, tendered: p.method === 'CASH' ? (p.tendered ?? p.amount) : null, change: p.tendered ? p.tendered - p.amount : null, reference: p.reference ?? null })),
  };
}

// ───────────────────────── actions used by the screens ─────────────────────────

export interface SaveOptions {
  sendToKitchen?: boolean;
  printBill?: boolean;
  discountApproval?: string | null;
  removalApproval?: string | null;
}

/** Saves the draft order. Returns the saved order (local copy), or null if it was emptied. */
export function saveDraft(opts: SaveOptions = {}): OrderDTO | null {
  const { draft, orders } = state();
  if (!draft) return null;
  const prev = orders[draft.id];
  if (!draft.items.length && !prev) {
    setState({ dirty: false });
    return null;
  }
  const payload: OrderSavePayload = {
    order: {
      id: draft.id,
      type: draft.type,
      tableId: draft.type === 'DINE_IN' ? draft.tableId : null,
      customerName: draft.customerName,
      customerPhone: draft.customerPhone,
      deliveryAddress: draft.deliveryAddress,
      guests: draft.guests,
      note: draft.note,
      discount: draft.discount,
      createdAt: draft.createdAt,
      items: draft.items.map(({ sentQty: _s, ...rest }) => rest),
    },
    sendToKitchen: !!opts.sendToKitchen,
    ticketId: opts.sendToKitchen ? uuid() : undefined,
    printBill: opts.printBill,
    discountApproval: opts.discountApproval ?? null,
    removalApproval: opts.removalApproval ?? null,
    removedItemIds: state().removedLines,
  };
  const local = localOrderFromSave(payload, prev);
  setState((s) => {
    const next = { ...s.orders };
    if (local) next[local.id] = local;
    else delete next[draft.id];
    return { orders: next, draft: local, dirty: false, removedLines: [] };
  });
  void enqueue(command('order.save', payload));
  return local;
}

export type PayOutcome = { ok: true; invoice: InvoiceDTO; offline: boolean } | { ok: false; error: string; code?: string };

export async function payDraft(payments: PaymentInput[], customer: { name?: string | null; phone?: string | null } = {}): Promise<PayOutcome> {
  let order = state().draft;
  if (!order) return { ok: false, error: t('errors.generic') };
  // Anything not yet sent goes to the kitchen now (takeaway: pay first, then cook).
  if (state().dirty || order.items.some((i) => i.qty > i.sentQty) || !state().orders[order.id]) order = saveDraft({ sendToKitchen: true }) ?? order;

  const bill = billFor(order);
  const invoiceId = uuid();
  const cmd = command('order.pay', {
    orderId: order.id,
    invoiceId,
    offlineNumber: state().connection === 'offline' ? nextOfflineBillNo() : null,
    payments,
    customerName: customer.name ?? null,
    customerPhone: customer.phone ?? null,
    paidAt: new Date().toISOString(),
    expectedTotal: bill.total,
  });

  const finishLocally = (number: string) => {
    const inv = localInvoice(order!, invoiceId, number, payments, customer);
    setState((s) => {
      const orders = { ...s.orders };
      delete orders[order!.id];
      return { orders, invoices: [inv, ...s.invoices], draft: s.draft?.id === order!.id ? null : s.draft, dirty: s.draft?.id === order!.id ? false : s.dirty };
    });
    return inv;
  };

  if (cmd.payload.offlineNumber) {
    void enqueue(cmd);
    return { ok: true, invoice: finishLocally(cmd.payload.offlineNumber), offline: true };
  }

  const outcome = await enqueue(cmd, { wait: true });
  if (outcome.network) {
    // Lost the connection while paying: give the bill an offline number and keep it queued.
    const number = nextOfflineBillNo();
    setState((s) => ({ outbox: s.outbox.map((c) => (c.id === cmd.id && c.type === 'order.pay' ? { ...c, offline: true, payload: { ...c.payload, offlineNumber: number } } : c)) }));
    void persistOutbox();
    return { ok: true, invoice: finishLocally(number), offline: true };
  }
  const r = outcome.result!;
  if (!r.ok) return { ok: false, error: r.error ?? t('errors.generic'), code: r.code };
  setState((s) => (s.draft?.id === order!.id ? { draft: null, dirty: false } : {}));
  return { ok: true, invoice: r.invoice!, offline: false };
}

export async function cancelOrder(orderId: string, reason: string, approvalToken?: string | null): Promise<{ ok: true } | { ok: false; error: string; code?: string }> {
  const cmd = command('order.cancel', { orderId, reason, approvalToken: approvalToken ?? null });
  const drop = () =>
    setState((s) => {
      const orders = { ...s.orders };
      delete orders[orderId];
      return { orders, draft: s.draft?.id === orderId ? null : s.draft, dirty: s.draft?.id === orderId ? false : s.dirty };
    });
  // Never reached the server: just forget it (and anything queued for it).
  if (state().orders[orderId]?.number === null && !state().outbox.some((c) => c.type === 'order.save' && c.payload.order.id === orderId && c.payload.sendToKitchen)) {
    setState((s) => ({ outbox: s.outbox.filter((c) => (c.type === 'order.save' ? c.payload.order.id : c.payload.orderId) !== orderId) }));
    void persistOutbox();
    drop();
    return { ok: true };
  }
  const outcome = await enqueue(cmd, { wait: true });
  if (outcome.network) {
    drop();
    return { ok: true };
  }
  const r = outcome.result!;
  if (!r.ok) return { ok: false, error: r.error ?? t('errors.generic'), code: r.code };
  drop();
  return { ok: true };
}

export function markServed(orderId: string) {
  setState((s) => {
    const o = s.orders[orderId];
    if (!o) return {};
    const updated = { ...o, status: 'SERVED' as const, tickets: o.tickets.map((tk) => (tk.status === 'CANCELLED' ? tk : { ...tk, status: 'SERVED' as const })) };
    return { orders: { ...s.orders, [orderId]: updated }, draft: s.draft?.id === orderId ? { ...s.draft, status: 'SERVED', tickets: updated.tickets } : s.draft };
  });
  void enqueue(command('order.served', { orderId, status: 'SERVED' }));
}

/** Records a reprint on the server (online only; offline reprints are just printed). */
export async function recordReprint(invoiceId: string) {
  try {
    const r = await api.post<{ invoice: InvoiceDTO }>(`/invoices/${invoiceId}/print`, { reprint: true });
    setState((s) => ({ invoices: s.invoices.map((i) => (i.id === invoiceId ? r.invoice : i)) }));
    return r.invoice;
  } catch {
    return null;
  }
}

export function upsertInvoice(inv: InvoiceDTO) {
  setState((s) => ({ invoices: s.invoices.some((i) => i.id === inv.id) ? s.invoices.map((i) => (i.id === inv.id ? inv : i)) : [inv, ...s.invoices] }));
}
