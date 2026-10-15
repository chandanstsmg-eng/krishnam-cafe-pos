import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, History, Info, Plus, Trash2, X } from 'lucide-react';
import { api, errorMessage, qs } from '../../api/client';
import { Button, IconButton } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Checkbox, Field, Input, MoneyInput, Select, Switch, Textarea } from '../../components/ui/Field';
import { EmptyState, Money, SkeletonRows } from '../../components/ui/Misc';
import { Tabs } from '../../components/ui/Segmented';
import { confirm } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import { formatDateLong, formatTime } from '../../../shared/dates';
import { INVENTORY_KEY, isQtyInput, type StockItem } from '../inventory/types';
import { MENU_KEY, PRICE_HISTORY_KEY, type AdminMenu, type AdminMenuItem, type PriceChangeRow } from './types';

type Tab = 'details' | 'options' | 'recipe' | 'history';

export function ItemEditor({
  itemId,
  menu,
  defaultCategoryId,
  onClose,
  onCreated,
  onDelete,
}: {
  itemId: string;
  menu: AdminMenu;
  defaultCategoryId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  onDelete: (item: AdminMenuItem) => void;
}) {
  const t = useT();
  const isNew = itemId === 'new';
  const item = isNew ? null : (menu.items.find((i) => i.id === itemId) ?? null);
  const [tab, setTab] = useState<Tab>('details');
  const dirty = useRef(false);
  const setDirty = useCallback((v: boolean) => {
    dirty.current = v;
  }, []);

  const guard = async () =>
    !dirty.current || (await confirm({ title: t('menuAdmin.unsavedTitle'), message: t('menuAdmin.unsavedMessage'), confirmLabel: t('menuAdmin.discard'), cancelLabel: t('menuAdmin.keepEditing'), danger: true }));

  const close = async () => {
    if (await guard()) onClose();
  };
  const switchTab = async (next: Tab) => {
    if (next === tab) return;
    if (await guard()) {
      dirty.current = false;
      setTab(next);
    }
  };

  const title = isNew ? t('menuAdmin.newTitle') : item ? t('menuAdmin.editTitle', { name: item.name }) : t('menuAdmin.title');

  return (
    <Dialog open onClose={() => void close()} title={title} size="xl" bodyClassName="p-0">
      {!isNew && !item ? (
        <EmptyState title={t('menuAdmin.itemNotFound')} className="py-16" />
      ) : (
        <>
          <div className="sticky top-0 z-10 bg-surface px-5">
            <Tabs<Tab>
              value={tab}
              onChange={(v) => void switchTab(v)}
              tabs={
                isNew
                  ? [{ value: 'details', label: t('menuAdmin.tabDetails') }]
                  : [
                      { value: 'details', label: t('menuAdmin.tabDetails') },
                      { value: 'options', label: t('menuAdmin.tabOptions'), count: item!.modifierGroups.length },
                      { value: 'recipe', label: t('menuAdmin.tabRecipe'), count: item!.recipe.length },
                      { value: 'history', label: t('menuAdmin.tabHistory') },
                    ]
              }
            />
          </div>
          {isNew && <p className="flex items-center gap-2 px-5 pt-3 text-[13px] text-ink-3">{t('menuAdmin.saveFirst')}</p>}
          {tab === 'details' && <DetailsTab item={item} menu={menu} defaultCategoryId={defaultCategoryId} onDirty={setDirty} onCreated={onCreated} onDelete={onDelete} onCancel={() => void close()} />}
          {tab === 'options' && item && <OptionsTab item={item} onDirty={setDirty} />}
          {tab === 'recipe' && item && <RecipeTab item={item} onDirty={setDirty} />}
          {tab === 'history' && item && <HistoryTab item={item} />}
        </>
      )}
    </Dialog>
  );
}

function TabFooter({ children, left }: { children: ReactNode; left?: ReactNode }) {
  return (
    <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-paper px-5 py-3">
      <div className="mr-auto">{left}</div>
      {children}
    </div>
  );
}

function useReportDirty(dirty: boolean, onDirty: (v: boolean) => void) {
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
}

// ───────────────────────── Details ─────────────────────────

interface DetailsForm {
  name: string;
  code: string;
  categoryId: string;
  price: string;
  taxRateId: string;
  isVeg: boolean;
  sendToKitchen: boolean;
  available: boolean;
  active: boolean;
  description: string;
}

function mostUsedTax(menu: AdminMenu) {
  const counts = new Map<string, number>();
  for (const i of menu.items) if (i.taxRateId) counts.set(i.taxRateId, (counts.get(i.taxRateId) ?? 0) + 1);
  let best = '';
  let n = 0;
  for (const [id, c] of counts) if (c > n && menu.taxRates.find((r) => r.id === id)?.active) [best, n] = [id, c];
  return best;
}

function toForm(item: AdminMenuItem | null, menu: AdminMenu, defaultCategoryId?: string): DetailsForm {
  if (!item)
    return {
      name: '',
      code: '',
      categoryId: defaultCategoryId ?? '',
      price: '',
      taxRateId: mostUsedTax(menu),
      isVeg: true,
      sendToKitchen: true,
      available: true,
      active: true,
      description: '',
    };
  return {
    name: item.name,
    code: item.code ?? '',
    categoryId: item.categoryId,
    price: rupeeInput(item.price),
    taxRateId: item.taxRateId ?? '',
    isVeg: item.isVeg,
    sendToKitchen: item.sendToKitchen,
    available: item.available,
    active: item.active,
    description: item.description ?? '',
  };
}

function DetailsTab({
  item,
  menu,
  defaultCategoryId,
  onDirty,
  onCreated,
  onDelete,
  onCancel,
}: {
  item: AdminMenuItem | null;
  menu: AdminMenu;
  defaultCategoryId?: string;
  onDirty: (v: boolean) => void;
  onCreated: (id: string) => void;
  onDelete: (item: AdminMenuItem) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const initial = useMemo(() => toForm(item, menu, defaultCategoryId), [item, menu, defaultCategoryId]);
  const [form, setForm] = useState<DetailsForm>(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof DetailsForm | 'form', string>>>({});
  const set = <K extends keyof DetailsForm>(k: K, v: DetailsForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useReportDirty(dirty, onDirty);

  const taxOptions = menu.taxRates.filter((r) => r.active || r.id === form.taxRateId);

  const save = async () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = t('menuAdmin.nameRequired');
    if (!form.categoryId) e.categoryId = t('menuAdmin.categoryRequired');
    if (form.price === '') e.price = t('menuAdmin.priceRequired');
    setErrors(e);
    if (Object.keys(e).length) return;

    const body = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      categoryId: form.categoryId,
      price: toPaise(form.price),
      taxRateId: form.taxRateId || null,
      isVeg: form.isVeg,
      sendToKitchen: form.sendToKitchen,
      available: form.available,
      active: form.active,
      description: form.description.trim() || null,
    };
    setBusy(true);
    try {
      if (!item) {
        const created = await api.post<{ id: string; name: string }>('/menu', body);
        toast.success(t('menuAdmin.created', { name: created.name }));
        await qc.invalidateQueries({ queryKey: MENU_KEY });
        onDirty(false);
        onCreated(created.id);
      } else {
        const before: Record<string, unknown> = {
          name: item.name,
          code: item.code,
          categoryId: item.categoryId,
          price: item.price,
          taxRateId: item.taxRateId,
          isVeg: item.isVeg,
          sendToKitchen: item.sendToKitchen,
          available: item.available,
          active: item.active,
          description: item.description,
        };
        const diff = Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== before[k]));
        if (!Object.keys(diff).length) {
          toast.info(t('menuAdmin.noChanges'));
        } else {
          await api.patch(`/menu/${item.id}`, diff);
          toast.success(t('menuAdmin.saved', { name: body.name }));
          if ('price' in diff) void qc.invalidateQueries({ queryKey: PRICE_HISTORY_KEY });
          await qc.invalidateQueries({ queryKey: MENU_KEY });
        }
      }
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
        <Field label={t('menuAdmin.name')} htmlFor="mi-name" error={errors.name}>
          <Input id="mi-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder={t('menuAdmin.namePlaceholder')} invalid={!!errors.name} autoFocus={!item} />
        </Field>
        <Field label={t('menuAdmin.code')} htmlFor="mi-code" hint={t('menuAdmin.codeHint')} optional>
          <Input id="mi-code" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} maxLength={12} className="font-mono uppercase" />
        </Field>
        <Field label={t('menuAdmin.category')} htmlFor="mi-cat" error={errors.categoryId}>
          <Select id="mi-cat" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)} aria-invalid={!!errors.categoryId || undefined}>
            <option value="">{t('menuAdmin.chooseCategory')}</option>
            {menu.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? '' : ` (${t('menuAdmin.categoryHidden')})`}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('menuAdmin.price')} htmlFor="mi-price" error={errors.price}>
            <MoneyInput id="mi-price" value={form.price} onValueChange={(v) => set('price', v)} invalid={!!errors.price} />
          </Field>
          <Field label={t('menuAdmin.tax')} htmlFor="mi-tax">
            <Select id="mi-tax" value={form.taxRateId} onChange={(e) => set('taxRateId', e.target.value)}>
              <option value="">{t('menuAdmin.noGst')}</option>
              {taxOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name.includes('%') ? r.name : `${r.name} (${r.rate}%)`}
                </option>
              ))}
            </Select>
          </Field>
          <p className="col-span-2 -mt-1 flex items-start gap-1.5 text-[13px] text-ink-3">
            <History className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {t('menuAdmin.priceHint')}
              {item?.lastPriceChange && (
                <>
                  {' '}
                  <span className="num">
                    {formatMoney(item.lastPriceChange.oldPrice)} → {formatMoney(item.lastPriceChange.newPrice)}, {formatDateLong(item.lastPriceChange.at)}
                    {item.lastPriceChange.by ? ` · ${item.lastPriceChange.by}` : ''}
                  </span>
                </>
              )}
            </span>
          </p>
        </div>
        <Field label={t('menuAdmin.description')} htmlFor="mi-desc" hint={t('menuAdmin.descriptionHint')} optional className="md:col-span-2">
          <Textarea id="mi-desc" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={240} className="min-h-16" />
        </Field>
        <div className="divide-y divide-line rounded-md border border-line px-3 md:col-span-2 md:grid md:grid-cols-2 md:divide-y-0 md:gap-x-6">
          <div className="py-2">
            <Switch checked={form.isVeg} onChange={(v) => set('isVeg', v)} label={t('menuAdmin.veg')} description={t('menuAdmin.vegHint')} />
          </div>
          <div className="py-2">
            <Switch checked={form.sendToKitchen} onChange={(v) => set('sendToKitchen', v)} label={t('menuAdmin.sendsToKitchen')} description={t('menuAdmin.sendsToKitchenHint')} />
          </div>
          <div className="py-2">
            <Switch checked={form.available} onChange={(v) => set('available', v)} label={t('menuAdmin.available')} description={t('menuAdmin.availableHint')} />
          </div>
          <div className="py-2">
            <Switch checked={form.active} onChange={(v) => set('active', v)} label={t('menuAdmin.onMenu')} description={t('menuAdmin.onMenuHint')} />
          </div>
        </div>
        {errors.form && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger md:col-span-2">
            {errors.form}
          </p>
        )}
      </div>
      <TabFooter
        left={
          item && (
            <Button variant="danger-outline" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(item)}>
              {t('menuAdmin.delete')}
            </Button>
          )
        }
      >
        <Button onClick={onCancel}>{t('common.close')}</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!!item && !dirty}>
          {t('menuAdmin.saveItem')}
        </Button>
      </TabFooter>
    </form>
  );
}

// ───────────────────────── Options ─────────────────────────

interface OptDraft {
  key: string;
  name: string;
  sign: 1 | -1;
  amount: string;
  isDefault: boolean;
}
interface GroupDraft {
  key: string;
  name: string;
  required: boolean;
  multiple: boolean;
  options: OptDraft[];
}

let keySeq = 0;
const nk = () => `k${++keySeq}`;

const toOpt = (name: string, delta: number, isDefault: boolean): OptDraft => ({ key: nk(), name, sign: delta < 0 ? -1 : 1, amount: delta ? rupeeInput(Math.abs(delta)) : '', isDefault });

function groupsFrom(item: AdminMenuItem): GroupDraft[] {
  return item.modifierGroups.map((g) => ({ key: nk(), name: g.name, required: g.required, multiple: g.multiple, options: g.options.map((o) => toOpt(o.name, o.priceDelta, o.isDefault)) }));
}

const serialize = (groups: GroupDraft[]) =>
  groups.map((g) => ({
    name: g.name.trim(),
    required: g.required,
    multiple: g.multiple,
    options: g.options.map((o) => ({ name: o.name.trim(), priceDelta: o.sign * toPaise(o.amount || '0'), isDefault: o.isDefault })),
  }));

function OptionsTab({ item, onDirty }: { item: AdminMenuItem; onDirty: (v: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [groups, setGroups] = useState<GroupDraft[]>(() => groupsFrom(item));
  const [saved, setSaved] = useState(() => JSON.stringify(serialize(groupsFrom(item))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = JSON.stringify(serialize(groups));
  const dirty = current !== saved;
  useReportDirty(dirty, onDirty);

  const updGroup = (key: string, patch: Partial<GroupDraft>) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const updOpt = (gk: string, ok: string, patch: Partial<OptDraft>) =>
    setGroups((gs) =>
      gs.map((g) => {
        if (g.key !== gk) return g;
        let options = g.options.map((o) => (o.key === ok ? { ...o, ...patch } : o));
        // single-choice groups have at most one default
        if (patch.isDefault && !g.multiple) options = options.map((o) => (o.key === ok ? o : { ...o, isDefault: false }));
        return { ...g, options };
      }),
    );
  const moveGroup = (i: number, dir: -1 | 1) =>
    setGroups((gs) => {
      const n = [...gs];
      const j = i + dir;
      if (j < 0 || j >= n.length) return gs;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const addExample = (kind: 'dosa' | 'rice') =>
    setGroups((gs) => [
      ...gs,
      kind === 'dosa'
        ? { key: nk(), name: t('menuAdmin.exStyle'), required: true, multiple: false, options: [toOpt(t('menuAdmin.exNormal'), 0, true), toOpt(t('menuAdmin.exButter'), 1000, false), toOpt(t('menuAdmin.exGhee'), 2000, false)] }
        : { key: nk(), name: t('menuAdmin.exPortion'), required: true, multiple: false, options: [toOpt(t('menuAdmin.exFull'), 0, true), toOpt(t('menuAdmin.exHalf'), -3500, false)] },
    ]);

  const save = async () => {
    const body = serialize(groups);
    if (body.some((g) => !g.name)) return setError(t('menuAdmin.groupNeedsName'));
    if (body.some((g) => !g.options.length || g.options.some((o) => !o.name))) return setError(t('menuAdmin.groupNeedsOptions'));
    setError(null);
    setBusy(true);
    try {
      await api.put(`/menu/${item.id}/modifiers`, body);
      setSaved(JSON.stringify(body));
      toast.success(t('menuAdmin.optionsSaved'));
      await qc.invalidateQueries({ queryKey: MENU_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm text-ink-3">{t('menuAdmin.optionsIntro')}</p>
        {groups.length === 0 && (
          <div className="rounded-md border border-dashed border-line-2 px-4 py-6 text-center">
            <p className="text-sm text-ink-3">{t('menuAdmin.noGroups')}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => addExample('dosa')}>
                {t('menuAdmin.exampleDosa')}
              </Button>
              <Button size="sm" onClick={() => addExample('rice')}>
                {t('menuAdmin.exampleRice')}
              </Button>
            </div>
          </div>
        )}
        {groups.map((g, gi) => (
          <fieldset key={g.key} className="rounded-lg border border-line">
            <legend className="sr-only">{g.name || t('menuAdmin.groupName')}</legend>
            <div className="flex flex-wrap items-end gap-3 border-b border-line bg-paper/60 px-3 py-3">
              <Field label={t('menuAdmin.groupName')} htmlFor={`g-${g.key}`} className="min-w-48 flex-1">
                <Input id={`g-${g.key}`} value={g.name} onChange={(e) => updGroup(g.key, { name: e.target.value })} maxLength={40} placeholder={t('menuAdmin.groupNamePlaceholder')} />
              </Field>
              <div className="flex flex-wrap items-center gap-4 pb-2.5">
                <Checkbox checked={g.required} onChange={(v) => updGroup(g.key, { required: v })} label={t('menuAdmin.required')} />
                <Checkbox
                  checked={g.multiple}
                  onChange={(v) =>
                    updGroup(g.key, {
                      multiple: v,
                      // switching to single choice: keep only the first default
                      options: v ? g.options : g.options.map((o, i) => ({ ...o, isDefault: o.isDefault && g.options.findIndex((x) => x.isDefault) === i })),
                    })
                  }
                  label={t('menuAdmin.multiple')}
                />
              </div>
              <div className="flex items-center pb-0.5">
                <IconButton label={t('menuAdmin.moveGroupUp')} size="sm" disabled={gi === 0} onClick={() => moveGroup(gi, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </IconButton>
                <IconButton label={t('menuAdmin.moveGroupDown')} size="sm" disabled={gi === groups.length - 1} onClick={() => moveGroup(gi, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </IconButton>
                <IconButton label={t('menuAdmin.removeGroup')} size="sm" tone="danger" onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
            <div className="space-y-2 px-3 py-3">
              <div className="hidden grid-cols-[minmax(0,1fr)_170px_90px_40px] gap-2 text-[12px] font-medium text-ink-3 sm:grid">
                <span>{t('menuAdmin.optionName')}</span>
                <span>{t('menuAdmin.priceDelta')}</span>
                <span>{t('menuAdmin.isDefault')}</span>
                <span />
              </div>
              {g.options.map((o) => (
                <div key={o.key} className="grid grid-cols-[minmax(0,1fr)_40px] gap-2 sm:grid-cols-[minmax(0,1fr)_170px_90px_40px] sm:items-center">
                  <Input value={o.name} onChange={(e) => updOpt(g.key, o.key, { name: e.target.value })} maxLength={40} placeholder={t('menuAdmin.optionNamePlaceholder')} aria-label={t('menuAdmin.optionName')} />
                  <IconButton label={t('menuAdmin.removeOption', { name: o.name })} tone="danger" onClick={() => updGroup(g.key, { options: g.options.filter((x) => x.key !== o.key) })} className="sm:order-last">
                    <X className="h-4 w-4" />
                  </IconButton>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => updOpt(g.key, o.key, { sign: o.sign === 1 ? -1 : 1 })}
                      aria-label={o.sign === 1 ? '+' : '−'}
                      title={t('menuAdmin.priceDeltaHint')}
                      className={cn('h-10 w-10 shrink-0 rounded-md border text-base font-semibold', o.sign === 1 ? 'border-line-2 text-ink-2' : 'border-warn/30 bg-warn-50 text-warn')}
                    >
                      {o.sign === 1 ? '+' : '−'}
                    </button>
                    <MoneyInput value={o.amount} onValueChange={(v) => updOpt(g.key, o.key, { amount: v })} placeholder="0" aria-label={`${t('menuAdmin.priceDelta')} ${o.name}`} className="flex-1" />
                  </div>
                  <label className="flex h-10 items-center gap-2 text-sm">
                    <input
                      type={g.multiple ? 'checkbox' : 'radio'}
                      name={`def-${g.key}`}
                      checked={o.isDefault}
                      onChange={(e) => updOpt(g.key, o.key, { isDefault: g.multiple ? e.target.checked : true })}
                      onClick={() => {
                        if (!g.multiple && o.isDefault) updOpt(g.key, o.key, { isDefault: false });
                      }}
                      className="h-4 w-4 accent-brand"
                    />
                    <span className="sm:sr-only">{t('menuAdmin.isDefault')}</span>
                  </label>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} disabled={g.options.length >= 12} onClick={() => updGroup(g.key, { options: [...g.options, toOpt('', 0, false)] })}>
                {t('menuAdmin.addOption')}
              </Button>
            </div>
          </fieldset>
        ))}
        {groups.length > 0 && (
          <Button
            icon={<Plus className="h-4 w-4" />}
            disabled={groups.length >= 6}
            onClick={() => setGroups((gs) => [...gs, { key: nk(), name: '', required: false, multiple: false, options: [toOpt('', 0, false)] }])}
          >
            {t('menuAdmin.addGroup')}
          </Button>
        )}
        {groups.length === 0 && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setGroups([{ key: nk(), name: '', required: false, multiple: false, options: [toOpt('', 0, false)] }])}>
            {t('menuAdmin.addGroup')}
          </Button>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <TabFooter>
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty}>
          {t('menuAdmin.saveOptions')}
        </Button>
      </TabFooter>
    </div>
  );
}

// ───────────────────────── Stock usage ─────────────────────────

interface RecipeDraft {
  key: string;
  inventoryItemId: string;
  qty: string;
}

const recipeFrom = (item: AdminMenuItem): RecipeDraft[] => item.recipe.map((r) => ({ key: nk(), inventoryItemId: r.inventoryItemId, qty: String(r.quantity) }));
const recipeBody = (rows: RecipeDraft[]) => {
  const merged = new Map<string, number>();
  for (const r of rows) {
    const q = Number(r.qty);
    if (r.inventoryItemId && q > 0) merged.set(r.inventoryItemId, (merged.get(r.inventoryItemId) ?? 0) + q);
  }
  return [...merged].map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity: Math.round(quantity * 1000) / 1000 }));
};

function RecipeTab({ item, onDirty }: { item: AdminMenuItem; onDirty: (v: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const inv = useQuery({ queryKey: INVENTORY_KEY, queryFn: () => api.get<StockItem[]>('/inventory') });
  const [rows, setRows] = useState<RecipeDraft[]>(() => recipeFrom(item));
  const [saved, setSaved] = useState(() => JSON.stringify(recipeBody(recipeFrom(item))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(recipeBody(rows)) !== saved;
  useReportDirty(dirty, onDirty);

  const stock = inv.data ?? [];
  const byId = useMemo(() => new Map(stock.map((s) => [s.id, s])), [stock]);
  const grouped = useMemo(() => {
    const m = new Map<string, StockItem[]>();
    for (const s of stock) if (s.active) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m];
  }, [stock]);

  const lineCost = (r: RecipeDraft) => {
    const s = byId.get(r.inventoryItemId);
    const q = Number(r.qty);
    return s && q > 0 ? Math.round(q * s.purchasePrice) : 0;
  };
  const total = rows.reduce((a, r) => a + lineCost(r), 0);
  const margin = item.price - total;

  const upd = (key: string, patch: Partial<RecipeDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = recipeBody(rows);
      await api.put(`/menu/${item.id}/recipe`, body);
      setSaved(JSON.stringify(body));
      toast.success(t('menuAdmin.recipeSaved'));
      await qc.invalidateQueries({ queryKey: MENU_KEY });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="space-y-4 px-5 py-4">
        <p className="text-sm text-ink-3">{t('menuAdmin.recipeIntro')}</p>
        {inv.isLoading ? (
          <SkeletonRows rows={3} />
        ) : inv.isError ? (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger">
            {t('menuAdmin.inventoryFailed')}
          </p>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="flex items-start gap-2 rounded-md border border-dashed border-line-2 px-4 py-4 text-sm text-ink-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {t('menuAdmin.noRecipe')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-[12px] tracking-wide text-ink-3 uppercase">
                    <tr>
                      <th className="py-1.5 pr-2 font-medium">{t('menuAdmin.ingredient')}</th>
                      <th className="px-2 py-1.5 font-medium">{t('menuAdmin.quantity')}</th>
                      <th className="px-2 py-1.5 text-right font-medium">{t('menuAdmin.lineCost')}</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => {
                      const s = byId.get(r.inventoryItemId);
                      const used = new Set(rows.filter((x) => x.key !== r.key).map((x) => x.inventoryItemId));
                      return (
                        <tr key={r.key}>
                          <td className="py-2 pr-2">
                            <Select value={r.inventoryItemId} onChange={(e) => upd(r.key, { inventoryItemId: e.target.value })} aria-label={t('menuAdmin.ingredient')}>
                              <option value="">{t('menuAdmin.chooseIngredient')}</option>
                              {grouped.map(([cat, list]) => (
                                <optgroup key={cat} label={cat}>
                                  {list.map((x) => (
                                    <option key={x.id} value={x.id} disabled={used.has(x.id)}>
                                      {x.name} ({x.unit})
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                              {s && !s.active && <option value={s.id}>{s.name}</option>}
                            </Select>
                            {s && <p className="mt-1 text-[12px] text-ink-3">{t('menuAdmin.perUnit', { price: formatMoney(s.purchasePrice), unit: s.unit })}</p>}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex items-center gap-2">
                              <div className="w-28">
                              <Input
                                value={r.qty}
                                inputMode="decimal"
                                onChange={(e) => isQtyInput(e.target.value) && upd(r.key, { qty: e.target.value })}
                                aria-label={`${t('menuAdmin.quantity')}${s ? ` (${s.unit})` : ''}`}
                                className="num text-right"
                              />
                              </div>
                              <span className="w-12 text-ink-3">{s?.unit ?? ''}</span>
                            </div>
                          </td>
                          <td className="num px-2 py-2 text-right align-top leading-10">{formatMoney(lineCost(r), { decimals: 'always' })}</td>
                          <td className="py-2 align-top">
                            <IconButton label={t('menuAdmin.removeIngredient', { name: s?.name ?? '' })} tone="danger" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                              <X className="h-4 w-4" />
                            </IconButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={rows.length >= 30} onClick={() => setRows((rs) => [...rs, { key: nk(), inventoryItemId: '', qty: '' }])}>
              {t('menuAdmin.addIngredient')}
            </Button>
            {rows.length > 0 && (
              <dl className="grid gap-3 rounded-lg bg-paper p-4 sm:grid-cols-3">
                <div>
                  <dt className="text-[13px] text-ink-3">{t('menuAdmin.price')}</dt>
                  <dd className="num text-lg font-semibold">{formatMoney(item.price)}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-3">{t('menuAdmin.costPerPlate')}</dt>
                  <dd className="num text-lg font-semibold">{formatMoney(total, { decimals: 'always' })}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-3">{t('menuAdmin.marginPerPlate')}</dt>
                  <dd className={cn('num text-lg font-semibold', margin < 0 && 'text-danger')}>
                    {formatMoney(margin, { decimals: 'always' })}
                    {item.price > 0 && <span className="ml-1.5 text-sm font-normal text-ink-3">({Math.round((margin / item.price) * 100)}%)</span>}
                  </dd>
                </div>
                <p className="text-[12px] text-ink-3 sm:col-span-3">{t('menuAdmin.costNote')}</p>
              </dl>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <TabFooter>
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty || inv.isLoading}>
          {t('menuAdmin.saveRecipe')}
        </Button>
      </TabFooter>
    </div>
  );
}

// ───────────────────────── Price history ─────────────────────────

function HistoryTab({ item }: { item: AdminMenuItem }) {
  const t = useT();
  const { data, isLoading } = useQuery({ queryKey: [...PRICE_HISTORY_KEY, item.id], queryFn: () => api.get<PriceChangeRow[]>(`/menu/price-changes${qs({ itemId: item.id })}`) });
  const rows = data ?? [];
  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-sm text-ink-3">{t('menuAdmin.historyIntro')}</p>
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<History />} title={t('menuAdmin.noHistory')} className="py-8" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">{t('menuAdmin.colWhen')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('menuAdmin.colOld')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('menuAdmin.colNew')}</th>
                <th className="px-3 py-2 font-medium">{t('menuAdmin.colBy')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num px-3 py-2 text-ink-2">
                    {formatDateLong(r.at)}, {formatTime(r.at)}
                  </td>
                  <td className="num px-3 py-2 text-right text-ink-3">
                    <Money value={r.oldPrice} />
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold">
                    <Money value={r.newPrice} />
                  </td>
                  <td className="px-3 py-2 text-ink-2">{r.by ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

