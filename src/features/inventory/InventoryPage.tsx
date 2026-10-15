import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, History, MoreHorizontal, Package, Pencil, Plus, Search, ShoppingCart, X } from 'lucide-react';
import { api, errorMessage, qs } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { useCan } from '../auth/session';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, MoneyInput, Select, Switch } from '../../components/ui/Field';
import { EmptyState, Money, PageHeader, Panel, SkeletonRows, Stat } from '../../components/ui/Misc';
import { Segmented, Tabs } from '../../components/ui/Segmented';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import { formatDateLong, formatTime } from '../../../shared/dates';
import { INVENTORY_KEY, MOVE_TYPES, SUPPLIERS_KEY, formatQty, isQtyInput, qtyWithUnit, type MoveType, type Movement, type MovementType, type StockItem, type Supplier } from './types';

type Filter = 'all' | 'low' | 'off';
type Tab = 'stock' | 'movements';

const UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'packet', 'dozen', 'box', 'bottle', 'bag'];

const statusTone = (s: StockItem): Tone => (!s.active ? 'neutral' : s.status === 'OUT' ? 'danger' : s.status === 'LOW' ? 'warn' : 'ok');

export default function InventoryPage() {
  const t = useT();
  const can = useCan();
  const manage = can('inventory.manage');
  const [params, setParams] = useSearchParams();
  const initialFilter: Filter = params.get('filter') === 'low' ? 'low' : 'all';
  const [filter, setFilterState] = useState<Filter>(initialFilter);
  const [tab, setTab] = useState<Tab>('stock');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [move, setMove] = useState<{ item: StockItem; type: MoveType } | null>(null);
  const [edit, setEdit] = useState<StockItem | 'new' | null>(null);
  const [historyFor, setHistoryFor] = useState<StockItem | null>(null);

  const { data, isLoading } = useQuery({ queryKey: INVENTORY_KEY, queryFn: () => api.get<StockItem[]>('/inventory') });
  const suppliers = useQuery({ queryKey: SUPPLIERS_KEY, queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: manage || can('expenses.manage') });
  useLive(['inventory'], [INVENTORY_KEY, ['stock-movements']]);

  const setFilter = (f: Filter) => {
    setFilterState(f);
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (f === 'low') n.set('filter', 'low');
        else n.delete('filter');
        return n;
      },
      { replace: true },
    );
  };

  const items = data ?? [];
  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const activeItems = items.filter((i) => i.active);
  const low = activeItems.filter((i) => i.status !== 'OK').sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'OUT' ? -1 : 1));
  const stockValue = activeItems.reduce((a, i) => a + Math.max(0, i.currentStock) * i.purchasePrice, 0);

  const term = q.trim().toLowerCase();
  const visible = items.filter((i) => {
    if (filter === 'off' ? i.active : !i.active) return false;
    if (filter === 'low' && i.status === 'OK') return false;
    if (cat && i.category !== cat) return false;
    if (term && !i.name.toLowerCase().includes(term) && !(i.supplierName ?? '').toLowerCase().includes(term)) return false;
    return true;
  });

  const moveItems = (i: StockItem) =>
    MOVE_TYPES.map((type) => ({
      label: t(`stock.act${type}`),
      onSelect: () => setMove({ item: i, type }),
    }));

  return (
    <div>
      <PageHeader
        title={t('stock.title')}
        subtitle={t('stock.subtitle')}
        actions={
          manage && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>
              {t('stock.addItem')}
            </Button>
          )
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { value: 'stock', label: t('stock.tabStock') },
          { value: 'movements', label: t('stock.tabMovements') },
        ]}
      />

      {tab === 'movements' ? (
        <MovementsView />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-4 shadow-card sm:grid-cols-3">
            <Stat label={t('stock.itemsCount')} value={isLoading ? '—' : activeItems.length} />
            <Stat label={t('stock.stockValue')} value={isLoading ? '—' : formatMoney(Math.round(stockValue / 100) * 100)} sub={t('stock.stockValueHint')} />
            <Stat label={t('stock.lowCount')} value={isLoading ? '—' : low.length} sub={t('stock.lowCountHint')} tone={low.length ? 'warn' : undefined} />
          </div>

          {low.length > 0 && filter !== 'low' && (
            <Panel
              title={t('stock.lowTitle')}
              subtitle={t('stock.lowSubtitle')}
              className="mb-4"
              bodyClassName="p-0"
              action={
                <Button size="sm" variant="ghost" onClick={() => setFilter('low')}>
                  {t('stock.filterLow')} ({low.length})
                </Button>
              }
            >
              <ul className="divide-y divide-line">
                {low.slice(0, 6).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                    <Badge tone={statusTone(i)} size="sm">
                      {t(`stock.status${i.status}`)}
                    </Badge>
                    <span className="font-medium">{i.name}</span>
                    <span className="text-ink-2">— {t('stock.remaining', { qty: qtyWithUnit(i.currentStock, i.unit) })}</span>
                    <span className="text-[13px] text-ink-3">
                      ({t('stock.minimum', { qty: qtyWithUnit(i.minStock, i.unit) })}
                      {i.daysLeft != null && i.currentStock > 0 ? ` · ${daysLeftText(t, i.daysLeft)}` : ''})
                    </span>
                    {manage && (
                      <Button size="sm" variant="subtle" className="ml-auto" icon={<ShoppingCart className="h-4 w-4" />} onClick={() => setMove({ item: i, type: 'PURCHASE' })}>
                        {t('stock.actPURCHASE')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <section className="rounded-lg border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('stock.searchPlaceholder')} aria-label={t('stock.searchPlaceholder')} className="pl-9" />
                {q && (
                  <button type="button" onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="w-48 shrink-0"><Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('stock.categoryFilter')}>
                <option value="">{t('stock.allCategories')}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select></div>
              <Segmented<Filter>
                label={t('stock.filterLabel')}
                value={filter}
                onChange={setFilter}
                size="sm"
                options={[
                  { value: 'all', label: t('stock.filterAll') },
                  { value: 'low', label: `${t('stock.filterLow')} ${low.length}` },
                  { value: 'off', label: t('stock.filterOff') },
                ]}
              />
            </div>

            {isLoading ? (
              <SkeletonRows className="p-4" rows={8} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Package />}
                title={t('stock.noItems')}
                action={
                  manage && (
                    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>
                      {t('stock.addItem')}
                    </Button>
                  )
                }
              >
                {t('stock.noItemsHint')}
              </EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState icon={<Search />} title={t('stock.noMatch')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t('stock.colItem')}</th>
                      <th className="px-2 py-2 font-medium">{t('stock.colCategory')}</th>
                      <th className="px-2 py-2 text-right font-medium">{t('stock.colStock')}</th>
                      <th className="px-2 py-2 text-right font-medium">{t('stock.colMin')}</th>
                      <th className="px-2 py-2 text-right font-medium">{t('stock.colCost')}</th>
                      <th className="px-2 py-2 text-right font-medium">{t('stock.colValue')}</th>
                      <th className="px-2 py-2 font-medium">{t('stock.colStatus')}</th>
                      <th className="px-2 py-2 text-right font-medium">{t('stock.colDaysLeft')}</th>
                      <th className="px-4 py-2">
                        <span className="sr-only">{t('stock.record')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visible.map((i) => (
                      <tr key={i.id} className={cn('hover:bg-paper', !i.active && 'text-ink-3')}>
                        <td className="px-4 py-2">
                          <button type="button" className="text-left font-medium hover:underline" onClick={() => setHistoryFor(i)}>
                            {i.name}
                          </button>
                          {i.supplierName && <p className="text-[12px] text-ink-3">{i.supplierName}</p>}
                        </td>
                        <td className="px-2 py-2 text-ink-2">{i.category}</td>
                        <td className={cn('num px-2 py-2 text-right font-semibold', i.status === 'OUT' && i.active && 'text-danger')}>{qtyWithUnit(i.currentStock, i.unit)}</td>
                        <td className="num px-2 py-2 text-right text-ink-3">{qtyWithUnit(i.minStock, i.unit)}</td>
                        <td className="num px-2 py-2 text-right text-ink-2">
                          {formatMoney(i.purchasePrice)}
                          <span className="text-ink-4"> / {i.unit}</span>
                        </td>
                        <td className="num px-2 py-2 text-right">
                          <Money value={Math.round((Math.max(0, i.currentStock) * i.purchasePrice) / 100) * 100} />
                        </td>
                        <td className="px-2 py-2">
                          <Badge tone={statusTone(i)} size="sm">
                            {i.active ? t(`stock.status${i.status}`) : t('stock.statusOff')}
                          </Badge>
                        </td>
                        <td className="num px-2 py-2 text-right text-ink-2" title={i.usePerDay > 0 ? t('stock.usePerDay', { qty: qtyWithUnit(i.usePerDay, i.unit) }) : undefined}>
                          {i.daysLeft != null && i.active ? t('stock.days', { n: i.daysLeft }) : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {manage && i.active && (
                              <DropdownMenu
                                label={t('stock.recordFor', { name: i.name })}
                                trigger={({ toggle }) => (
                                  <Button size="sm" icon={<ClipboardList className="h-4 w-4" />} onClick={toggle} aria-label={t('stock.recordFor', { name: i.name })}>
                                    {t('stock.record')}
                                  </Button>
                                )}
                                items={moveItems(i)}
                              />
                            )}
                            <DropdownMenu
                              label={i.name}
                              trigger={({ toggle }) => (
                                <IconButton label={`${t('stock.history')} / ${t('stock.edit')}: ${i.name}`} size="sm" onClick={toggle}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </IconButton>
                              )}
                              items={[
                                { label: t('stock.history'), icon: <History />, onSelect: () => setHistoryFor(i) },
                                ...(manage ? [{ label: t('stock.edit'), icon: <Pencil />, onSelect: () => setEdit(i) }] : []),
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <MoveDialog state={move} suppliers={suppliers.data ?? []} onClose={() => setMove(null)} />
      <ItemDialog state={edit} categories={categories} suppliers={suppliers.data ?? []} onClose={() => setEdit(null)} />
      <HistoryDialog item={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

function daysLeftText(t: (k: string, v?: Record<string, string | number>) => string, n: number) {
  return n < 1 ? t('stock.lessThanDay') : n === 1 ? t('stock.oneDayLeft') : t('stock.daysLeft', { n });
}

// ───────────────────────── Record a movement ─────────────────────────

function MoveDialog({ state, suppliers, onClose }: { state: { item: StockItem; type: MoveType } | null; suppliers: Supplier[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [type, setType] = useState<MoveType>('PURCHASE');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    if (state) {
      setType(state.type);
      setQty(state.type === 'ADJUSTMENT' ? formatQty(state.item.currentStock).replace(/,/g, '') : '');
      setCost(rupeeInput(state.item.purchasePrice));
      setSupplierId(state.item.supplierId ?? '');
      setNote('');
      setError(null);
    }
  }
  const item = state?.item;
  if (!item) return <Dialog open={false} onClose={onClose} />;

  const n = Number(qty);
  const valid = qty !== '' && Number.isFinite(n) && (type === 'ADJUSTMENT' ? n >= 0 : n > 0);
  const after = !valid ? null : type === 'ADJUSTMENT' ? n : type === 'PURCHASE' ? item.currentStock + n : item.currentStock - n;
  const goesNegative = after != null && after < 0;
  const activeSuppliers = suppliers.filter((s) => s.active || s.id === supplierId);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/inventory/adjust', {
        itemId: item.id,
        type,
        quantity: n,
        unitCost: type === 'PURCHASE' && cost !== '' ? toPaise(cost) : null,
        note: note.trim() || null,
        supplierId: type === 'PURCHASE' || type === 'RETURN' ? supplierId || null : null,
      });
      toast.success(t('stock.recorded', { name: item.name, what: t(`stock.${type}`).toLowerCase() }));
      await Promise.all([qc.invalidateQueries({ queryKey: INVENTORY_KEY }), qc.invalidateQueries({ queryKey: ['stock-movements'] })]);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t(`stock.act${type}`)} — ${item.name}`}
      description={t(`stock.hint${type}`)}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!valid}>
            {t('stock.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('stock.movementType')} htmlFor="mv-type">
          <Select id="mv-type" value={type} onChange={(e) => setType(e.target.value as MoveType)}>
            {MOVE_TYPES.map((m) => (
              <option key={m} value={m}>
                {t(`stock.act${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={type === 'ADJUSTMENT' ? t('stock.countedStock') : t('stock.quantity')} htmlFor="mv-qty">
            <div className="flex items-center gap-2">
              <Input id="mv-qty" size="lg" inputMode="decimal" value={qty} onChange={(e) => isQtyInput(e.target.value) && setQty(e.target.value)} className="num" autoFocus />
              <span className="shrink-0 text-ink-3">{item.unit}</span>
            </div>
          </Field>
          {type === 'PURCHASE' && (
            <Field label={t('stock.unitCost', { unit: item.unit })} htmlFor="mv-cost" hint={t('stock.unitCostHint')}>
              <MoneyInput id="mv-cost" size="lg" value={cost} onValueChange={setCost} />
            </Field>
          )}
        </div>
        {(type === 'PURCHASE' || type === 'RETURN') && (
          <Field label={t('stock.supplier')} htmlFor="mv-sup" optional>
            <Select id="mv-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('stock.noSupplier')}</option>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('stock.note')} htmlFor="mv-note" optional>
          <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t('stock.notePlaceholder')} />
        </Field>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-paper p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-ink-3">{t('stock.currentStock')}</dt>
            <dd className="num font-semibold">{qtyWithUnit(item.currentStock, item.unit)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-3">{t('stock.afterStock')}</dt>
            <dd className={cn('num font-semibold', goesNegative && 'text-danger')}>{after != null ? qtyWithUnit(after, item.unit) : '—'}</dd>
          </div>
          {type === 'ADJUSTMENT' && after != null && (
            <div>
              <dt className="text-[13px] text-ink-3">{t('stock.difference')}</dt>
              <dd className="num font-semibold">
                {after - item.currentStock > 0 ? '+' : after - item.currentStock < 0 ? '−' : ''}
                {qtyWithUnit(Math.abs(after - item.currentStock), item.unit)}
              </dd>
            </div>
          )}
          {type === 'PURCHASE' && valid && cost !== '' && (
            <div>
              <dt className="text-[13px] text-ink-3">{t('stock.purchaseTotal')}</dt>
              <dd className="num font-semibold">{formatMoney(Math.round(n * toPaise(cost)))}</dd>
            </div>
          )}
        </dl>
        {goesNegative && <p className="text-[13px] text-warn">{t('stock.tooMuch', { qty: qtyWithUnit(item.currentStock, item.unit) })}</p>}
        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

// ───────────────────────── Add / edit item ─────────────────────────

interface ItemForm {
  name: string;
  category: string;
  unit: string;
  minStock: string;
  purchasePrice: string;
  supplierId: string;
  active: boolean;
  openingStock: string;
}

function ItemDialog({ state, categories, suppliers, onClose }: { state: StockItem | 'new' | null; categories: string[]; suppliers: Supplier[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<ItemForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    setError(null);
    setForm(
      state === null
        ? null
        : state === 'new'
          ? { name: '', category: '', unit: 'kg', minStock: '', purchasePrice: '', supplierId: '', active: true, openingStock: '' }
          : {
              name: state.name,
              category: state.category,
              unit: state.unit,
              minStock: String(state.minStock),
              purchasePrice: rupeeInput(state.purchasePrice),
              supplierId: state.supplierId ?? '',
              active: state.active,
              openingStock: '',
            },
    );
  }
  if (!state || !form) return <Dialog open={false} onClose={onClose} />;
  const isNew = state === 'new';
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const ok = form.name.trim() && form.category.trim() && form.unit.trim();

  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      category: form.category.trim(),
      unit: form.unit.trim(),
      minStock: Number(form.minStock) || 0,
      purchasePrice: toPaise(form.purchasePrice || '0'),
      supplierId: form.supplierId || null,
      active: form.active,
      ...(isNew && form.openingStock ? { openingStock: Number(form.openingStock) } : {}),
    };
    try {
      if (isNew) await api.post('/inventory', body);
      else await api.patch(`/inventory/${state.id}`, body);
      toast.success(isNew ? t('stock.created', { name: body.name }) : t('stock.saved', { name: body.name }));
      await qc.invalidateQueries({ queryKey: INVENTORY_KEY });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const unitLabel = form.unit.trim() || t('stock.unit');
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t('stock.newItem') : t('stock.editItem', { name: state.name })}
      description={!isNew && state.usedInRecipes > 0 ? t('stock.usedIn', { n: state.usedInRecipes }) : undefined}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!ok}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('stock.name')} htmlFor="si-name">
          <Input id="si-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} placeholder={t('stock.namePlaceholder')} autoFocus={isNew} />
        </Field>
        <Field label={t('stock.category')} htmlFor="si-cat">
          <Input id="si-cat" value={form.category} onChange={(e) => set('category', e.target.value)} maxLength={40} list="si-cats" placeholder={t('stock.categoryPlaceholder')} />
          <datalist id="si-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label={t('stock.unit')} htmlFor="si-unit" hint={t('stock.unitHint')}>
          <Input id="si-unit" value={form.unit} onChange={(e) => set('unit', e.target.value)} maxLength={12} list="si-units" />
          <datalist id="si-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label={t('stock.purchasePrice')} htmlFor="si-price" hint={t('stock.purchasePriceHint', { unit: unitLabel })}>
          <MoneyInput id="si-price" value={form.purchasePrice} onValueChange={(v) => set('purchasePrice', v)} />
        </Field>
        <Field label={`${t('stock.minStock')} (${unitLabel})`} htmlFor="si-min" hint={t('stock.minStockHint')}>
          <Input id="si-min" inputMode="decimal" value={form.minStock} onChange={(e) => isQtyInput(e.target.value) && set('minStock', e.target.value)} className="num" />
        </Field>
        {isNew && (
          <Field label={`${t('stock.openingStock')} (${unitLabel})`} htmlFor="si-open" hint={t('stock.openingStockHint')}>
            <Input id="si-open" inputMode="decimal" value={form.openingStock} onChange={(e) => isQtyInput(e.target.value) && set('openingStock', e.target.value)} className="num" />
          </Field>
        )}
        <Field label={t('stock.supplier')} htmlFor="si-sup" optional>
          <Select id="si-sup" value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
            <option value="">{t('stock.noSupplier')}</option>
            {suppliers
              .filter((s) => s.active || s.id === form.supplierId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        {!isNew && (
          <div className="sm:col-span-2">
            <Switch checked={form.active} onChange={(v) => set('active', v)} label={t('stock.activeLabel')} description={t('stock.activeHint')} />
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ───────────────────────── History ─────────────────────────

function MovementRows({ rows, showItem }: { rows: Movement[]; showItem?: boolean }) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">{t('stock.colWhen')}</th>
            {showItem && <th className="px-2 py-2 font-medium">{t('stock.colItemName')}</th>}
            <th className="px-2 py-2 font-medium">{t('stock.colWhat')}</th>
            <th className="px-2 py-2 text-right font-medium">{t('stock.colChange')}</th>
            <th className="px-2 py-2 text-right font-medium">{t('stock.colBalance')}</th>
            <th className="px-2 py-2 font-medium">{t('stock.colNote')}</th>
            <th className="px-3 py-2 font-medium">{t('stock.colBy')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((m) => {
            const sold = m.type === 'CONSUMPTION' && !!m.reference;
            const note = [m.supplier, m.reference, sold && m.note === 'Sold' ? null : m.note].filter(Boolean).join(' · ');
            return (
              <tr key={m.id}>
                <td className="num px-3 py-2 whitespace-nowrap text-ink-2">
                  {formatDateLong(m.at)}, {formatTime(m.at)}
                </td>
                {showItem && <td className="px-2 py-2 font-medium">{m.item}</td>}
                <td className="px-2 py-2">{sold ? t('stock.soldAuto') : t(`stock.${m.type}`)}</td>
                <td className={cn('num px-2 py-2 text-right font-medium', m.quantity < 0 ? 'text-ink' : 'text-ok')}>
                  {m.type === 'OPENING' ? '' : m.quantity > 0 ? '+' : m.quantity < 0 ? '−' : ''}
                  {qtyWithUnit(Math.abs(m.quantity), m.unit)}
                  {m.unitCost != null && m.type === 'PURCHASE' && <span className="block text-[12px] font-normal text-ink-3">@ {formatMoney(m.unitCost)}</span>}
                </td>
                <td className="num px-2 py-2 text-right text-ink-2">{qtyWithUnit(m.balanceAfter, m.unit)}</td>
                <td className="max-w-64 px-2 py-2 text-ink-2">
                  <span className="line-clamp-2">{note || '—'}</span>
                </td>
                <td className="px-3 py-2 text-ink-3">{m.by ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryDialog({ item, onClose }: { item: StockItem | null; onClose: () => void }) {
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['stock-movements', item?.id ?? ''],
    queryFn: () => api.get<Movement[]>(`/inventory/movements${qs({ itemId: item!.id })}`),
    enabled: !!item,
  });
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      size="xl"
      title={item ? t('stock.historyTitle', { name: item.name }) : undefined}
      description={item ? t('stock.historySubtitle', { qty: qtyWithUnit(item.currentStock, item.unit) }) : undefined}
      bodyClassName="p-0"
    >
      {isLoading ? <SkeletonRows className="p-4" rows={6} /> : !data?.length ? <EmptyState icon={<History />} title={t('stock.noHistory')} /> : <MovementRows rows={data} />}
    </Dialog>
  );
}

function MovementsView() {
  const t = useT();
  const [type, setType] = useState<MovementType | ''>('');
  const { data, isLoading } = useQuery({
    queryKey: ['stock-movements', 'all', type],
    queryFn: () => api.get<Movement[]>(`/inventory/movements${qs({ type })}`),
  });
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="w-56"><Select value={type} onChange={(e) => setType(e.target.value as MovementType | '')} aria-label={t('stock.typeFilter')}>
          <option value="">{t('stock.allTypes')}</option>
          {(['PURCHASE', 'CONSUMPTION', 'WASTE', 'RETURN', 'ADJUSTMENT', 'OPENING'] as MovementType[]).map((m) => (
            <option key={m} value={m}>
              {t(`stock.${m}`)}
            </option>
          ))}
        </Select></div>
      </div>
      {isLoading ? <SkeletonRows className="p-4" rows={8} /> : !data?.length ? <EmptyState icon={<History />} title={t('stock.noHistory')} /> : <MovementRows rows={data} showItem />}
    </section>
  );
}
