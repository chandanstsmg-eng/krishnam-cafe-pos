import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookUser, Search, X } from 'lucide-react';
import { api, ApiError, errorMessage, qs } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, SkeletonRows, Stat } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { statusBadge } from '../billing/BillsScreen';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { formatDateLong, formatTime } from '../../../shared/dates';
import type { InvoiceDTO } from '../../../shared/types';

interface CustomerRow {
  id: string;
  name: string | null;
  phone: string | null;
  visits: number;
  spent: number;
  lastVisit: string | null;
}

interface CustomerDetail {
  id: string;
  name: string | null;
  phone: string | null;
  notes: string | null;
  since: string;
  visits: number;
  spent: number;
  favourites: { name: string; qty: number }[];
  invoices: InvoiceDTO[];
}

export default function CustomersPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['customers', 'list', term],
    queryFn: () => api.get<CustomerRow[]>(`/customers${qs({ q: term })}`),
    placeholderData: keepPreviousData,
  });

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: !id });
  };

  return (
    <>
      <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('customers.search')} aria-label={t('customers.search')} className="pl-9" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {data && data.length >= 200 && !term && <p className="text-[13px] text-ink-3">{t('customers.showing', { n: data.length })}</p>}
      </div>

      <Panel bodyClassName="p-0">
        {isLoading ? (
          <SkeletonRows className="p-4" rows={8} />
        ) : error ? (
          <EmptyState icon={<BookUser />} title={errorMessage(error)} />
        ) : !data?.length ? (
          term ? (
            <EmptyState icon={<Search />} title={t('customers.noMatch', { q: term })} />
          ) : (
            <EmptyState icon={<BookUser />} title={t('customers.none')}>
              {t('customers.noneHint')}
            </EmptyState>
          )
        ) : (
          <div className={cn('overflow-x-auto transition-opacity', isFetching && 'opacity-70')}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('customers.name')}</th>
                  <th className="px-2 py-2 font-medium">{t('customers.mobile')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('customers.visits')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('customers.spent')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('customers.lastVisit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((c) => (
                  <tr key={c.id} onClick={() => open(c.id)} className={cn('cursor-pointer hover:bg-paper', openId === c.id && 'bg-brand-50/70')}>
                    <td className="px-4 py-2.5">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => open(c.id)} aria-label={t('customers.open', { name: c.name || c.phone || '' })}>
                        {c.name || <span className="font-normal text-ink-3 italic">{t('customers.noName')}</span>}
                      </button>
                    </td>
                    <td className="num px-2 py-2.5 text-ink-2">{c.phone ?? '—'}</td>
                    <td className="num px-2 py-2.5 text-right">{c.visits}</td>
                    <td className="num px-2 py-2.5 text-right font-semibold">{formatMoney(c.spent)}</td>
                    <td className="num px-4 py-2.5 text-right text-ink-2">{c.lastVisit ? formatDateLong(c.lastVisit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <CustomerDialog id={openId} onClose={() => open(null)} />
    </>
  );
}

function CustomerDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}`),
    enabled: !!id,
  });
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      setName(data.name ?? '');
      setNotes(data.notes ?? '');
      setFields({});
    }
  }, [data]);

  const dirty = !!data && (name.trim() !== (data.name ?? '') || notes.trim() !== (data.notes ?? ''));

  const save = useMutation({
    mutationFn: () => api.patch(`/customers/${id}`, { name: name.trim() || null, notes: notes.trim() || null }),
    onSuccess: () => {
      toast.success(t('customers.saved'));
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => {
      setFields(err instanceof ApiError && err.fields ? err.fields : {});
      toast.error(errorMessage(err));
    },
  });

  const valid = data?.invoices.filter((i) => i.status !== 'VOID') ?? [];

  return (
    <Dialog
      open={!!id}
      onClose={onClose}
      size="xl"
      title={data ? data.name || data.phone || t('customers.noName') : t('customers.title')}
      description={data ? [data.name ? data.phone : null, t('customers.since', { date: formatDateLong(data.since) })].filter(Boolean).join(' · ') : undefined}
    >
      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : error || !data ? (
        <EmptyState icon={<BookUser />} title={error ? errorMessage(error) : t('customers.notFound')} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-paper/50 p-4 sm:grid-cols-4">
            <Stat label={t('customers.visits')} value={data.visits} />
            <Stat label={t('customers.spent')} value={formatMoney(data.spent)} />
            <Stat label={t('customers.avgBill')} value={data.visits ? formatMoney(Math.round(data.spent / data.visits)) : '—'} />
            <Stat label={t('customers.lastVisit')} value={<span className="text-base">{valid[0] ? formatDateLong(valid[0].createdAt) : '—'}</span>} />
          </div>

          <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{t('customers.favourites')}</h3>
              {data.favourites.length === 0 ? (
                <p className="text-sm text-ink-3">{t('customers.noFavourites')}</p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {data.favourites.map((f) => (
                    <li key={f.name} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>{f.name}</span>
                      <span className="num text-ink-3">{t('customers.timesOrdered', { n: f.qty })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <h3 className="text-[13px] font-semibold text-ink-2">{t('customers.details')}</h3>
              <Field label={t('customers.name')} htmlFor="cu-name" error={fields.name}>
                <Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} invalid={!!fields.name} />
              </Field>
              <Field label={t('customers.notes')} htmlFor="cu-notes" hint={t('customers.notesHint')} error={fields.notes} optional>
                <Textarea id="cu-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={400} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
                  {t('common.save')}
                </Button>
              </div>
            </form>
          </div>

          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-ink-2">{t('customers.bills')}</h3>
            {data.invoices.length === 0 ? (
              <p className="text-sm text-ink-3">{t('customers.noBills')}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('customers.billNo')}</th>
                      <th className="px-2 py-2 font-medium">{t('customers.date')}</th>
                      <th className="px-2 py-2 font-medium">{t('customers.items')}</th>
                      <th className="px-2 py-2 text-right font-medium">{t('customers.amount')}</th>
                      <th className="px-3 py-2 font-medium">{t('customers.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.invoices.map((i) => (
                      <tr key={i.id} className={cn(i.status === 'VOID' && 'text-ink-3')}>
                        <td className="px-3 py-2 font-mono text-[13px]">{i.number}</td>
                        <td className="num px-2 py-2 whitespace-nowrap text-ink-2">
                          {formatDateLong(i.createdAt)}, {formatTime(i.createdAt)}
                        </td>
                        <td className="max-w-[280px] px-2 py-2 text-ink-2">
                          <span className="line-clamp-1">{i.items.map((it) => `${it.qty} × ${it.name}`).join(', ')}</span>
                        </td>
                        <td className={cn('num px-2 py-2 text-right font-semibold', i.status === 'VOID' && 'line-through')}>{formatMoney(i.total)}</td>
                        <td className="px-3 py-2">{statusBadge(i, t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.invoices.length >= 100 && <p className="mt-2 text-[13px] text-ink-3">{t('customers.lastHundred')}</p>}
          </section>
        </div>
      )}
    </Dialog>
  );
}
