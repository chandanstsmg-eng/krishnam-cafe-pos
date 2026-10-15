import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ChefHat, PlusCircle, ShoppingBag, X } from 'lucide-react';
import { usePos } from './store';
import { newOrder, openOrder, openTable } from './draft';
import { sendToKitchen } from './orderActions';
import { toast } from '../../components/ui/Toast';
import { CategoryRail, MenuGrid } from './MenuGrid';
import { OrderPanel } from './OrderPanel';
import { billFor } from '../../services/sync';
import { Skeleton } from '../../components/ui/Misc';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import type { OrderType } from '../../../shared/types';

function lastType(): OrderType {
  try {
    const v = localStorage.getItem('ap.orderType');
    return v === 'TAKEAWAY' || v === 'DELIVERY' ? v : 'DINE_IN';
  } catch {
    return 'DINE_IN';
  }
}

/**
 * The cashier's main screen: categories, menu and the current order side by
 * side. Everything needed for a normal bill happens here.
 */
export function OrderScreen() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ready = usePos((s) => s.ready);
  const draft = usePos((s) => s.draft);
  const orders = usePos((s) => s.orders);
  const [category, setCategory] = useState('all');
  const [sheet, setSheet] = useState(false);

  // Deep links: /pos?order=…  /pos?table=…  /pos?new=TAKEAWAY
  useEffect(() => {
    if (!ready) return;
    const order = params.get('order');
    const table = params.get('table');
    const fresh = params.get('new') as OrderType | null;
    if (order) {
      if (!openOrder(order)) navigate('/pos/tables', { replace: true });
    } else if (table) openTable(table);
    else if (fresh) newOrder(fresh);
    else if (!usePos.getState().draft) newOrder(lastType());
    if (order || table || fresh) setParams({}, { replace: true });
  }, [ready, params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (draft?.type) {
      try {
        localStorage.setItem('ap.orderType', draft.type);
      } catch {
        /* ignore */
      }
    }
  }, [draft?.type]);

  if (!ready) {
    return (
      <div className="grid h-full gap-3 p-3 lg:grid-cols-[172px_1fr_380px]">
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
        <Skeleton className="h-full" />
      </div>
    );
  }

  const bill = draft ? billFor(draft) : null;
  const count = draft?.items.reduce((a, i) => a + i.qty, 0) ?? 0;
  const unsent = draft?.items.reduce((a, i) => a + (i.kitchen ? Math.max(0, i.qty - i.sentQty) : 0), 0) ?? 0;
  const running = !!draft && draft.type === 'DINE_IN' && !!draft.tableId && !!orders[draft.id];

  const onSend = async () => {
    const r = await sendToKitchen();
    if (r === 'need-table') {
      toast.info(t('pos.chooseTableFirst'));
      setSheet(true);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[172px_minmax(0,1fr)_minmax(340px,380px)] xl:grid-cols-[188px_minmax(0,1fr)_400px]">
      <div className="shrink-0 border-b border-line bg-surface lg:min-h-0 lg:border-r lg:border-b-0">
        <CategoryRail value={category} onChange={setCategory} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Phones/tablets: the order panel is hidden, so say which table the items go to. */}
        {running && (
          <div className="flex shrink-0 items-center gap-2 border-b border-brand/20 bg-brand-50 px-4 py-2 text-[13px] lg:hidden">
            <PlusCircle className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {t('pos.addingTo', { table: draft!.tableName ?? '', n: draft!.number ?? '' })}
            </span>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <MenuGrid category={category} onCategory={setCategory} />
        </div>
      </div>

      {/* Desktop: always visible. Tablet/phone: slide-over opened from the bar below. */}
      <div
        className={cn(
          'lg:static lg:block lg:min-h-0',
          sheet ? 'fixed inset-0 z-40 flex justify-end bg-ink/40 lg:bg-transparent' : 'hidden',
        )}
        onClick={(e) => e.target === e.currentTarget && setSheet(false)}
      >
        <div className="pb-safe flex h-full w-full max-w-[440px] flex-col bg-surface lg:max-w-none lg:pb-0">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-4 lg:hidden">
            <span className="font-semibold">{t('pos.currentOrder')}</span>
            <button onClick={() => setSheet(false)} aria-label={t('common.close')} className="flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-paper-2">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
          <OrderPanel
            onPaid={(type) => {
              setSheet(false);
              if (type === 'DINE_IN') navigate('/pos/tables');
              else newOrder(type);
            }}
          />
          </div>
        </div>
      </div>

      <div className="flex h-14 shrink-0 lg:hidden">
        <button
          onClick={() => setSheet(true)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 bg-brand px-4 text-white"
          aria-label={t('pos.viewOrder')}
        >
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden />
            <span className="truncate">
              {draft?.tableName ? t('pos.tableN', { n: draft.tableName }) : t(`orderType.${draft?.type ?? 'TAKEAWAY'}`)} · {t('pos.itemsCount', { n: count })}
            </span>
          </span>
          <span className="num text-lg font-semibold">{formatMoney(bill?.total ?? 0)}</span>
        </button>
        {/* Extra items for a table go straight to the kitchen without opening the order. */}
        {unsent > 0 && (
          <button onClick={onSend} className="flex shrink-0 items-center gap-1.5 border-l border-white/25 bg-brand-700 px-4 text-[14px] font-semibold text-white active:bg-brand-600">
            <ChefHat className="h-5 w-5" aria-hidden />
            {t('pos.sendNew', { n: unsent })}
          </button>
        )}
      </div>
    </div>
  );
}
