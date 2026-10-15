import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CircleDot, Lock, Wallet } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { useCan } from '../auth/session';
import { useLive } from '../../hooks/useLive';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, PageHeader, Panel, SkeletonRows } from '../../components/ui/Misc';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { formatDateLong, formatDuration, formatTime, minutesSince } from '../../../shared/dates';

interface ShiftSummary {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedBy: string;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  cashSales: number;
  upiSales: number;
  cardSales: number;
  bankSales: number;
  totalSales: number;
  bills: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  closingNote: string | null;
  denominations: Record<string, number> | null;
  movements: { id: string; type: 'CASH_IN' | 'CASH_OUT'; amount: number; reason: string; by: string; at: string }[];
}

/** Short / extra / matches — always with a word and a sign, never colour alone. */
function Difference({ value, size = 'md' }: { value: number | null; size?: 'md' | 'lg' }) {
  const t = useT();
  if (value == null) return <span className="text-ink-4">—</span>;
  const tone = value < 0 ? 'text-danger' : value > 0 ? 'text-warn' : 'text-ok';
  const word = value === 0 ? t('shift.matched') : value < 0 ? t('shift.short') : t('shift.over');
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap', tone, size === 'lg' && 'text-lg')}>
      <span className="text-[12px] font-medium">{word}</span>
      {value !== 0 && (
        <span className="num font-semibold">
          {value > 0 ? '+' : '−'}
          {formatMoney(Math.abs(value))}
        </span>
      )}
    </span>
  );
}

function when(iso: string) {
  return `${formatDateLong(iso)}, ${formatTime(iso)}`;
}

/** Closing time; shows only the time when the shift closed on the day it opened. */
function closedWhen(s: ShiftSummary) {
  if (!s.closedAt) return null;
  return formatDateLong(s.closedAt) === formatDateLong(s.openedAt) ? formatTime(s.closedAt) : when(s.closedAt);
}

export default function ShiftsPage() {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);
  useLive(['shift', 'invoices'], [['shifts']]);
  const { data, isLoading, error } = useQuery({ queryKey: ['shifts'], queryFn: () => api.get<ShiftSummary[]>('/shifts') });
  const current = data?.find((s) => s.status === 'OPEN');

  return (
    <>
      <PageHeader
        title={t('shiftsPage.title')}
        subtitle={t('shiftsPage.subtitle')}
        actions={
          can('shifts.manage') && (
            <Button variant="primary" icon={<Wallet className="h-4 w-4" />} onClick={() => navigate('/pos/shift')}>
              {t('shiftsPage.goToCounter')}
            </Button>
          )
        }
      />

      {data && (
        <p className={cn('mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm', current ? 'border-ok/25 bg-ok-50 text-ok' : 'border-line bg-surface text-ink-3')}>
          {current ? <CircleDot className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          {current ? t('shiftsPage.openNow', { name: current.openedBy, time: formatTime(current.openedAt) }) : t('shiftsPage.noneOpen')}
        </p>
      )}

      <Panel bodyClassName="p-0">
        {isLoading ? (
          <SkeletonRows className="p-4" rows={8} />
        ) : error ? (
          <EmptyState icon={<Wallet />} title={errorMessage(error)} />
        ) : !data?.length ? (
          <EmptyState icon={<Wallet />} title={t('shiftsPage.none')}>
            {t('shiftsPage.noneHint')}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('shiftsPage.opened')}</th>
                  <th className="px-2 py-2 font-medium">{t('shiftsPage.closed')}</th>
                  <th className="px-2 py-2 font-medium">{t('shiftsPage.cashier')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('shiftsPage.openingCash')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('shiftsPage.cashSales')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('shiftsPage.upiCard')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('shiftsPage.expected')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('shiftsPage.counted')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('shiftsPage.difference')}</th>
                  <th className="px-2 py-2 font-medium">{t('shiftsPage.note')}</th>
                  <th className="px-4 py-2 font-medium">{t('shiftsPage.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((s) => (
                  <tr key={s.id} onClick={() => setOpenId(s.id)} className="cursor-pointer hover:bg-paper">
                    <td className="num px-4 py-2 whitespace-nowrap">
                      <button type="button" className="text-left hover:underline" onClick={() => setOpenId(s.id)} aria-label={t('shiftsPage.open', { name: s.openedBy, date: when(s.openedAt) })}>
                        <span className="block font-medium">{formatDateLong(s.openedAt)}</span>
                        <span className="text-[12px] text-ink-3">{formatTime(s.openedAt)}</span>
                      </button>
                    </td>
                    <td className="num px-2 py-2 whitespace-nowrap text-ink-2">{closedWhen(s) ?? <span className="text-ink-4">—</span>}</td>
                    <td className="px-2 py-2.5 whitespace-nowrap">
                      {s.openedBy}
                      {s.closedBy && s.closedBy !== s.openedBy && <span className="block text-[12px] text-ink-3">{t('shiftsPage.closedBy', { name: s.closedBy })}</span>}
                    </td>
                    <td className="num px-2 py-2.5 text-right">{formatMoney(s.openingCash)}</td>
                    <td className="num px-2 py-2.5 text-right">{formatMoney(s.cashSales)}</td>
                    <td className="num px-2 py-2.5 text-right text-ink-2">{formatMoney(s.upiSales + s.cardSales + s.bankSales)}</td>
                    <td className="num px-2 py-2.5 text-right font-semibold">{formatMoney(s.expectedCash)}</td>
                    <td className="num px-2 py-2.5 text-right">{s.countedCash != null ? formatMoney(s.countedCash) : <span className="text-ink-4">—</span>}</td>
                    <td className="px-2 py-2.5 text-right">{s.status === 'CLOSED' ? <Difference value={s.difference} /> : <span className="text-ink-4">—</span>}</td>
                    <td className="max-w-[180px] px-2 py-2.5 text-[13px] text-ink-2">{s.closingNote ? <span className="line-clamp-2">{s.closingNote}</span> : <span className="text-ink-4">—</span>}</td>
                    <td className="px-4 py-2.5">{s.status === 'OPEN' ? <Badge tone="ok" icon={<CircleDot className="h-3 w-3" />}>{t('shiftsPage.OPEN')}</Badge> : <Badge tone="neutral">{t('shiftsPage.CLOSED')}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {data && data.length >= 60 && <p className="mt-2 text-[13px] text-ink-3">{t('shiftsPage.latest')}</p>}

      <ShiftDetail id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function Row({ label, value, sign, strong }: { label: string; value: number; sign?: '+' | '−'; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', strong && 'border-t border-line pt-2 font-semibold')}>
      <dt className={strong ? 'text-ink' : 'text-ink-2'}>{label}</dt>
      <dd className="num">
        {sign && value > 0 ? `${sign} ` : ''}
        {formatMoney(value)}
      </dd>
    </div>
  );
}

const NOTE_ORDER = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

function ShiftDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const { data: s, isLoading, error } = useQuery({ queryKey: ['shifts', id], queryFn: () => api.get<ShiftSummary>(`/shifts/${id}`), enabled: !!id });
  const notes = s?.denominations ? NOTE_ORDER.filter((d) => s.denominations![String(d)]) : [];
  const coins = s?.denominations?.coins ?? 0;

  return (
    <Dialog
      open={!!id}
      onClose={onClose}
      size="xl"
      title={s ? t('shiftsPage.detailTitle', { name: s.openedBy }) : t('shiftsPage.title')}
      description={
        s
          ? `${when(s.openedAt)} – ${s.closedAt ? closedWhen(s) : t('shiftsPage.stillOpen')} · ${formatDuration(minutesSince(s.openedAt, s.closedAt ? new Date(s.closedAt).getTime() : Date.now()))}${s.closedBy ? ` · ${t('shiftsPage.closedBy', { name: s.closedBy })}` : ''}`
          : undefined
      }
    >
      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : error || !s ? (
        <EmptyState icon={<Wallet />} title={errorMessage(error)} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-line p-4">
              <h3 className="mb-3 text-[13px] font-semibold text-ink-2">{t('shiftsPage.drawer')}</h3>
              <dl className="space-y-1.5 text-sm">
                <Row label={t('shift.openingCash')} value={s.openingCash} />
                <Row label={t('shift.cashSales')} value={s.cashSales} sign="+" />
                <Row label={t('shift.cashAdded')} value={s.cashIn} sign="+" />
                <Row label={t('shift.paidOut')} value={s.cashOut} sign="−" />
                <Row label={t('shift.cashRefunds')} value={s.cashRefunds} sign="−" />
                <Row label={t('shift.expectedCash')} value={s.expectedCash} strong />
                {s.countedCash != null ? <Row label={t('shift.counted')} value={s.countedCash} /> : <p className="text-ink-3">{t('shiftsPage.notCounted')}</p>}
                {s.status === 'CLOSED' && (
                  <div className="flex items-baseline justify-between border-t border-line pt-2">
                    <dt className="font-semibold">{t('shift.difference')}</dt>
                    <dd>
                      <Difference value={s.difference} size="lg" />
                    </dd>
                  </div>
                )}
              </dl>
            </section>
            <section className="rounded-lg border border-line p-4">
              <h3 className="mb-3 text-[13px] font-semibold text-ink-2">{t('shiftsPage.sales')}</h3>
              <dl className="space-y-1.5 text-sm">
                <Row label={t('pay.cash')} value={s.cashSales} />
                <Row label={t('pay.upi')} value={s.upiSales} />
                <Row label={t('pay.card')} value={s.cardSales} />
                {s.bankSales > 0 && <Row label={t('pay.bank')} value={s.bankSales} />}
                <Row label={t('shift.totalSales', { n: s.bills })} value={s.totalSales} strong />
              </dl>
            </section>
          </div>

          {s.closingNote && (
            <section className="rounded-md border border-warn/20 bg-warn-50 px-4 py-3 text-sm">
              <p className="text-[12px] font-semibold text-warn">{t('shiftsPage.closingNote')}</p>
              <p className="mt-0.5 text-ink">{s.closingNote}</p>
            </section>
          )}

          {(notes.length > 0 || coins > 0) && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{t('shiftsPage.notesCounted')}</h3>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full max-w-md text-sm">
                  <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">{t('shiftsPage.denomination')}</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t('shiftsPage.count')}</th>
                      <th className="px-3 py-1.5 text-right font-medium">{t('shiftsPage.value')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {notes.map((d) => (
                      <tr key={d}>
                        <td className="num px-3 py-1.5">{formatMoney(d)}</td>
                        <td className="num px-3 py-1.5 text-right">{s.denominations![String(d)]}</td>
                        <td className="num px-3 py-1.5 text-right">{formatMoney(d * s.denominations![String(d)])}</td>
                      </tr>
                    ))}
                    {coins > 0 && (
                      <tr>
                        <td className="px-3 py-1.5">{t('shiftsPage.coins')}</td>
                        <td className="px-3 py-1.5" />
                        <td className="num px-3 py-1.5 text-right">{formatMoney(coins)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{t('shiftsPage.movements')}</h3>
            {s.movements.length === 0 ? (
              <p className="text-sm text-ink-3">{t('shiftsPage.noMovements')}</p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {s.movements.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', m.type === 'CASH_IN' ? 'bg-ok-50 text-ok' : 'bg-warn-50 text-warn')}>
                      {m.type === 'CASH_IN' ? <ArrowDownLeft className="h-4 w-4" aria-hidden /> : <ArrowUpRight className="h-4 w-4" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{m.reason}</span>
                      <span className="text-[12px] text-ink-3">
                        {m.type === 'CASH_IN' ? t('shift.cashAdded') : t('shift.paidOut')} · {formatTime(m.at)} · {m.by}
                      </span>
                    </span>
                    <span className="num font-semibold">
                      {m.type === 'CASH_IN' ? '+' : '−'}
                      {formatMoney(m.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
