/**
 * Editing the order on screen. These only change the working copy; nothing
 * is sent until the cashier sends it to the kitchen, prints the bill, takes
 * payment, or leaves the order (which saves it quietly).
 */
import { usePos } from './store';
import { saveDraft } from '../../services/sync';
import { toast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { uuid } from '../../utils/id';
import type { CatalogItem, OrderDiscount, OrderDTO, OrderItemDTO, OrderModifier, OrderType } from '../../../shared/types';

const set = (fn: (d: OrderDTO) => OrderDTO) =>
  usePos.setState((s) => (s.draft ? { draft: { ...fn(s.draft), updatedAt: new Date().toISOString() }, dirty: true } : {}));

export function blankOrder(type: OrderType, tableId: string | null = null): OrderDTO {
  const table = usePos.getState().boot?.tables.find((t) => t.id === tableId);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    number: null,
    type,
    status: 'NEW',
    tableId: type === 'DINE_IN' ? tableId : null,
    tableName: table?.name ?? null,
    customerName: null,
    customerPhone: null,
    deliveryAddress: null,
    guests: null,
    note: null,
    discount: null,
    billPrintedAt: null,
    createdAt: now,
    updatedAt: now,
    createdByName: null,
    items: [],
    tickets: [],
  };
}

/** Leaves the current order (saving it if it has unsaved items) and opens another. */
export function switchTo(next: OrderDTO | null) {
  const { draft, dirty } = usePos.getState();
  const saveable = draft && (draft.type !== 'DINE_IN' || draft.tableId);
  if (draft && dirty && saveable && (draft.items.length || usePos.getState().orders[draft.id])) {
    const saved = saveDraft();
    // Re-opening the same order: show what was just saved, not the older copy passed in.
    if (saved && next?.id === saved.id) next = saved;
  }
  // Saved quietly, but the kitchen doesn't know yet — easy to miss when a waiter adds extras.
  const waiting = draft && saveable && draft.id !== next?.id ? unsentLines(draft).filter((u) => u.line.kitchen).reduce((a, u) => a + u.qty, 0) : 0;
  if (waiting) toast.warning(t('pos.notSentWarning', { n: waiting, where: draft!.tableName ? t('pos.tableN', { n: draft!.tableName }) : t(`orderType.${draft!.type}`) }), t('pos.notSentWarningDetail'));
  usePos.setState({ draft: next ? structuredClone(next) : null, dirty: false, removedLines: [] });
}

/** A new dine-in order with items but no table yet (items first, table second). */
function tablelessDraft() {
  const { draft, orders } = usePos.getState();
  return draft && !orders[draft.id] && draft.type === 'DINE_IN' && !draft.tableId && draft.items.length ? draft : null;
}

export function openOrder(id: string) {
  const o = usePos.getState().orders[id];
  if (o) switchTo(o);
  return !!o;
}

export function newOrder(type: OrderType, tableId: string | null = null) {
  switchTo(blankOrder(type, tableId));
}

/** Opens the table's running order, or starts a new one for it. */
export function openTable(tableId: string) {
  const { draft, orders } = usePos.getState();
  // Already on this table (maybe not saved yet): keep going with it.
  if (draft?.type === 'DINE_IN' && draft.tableId === tableId) return true;
  const open = Object.values(orders).filter((o) => o.tableId === tableId);
  if (open.length) {
    const pending = tablelessDraft();
    if (pending) {
      // Opening the busy table would drop these items (they have no table to be saved under).
      const name = usePos.getState().boot?.tables.find((tb) => tb.id === tableId)?.name ?? '';
      toast.error(t('tables.busyTitle', { n: name }), t('pos.chooseFreeTableFirst', { n: pending.items.reduce((a, l) => a + l.qty, 0) }));
      return false;
    }
    return openOrder(open.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].id);
  }
  if (tablelessDraft()) {
    setTable(tableId);
    return true;
  }
  newOrder('DINE_IN', tableId);
  return true;
}

const sameMods = (a: OrderModifier[], b: OrderModifier[]) => a.length === b.length && a.every((m, i) => m.groupName === b[i].groupName && m.name === b[i].name);

export function addItem(item: CatalogItem, modifiers: OrderModifier[] = [], qty = 1, note: string | null = null) {
  set((d) => {
    const existing = d.items.find((l) => l.menuItemId === item.id && sameMods(l.modifiers, modifiers) && (l.note ?? null) === (note ?? null));
    if (existing) return { ...d, items: d.items.map((l) => (l === existing ? { ...l, qty: Math.min(999, l.qty + qty) } : l)) };
    const line: OrderItemDTO = {
      id: uuid(),
      menuItemId: item.id,
      name: item.name,
      basePrice: item.price,
      unitPrice: item.price + modifiers.reduce((a, m) => a + m.priceDelta, 0),
      modifiers,
      qty,
      sentQty: 0,
      note,
      taxRate: item.taxRate,
      kitchen: item.sendToKitchen,
    };
    return { ...d, items: [...d.items, line] };
  });
}

export function defaultModifiers(item: CatalogItem): OrderModifier[] {
  return item.modifierGroups
    .filter((g) => g.required)
    .map((g) => {
      const o = g.options.find((x) => x.isDefault) ?? g.options[0];
      return { groupName: g.name, name: o.name, priceDelta: o.priceDelta };
    });
}

const noteRemoved = (lineId: string) => usePos.setState((s) => ({ removedLines: [...s.removedLines, lineId] }));

export function setQty(lineId: string, qty: number) {
  if (qty <= 0) return removeLine(lineId);
  set((d) => ({ ...d, items: d.items.map((l) => (l.id === lineId ? { ...l, qty: Math.min(999, qty) } : l)) }));
}

export function removeLine(lineId: string) {
  noteRemoved(lineId);
  set((d) => ({ ...d, items: d.items.filter((l) => l.id !== lineId) }));
}

export const updateLine = (lineId: string, patch: Partial<Pick<OrderItemDTO, 'qty' | 'note'>>) =>
  set((d) => ({ ...d, items: d.items.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }));

export const setOrderType = (type: OrderType) =>
  set((d) => ({ ...d, type, tableId: type === 'DINE_IN' ? d.tableId : null, tableName: type === 'DINE_IN' ? d.tableName : null }));

export function setTable(tableId: string) {
  const table = usePos.getState().boot?.tables.find((t) => t.id === tableId);
  set((d) => ({ ...d, type: 'DINE_IN', tableId, tableName: table?.name ?? null }));
}

export const setGuests = (guests: number | null) => set((d) => ({ ...d, guests }));
export const setDiscount = (discount: OrderDiscount | null) => set((d) => ({ ...d, discount }));
export const setNote = (note: string | null) => set((d) => ({ ...d, note }));
export const setCustomer = (c: { customerName?: string | null; customerPhone?: string | null; deliveryAddress?: string | null }) => set((d) => ({ ...d, ...c }));

/** Kitchen items added or increased since the last ticket. */
export function unsentLines(d: OrderDTO) {
  return d.items.filter((l) => l.qty > l.sentQty).map((l) => ({ line: l, qty: l.qty - l.sentQty }));
}

/** Items already with the kitchen that the current edits remove or reduce. */
export function pulledFromKitchen(d: OrderDTO) {
  const { orders, removedLines } = usePos.getState();
  const saved = orders[d.id];
  if (!saved) return [];
  // A saved line missing from the draft was added on another device, not removed here.
  const touched = (id: string) => d.items.some((l) => l.id === id) || removedLines.includes(id);
  return saved.items
    .filter((s) => s.kitchen && s.sentQty > 0 && touched(s.id))
    .map((s) => {
      const now = d.items.find((l) => l.id === s.id);
      return { name: s.name, qty: s.sentQty - Math.min(now?.qty ?? 0, s.sentQty) };
    })
    .filter((x) => x.qty > 0);
}
