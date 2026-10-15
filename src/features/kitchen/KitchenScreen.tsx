import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowLeft, BellRing, Check, ChefHat, Clock, Flame, Printer, RotateCcw, ShoppingBag, Truck, Volume2, VolumeX } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { useNow } from '../../hooks/useNow';
import { useCan } from '../auth/session';
import { UserMenu } from '../../components/UserMenu';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { Skeleton } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { chime } from '../../utils/chime';
import { formatTime, minutesSince } from '../../../shared/dates';

interface Ticket {
  id: string;
  orderId: string;
  orderNumber: number;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  tableName: string | null;
  customerName: string | null;
  round: number;
  status: 'NEW' | 'PREPARING' | 'READY' | 'SERVED';
  note: string | null;
  items: { name: string; qty: number; modifiers: string | null; note: string | null }[];
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  paid: boolean;
}

/**
 * Kitchen display. Big text, three steps: start cooking → ready → served.
 */
export function KitchenScreen() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const now = useNow(15_000);
  const [filter, setFilter] = useState<'all' | 'DINE_IN' | 'TAKEAWAY'>('all');
  const [sound, setSound] = useState(() => localStorage.getItem('ap.kdsSound') !== 'off');
  const [lastAction, setLastAction] = useState<{ id: string; from: Ticket['status'] } | null>(null);
  const [phoneCol, setPhoneCol] = useState<'NEW' | 'PREPARING' | 'READY'>('NEW');
  const seen = useRef<Set<string> | null>(null);

  const { data, isLoading, isError } = useQuery({ queryKey: ['kitchen'], queryFn: () => api.get<Ticket[]>('/kitchen/tickets'), refetchInterval: 30_000 });
  useLive(['kitchen', 'orders'], [['kitchen']]);

  // Chime for tickets that weren't there before.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.filter((d) => d.status === 'NEW').map((d) => d.id));
    if (seen.current && sound && [...ids].some((id) => !seen.current!.has(id))) chime();
    seen.current = new Set([...(seen.current ?? []), ...ids]);
  }, [data, sound]);

  const tickets = useMemo(() => (data ?? []).filter((tk) => filter === 'all' || (filter === 'TAKEAWAY' ? tk.orderType !== 'DINE_IN' : tk.orderType === 'DINE_IN')), [data, filter]);
  const cols = {
    NEW: tickets.filter((tk) => tk.status === 'NEW'),
    PREPARING: tickets.filter((tk) => tk.status === 'PREPARING'),
    READY: tickets.filter((tk) => tk.status === 'READY'),
  };

  const move = async (tk: Ticket, status: Ticket['status']) => {
    qc.setQueryData<Ticket[]>(['kitchen'], (old) => old?.map((x) => (x.id === tk.id ? { ...x, status } : x)));
    setLastAction({ id: tk.id, from: tk.status });
    try {
      await api.patch(`/kitchen/tickets/${tk.id}`, { status });
    } catch (err) {
      toast.error(errorMessage(err));
      void qc.invalidateQueries({ queryKey: ['kitchen'] });
    }
  };

  const undo = async () => {
    if (!lastAction) return;
    const { id, from } = lastAction;
    setLastAction(null);
    try {
      await api.patch(`/kitchen/tickets/${id}`, { status: from });
      void qc.invalidateQueries({ queryKey: ['kitchen'] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const reprint = async (tk: Ticket) => {
    try {
      await api.post(`/kitchen/tickets/${tk.id}/print`);
      toast.success(t('kitchen.printed'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="pb-safe flex h-dvh flex-col bg-paper-2/60">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        {can('orders.take') && (
          <Link to="/pos/tables" className="flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-paper" aria-label={t('kitchen.backToPos')}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <ChefHat className="h-6 w-6 text-brand" aria-hidden />
        <h1 className="text-lg font-semibold">{t('kitchen.title')}</h1>
        <span className="num text-ink-3">{formatTime(new Date(now))}</span>
        <div className="ml-auto flex items-center gap-2">
          {lastAction && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={undo}>
              {t('kitchen.undo')}
            </Button>
          )}
          <Segmented
            label={t('kitchen.show')}
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('kitchen.all') },
              { value: 'DINE_IN', label: t('orderType.DINE_IN') },
              { value: 'TAKEAWAY', label: t('kitchen.parcel') },
            ]}
          />
          <button
            onClick={() => {
              setSound((s) => !s);
              localStorage.setItem('ap.kdsSound', sound ? 'off' : 'on');
              if (!sound) chime();
            }}
            aria-pressed={sound}
            aria-label={sound ? t('kitchen.soundOn') : t('kitchen.soundOff')}
            title={sound ? t('kitchen.soundOn') : t('kitchen.soundOff')}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line-2 text-ink-2 hover:bg-paper"
          >
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <UserMenu area="kitchen" />
        </div>
      </header>

      {isError && <p className="bg-danger-50 px-4 py-2 text-sm text-danger">{t('kitchen.connectionLost')}</p>}

      {/* Phones: one column at a time, picked from these tabs. */}
      <div role="tablist" aria-label={t('kitchen.title')} className="grid shrink-0 grid-cols-3 gap-1.5 border-b border-line bg-surface p-2 md:hidden">
        {(['NEW', 'PREPARING', 'READY'] as const).map((col) => (
          <button
            key={col}
            role="tab"
            aria-selected={phoneCol === col}
            onClick={() => setPhoneCol(col)}
            className={cn(
              'flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-md px-1 text-[13px] font-semibold',
              phoneCol === col ? 'bg-ink text-white' : 'text-ink-2 hover:bg-paper',
            )}
          >
            <span className="truncate">{t(`kitchen.col.${col}`)}</span>
            <span className={cn('num rounded-full px-1.5 text-[12px]', phoneCol === col ? 'bg-white/20' : 'bg-paper-2')}>{cols[col].length}</span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-2 sm:p-3 md:grid-cols-3">
        {(['NEW', 'PREPARING', 'READY'] as const).map((col) => (
          <section key={col} className={cn('min-h-0 flex-col rounded-lg bg-paper/70 md:flex', phoneCol === col ? 'flex' : 'hidden')} aria-label={t(`kitchen.col.${col}`)}>
            <h2 className="hidden items-center justify-between px-3 py-2.5 md:flex">
              <span className={cn('flex items-center gap-2 text-[15px] font-bold tracking-wide uppercase', col === 'NEW' ? 'text-info' : col === 'PREPARING' ? 'text-warn' : 'text-ok')}>
                {col === 'NEW' ? <BellRing className="h-4 w-4" aria-hidden /> : col === 'PREPARING' ? <Flame className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                {t(`kitchen.col.${col}`)}
              </span>
              <span className="num rounded-full bg-surface px-2.5 py-0.5 text-sm font-semibold">{cols[col].length}</span>
            </h2>
            <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-2 sm:px-3 sm:pt-0 sm:pb-3">
              {isLoading && <Skeleton className="h-48" />}
              {!isLoading && cols[col].length === 0 && <p className="py-10 text-center text-sm text-ink-4">{t('kitchen.nothing')}</p>}
              {cols[col].map((tk) => (
                <TicketCard key={tk.id} tk={tk} now={now} onMove={move} onPrint={reprint} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function TicketCard({ tk, now, onMove, onPrint }: { tk: Ticket; now: number; onMove: (tk: Ticket, s: Ticket['status']) => void; onPrint: (tk: Ticket) => void }) {
  const t = useT();
  const age = minutesSince(tk.createdAt, now);
  const late = tk.status !== 'READY' && age >= 20;
  const warm = tk.status !== 'READY' && age >= 12 && !late;
  return (
    <article className={cn('rounded-lg border-2 bg-surface shadow-card', late ? 'border-danger' : warm ? 'border-warn/70' : 'border-line')}>
      <header className="flex items-start justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <div>
          <p className="text-[26px] leading-none font-bold tracking-tight">
            {tk.orderType === 'DINE_IN' && tk.tableName ? tk.tableName : (
              <span className="inline-flex items-center gap-1.5">
                {tk.orderType === 'DELIVERY' ? <Truck className="h-6 w-6" aria-hidden /> : <ShoppingBag className="h-6 w-6" aria-hidden />}
                {t(tk.orderType === 'DELIVERY' ? 'orderType.DELIVERY' : 'kitchen.parcel')}
              </span>
            )}
          </p>
          <p className="mt-1 text-[13px] text-ink-3">
            #{tk.orderNumber}
            {tk.round > 1 && <span className="ml-1.5 rounded bg-accent-50 px-1.5 py-px font-semibold text-accent">{t('kitchen.addOn')}</span>}
            {tk.customerName && <span className="ml-1.5">· {tk.customerName}</span>}
          </p>
        </div>
        <span className={cn('num flex items-center gap-1 rounded-md px-2 py-1 text-[15px] font-bold', late ? 'bg-danger text-white' : warm ? 'bg-warn-50 text-warn' : 'bg-paper text-ink-2')}>
          <Clock className="h-4 w-4" aria-hidden />
          {t('kitchen.mins', { n: age })}
        </span>
      </header>
      <ul className="space-y-1.5 px-3.5 py-3">
        {tk.items.map((it, i) => (
          <li key={i}>
            <p className="text-[20px] leading-snug font-semibold">
              <span className="num mr-2 inline-block min-w-7 text-brand">{it.qty}×</span>
              {it.name}
            </p>
            {it.modifiers && <p className="ml-9 text-[15px] text-ink-2">{it.modifiers}</p>}
            {it.note && <p className="ml-9 text-[15px] font-bold text-danger">▸ {it.note}</p>}
          </li>
        ))}
      </ul>
      {tk.note && <p className="mx-3.5 mb-3 rounded-md bg-accent-50 px-3 py-2 text-[15px] font-semibold text-ink">{tk.note}</p>}
      <footer className="flex gap-2 border-t border-line p-2.5">
        {tk.status === 'NEW' && (
          <Button size="xl" variant="primary" block onClick={() => onMove(tk, 'PREPARING')}>
            {t('kitchen.start')}
          </Button>
        )}
        {tk.status === 'PREPARING' && (
          <Button size="xl" variant="success" block onClick={() => onMove(tk, 'READY')}>
            {t('kitchen.ready')}
          </Button>
        )}
        {tk.status === 'READY' && (
          <Button size="xl" variant="secondary" block onClick={() => onMove(tk, 'SERVED')}>
            {t('kitchen.served')}
          </Button>
        )}
        <Button size="xl" variant="ghost" aria-label={t('kitchen.printTicket')} onClick={() => onPrint(tk)} className="px-4">
          <Printer className="h-5 w-5" />
        </Button>
      </footer>
    </article>
  );
}
