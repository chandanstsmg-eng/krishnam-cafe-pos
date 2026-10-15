/**
 * Alerts for changes made on another device, worked out by comparing the open
 * orders before and after a live refresh:
 *
 *   cashier (takes payments) ← a waiter's new order, more items, "bill please"
 *   waiter (takes orders)    ← the kitchen marked their order ready
 *
 * Changes made on this device are already in its local copy before the
 * refresh arrives, so they never alert here.
 */
import { useSession } from '../features/auth/session';
import { toast } from '../components/ui/Toast';
import { chime } from '../utils/chime';
import { t } from '../i18n';
import type { OrderDTO } from '../../shared/types';

/** Order id to open when the person taps "Open" on an alert. PosLayout listens for it. */
export const OPEN_ORDER_EVENT = 'pos:open-order';

const where = (o: OrderDTO) => (o.tableName ? t('pos.tableN', { n: o.tableName }) : `${t(`orderType.${o.type}`)} #${o.number ?? ''}`);

const open = (o: OrderDTO) => ({ label: t('live.open'), onClick: () => window.dispatchEvent(new CustomEvent(OPEN_ORDER_EVENT, { detail: o.id })) });

export function alertChanges(prev: Record<string, OrderDTO>, next: Record<string, OrderDTO>) {
  const user = useSession.getState().user;
  if (!user) return;
  const cashier = user.permissions.includes('payments.accept');
  const takesOrders = user.permissions.includes('orders.take');
  const byOther = (o: OrderDTO) => !!o.createdByName && o.createdByName !== user.name;
  let ring = false;

  for (const o of Object.values(next)) {
    const before = prev[o.id];
    if (cashier) {
      if (!before) {
        if (byOther(o)) {
          toast.alert(t('live.newOrder', { where: where(o) }), t('live.by', { name: o.createdByName! }), open(o));
          ring = true;
        }
      } else if (o.tickets.length > before.tickets.length) {
        toast.alert(t('live.moreItems', { where: where(o) }), byOther(o) ? t('live.by', { name: o.createdByName! }) : undefined, open(o));
        ring = true;
      }
      if (before && !before.billPrintedAt && o.billPrintedAt) {
        toast.alert(t('live.billAsked', { where: where(o) }), byOther(o) ? t('live.by', { name: o.createdByName! }) : undefined, open(o));
        ring = true;
      }
    }
    // Ready food goes to whoever took the order (a waiter's orders alert the waiter, not the counter).
    if (takesOrders && before && before.status !== 'READY' && o.status === 'READY' && !byOther(o)) {
      toast.alert(t('live.foodReady', { where: where(o) }), t('live.foodReadyDetail'), open(o));
      ring = true;
    }
  }
  if (ring) chime();
}
