import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, EyeOff, MoreHorizontal, Pencil, Plus, Search, Trash2, UtensilsCrossed, X, Eye } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input } from '../../components/ui/Field';
import { EmptyState, Money, PageHeader, Skeleton, SkeletonRows, VegMark } from '../../components/ui/Misc';
import { Segmented } from '../../components/ui/Segmented';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { confirm } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { ItemEditor } from './ItemEditor';
import { RowSwitch } from './RowSwitch';
import { MENU_KEY, type AdminCategory, type AdminMenu, type AdminMenuItem } from './types';

type Filter = 'menu' | 'available' | 'soldout' | 'removed';

const matchesFilter = (i: AdminMenuItem, f: Filter) =>
  f === 'removed' ? !i.active : f === 'available' ? i.active && i.available : f === 'soldout' ? i.active && !i.available : i.active;

export default function MenuPage() {
  const t = useT();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useQuery({ queryKey: MENU_KEY, queryFn: () => api.get<AdminMenu>('/menu/admin') });
  useLive(['menu', 'inventory'], [MENU_KEY]);

  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('menu');
  const [catDialog, setCatDialog] = useState<{ mode: 'add' } | { mode: 'rename'; cat: AdminCategory } | null>(null);

  const editing = params.get('item');
  const openItem = (id: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('item', id);
        return n;
      },
      { replace: false },
    );
  const closeItem = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('item');
      return n;
    });

  const categories = data?.categories ?? [];
  const items = data?.items ?? [];
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const taxName = useMemo(() => new Map((data?.taxRates ?? []).map((r) => [r.id, r])), [data]);

  const term = q.trim().toLowerCase();
  const visible = useMemo(() => {
    return items.filter((i) => {
      if (!matchesFilter(i, filter)) return false;
      if (term) return i.name.toLowerCase().includes(term) || (i.code ?? '').toLowerCase().includes(term);
      return cat === 'all' || i.categoryId === cat;
    });
  }, [items, filter, term, cat]);

  const counts = useMemo(() => {
    const base = items.filter((i) => (term ? i.name.toLowerCase().includes(term) || (i.code ?? '').toLowerCase().includes(term) : cat === 'all' || i.categoryId === cat));
    return {
      menu: base.filter((i) => matchesFilter(i, 'menu')).length,
      available: base.filter((i) => matchesFilter(i, 'available')).length,
      soldout: base.filter((i) => matchesFilter(i, 'soldout')).length,
      removed: base.filter((i) => matchesFilter(i, 'removed')).length,
    };
  }, [items, term, cat]);

  const perCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.active) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
    return m;
  }, [items]);

  const patchCache = (id: string, patch: Partial<AdminMenuItem>) =>
    qc.setQueryData<AdminMenu>(MENU_KEY, (d) => (d ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : d));

  const toggle = async (item: AdminMenuItem, key: 'available' | 'active', value: boolean) => {
    patchCache(item.id, { [key]: value });
    try {
      await api.patch(`/menu/${item.id}`, { [key]: value });
      const msg =
        key === 'available'
          ? value
            ? t('menuAdmin.nowAvailable', { name: item.name })
            : t('menuAdmin.nowSoldOut', { name: item.name })
          : value
            ? t('menuAdmin.nowOnMenu', { name: item.name })
            : t('menuAdmin.nowRemoved', { name: item.name });
      toast.success(msg);
    } catch (err) {
      patchCache(item.id, { [key]: !value });
      toast.error(errorMessage(err));
    } finally {
      void qc.invalidateQueries({ queryKey: MENU_KEY });
    }
  };

  const deleteItem = async (item: AdminMenuItem) => {
    const ok = await confirm({ title: t('menuAdmin.deleteTitle', { name: item.name }), message: t('menuAdmin.deleteMessage'), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return false;
    try {
      const r = await api.del<{ deleted: boolean; deactivated: boolean }>(`/menu/${item.id}`);
      if (r?.deactivated) toast.info(t('menuAdmin.deactivated', { name: item.name }));
      else toast.success(t('menuAdmin.deleted', { name: item.name }));
      await qc.invalidateQueries({ queryKey: MENU_KEY });
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  };

  // ── Categories ──
  const moveCategory = async (index: number, dir: -1 | 1) => {
    const next = [...categories];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    qc.setQueryData<AdminMenu>(MENU_KEY, (d) => (d ? { ...d, categories: next.map((c, i) => ({ ...c, sortOrder: i })) } : d));
    try {
      await api.put('/categories/order', next.map((c) => c.id));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      void qc.invalidateQueries({ queryKey: MENU_KEY });
    }
  };

  const setCategoryActive = async (c: AdminCategory, active: boolean) => {
    try {
      await api.patch(`/categories/${c.id}`, { active });
      toast.success(active ? t('menuAdmin.categoryShownToast', { name: c.name }) : t('menuAdmin.categoryHiddenToast', { name: c.name }));
      await qc.invalidateQueries({ queryKey: MENU_KEY });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const deleteCategory = async (c: AdminCategory) => {
    const ok = await confirm({ title: t('menuAdmin.deleteCategoryTitle', { name: c.name }), message: t('menuAdmin.deleteCategoryMessage'), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      const r = await api.del<{ deleted: boolean; hidden?: boolean; message?: string }>(`/categories/${c.id}`);
      if (r?.deleted) {
        toast.success(t('menuAdmin.categoryDeleted'));
        if (cat === c.id) setCat('all');
      } else toast.info(r?.message ?? t('menuAdmin.categoryHiddenToast', { name: c.name }));
      await qc.invalidateQueries({ queryKey: MENU_KEY });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const selectedCat = categories.find((c) => c.id === cat);
  const activeCount = items.filter((i) => i.active).length;

  return (
    <div>
      <PageHeader
        title={t('menuAdmin.title')}
        subtitle={data ? t('menuAdmin.subtitle', { items: activeCount, cats: categories.filter((c) => c.active).length }) : undefined}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openItem('new')} disabled={!data}>
            {t('menuAdmin.addItem')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Category list */}
        <section className="rounded-lg border border-line bg-surface shadow-card lg:self-start" aria-label={t('menuAdmin.categories')}>
          <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            <h2 className="text-[15px] font-semibold">{t('menuAdmin.categories')}</h2>
            <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setCatDialog({ mode: 'add' })}>
              {t('common.add')}
            </Button>
          </header>
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : (
            <ul className="scroll-thin max-h-[40vh] overflow-y-auto p-1.5 lg:max-h-[calc(100dvh-230px)]">
              <li>
                <button
                  type="button"
                  onClick={() => setCat('all')}
                  aria-current={cat === 'all' || undefined}
                  className={cn('flex h-10 w-full items-center justify-between rounded-md px-2.5 text-left text-sm', cat === 'all' ? 'bg-brand-50 font-semibold text-brand' : 'text-ink-2 hover:bg-paper')}
                >
                  {t('menuAdmin.allItems')}
                  <span className="num text-xs text-ink-3">{activeCount}</span>
                </button>
              </li>
              {categories.map((c, i) => (
                <li key={c.id} className="group flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setCat(c.id)}
                    aria-current={cat === c.id || undefined}
                    className={cn(
                      'flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm',
                      cat === c.id ? 'bg-brand-50 font-semibold text-brand' : 'text-ink-2 hover:bg-paper',
                    )}
                  >
                    <span className={cn('min-w-0 truncate', !c.active && 'text-ink-4')}>{c.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {!c.active && (
                        <Badge size="sm" icon={<EyeOff className="h-3 w-3" />}>
                          {t('menuAdmin.categoryHidden')}
                        </Badge>
                      )}
                      <span className="num text-xs text-ink-3">{perCat.get(c.id) ?? 0}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label={t('menuAdmin.moveUp', { name: c.name })}
                      title={t('menuAdmin.moveUp', { name: c.name })}
                      disabled={i === 0}
                      onClick={() => moveCategory(i, -1)}
                      className="flex h-5 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-30"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('menuAdmin.moveDown', { name: c.name })}
                      title={t('menuAdmin.moveDown', { name: c.name })}
                      disabled={i === categories.length - 1}
                      onClick={() => moveCategory(i, 1)}
                      className="flex h-5 w-7 items-center justify-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-30"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                  <DropdownMenu
                    label={t('menuAdmin.categoryActions', { name: c.name })}
                    trigger={({ toggle }) => (
                      <IconButton label={t('menuAdmin.categoryActions', { name: c.name })} size="sm" onClick={toggle}>
                        <MoreHorizontal className="h-4 w-4" />
                      </IconButton>
                    )}
                    items={[
                      { label: t('menuAdmin.renameCategory'), icon: <Pencil />, onSelect: () => setCatDialog({ mode: 'rename', cat: c }) },
                      { label: t('menuAdmin.moveUpShort'), icon: <ChevronUp />, disabled: i === 0, onSelect: () => void moveCategory(i, -1) },
                      { label: t('menuAdmin.moveDownShort'), icon: <ChevronDown />, disabled: i === categories.length - 1, onSelect: () => void moveCategory(i, 1) },
                      c.active
                        ? { label: t('menuAdmin.hideCategory'), icon: <EyeOff />, onSelect: () => setCategoryActive(c, false) }
                        : { label: t('menuAdmin.showCategory'), icon: <Eye />, onSelect: () => setCategoryActive(c, true) },
                      'divider',
                      { label: t('menuAdmin.deleteCategory'), icon: <Trash2 />, danger: true, onSelect: () => deleteCategory(c) },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Items */}
        <section className="min-w-0 rounded-lg border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="relative min-w-52 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('menuAdmin.searchPlaceholder')} aria-label={t('menuAdmin.searchPlaceholder')} className="pl-9" />
              {q && (
                <button type="button" onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="no-scrollbar max-w-full overflow-x-auto">
            <Segmented<Filter>
              label={t('menuAdmin.filterLabel')}
              value={filter}
              onChange={setFilter}
              size="sm"
              options={[
                { value: 'menu', label: `${t('menuAdmin.filterAll')} ${counts.menu}` },
                { value: 'available', label: `${t('menuAdmin.filterAvailable')} ${counts.available}` },
                { value: 'soldout', label: `${t('menuAdmin.filterSoldOut')} ${counts.soldout}` },
                { value: 'removed', label: `${t('menuAdmin.filterRemoved')} ${counts.removed}` },
              ]}
            />
            </div>
          </div>
          {term &&<p className="border-b border-line bg-paper px-4 py-1.5 text-[13px] text-ink-3">{t('menuAdmin.searchingAll')}</p>}
          {!term && selectedCat && !selectedCat.active && (
            <p className="flex items-center gap-2 border-b border-line bg-paper px-4 py-1.5 text-[13px] text-ink-3">
              <EyeOff className="h-4 w-4" aria-hidden />
              {t('menuAdmin.hiddenCategoryNote')}
            </p>
          )}

          {isLoading ? (
            <SkeletonRows className="p-4" rows={8} />
          ) : visible.length === 0 ? (
            items.length === 0 ? (
              <EmptyState
                icon={<UtensilsCrossed />}
                title={t('menuAdmin.noItems')}
                action={
                  <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openItem('new')}>
                    {t('menuAdmin.addItem')}
                  </Button>
                }
              >
                {t('menuAdmin.noItemsHint')}
              </EmptyState>
            ) : (
              <EmptyState icon={<Search />} title={t('menuAdmin.noMatch')}>
                {t('menuAdmin.noMatchHint')}
              </EmptyState>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                  <tr>
                    <th className="px-4 py-2 font-medium">{t('menuAdmin.colItem')}</th>
                    <th className="px-2 py-2 font-medium">{t('menuAdmin.colCode')}</th>
                    <th className="px-2 py-2 text-right font-medium">{t('menuAdmin.colPrice')}</th>
                    <th className="px-2 py-2 font-medium">{t('menuAdmin.colTax')}</th>
                    <th className="px-2 py-2 font-medium">{t('menuAdmin.colKitchen')}</th>
                    <th className="px-2 py-2 font-medium">{t('menuAdmin.colAvailable')}</th>
                    <th className="px-2 py-2 font-medium">{t('menuAdmin.colOnMenu')}</th>
                    <th className="px-2 py-2 text-right font-medium">{t('menuAdmin.colCost')}</th>
                    <th className="px-2 py-2 text-right font-medium">{t('menuAdmin.colMargin')}</th>
                    <th className="w-12 px-2 py-2">
                      <span className="sr-only">{t('common.edit')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visible.map((i) => {
                    const tax = i.taxRateId ? taxName.get(i.taxRateId) : undefined;
                    const margin = i.unitCost != null ? i.price - i.unitCost : null;
                    const pct = margin != null && i.price > 0 ? Math.round((margin / i.price) * 100) : null;
                    return (
                      <tr key={i.id} onClick={() => openItem(i.id)} className={cn('cursor-pointer hover:bg-paper', !i.active && 'text-ink-3')}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <VegMark veg={i.isVeg} />
                            <button type="button" className="text-left font-medium hover:underline" onClick={(e) => {
                                e.stopPropagation();
                                openItem(i.id);
                              }}>
                              {i.name}
                            </button>
                            {i.modifierGroups.length > 0 && (
                              <Badge size="sm" tone="neutral">
                                {t('menuAdmin.options')}
                              </Badge>
                            )}
                          </div>
                          {(cat === 'all' || term) && <p className="ml-5 text-[12px] text-ink-3">{catName.get(i.categoryId)}</p>}
                        </td>
                        <td className="px-2 py-2 font-mono text-[13px] text-ink-2">{i.code ?? '—'}</td>
                        <td className="num px-2 py-2 text-right font-semibold">
                          <Money value={i.price} />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-ink-2">{tax ?`${tax.rate}%` : t('menuAdmin.noGst')}</td>
                        <td className="px-2 py-2 text-ink-2">{i.sendToKitchen ? t('menuAdmin.kitchenYes') : t('menuAdmin.kitchenNo')}</td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <RowSwitch
                            checked={i.available}
                            disabled={!i.active}
                            onChange={(v) => toggle(i, 'available', v)}
                            onText={t('menuAdmin.available')}
                            offText={t('menuAdmin.soldOut')}
                            label={i.available ? t('menuAdmin.markSoldOut', { name: i.name }) : t('menuAdmin.markAvailable', { name: i.name })}
                          />
                        </td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <RowSwitch
                            checked={i.active}
                            onChange={(v) => toggle(i, 'active', v)}
                            onText={t('menuAdmin.onMenu')}
                            offText={t('menuAdmin.removed')}
                            label={i.active ? t('menuAdmin.takeOff', { name: i.name }) : t('menuAdmin.putBack', { name: i.name })}
                          />
                        </td>
                        <td className="num px-2 py-2 text-right text-ink-2">{i.unitCost != null ? <Money value={i.unitCost} /> : '—'}</td>
                        <td className={cn('num px-2 py-2 text-right', margin != null && margin < 0 && 'text-danger')}>
                          {margin != null ? (
                            <>
                              <Money value={margin} />
                              {pct != null && <span className="block text-[12px] text-ink-3">{pct}%</span>}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu
                            label={t('menuAdmin.rowActions', { name: i.name })}
                            trigger={({ toggle: open }) => (
                              <IconButton label={t('menuAdmin.rowActions', { name: i.name })} size="sm" onClick={open}>
                                <MoreHorizontal className="h-4 w-4" />
                              </IconButton>
                            )}
                            items={[
                              { label: t('menuAdmin.edit'), icon: <Pencil />, onSelect: () => openItem(i.id) },
                              'divider',
                              { label: t('menuAdmin.delete'), icon: <Trash2 />, danger: true, onSelect: () => void deleteItem(i) },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {data && editing && (
        <ItemEditor
          key={editing}
          itemId={editing}
          menu={data}
          defaultCategoryId={cat !== 'all' ? cat : undefined}
          onClose={closeItem}
          onCreated={(id) => openItem(id)}
          onDelete={async (item) => {
            if (await deleteItem(item)) closeItem();
          }}
        />
      )}

      <CategoryDialog state={catDialog} onClose={() => setCatDialog(null)} />
    </div>
  );
}

function CategoryDialog({ state, onClose }: { state: { mode: 'add' } | { mode: 'rename'; cat: AdminCategory } | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setName(state?.mode === 'rename' ? state.cat.name : '');
    setError(null);
  }

  const save = async () => {
    if (!state || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (state.mode === 'add') await api.post('/categories', { name: name.trim() });
      else await api.patch(`/categories/${state.cat.id}`, { name: name.trim() });
      toast.success(state.mode === 'add' ? t('menuAdmin.categoryAdded') : t('menuAdmin.categorySaved'));
      await qc.invalidateQueries({ queryKey: MENU_KEY });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!state}
      onClose={onClose}
      size="sm"
      title={state?.mode === 'rename' ? t('menuAdmin.renameCategory') : t('menuAdmin.newCategory')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t('menuAdmin.categoryName')} htmlFor="cat-name" hint={t('menuAdmin.categoryNameHint')} error={error}>
          <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
