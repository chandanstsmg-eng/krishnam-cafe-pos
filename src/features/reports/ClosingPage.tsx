import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck2, CheckCircle2, Lock, Printer } from 'lucide-react';
import { api, errorMessage, qs } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { useCan } from '../auth/session';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, Skeleton } from '../../components/ui/Misc';
import { confirm } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { printPage } from '../../services/print';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { businessDate, formatDateLong, formatDateTime, formatDayShort } from '../../../shared/dates';
import type { AppSettings } from '../../../shared/types';
import { formatNum } from './charts';

interface DayTotals {
  date: string;
  sales: number;
  bills: number;
  avgBill: number;
  discount: number;
  tax: number;
  cash: number;
  upi: number;
  card: number;
  bank: number;
  expenses: number;
  refunds: number;
  voids: number;
  voidValue: number;
  cashDifference?: number;
}

interface ClosingData {
  date: string;
  totals: DayTotals;
  cashDifference: number;
  warnings: string[];
  closed: { at: string; by: string; note: string | null; totals: DayTotals } | null;
  history: { date: string; totals: DayTotals; by: string; at: string; note: string | null }[];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export default function ClosingPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = businessDate();
  const raw = params.get('date') ?? '';
  const date = YMD.test(raw) && raw <= today ? raw : today;
  const [note, setNote] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['closing', date],
    queryFn: () => api.get<ClosingData>(`/closing${qs({ date })}`),
    placeholderData: keepPreviousData,
  });
  useLive(['invoices', 'orders', 'shift'], [['closing']]);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ settings: AppSettings }>('/settings'), staleTime: 60_000 });

  const setDate = (d: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (d === today) n.delete('date');
      else n.set('date', d);
      return n;
    });

  const close = useMutation({
    mutationFn: () => api.post('/closing', { date, note: note.trim() || null }),
    onSuccess: () => {
      toast.success(t('closing.closedToast', { date: formatDateLong(date) }));
      setNote('');
      void qc.invalidateQueries({ queryKey: ['closing'] });
    },
    onError: (err) => toast.error(t('closing.closeFailed'), errorMessage(err)),
  });

  const d = data && data.date === date ? data : undefined;

  const askClose = async () => {
    if (!d) return;
    const ok = await confirm({
      title: t('closing.confirmTitle', { date: formatDateLong(date) }),
      message: (
        <div className="space-y-2">
          <p>{t('closing.confirmMessage', { sales: formatMoney(d.totals.sales), n: formatNum(d.totals.bills) })}</p>
          {d.warnings.length > 0 && (
            <ul className="space-y-1 text-warn">
              {d.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="text-ink-3">{t('closing.confirmFinal')}</p>
        </div>
      ),
      confirmLabel: t('closing.closeBtn'),
    });
    if (ok) close.mutate();
  };

  const shown = d?.closed ? d.closed.totals : d?.totals;
  const cashDiff = d?.closed ? (d.closed.totals.cashDifference ?? 0) : (d?.cashDifference ?? 0);

  const lines = (x: DayTotals, diff: number): { label: string; value: string; strong?: boolean; tone?: 'danger' | 'warn' }[] => [
    { label: t('pay.cash'), value: formatMoney(x.cash) },
    { label: t('pay.upi'), value: formatMoney(x.upi) },
    { label: t('pay.card'), value: formatMoney(x.card) },
    { label: t('pay.bank'), value: formatMoney(x.bank) },
    { label: t('closing.expenses'), value: formatMoney(x.expenses) },
    { label: t('closing.refunds'), value: formatMoney(x.refunds) },
    { label: t('closing.discounts'), value: formatMoney(x.discount) },
    { label: t('closing.voids'), value: x.voids ? t('closing.voidsValue', { n: formatNum(x.voids), amount: formatMoney(x.voidValue) }) : t('closing.none') },
    { label: t('closing.tax'), value: formatMoney(x.tax) },
    { label: t('closing.bills'), value: formatNum(x.bills) },
    {
      label: t('closing.cashDiff'),
      value: diff === 0 ? t('closing.matched') : diff < 0 ? t('closing.short', { amount: formatMoney(-diff) }) : t('closing.over', { amount: formatMoney(diff) }),
      tone: diff < 0 ? 'danger' : diff > 0 ? 'warn' : undefined,
    },
  ];

  const print = () => {
    if (!d || !shown) return;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const name = settings.data?.settings.business.name ?? t('app.name');
    const rows = [{ label: t('closing.totalSales'), value: formatMoney(shown.sales) }, ...lines(shown, cashDiff)];
    const meta = d.closed ? t('closing.closedBy', { name: d.closed.by, at: formatDateTime(d.closed.at) }) : t('closing.notClosedYet');
    printPage(
      `${t('closing.printTitle')} — ${formatDateLong(date)}`,
      `<h1>${esc(t('closing.printTitle'))} — ${esc(formatDateLong(date))}</h1><p class="meta">${esc(name)} · ${esc(meta)}</p>
       <table style="max-width:420px"><tbody>${rows.map((r, i) => `<tr><td${i === 0 ? ' style="font-weight:700"' : ''}>${esc(r.label)}</td><td class="r"${i === 0 ? ' style="font-weight:700"' : ''}>${esc(r.value)}</td></tr>`).join('')}</tbody></table>
       ${d.closed?.note ? `<p class="meta" style="margin-top:10px">${esc(t('closing.note'))}: ${esc(d.closed.note)}</p>` : ''}`,
    );
  };

  return (
    <div>
      <PageHeader
        title={t('closing.title')}
        subtitle={t('closing.subtitle')}
        actions={
          <Field label={t('closing.day')} htmlFor="close-date">
            <Input id="close-date" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
          </Field>
        }
      />

      {error && !data ? (
        <Panel>
          <EmptyState title={t('closing.loadFailed')} action={<Button onClick={() => refetch()}>{t('dashboard.tryAgain')}</Button>}>
            {errorMessage(error)}
          </EmptyState>
        </Panel>
      ) : isLoading || !d || !shown ? (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]" aria-busy="true">
          <Skeleton className="h-96" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className={cn('grid gap-4 lg:grid-cols-[1.3fr_1fr]', isFetching && 'opacity-80')}>
          <Panel
            title={date === today ? t('closing.todayFigures') : t('closing.figuresFor', { date: formatDateLong(date) })}
            subtitle={d.closed ? t('closing.storedFigures') : t('closing.liveFigures')}
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-4">
              <span className="text-[13px] font-semibold tracking-[0.06em] text-ink-2 uppercase">{t('closing.totalSales')}</span>
              <span className="num text-[32px] leading-none font-bold text-ink">{formatMoney(shown.sales)}</span>
            </div>
            <dl className="mt-3 divide-y divide-line text-[15px]">
              {lines(shown, cashDiff).map((l) => (
                <div key={l.label} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-ink-2">{l.label}</dt>
                  <dd className={cn('num text-right', l.tone === 'danger' ? 'font-semibold text-danger' : l.tone === 'warn' ? 'font-semibold text-warn' : 'text-ink')}>{l.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[12px] text-ink-4">{t('closing.cashDiffHint')}</p>
            {d.closed && d.totals.sales !== d.closed.totals.sales && (
              <p className="mt-2 rounded-md bg-warn-50 px-3 py-2 text-[13px] text-warn">{t('closing.changedSince', { amount: formatMoney(d.totals.sales) })}</p>
            )}
          </Panel>

          <div className="space-y-4">
            {d.closed ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    {t('closing.dayClosed')}
                    <Badge tone="ok" icon={<CheckCircle2 className="h-3 w-3" />}>
                      {t('closing.closedBadge')}
                    </Badge>
                  </span>
                }
                action={
                  <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={print}>
                    {t('common.print')}
                  </Button>
                }
              >
                <p className="text-sm text-ink-2">{t('closing.closedBy', { name: d.closed.by, at: formatDateTime(d.closed.at) })}</p>
                {d.closed.note && (
                  <p className="mt-3 rounded-md bg-paper px-3 py-2 text-sm text-ink-2">
                    <span className="text-ink-3">{t('closing.note')}: </span>
                    {d.closed.note}
                  </p>
                )}
                <p className="mt-3 text-[13px] text-ink-3">{t('closing.readOnly')}</p>
              </Panel>
            ) : (
              <Panel title={t('closing.closeTitle')} subtitle={t('closing.closeHint')}>
                {d.warnings.length > 0 && (
                  <ul className="mb-4 space-y-2">
                    {d.warnings.map((w) => (
                      <li key={w} className="flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2 text-sm text-warn">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>
                          <span className="sr-only">{t('closing.warning')}: </span>
                          {w}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {can('day.close') ? (
                  <div className="space-y-4">
                    <Field label={t('closing.note')} htmlFor="close-note" optional hint={t('closing.noteHint')}>
                      <Textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
                    </Field>
                    <Button variant="primary" size="xl" block icon={<Lock className="h-5 w-5" />} loading={close.isPending} onClick={askClose}>
                      {t('closing.closeBtnFor', { date: date === today ? t('closing.todayWord') : formatDayShort(date) })}
                    </Button>
                    <Button variant="ghost" size="sm" icon={<Printer className="h-4 w-4" />} onClick={print}>
                      {t('closing.printPreview')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-3">{t('closing.noPermission')}</p>
                )}
              </Panel>
            )}

            <Panel title={t('closing.history')} bodyClassName="p-0!">
              {d.history.length === 0 ? (
                <EmptyState icon={<CalendarCheck2 />} title={t('closing.noHistory')} className="py-8" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.history.map((h) => (
                    <li key={h.date}>
                      <button
                        type="button"
                        onClick={() => setDate(h.date)}
                        aria-current={h.date === date ? 'date' : undefined}
                        className={cn('flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-paper', h.date === date && 'bg-brand-50/70')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-ink">{formatDayShort(h.date)}</span>
                          <span className="block text-[12px] text-ink-3">{t('closing.historyBy', { name: h.by, n: formatNum(h.totals.bills ?? 0) })}</span>
                        </span>
                        <HistoryAmount>{formatMoney(h.totals.sales ?? 0)}</HistoryAmount>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryAmount({ children }: { children: ReactNode }) {
  return <span className="num shrink-0 font-semibold text-ink">{children}</span>;
}
