import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Package, Receipt, Utensils } from 'lucide-react';
import { api, errorMessage, qs } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { CardRangeFilter, rangeText, useCardRange } from './CardRangeFilter';
import { EmptyState, PageHeader, Panel, Skeleton, Stat } from '../../components/ui/Misc';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { addDays, businessDate, formatDateLong, formatDayShort } from '../../../shared/dates';
import { Change, SalesColumns, formatNum, type SeriesPoint } from './charts';

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
  foodCost: number;
  costCoverage: number;
}

export interface DashboardData {
  today: DayTotals;
  sameDayLastWeek: { sales: number; bills: number };
  sameTimeLastWeek: { sales: number; bills: number };
  estimatedNet: number;
  hourly: { hour: number; sales: number; bills: number }[];
  days: { date: string; sales: number; bills: number }[];
  topItems: { name: string; qty: number; sales: number }[];
  open: { orders: number; value: number; tablesBusy: number; tablesTotal: number };
  lowStock: { id: string; name: string; unit: string; currentStock: number; minStock: number }[];
}

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** "How is my business doing today?" */
export default function DashboardPage() {
  const t = useT();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
    refetchInterval: 120_000,
  });
  useLive(['invoices', 'orders', 'inventory'], [['dashboard']]);

  const today = data?.today.date ?? businessDate();
  const dayName = t(`dashboard.weekday${weekday(today)}`);

  return (
    <div>
      <PageHeader title={t('dashboard.title')} subtitle={`${dayName}, ${formatDateLong(today)}`} />

      {error && !data ? (
        <Panel>
          <EmptyState title={t('dashboard.loadFailed')} action={<Button onClick={() => refetch()}>{t('dashboard.tryAgain')}</Button>}>
            {errorMessage(error)}
          </EmptyState>
        </Panel>
      ) : isLoading || !data ? (
        <DashboardSkeleton />
      ) : (
        <Loaded d={data} dayName={dayName} />
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-36" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

function Loaded({ d, dayName }: { d: DashboardData; dayName: string }) {
  const t = useT();
  const td = d.today;
  const lastWeekDay = t('dashboard.lastDay', { day: dayName });

  const days: SeriesPoint[] = d.days.map((x) => {
    const isToday = x.date === td.date;
    const short = formatDayShort(x.date); // "Sat, 27 Sep"
    return {
      label: String(Number(x.date.slice(8))),
      title: isToday ? `${short} · ${t('dashboard.soFar')}` : short,
      sales: x.sales,
      bills: x.bills,
      muted: isToday,
    };
  });
  const weekTotal = d.days.filter((x) => x.date > addDays(td.date, -7)).reduce((a, x) => a + x.sales, 0);

  return (
    <div className="space-y-4">
      {/* The figures: plain, in one strip. */}
      <section className="rounded-lg border border-line bg-surface px-5 py-4 shadow-card" aria-label={t('dashboard.figures')}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat
            label={t('dashboard.todaysSales')}
            value={<span className="text-[28px]">{formatMoney(td.sales)}</span>}
            sub={<Change cur={td.sales} prev={d.sameTimeLastWeek.sales} against={lastWeekDay} />}
            className="col-span-2 sm:col-span-1"
          />
          <Stat label={t('dashboard.bills')} value={formatNum(td.bills)} sub={t('dashboard.billsLastWeek', { n: formatNum(d.sameTimeLastWeek.bills), day: lastWeekDay })} />
          <Stat label={t('dashboard.avgOrder')} value={formatMoney(td.avgBill)} />
          <Stat label={t('dashboard.estimatedNet')} value={formatMoney(d.estimatedNet)} tone={d.estimatedNet < 0 ? 'danger' : undefined} sub={t('dashboard.estimatedNetHint')} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Small label={t('pay.cash')} value={td.cash} />
          <Small label={t('pay.upi')} value={td.upi} />
          <Small label={t('pay.card')} value={td.card} />
          {td.bank > 0 && <Small label={t('pay.bank')} value={td.bank} />}
          <Small label={t('dashboard.expenses')} value={td.expenses} />
          {td.refunds > 0 && <Small label={t('dashboard.refunds')} value={td.refunds} />}
        </div>
        {td.costCoverage > 0 && (
          <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-3">
            {t('dashboard.foodCost', { amount: formatMoney(td.foodCost), pct: Math.round(td.costCoverage * 100) })}
          </p>
        )}
        <p className="mt-2 text-[12px] text-ink-4">{t('dashboard.compareNote', { day: lastWeekDay, amount: formatMoney(d.sameDayLastWeek.sales) })}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <HourlyCard />

        <Panel title={t('dashboard.last14')} subtitle={t('dashboard.last7Total', { amount: formatMoney(weekTotal) })}>
          <SalesColumns data={days} ariaLabel={t('dashboard.last14')} />
          <p className="mt-2 text-[12px] text-ink-3">{t('dashboard.todayLight')}</p>
        </Panel>

        <TopItemsCard />

        <div className="space-y-4">
          <Panel
            title={t('dashboard.rightNow')}
            action={
              <Link to="/pos/tables" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-brand hover:bg-brand-50">
                {t('dashboard.openTables')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            }
          >
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-[13px] text-ink-3">{t('dashboard.openOrders')}</dt>
                <dd className="num mt-1 text-xl font-semibold">{formatNum(d.open.orders)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-ink-3">{t('dashboard.notBilled')}</dt>
                <dd className="num mt-1 text-xl font-semibold">{formatMoney(d.open.value)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-ink-3">{t('dashboard.tablesBusy')}</dt>
                <dd className="num mt-1 text-xl font-semibold">{t('dashboard.ofTables', { n: d.open.tablesBusy, total: d.open.tablesTotal })}</dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title={t('dashboard.lowStock')}
            action={
              <Link to="/admin/inventory" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-brand hover:bg-brand-50">
                {t('dashboard.openStock')} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            }
          >
            {d.lowStock.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ink-3">
                <Package className="h-4 w-4" aria-hidden />
                {t('dashboard.stockFine')}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {d.lowStock.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink-2">{s.name}</span>
                    <span className={cn('num shrink-0 text-[13px]', s.currentStock <= 0 ? 'text-warn' : 'text-ink-3')}>
                      {s.currentStock <= 0
                        ? t('dashboard.outOfStock')
                        : t('dashboard.stockLeft', { qty: formatNum(s.currentStock), unit: s.unit, min: formatNum(s.minStock) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Sales by hour of the day, for the period picked on the card. */
function HourlyCard() {
  const t = useT();
  const [range, setRange] = useCardRange();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'hourly', range.from, range.to],
    queryFn: () => api.get<{ hourly: { hour: number; sales: number; bills: number }[] }>(`/dashboard/hourly${qs({ from: range.from, to: range.to })}`),
    placeholderData: keepPreviousData,
  });
  const rows = data?.hourly ?? [];
  // Hours with sales, padded to a normal trading day so the shape reads.
  const hours = rows.map((h) => h.hour);
  const first = Math.min(7, ...hours);
  const last = Math.max(21, ...hours);
  const hourly: SeriesPoint[] = [];
  for (let h = first; h <= last; h++) {
    const row = rows.find((x) => x.hour === h);
    hourly.push({ label: hourLabel(h), title: `${hourLabel(h)} – ${hourLabel((h + 1) % 24)}`, sales: row?.sales ?? 0, bills: row?.bills ?? 0 });
  }
  const today = range.preset === 'today';
  return (
    <Panel title={t('dashboard.byHour')} subtitle={rangeText(range, t)} action={<CardRangeFilter id="hourly-range" value={range} onChange={setRange} />}>
      {isLoading && !data ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Receipt />} title={today ? t('dashboard.noSalesYet') : t('dashboard.noSalesInRange')} className="py-10" />
      ) : (
        <SalesColumns data={hourly} ariaLabel={t('dashboard.byHour')} />
      )}
      {range.from !== range.to && rows.length > 0 && <p className="mt-2 text-[12px] text-ink-3">{t('dashboard.hourlyAddedUp')}</p>}
    </Panel>
  );
}

/** Best sellers for the period picked on the card, by quantity or by sales. */
function TopItemsCard() {
  const t = useT();
  const [range, setRange] = useCardRange();
  const [by, setBy] = useState<'qty' | 'sales'>('qty');
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'top-items', range.from, range.to, by],
    queryFn: () => api.get<{ items: { name: string; qty: number; sales: number }[] }>(`/dashboard/top-items${qs({ from: range.from, to: range.to, by, limit: 10 })}`),
    placeholderData: keepPreviousData,
  });
  const items = data?.items ?? [];
  return (
    <Panel
      title={t('dashboard.topItemsTitle')}
      subtitle={`${rangeText(range, t)} · ${by === 'qty' ? t('dashboard.byQty') : t('dashboard.bySales')}`}
      action={<CardRangeFilter id="top-range" value={range} onChange={setRange} />}
    >
      <div className="mb-2 flex justify-end">
        <Segmented
          label={t('dashboard.rankBy')}
          size="sm"
          value={by}
          onChange={setBy}
          options={[
            { value: 'qty', label: t('dashboard.byQty') },
            { value: 'sales', label: t('dashboard.bySales') },
          ]}
        />
      </div>
      {isLoading && !data ? (
        <Skeleton className="h-48" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Utensils />} title={range.preset === 'today' ? t('dashboard.noItemsYet') : t('dashboard.noItemsInRange')} className="py-10" />
      ) : (
        <ol className="divide-y divide-line">
          {items.map((it, i) => (
            <li key={it.name} className="flex items-baseline gap-3 py-2 text-sm">
              <span className="num w-5 shrink-0 text-right text-ink-3">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {it.name} <span className="text-ink-3">— {t('dashboard.sold', { n: formatNum(it.qty) })}</span>
              </span>
              <span className="num shrink-0 text-ink-2">{formatMoney(it.sales)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function Small({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className="num mt-0.5 text-[17px] font-semibold text-ink">{formatMoney(value)}</p>
    </div>
  );
}
