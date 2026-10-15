import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, IndianRupee, MoreHorizontal, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react';
import { api, errorMessage, qs } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { useCan } from '../auth/session';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, MoneyInput, Select, Switch } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, SkeletonRows, Stat } from '../../components/ui/Misc';
import { Segmented } from '../../components/ui/Segmented';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { confirm } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import { addDays, businessDate, formatDateLong, formatDayShort, monthLabel } from '../../../shared/dates';
import { SUPPLIERS_KEY, type Supplier } from '../inventory/types';

type PayMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER';

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  paymentMethod: PayMethod;
  fromDrawer: boolean;
  supplierId: string | null;
  supplierName: string | null;
  reference: string | null;
  createdBy: string;
  createdAt: string;
}

interface ExpenseList {
  from: string;
  to: string;
  categories: string[];
  expenses: Expense[];
}

const FALLBACK_CATEGORIES = ['Ingredients', 'Gas', 'Electricity', 'Staff', 'Rent', 'Maintenance', 'Transport', 'Cleaning', 'Supplies', 'Other'];
const METHODS: PayMethod[] = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'];

interface Form {
  date: string;
  category: string;
  description: string;
  amount: string;
  paymentMethod: PayMethod;
  fromDrawer: boolean;
  supplierId: string;
  reference: string;
}

const blankForm = (): Form => ({ date: businessDate(), category: '', description: '', amount: '', paymentMethod: 'CASH', fromDrawer: false, supplierId: '', reference: '' });

const monthRange = (ym: string) => {
  const from = `${ym}-01`;
  const [y, m] = ym.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(next, -1) };
};
const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function ExpensesPage() {
  const t = useT();
  const can = useCan();
  const manage = can('expenses.manage');
  const qc = useQueryClient();
  const thisMonth = businessDate().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const range = monthRange(month);

  const { data, isLoading } = useQuery({ queryKey: ['expenses', range.from, range.to], queryFn: () => api.get<ExpenseList>(`/expenses${qs(range)}`) });
  const suppliers = useQuery({ queryKey: SUPPLIERS_KEY, queryFn: () => api.get<Supplier[]>('/suppliers'), enabled: manage });
  const shift = useQuery({ queryKey: ['shifts', 'current'], queryFn: () => api.get<{ id: string } | null>('/shifts/current'), enabled: manage });
  useLive(['shift'], [['expenses'], ['shifts', 'current']]);

  const categories = data?.categories ?? FALLBACK_CATEGORIES;
  const expenses = data?.expenses ?? [];
  const catLabel = (c: string) => (FALLBACK_CATEGORIES.includes(c) ? t(`expenses.cat.${c}`) : c);
  const methodLabel = (m: PayMethod) => (m === 'CASH' ? t('pay.cash') : m === 'UPI' ? t('pay.upi') : m === 'CARD' ? t('pay.card') : t('pay.bank'));

  const total = expenses.reduce((a, e) => a + e.amount, 0);
  const drawerTotal = expenses.filter((e) => e.fromDrawer).reduce((a, e) => a + e.amount, 0);
  const byCat = useMemo(() => {
    const m = new Map<string, { amount: number; count: number }>();
    for (const e of expenses) {
      const c = m.get(e.category) ?? { amount: 0, count: 0 };
      m.set(e.category, { amount: c.amount + e.amount, count: c.count + 1 });
    }
    return [...m].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amount - a.amount);
  }, [expenses]);
  const maxCat = byCat[0]?.amount ?? 0;

  const listed = catFilter ? expenses.filter((e) => e.category === catFilter) : expenses;
  const byDate = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of listed) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [listed]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['expenses'] }), qc.invalidateQueries({ queryKey: ['shifts'] }), qc.invalidateQueries({ queryKey: SUPPLIERS_KEY })]);

  const remove = async (e: Expense) => {
    const ok = await confirm({
      title: t('expenses.deleteTitle'),
      message: (
        <div className="space-y-2">
          <p>{t('expenses.deleteMessage', { desc: e.description, amount: formatMoney(e.amount), date: formatDateLong(e.date) })}</p>
          {e.fromDrawer && <p className="text-ink-3">{t('expenses.deleteDrawerNote')}</p>}
        </div>
      ),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/expenses/${e.id}`);
      toast.success(t('expenses.deleted'));
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const setMonthAndReset = (m: string) => {
    setMonth(m);
    setCatFilter(null);
  };

  return (
    <div>
      <PageHeader title={t('expenses.title')} subtitle={t('expenses.subtitle')} />

      {manage && (
        <QuickAdd
          categories={categories}
          catLabel={catLabel}
          methodLabel={methodLabel}
          suppliers={suppliers.data ?? []}
          shiftOpen={!!shift.data}
          onAdded={async (date) => {
            await refresh();
            if (date.slice(0, 7) !== month) setMonthAndReset(date.slice(0, 7));
          }}
        />
      )}

      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <IconButton label={t('expenses.prevMonth')} onClick={() => setMonthAndReset(shiftMonth(month, -1))}>
          <ChevronLeft className="h-5 w-5" />
        </IconButton>
        <h2 className="min-w-32 text-center text-lg font-semibold" aria-live="polite">
          {monthLabel(month)}
        </h2>
        <IconButton label={t('expenses.nextMonth')} onClick={() => setMonthAndReset(shiftMonth(month, 1))} disabled={month >= thisMonth}>
          <ChevronRight className="h-5 w-5" />
        </IconButton>
        {month !== thisMonth && (
          <Button size="sm" variant="ghost" onClick={() => setMonthAndReset(thisMonth)}>
            {t('expenses.thisMonth')}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 min-w-0 lg:order-1">
          {catFilter && (
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="text-ink-2">{t('expenses.showingCategory', { cat: catLabel(catFilter) })}</span>
              <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => setCatFilter(null)}>
                {t('expenses.showAll')}
              </Button>
            </div>
          )}
          {isLoading ? (
            <SkeletonRows rows={8} />
          ) : byDate.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface shadow-card">
              <EmptyState icon={<IndianRupee />} title={t('expenses.noExpenses', { month: monthLabel(month) })}>
                {manage ? t('expenses.noExpensesHint') : null}
              </EmptyState>
            </div>
          ) : (
            <div className="space-y-4">
              {byDate.map(([date, rows]) => (
                <section key={date} className="rounded-lg border border-line bg-surface shadow-card">
                  <header className="flex items-center justify-between border-b border-line px-4 py-2">
                    <h3 className="text-sm font-semibold">
                      {date === businessDate() ? `${t('common.today')} · ` : ''}
                      {formatDayShort(date)}
                    </h3>
                    <p className="text-[13px] text-ink-3">
                      {t('expenses.dayTotal')} <span className="num ml-1 font-semibold text-ink">{formatMoney(rows.reduce((a, e) => a + e.amount, 0))}</span>
                    </p>
                  </header>
                  <ul className="divide-y divide-line">
                    {rows.map((e) => (
                      <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{e.description}</span>
                            <Badge size="sm">{catLabel(e.category)}</Badge>
                            {e.fromDrawer && (
                              <Badge size="sm" tone="accent" icon={<Wallet className="h-3 w-3" />}>
                                {t('expenses.drawerTag')}
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 text-[12px] text-ink-3">
                            {[methodLabel(e.paymentMethod), e.supplierName, e.reference, t('expenses.by', { name: e.createdBy })].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className="num shrink-0 font-semibold">{formatMoney(e.amount)}</span>
                        {manage && (
                          <DropdownMenu
                            label={t('expenses.edit')}
                            trigger={({ toggle }) => (
                              <IconButton label={`${t('expenses.edit')}: ${e.description}`} size="sm" onClick={toggle}>
                                <MoreHorizontal className="h-4 w-4" />
                              </IconButton>
                            )}
                            items={[
                              { label: t('expenses.edit'), icon: <Pencil />, onSelect: () => setEditing(e) },
                              'divider',
                              { label: t('expenses.deleteLabel'), icon: <Trash2 />, danger: true, onSelect: () => void remove(e) },
                            ]}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="order-1 space-y-4 lg:order-2">
          <Panel>
            <div className="grid grid-cols-2 gap-4">
              <Stat
                label={t('expenses.monthTotal')}
                value={isLoading ? '—' : formatMoney(total)}
                sub={isLoading ? undefined : expenses.length === 1 ? t('expenses.oneEntry') : t('expenses.entries', { n: expenses.length })}
              />
              <Stat label={t('expenses.fromDrawerTotal')} value={isLoading ? '—' : formatMoney(drawerTotal)} />
            </div>
          </Panel>
          <Panel title={t('expenses.byCategory')} subtitle={byCat.length > 1 ? t('expenses.byCategoryHint') : undefined} bodyClassName="p-2">
            {isLoading ? (
              <SkeletonRows rows={4} className="p-2" />
            ) : byCat.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-ink-3">—</p>
            ) : (
              <ul className="space-y-0.5">
                {byCat.map((c) => {
                  const pct = total ? Math.round((c.amount / total) * 100) : 0;
                  const active = catFilter === c.category;
                  return (
                    <li key={c.category}>
                      <button
                        type="button"
                        onClick={() => setCatFilter(active ? null : c.category)}
                        aria-pressed={active}
                        className={cn('w-full rounded-md px-2 py-2 text-left hover:bg-paper', active && 'bg-brand-50 hover:bg-brand-50')}
                      >
                        <span className="flex items-baseline justify-between gap-2 text-sm">
                          <span className={cn('font-medium', active && 'text-brand')}>{catLabel(c.category)}</span>
                          <span className="num">
                            <span className="font-semibold">{formatMoney(c.amount)}</span>
                            <span className="ml-1.5 text-[12px] text-ink-3">{pct}%</span>
                          </span>
                        </span>
                        <span className="mt-1.5 block h-1.5 rounded-full bg-paper-2" aria-hidden>
                          <span className="block h-1.5 rounded-full bg-brand" style={{ width: `${maxCat ? Math.max(2, (c.amount / maxCat) * 100) : 0}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </aside>
      </div>

      <EditDialog
        expense={editing}
        categories={categories}
        catLabel={catLabel}
        methodLabel={methodLabel}
        suppliers={suppliers.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    </div>
  );
}

// ───────────────────────── Form pieces ─────────────────────────

interface FieldProps {
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  categories: string[];
  catLabel: (c: string) => string;
  methodLabel: (m: PayMethod) => string;
  suppliers: Supplier[];
  idPrefix: string;
}

function DetailFields({ form, set, suppliers, idPrefix }: Pick<FieldProps, 'form' | 'set' | 'suppliers' | 'idPrefix'>) {
  const t = useT();
  return (
    <>
      <Field label={t('expenses.supplier')} htmlFor={`${idPrefix}-sup`} optional>
        <Select id={`${idPrefix}-sup`} value={form.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
          <option value="">{t('expenses.noSupplier')}</option>
          {suppliers
            .filter((s) => s.active || s.id === form.supplierId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label={t('expenses.reference')} htmlFor={`${idPrefix}-ref`} optional>
        <Input id={`${idPrefix}-ref`} value={form.reference} onChange={(e) => set('reference', e.target.value)} maxLength={60} />
      </Field>
    </>
  );
}

function QuickAdd({
  categories,
  catLabel,
  methodLabel,
  suppliers,
  shiftOpen,
  onAdded,
}: Omit<FieldProps, 'form' | 'set' | 'idPrefix'> & { shiftOpen: boolean; onAdded: (date: string) => Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState<Form>(blankForm);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const today = businessDate();

  const presets = [
    { label: t('expenses.presetGas'), category: 'Gas' },
    { label: t('expenses.presetMilk'), category: 'Ingredients' },
    { label: t('expenses.presetVeg'), category: 'Ingredients' },
    { label: t('expenses.presetPower'), category: 'Electricity' },
    { label: t('expenses.presetSalary'), category: 'Staff' },
    { label: t('expenses.presetRent'), category: 'Rent' },
  ].filter((p) => categories.includes(p.category));

  const amount = toPaise(form.amount || '0');
  const errs = {
    amount: amount <= 0 ? t('expenses.amountRequired') : null,
    description: !form.description.trim() ? t('expenses.descriptionRequired') : null,
    date: form.date > today ? t('expenses.futureDate') : null,
  };
  const valid = !errs.amount && !errs.description && !errs.date && !!form.category;

  const submit = async () => {
    setTried(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/expenses', {
        category: form.category,
        description: form.description.trim(),
        amount,
        date: form.date,
        paymentMethod: form.paymentMethod,
        fromDrawer: form.paymentMethod === 'CASH' && form.fromDrawer,
        supplierId: form.supplierId || null,
        reference: form.reference.trim() || null,
      });
      toast.success(form.paymentMethod === 'CASH' && form.fromDrawer ? t('expenses.addedDrawer', { amount: formatMoney(amount) }) : t('expenses.added', { amount: formatMoney(amount) }));
      const date = form.date;
      setForm((f) => ({ ...blankForm(), date: f.date, paymentMethod: f.paymentMethod, fromDrawer: f.fromDrawer }));
      setTried(false);
      await onAdded(date);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('expenses.quickAdd')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        {presets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[13px] text-ink-3">{t('expenses.quickHint')}</span>
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, category: p.category, description: p.label }));
                  amountRef.current?.focus();
                }}
                className={cn('h-9 rounded-full border px-3 text-[13px]', form.description === p.label ? 'border-brand bg-brand-50 text-brand' : 'border-line-2 text-ink-2 hover:bg-paper')}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_150px_160px]">
          <Field label={t('expenses.description')} htmlFor="qa-desc" error={tried ? errs.description : null}>
            <Input id="qa-desc" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={200} placeholder={t('expenses.descriptionPlaceholder')} invalid={tried && !!errs.description} />
          </Field>
          <Field label={t('expenses.category')} htmlFor="qa-cat" error={tried && !form.category ? t('expenses.categoryRequired') : null}>
            <Select id="qa-cat" value={form.category} onChange={(e) => set('category', e.target.value)} aria-invalid={(tried && !form.category) || undefined}>
              <option value="">{t('expenses.chooseCategory')}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {catLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('expenses.amount')} htmlFor="qa-amt" error={tried ? errs.amount : null}>
            <MoneyInput ref={amountRef} id="qa-amt" value={form.amount} onValueChange={(v) => set('amount', v)} invalid={tried && !!errs.amount} />
          </Field>
          <Field label={t('expenses.date')} htmlFor="qa-date" error={errs.date}>
            <Input id="qa-date" type="date" value={form.date} max={today} onChange={(e) => set('date', e.target.value || today)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t('expenses.paidBy')}</p>
            <Segmented<PayMethod> label={t('expenses.paidBy')} value={form.paymentMethod} onChange={(v) => set('paymentMethod', v)} options={METHODS.map((m) => ({ value: m, label: methodLabel(m) }))} />
          </div>
          {form.paymentMethod === 'CASH' && (
            <div className="min-w-64 max-w-sm flex-1">
              <Switch
                checked={form.fromDrawer && shiftOpen}
                onChange={(v) => set('fromDrawer', v)}
                disabled={!shiftOpen}
                label={t('expenses.fromDrawer')}
                description={shiftOpen ? t('expenses.fromDrawerHint') : t('shift.notOpenBanner')}
              />
            </div>
          )}
          <Button type="button" size="sm" variant="ghost" icon={<Plus className={cn('h-4 w-4 transition-transform', more && 'rotate-45')} />} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {t('expenses.moreDetails')}
          </Button>
        </div>
        {more && (
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailFields form={form} set={set} suppliers={suppliers} idPrefix="qa" />
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} loading={busy} disabled={tried && !valid}>
            {t('expenses.add')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function EditDialog({
  expense,
  categories,
  catLabel,
  methodLabel,
  suppliers,
  onClose,
  onSaved,
}: Omit<FieldProps, 'form' | 'set' | 'idPrefix'> & { expense: Expense | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState<Form>(blankForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(expense);
  if (expense !== last) {
    setLast(expense);
    setError(null);
    if (expense)
      setForm({
        date: expense.date,
        category: expense.category,
        description: expense.description,
        amount: rupeeInput(expense.amount),
        paymentMethod: expense.paymentMethod,
        fromDrawer: expense.fromDrawer,
        supplierId: expense.supplierId ?? '',
        reference: expense.reference ?? '',
      });
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const today = businessDate();
  const locked = !!expense?.fromDrawer;
  const amount = toPaise(form.amount || '0');
  const valid = amount > 0 && !!form.description.trim() && !!form.category && form.date <= today;

  const submit = async () => {
    if (!expense || !valid) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      category: form.category,
      description: form.description.trim(),
      date: form.date,
      supplierId: form.supplierId || null,
      reference: form.reference.trim() || null,
    };
    if (!locked) {
      body.amount = amount;
      body.paymentMethod = form.paymentMethod;
    }
    try {
      await api.patch(`/expenses/${expense.id}`, body);
      toast.success(t('expenses.saved'));
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!expense}
      onClose={onClose}
      title={t('expenses.editTitle')}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!valid}>
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
        {locked && (
          <p className="flex items-start gap-2 rounded-md bg-accent-50 px-3 py-2 text-[13px] text-ink-2 sm:col-span-2">
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            {t('expenses.drawerLocked')}
          </p>
        )}
        <Field label={t('expenses.description')} htmlFor="ed-desc" className="sm:col-span-2">
          <Input id="ed-desc" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={200} />
        </Field>
        <Field label={t('expenses.category')} htmlFor="ed-cat">
          <Select id="ed-cat" value={form.category} onChange={(e) => set('category', e.target.value)}>
            {!categories.includes(form.category) && form.category && <option value={form.category}>{form.category}</option>}
            {categories.map((c) => (
              <option key={c} value={c}>
                {catLabel(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('expenses.date')} htmlFor="ed-date">
          <Input id="ed-date" type="date" value={form.date} max={today} onChange={(e) => set('date', e.target.value || form.date)} />
        </Field>
        <Field label={t('expenses.amount')} htmlFor="ed-amt">
          <MoneyInput id="ed-amt" value={form.amount} onValueChange={(v) => set('amount', v)} disabled={locked} />
        </Field>
        <Field label={t('expenses.paidBy')} htmlFor="ed-method">
          <Select id="ed-method" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as PayMethod)} disabled={locked}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        <DetailFields form={form} set={set} suppliers={suppliers} idPrefix="ed" />
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
