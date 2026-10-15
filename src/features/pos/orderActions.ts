/**
 * The buttons on the order panel: send to kitchen, print bill, cancel.
 * Handles the approvals a cashier may need along the way.
 */
import { usePos } from './store';
import { pulledFromKitchen, switchTo, unsentLines } from './draft';
import { billFor, cancelOrder, saveDraft } from '../../services/sync';
import { printKot, printPreBill } from '../../services/print';
import { requestApproval } from '../auth/Approval';
import { can, useSession } from '../auth/session';
import { confirm, confirmWithReason } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { t } from '../../i18n';
import { formatMoney } from '../../../shared/money';
import type { OrderDTO } from '../../../shared/types';

export const CANCEL_REASONS = () => [t('reasons.customerCancelled'), t('reasons.wrongOrder'), t('reasons.duplicateOrder'), t('reasons.customerLeft')];

function discountChanged(d: OrderDTO) {
  const saved = usePos.getState().orders[d.id];
  const a = d.discount && d.discount.value > 0 ? `${d.discount.type}:${d.discount.value}` : '';
  const b = saved?.discount && saved.discount.value > 0 ? `${saved.discount.type}:${saved.discount.value}` : '';
  return a !== b;
}

/** Collects any manager approvals the current edits need. null = stopped. */
async function approvalsFor(d: OrderDTO): Promise<{ discountApproval?: string | null; removalApproval?: string | null } | null> {
  const user = useSession.getState().user;
  const offline = usePos.getState().connection === 'offline';
  const out: { discountApproval?: string | null; removalApproval?: string | null } = {};

  if (d.discount && d.discount.value > 0 && discountChanged(d)) {
    const bill = billFor(d);
    const pct = bill.subtotal ? (bill.discount / bill.subtotal) * 100 : 0;
    const allowed = can('discounts.apply') && pct <= (user?.maxDiscountPercent ?? 0) + 0.001;
    if (!allowed) {
      if (offline) {
        toast.error(t('approval.offlineBlocked'));
        return null;
      }
      const token = await requestApproval('discounts.apply', t('approval.discountReason', { amount: formatMoney(bill.discount), pct: pct.toFixed(0) }));
      if (!token) return null;
      out.discountApproval = token;
    }
  }

  const pulled = pulledFromKitchen(d);
  if (pulled.length && !can('bills.void')) {
    if (offline) {
      toast.error(t('approval.offlineBlocked'));
      return null;
    }
    const token = await requestApproval('bills.void', t('approval.removeReason', { items: pulled.map((p) => `${p.qty} × ${p.name}`).join(', ') }));
    if (!token) return null;
    out.removalApproval = token;
  }
  return out;
}

export type ActionResult = 'ok' | 'need-table' | 'empty' | 'stopped';

export async function sendToKitchen(): Promise<ActionResult> {
  const d = usePos.getState().draft;
  if (!d || !d.items.length) return 'empty';
  if (d.type === 'DINE_IN' && !d.tableId) return 'need-table';
  const approvals = await approvalsFor(d);
  if (!approvals) return 'stopped';
  const fresh = unsentLines(d).filter((u) => u.line.kitchen);
  const round = d.tickets.length + 1;
  const saved = saveDraft({ sendToKitchen: true, ...approvals });
  const offline = usePos.getState().connection === 'offline';
  if (fresh.length && saved) {
    const settings = usePos.getState().boot?.settings;
    if (settings?.pos.printKot) {
      void printKot(
        saved,
        fresh.map((u) => ({ name: u.line.name, qty: u.qty, modifiers: u.line.modifiers.map((m) => m.name).join(', ') || null, note: u.line.note })),
        round,
      );
    }
    if (offline) toast.warning(t('pos.sentOffline'), t('pos.sentOfflineDetail'));
    else toast.success(t('pos.sentToKitchen', { n: fresh.reduce((a, u) => a + u.qty, 0) }));
  } else if (saved) {
    toast.success(t('pos.orderSaved'));
  }
  return 'ok';
}

export async function printBill(): Promise<ActionResult> {
  const d = usePos.getState().draft;
  if (!d || !d.items.length) return 'empty';
  if (d.type === 'DINE_IN' && !d.tableId) return 'need-table';
  const approvals = await approvalsFor(d);
  if (!approvals) return 'stopped';
  const saved = saveDraft({ sendToKitchen: true, printBill: true, ...approvals });
  if (saved) {
    // Waiters don't print on their phone; the cashier sees the request (and a network printer, if any, prints it).
    if (!can('payments.accept')) toast.success(t('pos.billSentToCashier', { where: saved.tableName ? t('pos.tableN', { n: saved.tableName }) : t(`orderType.${saved.type}`) }));
    await printPreBill(saved);
  }
  return 'ok';
}

/** Saves edits (approvals included) before payment. */
export async function prepareForPayment(): Promise<ActionResult> {
  const d = usePos.getState().draft;
  if (!d || !d.items.length) return 'empty';
  if (d.type === 'DINE_IN' && !d.tableId) return 'need-table';
  const approvals = await approvalsFor(d);
  if (!approvals) return 'stopped';
  if (approvals.discountApproval || approvals.removalApproval || usePos.getState().dirty) saveDraft({ sendToKitchen: true, ...approvals });
  return 'ok';
}

export async function cancelCurrentOrder(): Promise<boolean> {
  const d = usePos.getState().draft;
  if (!d) return false;
  const saved = usePos.getState().orders[d.id];
  if (!saved) {
    if (!d.items.length) {
      switchTo(null);
      return true;
    }
    const ok = await confirm({ title: t('pos.discardTitle'), message: t('pos.discardMessage'), confirmLabel: t('pos.discardConfirm'), cancelLabel: t('pos.keepOrder'), danger: true });
    if (ok) usePos.setState({ draft: null, dirty: false });
    return ok;
  }
  const reason = await confirmWithReason({
    title: t('pos.cancelTitle'),
    message: t('pos.cancelMessage', { n: saved.number ?? '' }),
    confirmLabel: t('pos.cancelConfirm'),
    cancelLabel: t('pos.keepOrder'),
    danger: true,
    reasons: CANCEL_REASONS(),
  });
  if (reason === null) return false;
  const started = saved.items.some((i) => i.kitchen && i.sentQty > 0) || !!saved.billPrintedAt;
  let token: string | null = null;
  if (started && !can('bills.void')) {
    if (usePos.getState().connection === 'offline') {
      toast.error(t('approval.offlineBlocked'));
      return false;
    }
    token = await requestApproval('bills.void', t('approval.cancelReason', { n: saved.number ?? '' }));
    if (!token) return false;
  }
  const r = await cancelOrder(d.id, reason, token);
  if (!r.ok) {
    toast.error(t('pos.cancelFailed'), r.error);
    return false;
  }
  toast.success(t('pos.cancelled', { n: saved.number ?? '' }));
  return true;
}
