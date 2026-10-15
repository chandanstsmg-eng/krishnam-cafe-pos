import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, History, Search, X } from 'lucide-react';
import { api, errorMessage, qs } from '../../api/client';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, SkeletonRows } from '../../components/ui/Misc';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { addDays, businessDate, formatDateLong, formatDayShort, formatTime } from '../../../shared/dates';

interface AuditRow {
  id: string;
  at: string;
  user: string;
  action: string;
  summary: string;
}

interface AuditResult {
  total: number;
  page: number;
  pages: number;
  rows: AuditRow[];
}

/** Filter values are action prefixes; the server matches with "starts with". */
const FILTERS = [
  { value: 'menu.price_change', key: 'price' },
  { value: 'invoice.void', key: 'void' },
  { value: 'invoice.refund', key: 'refund' },
  { value: 'order.discount', key: 'discount' },
  { value: 'inventory', key: 'stock' },
  { value: 'expense', key: 'expense' },
  { value: 'user', key: 'staff' },
  { value: 'role', key: 'permissions' },
  { value: 'shift', key: 'shift' },
  { value: 'day.close', key: 'closing' },
  { value: 'settings', key: 'settings' },
] as const;

/** Short tag for each entry, most specific prefix first. */
const TAGS: { prefix: string; key: string; tone?: Tone }[] = [
  { prefix: 'menu.price_change', key: 'price', tone: 'accent' },
  { prefix: 'menu', key: 'menu' },
  { prefix: 'invoice.void', key: 'void', tone: 'danger' },
  { prefix: 'invoice.refund', key: 'refund', tone: 'warn' },
  { prefix: 'invoice.reprint', key: 'reprint' },
  { prefix: 'invoice', key: 'bill' },
  { prefix: 'order.discount', key: 'discount', tone: 'warn' },
  { prefix: 'order.cancel', key: 'cancel', tone: 'warn' },
  { prefix: 'order', key: 'order' },
  { prefix: 'inventory', key: 'stock' },
  { prefix: 'supplier', key: 'supplier' },
  { prefix: 'expense', key: 'expense' },
  { prefix: 'user', key: 'staff' },
  { prefix: 'role', key: 'permissions', tone: 'plum' },
  { prefix: 'shift', key: 'shift' },
  { prefix: 'day.close', key: 'closing', tone: 'brand' },
  { prefix: 'settings', key: 'settings' },
  { prefix: 'table', key: 'tables' },
  { prefix: 'reservation', key: 'reservation' },
];

export default function AuditPage() {
  const t = useT();
  const today = businessDate();
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);

  // Debounce typing.
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);
  useEffect(() => setPage(1), [action, q, from, to]);

  const badRange = !!from && !!to && from > to;
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['audit', { action, q, from, to, page }],
    queryFn: () => api.get<AuditResult>(`/audit${qs({ q, action, from, to, page })}`),
    placeholderData: keepPreviousData,
    enabled: !badRange,
  });

  const groups: { day: string; rows: AuditRow[] }[] = [];
  for (const r of data?.rows ?? []) {
    const day = businessDate(new Date(r.at));
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.rows.push(r);
    else groups.push({ day, rows: [r] });
  }

  const dayTitle = (d: string) => (d === today ? `${t('common.today')} · ${formatDateLong(d)}` : d === addDays(today, -1) ? `${t('common.yesterday')} · ${formatDateLong(d)}` : `${formatDayShort(d)} ${d.slice(0, 4)}`);
  const tagFor = (a: string) => TAGS.find((x) => a.startsWith(x.prefix));
  const filtered = !!(action || q);

  return (
    <div>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-card" aria-label={t('audit.filters')}>
        <Field label={t('audit.type')} htmlFor="audit-type" className="w-full sm:w-52">
          <Select id="audit-type" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('audit.allTypes')}</option>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {t(`audit.filter.${f.key}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('common.search')} htmlFor="audit-q" className="min-w-52 flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input id="audit-q" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('audit.searchPlaceholder')} maxLength={60} className="pr-9 pl-9" />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label={t('common.clear')} className="absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-ink-4 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </Field>
        <Field label={t('common.from')} htmlFor="audit-from">
          <Input id="audit-from" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </Field>
        <Field label={t('common.to')} htmlFor="audit-to">
          <Input id="audit-to" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </Field>
        {badRange && (
          <p role="alert" className="w-full text-[13px] text-danger">
            {t('audit.badRange')}
          </p>
        )}
      </section>

      {error && !data ? (
        <Panel>
          <EmptyState title={t('audit.loadFailed')} action={<Button onClick={() => refetch()}>{t('dashboard.tryAgain')}</Button>}>
            {errorMessage(error)}
          </EmptyState>
        </Panel>
      ) : isLoading && !data ? (
        <SkeletonRows rows={10} />
      ) : !data || data.rows.length === 0 ? (
        <Panel>
          <EmptyState icon={<History />} title={filtered ? t('audit.noMatch') : t('audit.empty')}>
            {t('audit.emptyHint')}
          </EmptyState>
        </Panel>
      ) : (
        <div className={cn('space-y-4', isFetching && 'opacity-70 transition-opacity')} aria-busy={isFetching || undefined}>
          <p className="text-[13px] text-ink-3">{t('audit.count', { n: data.total.toLocaleString('en-IN') })}</p>
          {groups.map((g) => (
            <section key={g.day} className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
              <h2 className="border-b border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink-2">{dayTitle(g.day)}</h2>
              <ul className="divide-y divide-line">
                {g.rows.map((r) => {
                  const tag = tagFor(r.action);
                  return (
                    <li key={r.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[5rem_9rem_minmax(0,1fr)_auto] sm:items-baseline">
                      <span className="num text-ink-3">{formatTime(r.at)}</span>
                      <span className="truncate font-medium text-ink-2">{r.user}</span>
                      <span className="col-span-2 text-ink sm:col-span-1">{r.summary}</span>
                      <span className="col-span-2 sm:col-span-1 sm:text-right">
                        <Badge size="sm" tone={tag?.tone ?? 'neutral'}>
                          {tag ? t(`audit.tag.${tag.key}`) : r.action}
                        </Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {data.pages > 1 && (
            <nav className="flex items-center justify-between gap-3" aria-label={t('audit.pagination')}>
              <Button icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('audit.newer')}
              </Button>
              <span className="num text-[13px] text-ink-3">{t('audit.pageOf', { page: data.page, pages: data.pages })}</span>
              <Button iconRight={<ChevronRight className="h-4 w-4" />} disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                {t('audit.older')}
              </Button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
