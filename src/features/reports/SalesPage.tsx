import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { EmptyState, PageHeader, Panel, Skeleton, Stat } from '../../components/ui/Misc';
import { useT } from '../../i18n';
import { formatMoney } from '../../../shared/money';
import { formatDateLong, formatDayShort, monthLabel } from '../../../shared/dates';
import { Change, SalesColumns, ShareBars, formatNum, plural, wholeRupees, type SeriesPoint } from './charts';

type Period = 'today' | 'week' | 'month' | 'year';

interface Totals {
  sales: number;
  bills: number;
  avgBill: number;
}

interface Analytics {
  period: Period;
  from: string;
  to: string;
  current: Totals;
  previous: Totals;
  series: { label: string; key: string; sales: number; bills: number }[];
  methods: { method: string; amount: number; count: number }[];
  topItems: { name: string; category: string; qty: number; sales: number }[];
  categories: { name: string; qty: number; sales: number }[];
  orderTypes: { type: string; sales: number; bills: number }[];
}

const METHOD_KEY: Record<string, string> = { CASH: 'pay.cash', UPI: 'pay.upi', CARD: 'pay.card', BANK_TRANSFER: 'pay.bank' };

export default function SalesPage() {
  const t = useT();
  const [period, setPeriod] = useState<Period>('week');
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['analytics', period],
    queryFn: () => api.get<Analytics>(`/analytics?period=${period}`),
    placeholderData: keepPreviousData,
  });
  useLive(['invoices'], [['analytics']]);

  const against = t(`sales.prev_${period}`);

  return (
    <div>
      <PageHeader
        title={t('sales.title')}
        subtitle={data ? (data.from === data.to ? formatDateLong(data.to) : t('sales.range', { from: formatDateLong(data.from), to: formatDateLong(data.to) })) : ' '}
        actions={
          <div className="max-w-full overflow-x-auto">
            <Segmented<Period>
              label={t('sales.period')}
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'today', label: t('sales.today') },
                { value: 'week', label: t('sales.week') },
                { value: 'month', label: t('sales.month') },
                { value: 'year', label: t('sales.year') },
              ]}
            />
          </div>
        }
      />

      {error && !data ? (
        <Panel>
          <EmptyState title={t('sales.loadFailed')} action={<Button onClick={() => refetch()}>{t('dashboard.tryAgain')}</Button>}>
            {errorMessage(error)}
          </EmptyState>
        </Panel>
      ) : isLoading || !data ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-24" />
          <Skeleton className="h-72" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-60" />
            <Skeleton className="h-60" />
          </div>
        </div>
      ) : (
        <div className={isFetching ? 'space-y-4 opacity-70 transition-opacity' : 'space-y-4'} aria-busy={isFetching || undefined}>
          <section className="rounded-lg border border-line bg-surface px-5 py-4 shadow-card" aria-label={t('sales.totals')}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
              <Stat
                label={t('sales.totalSales')}
                value={<span className="text-[28px]">{formatMoney(data.current.sales)}</span>}
                sub={
                  <>
                    <Change cur={data.current.sales} prev={data.previous.sales} against={against} />
                    <span className="block text-ink-4">{t('sales.prevWas', { amount: formatMoney(data.previous.sales) })}</span>
                  </>
                }
              />
              <Stat
                label={t('sales.bills')}
                value={formatNum(data.current.bills)}
                sub={
                  <>
                    <Change cur={data.current.bills} prev={data.previous.bills} against={against} />
                    <span className="block text-ink-4">{t('sales.prevWas', { amount: formatNum(data.previous.bills) })}</span>
                  </>
                }
              />
              <Stat
                label={t('sales.avgBill')}
                value={formatMoney(data.current.avgBill)}
                sub={
                  <>
                    <Change cur={data.current.avgBill} prev={data.previous.avgBill} against={against} />
                    <span className="block text-ink-4">{t('sales.prevWas', { amount: formatMoney(data.previous.avgBill) })}</span>
                  </>
                }
              />
            </div>
            {period === 'today' && <p className="mt-3 text-[12px] text-ink-4">{t('sales.todayNote')}</p>}
          </section>

          {data.current.bills === 0 ? (
            <Panel>
              <EmptyState icon={<BarChart3 />} title={t('sales.noSales')}>
                {t('sales.noSalesHint')}
              </EmptyState>
            </Panel>
          ) : (
            <>
              <Panel title={t(`sales.seriesTitle_${period}`)}>
                <SalesColumns data={toSeries(data)} height={240} ariaLabel={t(`sales.seriesTitle_${period}`)} />
                {period !== 'today' && <p className="mt-2 text-[12px] text-ink-3">{t(period === 'year' ? 'sales.lightMonth' : 'sales.lightDay')}</p>}
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title={t('sales.byMethod')} subtitle={t('sales.byMethodHint')}>
                  <ShareBars
                    rows={data.methods.map((m) => ({
                      key: m.method,
                      label: METHOD_KEY[m.method] ? t(METHOD_KEY[m.method]) : m.method,
                      value: m.amount,
                      sub: plural('sales.payments', m.count),
                    }))}
                    empty={<p className="text-sm text-ink-3">{t('sales.nothing')}</p>}
                  />
                </Panel>
                <Panel title={t('sales.byType')} subtitle={t('sales.byTypeHint')}>
                  <ShareBars
                    rows={data.orderTypes.map((o) => ({ key: o.type, label: t(`orderType.${o.type}`), value: o.sales, sub: plural('sales.billsN', o.bills) }))}
                    empty={<p className="text-sm text-ink-3">{t('sales.nothing')}</p>}
                  />
                </Panel>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <Panel title={t('sales.topItems')} subtitle={t('sales.topItemsHint')} bodyClassName="p-0!">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                        <tr>
                          <th className="w-10 px-4 py-2 text-right font-medium">#</th>
                          <th className="px-2 py-2 font-medium">{t('sales.item')}</th>
                          <th className="px-2 py-2 font-medium">{t('sales.category')}</th>
                          <th className="px-2 py-2 text-right font-medium">{t('sales.qty')}</th>
                          <th className="px-4 py-2 text-right font-medium">{t('sales.salesCol')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {data.topItems.map((it, i) => (
                          <tr key={it.name}>
                            <td className="num px-4 py-2 text-right text-ink-3">{i + 1}</td>
                            <td className="px-2 py-2 font-medium text-ink">{it.name}</td>
                            <td className="px-2 py-2 text-ink-3">{it.category}</td>
                            <td className="num px-2 py-2 text-right">{formatNum(it.qty)}</td>
                            <td className="num px-4 py-2 text-right">{formatMoney(wholeRupees(it.sales))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                <Panel title={t('sales.byCategory')} subtitle={t('sales.byCategoryHint')}>
                  <ShareBars
                    rows={data.categories.map((c) => ({ key: c.name, label: c.name, value: c.sales, sub: t('sales.qtySold', { n: formatNum(c.qty) }) }))}
                    empty={<p className="text-sm text-ink-3">{t('sales.nothing')}</p>}
                  />
                </Panel>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;

function toSeries(d: Analytics): SeriesPoint[] {
  return d.series.map((s) => {
    if (d.period === 'today') {
      const h = Number(s.key);
      return { label: s.label, title: `${hourLabel(h)} – ${hourLabel((h + 1) % 24)}`, sales: s.sales, bills: s.bills };
    }
    if (d.period === 'year')
      return { label: `${monthLabel(s.key).slice(0, 3)} ’${s.key.slice(2, 4)}`, title: monthLabel(s.key), sales: s.sales, bills: s.bills, muted: s.key === d.to.slice(0, 7) };
    const short = formatDayShort(s.key); // "Sat, 27 Sep"
    const label = d.period === 'week' ? `${short.slice(0, 3)} ${short.slice(5).split(' ')[0]}` : short.slice(5);
    return { label, title: short, sales: s.sales, bills: s.bills, muted: s.key === d.to };
  });
}
