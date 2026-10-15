import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, Info, RotateCcw, Search, Tags, X } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input, MoneyInput } from '../../components/ui/Field';
import { EmptyState, Money, PageHeader, SkeletonRows, VegMark } from '../../components/ui/Misc';
import { Tabs } from '../../components/ui/Segmented';
import { confirm } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import { formatDateLong, formatTime } from '../../../shared/dates';
import { MENU_KEY, PRICE_HISTORY_KEY, type AdminMenu, type AdminMenuItem, type PriceChangeRow } from './types';

type Tab = 'change' | 'history';

/** A change is "big" when the new price is less than half or more than 1.5× the old one — often a typing slip. */
const isBig = (oldP: number, newP: number) => oldP > 0 && (newP < oldP * 0.5 || newP > oldP * 1.5);

export default function PricesPage() {
  const t = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('change');
  const menu = useQuery({ queryKey: MENU_KEY, queryFn: () => api.get<AdminMenu>('/menu/admin') });
  const history = useQuery({ queryKey: PRICE_HISTORY_KEY, queryFn: () => api.get<PriceChangeRow[]>('/menu/price-changes') });
  useLive(['menu'], [MENU_KEY, PRICE_HISTORY_KEY]);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const items = menu.data?.items;
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);

  const changes = useMemo(
    () =>
      Object.entries(drafts)
        .map(([id, v]) => ({ item: byId.get(id), price: toPaise(v), raw: v }))
        .filter((c): c is { item: AdminMenuItem; price: number; raw: string } => !!c.item && c.raw !== '' && c.price !== c.item.price),
    [drafts, byId],
  );

  const term = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const d = menu.data;
    if (!d) return [];
    return d.categories
      .map((c) => ({
        cat: c,
        items: d.items.filter((i) => i.active && i.categoryId === c.id && (!term || i.name.toLowerCase().includes(term) || (i.code ?? '').toLowerCase().includes(term))),
      }))
      .filter((g) => g.items.length);
  }, [menu.data, term]);

  const setDraft = (id: string, v: string) => setDrafts((d) => ({ ...d, [id]: v }));
  const undo = (id: string) =>
    setDrafts((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });

  const focusNext = (el: HTMLInputElement) => {
    const inputs = [...(listRef.current?.querySelectorAll<HTMLInputElement>('input[data-price]') ?? [])];
    const next = inputs[inputs.indexOf(el) + 1];
    next?.focus();
    next?.select();
  };

  const save = async () => {
    if (!changes.length) return;
    const ok = await confirm({
      title: t('prices.confirmTitle', { n: changes.length }),
      confirmLabel: changes.length === 1 ? t('prices.saveOne') : t('prices.save', { n: changes.length }),
      message: (
        <div className="space-y-3">
          <p>{t('prices.confirmMessage')}</p>
          <ul className="scroll-thin max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {changes.map((c) => (
              <li key={c.item.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">{c.item.name}</span>
                <span className="num shrink-0 whitespace-nowrap">
                  <span className="text-ink-3">{formatMoney(c.item.price)}</span> → <span className="font-semibold text-ink">{formatMoney(c.price)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.patch<{ changed: number; message: string }>(
        '/menu/prices',
        changes.map((c) => ({ id: c.item.id, price: c.price })),
      );
      toast.success(t('prices.saved'), r?.message);
      setDrafts({});
      await Promise.all([qc.invalidateQueries({ queryKey: MENU_KEY }), qc.invalidateQueries({ queryKey: PRICE_HISTORY_KEY })]);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('prices.title')} subtitle={t('prices.subtitle')} />
      <p className="mb-4 flex items-start gap-2 rounded-md border border-info/20 bg-info-50 px-3 py-2 text-sm text-info">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {t('prices.note')}
      </p>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { value: 'change', label: t('prices.tabChange'), count: changes.length || undefined },
          { value: 'history', label: t('prices.tabHistory') },
        ]}
      />

      {tab === 'change' ? (
        <section className="rounded-lg border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2.5">
            <div className="relative min-w-52 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('prices.searchPlaceholder')} aria-label={t('prices.searchPlaceholder')} className="pl-9" />
              {q && (
                <button type="button" onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-[13px] text-ink-3">{t('prices.enterHint')}</p>
          </div>

          {menu.isLoading ? (
            <SkeletonRows className="p-4" rows={10} />
          ) : groups.length === 0 ? (
            <EmptyState icon={<Tags />} title={term ? t('prices.noMatch', { q }) : t('prices.noItems')} />
          ) : (
            <div ref={listRef} className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t('prices.colItem')}</th>
                    <th className="px-2 py-2 text-right font-medium">{t('prices.colCurrent')}</th>
                    <th className="w-40 px-2 py-2 font-medium">{t('prices.colNew')}</th>
                    <th className="px-4 py-2 font-medium">{t('prices.colChange')}</th>
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.cat.id} className="divide-y divide-line border-b border-line">
                    <tr className="bg-paper-2/60">
                      <th colSpan={4} scope="colgroup" className="px-4 py-1.5 text-left text-[13px] font-semibold text-ink-2">
                        {g.cat.name}
                      </th>
                    </tr>
                    {g.items.map((i) => {
                      const raw = drafts[i.id];
                      const next = raw !== undefined && raw !== '' ? toPaise(raw) : null;
                      const changed = next !== null && next !== i.price;
                      return (
                        <tr key={i.id} className={cn(changed && 'bg-accent-50')}>
                          <td className="px-4 py-1.5">
                            <span className="flex items-center gap-2">
                              <VegMark veg={i.isVeg} />
                              <span className="font-medium">{i.name}</span>
                              {i.code && <span className="font-mono text-[12px] text-ink-4">{i.code}</span>}
                              {!i.available && <span className="text-[12px] text-ink-3">· {t('menuAdmin.soldOut')}</span>}
                            </span>
                          </td>
                          <td className={cn('num px-2 py-1.5 text-right', changed ? 'text-ink-3 line-through' : 'font-semibold')}>
                            <Money value={i.price} />
                          </td>
                          <td className="px-2 py-1.5">
                            <MoneyInput
                              data-price=""
                              value={raw ?? rupeeInput(i.price)}
                              onValueChange={(v) => setDraft(i.id, v)}
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  focusNext(e.currentTarget);
                                } else if (e.key === 'Escape' && raw !== undefined) {
                                  e.preventDefault();
                                  undo(i.id);
                                }
                              }}
                              aria-label={t('prices.newPriceFor', { name: i.name })}
                              className={cn(changed && '[&_input]:border-accent [&_input]:font-semibold')}
                            />
                          </td>
                          <td className="px-4 py-1.5">{changed && next !== null && <ChangeCell oldPrice={i.price} newPrice={next} name={i.name} onUndo={() => undo(i.id)} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          <p className="px-4 py-2 text-[12px] text-ink-3">{t('prices.removedItems')}</p>
        </section>
      ) : (
        <HistoryTable rows={history.data} loading={history.isLoading} />
      )}

      {tab === 'change' && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-4 py-3 lg:-mx-6 lg:px-6">
          <p className="mr-auto text-sm text-ink-2">{changes.length === 0 ? t('prices.noChanges') : changes.length === 1 ? t('prices.oneChange') : t('prices.changes', { n: changes.length })}</p>
          {changes.length > 0 && <Button onClick={() => setDrafts({})}>{t('prices.discardAll')}</Button>}
          <Button variant="primary" onClick={save} loading={busy} disabled={!changes.length}>
            {changes.length === 1 ? t('prices.saveOne') : t('prices.save', { n: changes.length })}
          </Button>
        </div>
      )}
    </div>
  );
}

function ChangeCell({ oldPrice, newPrice, name, onUndo }: { oldPrice: number; newPrice: number; name: string; onUndo: () => void }) {
  const t = useT();
  const diff = newPrice - oldPrice;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="num whitespace-nowrap">
        {formatMoney(oldPrice)} → <span className="font-semibold">{formatMoney(newPrice)}</span>
        <span className="ml-1.5 text-[13px] text-ink-3">
          ({diff > 0 ? '+' : '−'}
          {formatMoney(Math.abs(diff))})
        </span>
      </span>
      {newPrice === 0 && <Badge tone="warn">{t('prices.zeroPrice')}</Badge>}
      {isBig(oldPrice, newPrice) && (
        <span title={t('prices.bigChangeHint')}>
          <Badge tone="warn" icon={<AlertTriangle className="h-3 w-3" />}>
            {t('prices.bigChange')}
          </Badge>
        </span>
      )}
      <IconButton label={t('prices.undo', { name })} size="sm" onClick={onUndo}>
        <RotateCcw className="h-4 w-4" />
      </IconButton>
    </span>
  );
}

function HistoryTable({ rows, loading }: { rows: PriceChangeRow[] | undefined; loading: boolean }) {
  const t = useT();
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card">
      {loading ? (
        <SkeletonRows className="p-4" rows={8} />
      ) : !rows?.length ? (
        <EmptyState icon={<History />} title={t('prices.noHistory')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">{t('prices.colDate')}</th>
                <th className="px-2 py-2 font-medium">{t('prices.colItem')}</th>
                <th className="px-2 py-2 text-right font-medium">{t('prices.colOld')}</th>
                <th className="px-2 py-2 text-right font-medium">{t('prices.colNewShort')}</th>
                <th className="px-4 py-2 font-medium">{t('prices.colBy')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const diff = r.newPrice - r.oldPrice;
                return (
                  <tr key={r.id}>
                    <td className="num px-4 py-2 whitespace-nowrap text-ink-2">
                      {formatDateLong(r.at)}, {formatTime(r.at)}
                    </td>
                    <td className="px-2 py-2 font-medium">{r.item}</td>
                    <td className="num px-2 py-2 text-right text-ink-3">{formatMoney(r.oldPrice)}</td>
                    <td className="num px-2 py-2 text-right font-semibold">
                      {formatMoney(r.newPrice)}
                      <span className="ml-1.5 text-[12px] font-normal text-ink-3">
                        ({diff > 0 ? '+' : '−'}
                        {formatMoney(Math.abs(diff))})
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-2">{r.by ?? t('prices.unknownUser')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
