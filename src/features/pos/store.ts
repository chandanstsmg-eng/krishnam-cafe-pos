/**
 * The till's working state: catalogue, open orders, today's bills, the
 * order being edited, and the queue of changes waiting to reach the server.
 * Everything here is also saved on the device so the till keeps working
 * (and survives a page reload) when the server cannot be reached.
 */
import { create } from 'zustand';
import type { InvoiceDTO, OrderDTO, PosBootstrap, SyncCommand } from '../../../shared/types';

export type Connection = 'online' | 'offline' | 'syncing';

export interface PosState {
  ready: boolean;
  boot: PosBootstrap | null;
  orders: Record<string, OrderDTO>;
  invoices: InvoiceDTO[];
  outbox: SyncCommand[];
  connection: Connection;
  lastSyncedAt: number | null;
  /** the order open on the order screen (a working copy) */
  draft: OrderDTO | null;
  /** true when the draft differs from what was last saved */
  dirty: boolean;
  /** lines removed from the draft since it was last saved (see OrderSavePayload.removedItemIds) */
  removedLines: string[];
}

export const usePos = create<PosState>(() => ({
  ready: false,
  boot: null,
  orders: {},
  invoices: [],
  outbox: [],
  connection: 'online',
  lastSyncedAt: null,
  draft: null,
  dirty: false,
  removedLines: [],
}));

export const posState = () => usePos.getState();

/** Stable empty list for selectors (a fresh [] each render would loop forever). */
export const NONE: never[] = [];

/** Orders with changes still waiting in the queue. */
export function pendingOrderIds(outbox = usePos.getState().outbox) {
  const ids = new Set<string>();
  for (const c of outbox) ids.add(c.type === 'order.save' ? c.payload.order.id : c.payload.orderId);
  return ids;
}

export function orderTotalItems(o: OrderDTO) {
  return o.items.reduce((a, i) => a + i.qty, 0);
}
