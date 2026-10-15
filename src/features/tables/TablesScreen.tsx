import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, CalendarClock, ChefHat, Clock, Plus, Receipt, ShoppingBag, Sparkles, Truck, Users } from 'lucide-react';
import { usePos } from '../pos/store';
import { NONE } from '../pos/store';
import { newOrder, openOrder, openTable } from '../pos/draft';
import { OrderStatusBadge } from '../pos/OrderStatusBadge';
import { billFor } from '../../services/sync';
import { api, errorMessage } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { EmptyState, Skeleton } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { useNow } from '../../hooks/useNow';
import { useCan } from '../auth/session';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { formatDuration, minutesSince } from '../../../shared/dates';
import type { CatalogTable, OrderDTO } from '../../../shared/types';

type TableState = 'free' | 'busy' | 'billing' | 'reserved' | 'cleaning';

function tableState(tb: CatalogTable, orders: OrderDTO[]): TableState {
  if (orders.some((o) => o.billPrintedAt)) return 'billing';
  if (orders.length) return 'busy';
  if (tb.hold === 'RESERVED') return 'reserved';
  if (tb.hold === 'CLEANING') return 'cleaning';
  return 'free';
}

const to12h = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export function TablesScreen() {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const ready = usePos((s) => s.ready);
  const tables = usePos((s) => s.boot?.tables ?? NONE);
  const orders = usePos((s) => s.orders);
  const draft = usePos((s) => s.draft);
  const settings = usePos((s) => s.boot?.settings);
  const offline = usePos((s) => s.connection === 'offline');
  const [area, setArea] = useState('all');
  const now = useNow(20_000);

  const byTable = useMemo(() => {
    const m = new Map<string, OrderDTO[]>();
    for (const o of Object.values(orders)) if (o.tableId) m.set(o.tableId, [...(m.get(o.tableId) ?? []), o]);
    return m;
  }, [orders]);
  const queue = useMemo(() => Object.values(orders).filter((o) => o.type !== 'DINE_IN').sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [orders]);
  const areas = useMemo(() => [...new Set(tables.map((tb) => tb.area || t('tables.noArea')))], [tables, t]);

  const counts = useMemo(() => {
    const c: Record<TableState, number> = { free: 0, busy: 0, billing: 0, reserved: 0, cleaning: 0 };
    for (const tb of tables) c[tableState(tb, byTable.get(tb.id) ?? [])]++;
    return c;
  }, [tables, byTable]);

  const go = (tb: CatalogTable) => {
    openTable(tb.id);
    navigate('/pos');
  };

  const setHold = async (tb: CatalogTable, hold: 'NONE' | 'RESERVED' | 'CLEANING') => {
    try {
      await api.patch(`/tables/${tb.id}`, { hold });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (!ready) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-4">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  const shownAreas = area === 'all' ? areas : [area];
  const warnAfter = settings?.pos.tableWarnMinutes ?? 45;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2" aria-label={t('tables.summary')}>
            <Legend tone="free" label={t('tables.available')} n={counts.free} />
            <Legend tone="busy" label={t('tables.occupied')} n={counts.busy} />
            <Legend tone="billing" label={t('tables.billing')} n={counts.billing} />
            <Legend tone="reserved" label={t('tables.reserved')} n={counts.reserved} />
            {counts.cleaning > 0 && <Legend tone="cleaning" label={t('tables.cleaning')} n={counts.cleaning} />}
          </div>
          {areas.length > 1 && (
            <Segmented label={t('tables.area')} size="sm" value={area} onChange={setArea} options={[{ value: 'all', label: t('tables.allAreas') }, ...areas.map((a) => ({ value: a, label: a }))]} />
          )}
        </div>

        {tables.length === 0 && <EmptyState title={t('tables.none')}>{t('tables.noneHint')}</EmptyState>}

        {shownAreas.map((a) => {
          const list = tables.filter((tb) => (tb.area || t('tables.noArea')) === a);
          return (
            <section key={a} className="mb-6">
              <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-ink-3 uppercase">{a}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(148px,1fr))] sm:gap-3">
                {list.map((tb) => {
                  const os = byTable.get(tb.id) ?? [];
                  const st = tableState(tb, os);
                  const total = os.reduce((acc, o) => acc + billFor(o).total, 0);
                  const since = os.length ? Math.max(...os.map((o) => minutesSince(o.createdAt, now))) : 0;
                  const guests = os.reduce((acc, o) => acc + (o.guests ?? 0), 0);
                  const ready = os.some((o) => o.status === 'READY');
                  const draftHere = draft?.tableId === tb.id ? draft : null;
                  const notSent = [...os.filter((o) => o.id !== draftHere?.id), ...(draftHere ? [draftHere] : [])]
                    .flatMap((o) => o.items)
                    .reduce((a, l) => a + (l.kitchen ? Math.max(0, l.qty - l.sentQty) : 0), 0);
                  const long = since >= warnAfter;
                  return (
                    <div key={tb.id} className="relative">
                      <button
                        onClick={() => go(tb)}
                        className={cn(
                          'flex h-[132px] w-full flex-col rounded-lg border bg-surface p-3 text-left transition-colors hover:border-ink-4',
                          st === 'free' && 'border-line',
                          st === 'busy' && 'border-brand/35 bg-brand-50/60',
                          st === 'billing' && 'border-accent/50 bg-accent-50',
                          st === 'reserved' && 'border-plum/30 bg-plum-50/70',
                          st === 'cleaning' && 'border-dashed border-line-2 bg-paper',
                        )}
                        aria-label={`${t('pos.tableN', { n: tb.name })}, ${t(`tables.state.${st}`)}${total ? `, ${formatMoney(total)}` : ''}`}
                      >
                        <div className="flex w-full items-start justify-between">
                          <span className="text-[22px] leading-none font-semibold tracking-tight">{tb.name}</span>
                          {notSent > 0 ? (
                            <span className="flex items-center gap-1 rounded bg-warn px-1.5 py-0.5 text-[11px] font-semibold text-white" title={t('tables.notSent', { n: notSent })}>
                              <ChefHat className="h-3 w-3" aria-hidden />
                              {t('tables.notSentShort', { n: notSent })}
                            </span>
                          ) : ready && (
                            <span className="flex items-center gap-1 rounded bg-ok px-1.5 py-0.5 text-[11px] font-semibold text-white">
                              <Bell className="h-3 w-3" aria-hidden />
                              {t('status.READY')}
                            </span>
                          )}
                        </div>
                        <StateLabel st={st} tb={tb} />
                        {os[0]?.createdByName && <span className="block max-w-full truncate text-[11px] text-ink-3">{t('pos.takenBy', { name: os[0].createdByName })}</span>}
                        <div className="mt-auto w-full">
                          {os.length ? (
                            <>
                              <p className="num text-[19px] leading-tight font-semibold">{formatMoney(total)}</p>
                              <p className="mt-0.5 flex items-center gap-3 text-[12px] text-ink-3">
                                <span className={cn('flex items-center gap-1', long && 'font-semibold text-warn')}>
                                  <Clock className="h-3 w-3" aria-hidden />
                                  {formatDuration(since)}
                                </span>
                                {guests > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Users className="h-3 w-3" aria-hidden />
                                    {guests}
                                  </span>
                                )}
                              </p>
                            </>
                          ) : (
                            <p className="text-[12px] text-ink-3">{t('tables.seats', { n: tb.capacity })}</p>
                          )}
                        </div>
                      </button>
                      {(st === 'busy' || st === 'billing') && (
                        <button
                          onClick={() => go(tb)}
                          className="absolute right-1.5 bottom-1.5 flex h-8 w-8 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-600"
                          title={t('tables.addItems')}
                          aria-label={`${t('tables.addItems')} — ${t('pos.tableN', { n: tb.name })}`}
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                      {st !== 'busy' && st !== 'billing' && can('tables.manage') && !offline && (
                        <div className="absolute right-1.5 bottom-1.5">
                        <DropdownMenu
                          label={t('tables.tableOptions')}
                          trigger={({ toggle }) => (
                            <button onClick={toggle} aria-label={t('tables.tableOptions')} className="flex h-7 w-7 items-center justify-center rounded text-ink-4 hover:bg-paper-2 hover:text-ink">
                              <span aria-hidden className="text-lg leading-none">⋯</span>
                            </button>
                          )}
                          items={[
                            { label: t('tables.markReserved'), icon: <CalendarClock />, onSelect: () => setHold(tb, 'RESERVED'), disabled: tb.hold === 'RESERVED' },
                            { label: t('tables.markCleaning'), icon: <Sparkles />, onSelect: () => setHold(tb, 'CLEANING'), disabled: tb.hold === 'CLEANING' },
                            { label: t('tables.markFree'), onSelect: () => setHold(tb, 'NONE'), disabled: tb.hold === 'NONE' },
                          ]}
                        />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Takeaway & delivery queue */}
      <aside className="flex max-h-[38dvh] shrink-0 flex-col border-t border-line bg-surface lg:max-h-none lg:w-[340px] lg:border-t-0 lg:border-l">
        <div className={cn('flex items-center justify-between gap-2 px-4 py-3', queue.length > 0 ? 'border-b border-line' : 'lg:border-b lg:border-line')}>
          <h2 className="min-w-0 truncate font-semibold">
            {t('tables.takeawayQueue')}
            {queue.length > 0 && <span className="num ml-1.5 text-ink-3">{queue.length}</span>}
          </h2>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="primary"
              icon={<ShoppingBag className="h-4 w-4" />}
              onClick={() => {
                newOrder('TAKEAWAY');
                navigate('/pos');
              }}
            >
              {t('orderType.TAKEAWAY')}
            </Button>
            {settings?.pos.allowDelivery && (
              <Button
                size="sm"
                icon={<Truck className="h-4 w-4" />}
                onClick={() => {
                  newOrder('DELIVERY');
                  navigate('/pos');
                }}
                aria-label={t('pos.newDelivery')}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className={cn('scroll-thin min-h-0 flex-1 overflow-y-auto', queue.length === 0 && 'hidden lg:block')}>
          {queue.length === 0 ? (
            <EmptyState icon={<Receipt />} title={t('tables.noTakeaway')} />
          ) : (
            <ul className="divide-y divide-line">
              {queue.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => {
                      openOrder(o.id);
                      navigate('/pos');
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-paper-2 text-ink-2">
                      {o.type === 'DELIVERY' ? <Truck className="h-4 w-4" aria-hidden /> : <ShoppingBag className="h-4 w-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{o.number ? `#${o.number}` : t('pos.newOrder')}</span>
                        <span className="num font-semibold">{formatMoney(billFor(o).total)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-3">{[o.customerName, o.customerPhone].filter(Boolean).join(' · ') || t(`orderType.${o.type}`)}</span>
                      <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                        <OrderStatusBadge order={o} size="sm" />
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden />
                          {formatDuration(minutesSince(o.createdAt, now))}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function StateLabel({ st, tb }: { st: TableState; tb: CatalogTable }) {
  const t = useT();
  const map: Record<TableState, { cls: string; text: string }> = {
    free: { cls: 'text-ok', text: t('tables.available') },
    busy: { cls: 'text-brand', text: t('tables.occupied') },
    billing: { cls: 'text-accent', text: t('tables.billPrinted') },
    reserved: { cls: 'text-plum', text: tb.reservation ? `${t('tables.reserved')} ${to12h(tb.reservation.time)}` : t('tables.reserved') },
    cleaning: { cls: 'text-ink-3', text: t('tables.cleaning') },
  };
  const m = map[st];
  return (
    <span className={cn('mt-1 text-[12px] font-semibold', m.cls)}>
      {m.text}
      {st === 'reserved' && tb.reservation && <span className="block truncate font-normal text-ink-3">{tb.reservation.name} · {tb.reservation.guests}</span>}
    </span>
  );
}

function Legend({ tone, label, n }: { tone: TableState; label: string; n: number }) {
  const sw: Record<TableState, string> = {
    free: 'border-line-2 bg-surface',
    busy: 'border-brand/40 bg-brand-50',
    billing: 'border-accent/50 bg-accent-50',
    reserved: 'border-plum/40 bg-plum-50',
    cleaning: 'border-dashed border-line-2 bg-paper',
  };
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn('h-3.5 w-3.5 rounded-sm border', sw[tone])} />
      {label}
      <span className="num font-semibold text-ink">{n}</span>
    </span>
  );
}

