import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, DatabaseBackup, HardDriveDownload, Info, Languages, MonitorSmartphone, Plus, Printer, ReceiptText, Settings as SettingsIcon, X } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../api/client';
import { useLive } from '../../hooks/useLive';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Field, Input, MoneyInput, Switch, Textarea } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, SkeletonRows } from '../../components/ui/Misc';
import { Segmented, Tabs } from '../../components/ui/Segmented';
import { toast } from '../../components/ui/Toast';
import { ReceiptPreview } from '../billing/ReceiptPreview';
import { printTest } from '../../services/print';
import { setLanguage, useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import { formatDateTime } from '../../../shared/dates';
import { buildKot, buildReceipt } from '../../../shared/receipt';
import type { AppSettings, InvoiceDTO, PrinterSettingsDTO } from '../../../shared/types';

type SettingsData = { settings: AppSettings; printers: PrinterSettingsDTO[] };
type SectionKey = 'business' | 'billing' | 'counter' | 'printer' | 'language' | 'backups';
type Fields = Record<string, string>;

const KEY = ['settings'];
const SECTIONS: { key: SectionKey; icon: typeof Building2 }[] = [
  { key: 'business', icon: Building2 },
  { key: 'billing', icon: ReceiptText },
  { key: 'counter', icon: MonitorSmartphone },
  { key: 'printer', icon: Printer },
  { key: 'language', icon: Languages },
  { key: 'backups', icon: DatabaseBackup },
];

const fieldsOf = (err: unknown): Fields => (err instanceof ApiError && err.fields ? err.fields : {});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function SettingsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get('section') as SectionKey | null;
  const section: SectionKey = SECTIONS.some((s) => s.key === raw) ? raw! : 'business';
  const go = (k: SectionKey) => setParams(k === 'business' ? {} : { section: k }, { replace: true });
  useLive(['settings'], [KEY]);
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: () => api.get<SettingsData>('/settings') });

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <Tabs className="mb-4 lg:hidden" value={section} onChange={go} tabs={SECTIONS.map((s) => ({ value: s.key, label: t(`settings.nav.${s.key}`) }))} />
      <div className="grid items-start gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label={t('settings.sections')} className="hidden lg:block">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => go(s.key)}
                  aria-current={section === s.key ? 'page' : undefined}
                  className={cn(
                    'flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-[14px] transition-colors',
                    section === s.key ? 'bg-surface font-semibold text-ink shadow-card ring-1 ring-line' : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
                  )}
                >
                  <s.icon className={cn('h-[17px] w-[17px]', section === s.key ? 'text-brand' : 'text-ink-3')} aria-hidden />
                  <span className="flex-1">{t(`settings.nav.${s.key}`)}</span>
                  {section === s.key && <ChevronRight className="h-4 w-4 text-ink-4" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          {isLoading ? (
            <SkeletonRows rows={8} />
          ) : error || !data ? (
            <EmptyState icon={<SettingsIcon />} title={errorMessage(error)} />
          ) : section === 'business' ? (
            <BusinessSection data={data} />
          ) : section === 'billing' ? (
            <div className="space-y-5">
              <BillingSection data={data} />
              <TaxRatesPanel />
            </div>
          ) : section === 'counter' ? (
            <div className="space-y-5">
              <CounterSection data={data} />
              <ShiftSection data={data} />
            </div>
          ) : section === 'printer' ? (
            <PrinterSection data={data} />
          ) : section === 'language' ? (
            <LanguageSection data={data} />
          ) : (
            <BackupsSection />
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────── shared pieces ───────────────────────────

/** Saves one settings section and keeps the cached settings in step. */
function useSectionSave<K extends 'business' | 'billing' | 'pos' | 'shift'>(section: K, label: string) {
  const t = useT();
  const qc = useQueryClient();
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: AppSettings[K]) => api.put<AppSettings>(`/settings/${section}`, body),
    onMutate: () => {
      setFields({});
      setError(null);
    },
    onSuccess: (settings) => {
      qc.setQueryData<SettingsData>(KEY, (old) => (old ? { ...old, settings } : old));
      toast.success(t('settings.saved', { section: label }));
    },
    onError: (err) => {
      const f = fieldsOf(err);
      setFields(f);
      setError(errorMessage(err));
      toast.error(Object.keys(f).length ? t('settings.fixErrors') : errorMessage(err));
    },
  });
  return { save: m.mutate, saving: m.isPending, fields, error };
}

function SectionPanel({
  title,
  subtitle,
  children,
  dirty,
  saving,
  onSave,
  error,
  extra,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  error?: string | null;
  extra?: ReactNode;
}) {
  const t = useT();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      noValidate
    >
      <Panel title={title} subtitle={subtitle} bodyClassName="p-0">
        <div className="p-4 sm:p-5">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-paper/60 px-4 py-3 sm:px-5">
          {error && (
            <p role="alert" className="mr-auto text-[13px] text-danger">
              {error}
            </p>
          )}
          {!error && dirty && <p className="mr-auto text-[13px] text-warn">{t('settings.unsaved')}</p>}
          {extra}
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            {t('settings.saveSection')}
          </Button>
        </div>
      </Panel>
    </form>
  );
}

function RadioCard({ name, checked, onChange, title, hint }: { name: string; checked: boolean; onChange: () => void; title: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 transition-colors', checked ? 'border-brand bg-brand-50/60' : 'border-line-2 hover:bg-paper')}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}

function useDraft<T>(saved: T) {
  const [draft, setDraft] = useState<T>(saved);
  const sig = JSON.stringify(saved);
  useEffect(() => setDraft(saved), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => ({ ...d, [k]: v }));
  return [draft, set, setDraft] as const;
}

// ─────────────────────────── Business ───────────────────────────

function BusinessSection({ data }: { data: SettingsData }) {
  const t = useT();
  const saved = data.settings.business;
  const [d, set] = useDraft(saved);
  const { save, saving, fields, error } = useSectionSave('business', t('settings.nav.business'));
  const dirty = !same(d, saved);
  const text = (k: keyof typeof d, label: string, opts: { hint?: string; max: number; className?: string; inputMode?: 'numeric' | 'tel'; upper?: boolean; optional?: boolean }) => (
    <Field label={label} htmlFor={`biz-${k}`} hint={opts.hint} error={fields[k]} className={opts.className} optional={opts.optional}>
      <Input
        id={`biz-${k}`}
        value={d[k]}
        maxLength={opts.max}
        inputMode={opts.inputMode}
        onChange={(e) => set(k, opts.upper ? e.target.value.toUpperCase() : e.target.value)}
        invalid={!!fields[k]}
      />
    </Field>
  );
  return (
    <SectionPanel title={t('settings.nav.business')} subtitle={t('settings.business.intro')} dirty={dirty} saving={saving} error={error} onSave={() => save(d)}>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('name', t('settings.business.name'), { max: 60 })}
        {text('tagline', t('settings.business.tagline'), { max: 60, hint: t('settings.business.taglineHint'), optional: true })}
        {text('address', t('settings.business.address'), { max: 160, className: 'sm:col-span-2', optional: true })}
        {text('city', t('settings.business.city'), { max: 60, optional: true })}
        {text('state', t('settings.business.state'), { max: 40, optional: true })}
        {text('pincode', t('settings.business.pincode'), { max: 6, inputMode: 'numeric', optional: true })}
        {text('phone', t('settings.business.phone'), { max: 40, inputMode: 'tel', optional: true })}
        {text('gstin', t('settings.business.gstin'), { max: 15, hint: t('settings.business.gstinHint'), upper: true, optional: true })}
        {text('fssai', t('settings.business.fssai'), { max: 14, inputMode: 'numeric', hint: t('settings.business.fssaiHint'), optional: true })}
      </div>
    </SectionPanel>
  );
}

// ─────────────────────────── Billing & tax ───────────────────────────

function BillingSection({ data }: { data: SettingsData }) {
  const t = useT();
  const saved = data.settings.billing;
  const [d, set] = useDraft(saved);
  const { save, saving, fields, error } = useSectionSave('billing', t('settings.nav.billing'));
  const dirty = !same(d, saved);
  return (
    <SectionPanel title={t('settings.nav.billing')} subtitle={t('settings.billing.intro')} dirty={dirty} saving={saving} error={error} onSave={() => save(d)}>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-2">{t('settings.billing.taxMode')}</legend>
        <div className="grid gap-2">
          {(['EXCLUSIVE', 'INCLUSIVE', 'NONE'] as const).map((m) => (
            <RadioCard key={m} name="taxMode" checked={d.taxMode === m} onChange={() => set('taxMode', m)} title={t(`settings.billing.${m}`)} hint={t(`settings.billing.${m}_hint`)} />
          ))}
        </div>
        {fields.taxMode && <p className="mt-1 text-[13px] text-danger">{fields.taxMode}</p>}
      </fieldset>
      <div className="mt-5 grid gap-4 border-t border-line pt-4">
        <Switch checked={d.roundOff} onChange={(v) => set('roundOff', v)} label={t('settings.billing.roundOff')} description={t('settings.billing.roundOffHint')} />
        <Switch checked={d.requireApprovalForVoid} onChange={(v) => set('requireApprovalForVoid', v)} label={t('settings.billing.approval')} description={t('settings.billing.approvalHint')} />
        <Field label={t('settings.billing.invoicePrefix')} htmlFor="bill-prefix" hint={t('settings.billing.invoicePrefixHint', { example: `${d.invoicePrefix}000124` })} error={fields.invoicePrefix}>
          <Input id="bill-prefix" className="max-w-40 font-mono" value={d.invoicePrefix} maxLength={10} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase().replace(/\s/g, ''))} invalid={!!fields.invoicePrefix} />
        </Field>
      </div>
    </SectionPanel>
  );
}

interface TaxRate {
  id: string;
  name: string;
  rate: number;
  active: boolean;
}

function TaxRatesPanel() {
  const t = useT();
  const qc = useQueryClient();
  const key = ['settings', 'tax-rates'];
  useLive(['menu'], [key]);
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<TaxRate[]>('/tax-rates') });
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [addFields, setAddFields] = useState<Fields>({});

  const add = useMutation({
    mutationFn: () => api.post<TaxRate>('/tax-rates', { name: newName.trim(), rate: Number(newRate) }),
    onSuccess: (r) => {
      toast.success(t('settings.billing.taxAdded', { name: r.name }));
      setNewName('');
      setNewRate('');
      setAddFields({});
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => {
      setAddFields(fieldsOf(err));
      toast.error(errorMessage(err));
    },
  });

  return (
    <Panel title={t('settings.billing.taxRates')} subtitle={t('settings.billing.taxRatesHint')} bodyClassName="p-0">
      {isLoading ? (
        <SkeletonRows className="p-4" rows={3} />
      ) : error ? (
        <p className="px-4 py-4 text-sm text-ink-3">{errorMessage(error)}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('settings.billing.taxName')}</th>
                  <th className="px-2 py-2 font-medium">{t('settings.billing.taxRate')}</th>
                  <th className="px-2 py-2 font-medium">{t('settings.billing.taxActive')}</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">{t('common.save')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-ink-3">
                      {t('settings.billing.noTaxRates')}
                    </td>
                  </tr>
                )}
                {data?.map((r) => <TaxRow key={`${r.id}-${r.name}-${r.rate}-${r.active}`} rate={r} onSaved={() => void qc.invalidateQueries({ queryKey: key })} />)}
              </tbody>
            </table>
          </div>
          <form
            className="flex flex-wrap items-end gap-2 border-t border-line bg-paper/60 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim() && newRate !== '') add.mutate();
            }}
          >
            <Field label={t('settings.billing.taxName')} htmlFor="tax-new-name" error={addFields.name}>
              <Input id="tax-new-name" className="max-w-48" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder={t('settings.billing.newTaxName')} />
            </Field>
            <Field label={t('settings.billing.taxRate')} htmlFor="tax-new-rate" error={addFields.rate}>
              <Input id="tax-new-rate" className="num max-w-24 text-right" inputMode="decimal" value={newRate} onChange={(e) => /^\d{0,2}(\.\d{0,2})?$/.test(e.target.value) && setNewRate(e.target.value)} />
            </Field>
            <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={add.isPending} disabled={!newName.trim() || newRate === ''}>
              {t('settings.billing.addTax')}
            </Button>
          </form>
        </>
      )}
    </Panel>
  );
}

function TaxRow({ rate, onSaved }: { rate: TaxRate; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(rate.name);
  const [value, setValue] = useState(String(rate.rate));
  const [active, setActive] = useState(rate.active);
  const [fields, setFields] = useState<Fields>({});
  const dirty = name.trim() !== rate.name || Number(value) !== rate.rate || active !== rate.active;
  const save = useMutation({
    mutationFn: () => api.patch<TaxRate>(`/tax-rates/${rate.id}`, { name: name.trim(), rate: Number(value), active }),
    onSuccess: (r) => {
      toast.success(t('settings.billing.taxSaved', { name: r.name }));
      setFields({});
      onSaved();
    },
    onError: (err) => {
      setFields(fieldsOf(err));
      toast.error(errorMessage(err));
    },
  });
  return (
    <tr className={cn(!active && 'text-ink-3')}>
      <td className="px-4 py-2">
        <Input aria-label={t('settings.billing.taxName')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="" invalid={!!fields.name} />
        {fields.name && <p className="mt-1 text-[12px] text-danger">{fields.name}</p>}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <Input aria-label={t('settings.billing.taxRate')} inputMode="decimal" value={value} onChange={(e) => /^\d{0,2}(\.\d{0,2})?$/.test(e.target.value) && setValue(e.target.value)} className="num max-w-20 text-right" invalid={!!fields.rate} />
          <span className="text-ink-3">%</span>
        </div>
        {fields.rate && <p className="mt-1 text-[12px] text-danger">{fields.rate}</p>}
      </td>
      <td className="px-2 py-2">
        <div className="-ml-4 flex items-center gap-1">
          <Switch checked={active} onChange={setActive} label={<span className="sr-only">{t('settings.billing.turnOnTax', { name: rate.name })}</span>} />
          <span className="text-[13px] text-ink-3">{active ? t('common.active') : t('common.inactive')}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-right">
        <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || value === ''} loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </td>
    </tr>
  );
}

// ─────────────────────────── Counter & shift ───────────────────────────

function CounterSection({ data }: { data: SettingsData }) {
  const t = useT();
  const saved = data.settings.pos;
  const savedForm = useMemo(() => ({ ...saved, tableWarnMinutes: String(saved.tableWarnMinutes), billWarnMinutes: String(saved.billWarnMinutes), quickCash: saved.quickCash.map(rupeeInput) }), [saved]);
  const [d, set] = useDraft(savedForm);
  const { save, saving, fields, error } = useSectionSave('pos', t('settings.nav.counter'));
  const body = () => ({
    ...d,
    tableWarnMinutes: Number(d.tableWarnMinutes) || 0,
    billWarnMinutes: Number(d.billWarnMinutes) || 0,
    quickCash: [...new Set(d.quickCash.map((v) => toPaise(v)).filter((v) => v > 0))].sort((a, b) => a - b),
  });
  const dirty = !same(body(), saved);
  const qcErr = Object.entries(fields).find(([k]) => k.startsWith('quickCash'))?.[1];
  // Check the minute limits here so the cashier sees a plain sentence, not the server's rule text.
  const [checked, setChecked] = useState(false);
  const range = (v: string, min: number) => (Number(v) >= min && Number(v) <= 600 ? null : t('settings.counter.minutesRange', { min, max: 600 }));
  const local: Fields = Object.fromEntries(
    ([['tableWarnMinutes', range(d.tableWarnMinutes, 5)], ['billWarnMinutes', range(d.billWarnMinutes, 1)]] as const).filter(([, v]) => v) as [string, string][],
  );
  const fieldError = (k: string) => (checked ? local[k] : undefined) ?? fields[k];
  const onSave = () => {
    setChecked(true);
    if (!Object.keys(local).length) save(body());
  };

  const minutes = (k: 'tableWarnMinutes' | 'billWarnMinutes', label: string, hint: string) => (
    <Field label={label} htmlFor={`pos-${k}`} hint={hint} error={fieldError(k)}>
      <div className="flex items-center gap-2">
        <Input id={`pos-${k}`} inputMode="numeric" className="num max-w-24 text-right" value={d[k]} onChange={(e) => /^\d{0,3}$/.test(e.target.value) && set(k, e.target.value)} invalid={!!fieldError(k)} />
        <span className="text-sm text-ink-3">{t('settings.counter.minutes')}</span>
      </div>
    </Field>
  );

  return (
    <SectionPanel title={t('settings.nav.counter')} subtitle={t('settings.counter.intro')} dirty={dirty} saving={saving} error={error} onSave={onSave}>
      <div className="grid gap-3">
        <Switch checked={d.requireShift} onChange={(v) => set('requireShift', v)} label={t('settings.counter.requireShift')} description={t('settings.counter.requireShiftHint')} />
        <Switch checked={d.kitchenDisplay} onChange={(v) => set('kitchenDisplay', v)} label={t('settings.counter.kitchenDisplay')} description={t('settings.counter.kitchenDisplayHint')} />
        <Switch checked={d.printKot} onChange={(v) => set('printKot', v)} label={t('settings.counter.printKot')} description={t('settings.counter.printKotHint')} />
        <Switch checked={d.allowDelivery} onChange={(v) => set('allowDelivery', v)} label={t('settings.counter.allowDelivery')} description={t('settings.counter.allowDeliveryHint')} />
      </div>
      <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        {minutes('tableWarnMinutes', t('settings.counter.tableWarn'), t('settings.counter.tableWarnHint'))}
        {minutes('billWarnMinutes', t('settings.counter.billWarn'), t('settings.counter.billWarnHint'))}
      </div>
      <fieldset className="mt-5 border-t border-line pt-4">
        <legend className="sr-only">{t('settings.counter.quickCash')}</legend>
        <p className="text-[13px] font-medium text-ink-2">{t('settings.counter.quickCash')}</p>
        <p className="mb-2 text-[13px] text-ink-3">{t('settings.counter.quickCashHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {d.quickCash.map((v, i) => (
            <div key={i} className="flex items-center gap-0.5">
              <MoneyInput
                aria-label={t('settings.counter.quickCashAmount', { n: i + 1 })}
                value={v}
                onValueChange={(nv) => set('quickCash', d.quickCash.map((x, j) => (j === i ? nv : x)))}
                className="w-28"
              />
              <IconButton size="sm" label={t('settings.counter.removeAmount', { amount: v ? formatMoney(toPaise(v)) : '' })} onClick={() => set('quickCash', d.quickCash.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          ))}
          {d.quickCash.length < 6 && (
            <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => set('quickCash', [...d.quickCash, ''])}>
              {t('settings.counter.addAmount')}
            </Button>
          )}
        </div>
        {qcErr && <p className="mt-1 text-[13px] text-danger">{qcErr}</p>}
      </fieldset>
    </SectionPanel>
  );
}

function ShiftSection({ data }: { data: SettingsData }) {
  const t = useT();
  const saved = data.settings.shift;
  const [value, setValue] = useState(rupeeInput(saved.noteRequiredAbove));
  useEffect(() => setValue(rupeeInput(saved.noteRequiredAbove)), [saved.noteRequiredAbove]);
  const { save, saving, fields, error } = useSectionSave('shift', t('settings.counter.shiftTitle'));
  const dirty = toPaise(value || '0') !== saved.noteRequiredAbove;
  return (
    <SectionPanel title={t('settings.counter.shiftTitle')} subtitle={t('settings.counter.shiftIntro')} dirty={dirty} saving={saving} error={error} onSave={() => save({ noteRequiredAbove: toPaise(value || '0') })}>
      <Field label={t('settings.counter.noteAbove')} htmlFor="shift-note-above" hint={t('settings.counter.noteAboveHint')} error={fields.noteRequiredAbove}>
        <MoneyInput id="shift-note-above" value={value} onValueChange={setValue} className="w-36" invalid={!!fields.noteRequiredAbove} />
      </Field>
    </SectionPanel>
  );
}

// ─────────────────────────── Printer ───────────────────────────

const SAMPLE_ITEMS = [
  { name: 'Masala Dosa', qty: 2, unitPrice: 6000, taxRate: 5 },
  { name: 'Idli Vada', qty: 1, unitPrice: 5500, taxRate: 5 },
  { name: 'Filter Coffee', qty: 2, unitPrice: 2500, taxRate: 5 },
];

/** A made-up bill used only for the on-screen preview; follows the saved tax settings. */
function sampleInvoice(settings: AppSettings): InvoiceDTO {
  const subtotal = SAMPLE_ITEMS.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  const mode = settings.billing.taxMode;
  const tax = mode === 'NONE' ? 0 : mode === 'INCLUSIVE' ? Math.round((subtotal * 5) / 105) : Math.round(subtotal * 0.05);
  const raw = mode === 'EXCLUSIVE' ? subtotal + tax : subtotal;
  const total = settings.billing.roundOff ? Math.round(raw / 100) * 100 : raw;
  const now = new Date().toISOString();
  return {
    id: 'sample',
    number: `${settings.billing.invoicePrefix}000124`,
    orderId: 'sample',
    orderNumber: 57,
    orderType: 'DINE_IN',
    tableName: 'T4',
    customerName: null,
    customerPhone: null,
    subtotal,
    discount: 0,
    discountLabel: null,
    taxable: mode === 'INCLUSIVE' ? subtotal - tax : subtotal,
    tax,
    taxInclusive: mode === 'INCLUSIVE',
    roundOff: total - raw,
    total,
    paid: total,
    change: 0,
    refunded: 0,
    status: 'PAID',
    cashierName: 'Lakshmi',
    createdAt: now,
    reprintCount: 0,
    offline: false,
    voidReason: null,
    items: SAMPLE_ITEMS.map((i) => ({ name: i.name, modifiersText: null, note: null, qty: i.qty, unitPrice: i.unitPrice, lineTotal: i.qty * i.unitPrice, taxRate: i.taxRate })),
    payments: [{ method: 'CASH', amount: total, tendered: Math.ceil(total / 50000) * 50000, change: null, reference: null }],
  };
}

function PrinterSection({ data }: { data: SettingsData }) {
  const t = useT();
  const [which, setWhich] = useState<'receipt' | 'kitchen'>('receipt');
  const printer = data.printers.find((p) => p.id === which);
  return (
    <div className="space-y-4">
      <Segmented
        label={t('settings.printer.which')}
        value={which}
        onChange={setWhich}
        options={data.printers.map((p) => ({ value: p.id, label: p.id === 'receipt' ? t('settings.printer.receipt') : t('settings.printer.kitchen') }))}
      />
      {printer ? <PrinterForm key={printer.id} printer={printer} settings={data.settings} /> : null}
      <p className="flex items-start gap-2 rounded-md border border-info/20 bg-info-50 px-3 py-2 text-[13px] text-info">
        <Info className="mt-px h-4 w-4 shrink-0" aria-hidden />
        {t('settings.printer.tip')}
      </p>
    </div>
  );
}

function PrinterForm({ printer, settings }: { printer: PrinterSettingsDTO; settings: AppSettings }) {
  const t = useT();
  const qc = useQueryClient();
  const [d, set] = useDraft(printer);
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const isReceipt = printer.id === 'receipt';
  const dirty = !same(d, printer);
  const title = isReceipt ? t('settings.printer.receipt') : t('settings.printer.kitchen');

  const save = useMutation({
    mutationFn: () => {
      const { id: _id, label: _label, ...rest } = d;
      const ip = d.ipAddress?.trim() || null;
      // Keep a remembered address for "This computer" only if it is valid; the field is hidden then.
      const ipAddress = d.connection === 'NETWORK' || (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) ? ip : null;
      return api.put<PrinterSettingsDTO[]>(`/printers/${printer.id}`, { ...rest, ipAddress, printerName: d.printerName?.trim() || null });
    },
    onMutate: () => {
      setFields({});
      setError(null);
    },
    onSuccess: (printers) => {
      qc.setQueryData<SettingsData>(KEY, (old) => (old ? { ...old, printers } : old));
      toast.success(t('settings.saved', { section: title }));
    },
    onError: (err) => {
      const f = fieldsOf(err);
      setFields(f);
      setError(errorMessage(err));
      toast.error(Object.keys(f).length ? t('settings.fixErrors') : errorMessage(err));
    },
  });

  const test = async () => {
    if (d.connection === 'NETWORK' && dirty) {
      toast.info(t('settings.printer.testNeedsSave'));
      return;
    }
    setTesting(true);
    try {
      if (d.connection === 'NETWORK') {
        // Direct fetch: the shared client reports any 503 as "cannot reach the server",
        // but here 503 means the printer itself did not answer, and the server says so.
        const res = await fetch(`/api/printers/${printer.id}/test`, { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(30_000) });
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (res.ok) toast.success(body.message ?? t('settings.printer.testSent'));
        else toast.error(body.error ?? t('errors.generic'));
      } else {
        await printTest(d, settings.business.name);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const doc = useMemo(
    () =>
      isReceipt
        ? buildReceipt(sampleInvoice(settings), settings, d)
        : buildKot(
            { round: 1, createdAt: new Date().toISOString(), items: [{ name: 'Masala Dosa', qty: 2, note: 'Less spicy' }, { name: 'Filter Coffee', qty: 2 }], note: null },
            { number: 57, type: 'DINE_IN', tableName: 'T4' },
            d.paperWidth,
          ),
    [isReceipt, settings, d],
  );

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
      <SectionPanel
        title={title}
        subtitle={t('settings.printer.intro')}
        dirty={dirty}
        saving={save.isPending}
        error={error}
        onSave={() => save.mutate()}
        extra={
          <Button icon={<Printer className="h-4 w-4" />} onClick={() => void test()} loading={testing} disabled={!d.enabled}>
            {t('settings.printer.testPrint')}
          </Button>
        }
      >
        <div className="space-y-5">
          <Switch checked={d.enabled} onChange={(v) => set('enabled', v)} label={t('settings.printer.enabled')} />
          {!d.enabled && <p className="rounded-md bg-paper-2 px-3 py-2 text-[13px] text-ink-2">{t('settings.printer.off')}</p>}

          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink-2">{t('settings.printer.connection')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['BROWSER', 'NETWORK'] as const).map((c) => (
                <RadioCard key={c} name={`conn-${printer.id}`} checked={d.connection === c} onChange={() => set('connection', c)} title={t(`settings.printer.${c}`)} hint={t(`settings.printer.${c}_hint`)} />
              ))}
            </div>
          </fieldset>

          {d.connection === 'NETWORK' && (
            <Field label={t('settings.printer.ipAddress')} htmlFor={`ip-${printer.id}`} hint={t('settings.printer.ipHint')} error={fields.ipAddress}>
              <Input id={`ip-${printer.id}`} className="num max-w-52" inputMode="decimal" placeholder="192.168.1.50" value={d.ipAddress ?? ''} onChange={(e) => set('ipAddress', e.target.value.replace(/[^\d.]/g, ''))} invalid={!!fields.ipAddress} />
            </Field>
          )}

          <div className="flex flex-wrap gap-6">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t('settings.printer.paperWidth')}</p>
              <Segmented
                label={t('settings.printer.paperWidth')}
                value={String(d.paperWidth) as '80' | '58'}
                onChange={(v) => set('paperWidth', Number(v) as 58 | 80)}
                options={[
                  { value: '80', label: t('settings.printer.mm80') },
                  { value: '58', label: t('settings.printer.mm58') },
                ]}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t('settings.printer.copies')}</p>
              <Segmented label={t('settings.printer.copies')} value={String(d.copies) as '1' | '2' | '3'} onChange={(v) => set('copies', Number(v))} options={['1', '2', '3'].map((n) => ({ value: n as '1' | '2' | '3', label: n }))} />
            </div>
          </div>

          {isReceipt && (
            <div className="grid gap-3 border-t border-line pt-4">
              <Switch checked={d.autoPrint} onChange={(v) => set('autoPrint', v)} label={t('settings.printer.autoPrint')} />
              <Switch checked={d.printLogo} onChange={(v) => set('printLogo', v)} label={t('settings.printer.printLogo')} />
              <Switch checked={d.printTax} onChange={(v) => set('printTax', v)} label={t('settings.printer.printTax')} />
              <Switch checked={d.openDrawer} onChange={(v) => set('openDrawer', v)} label={t('settings.printer.openDrawer')} description={t('settings.printer.openDrawerHint')} />
              <Switch checked={d.printFooter} onChange={(v) => set('printFooter', v)} label={t('settings.printer.printFooter')} />
              {d.printFooter && (
                <Field label={t('settings.printer.footerText')} htmlFor="footer-text" error={fields.footerText}>
                  <Textarea id="footer-text" value={d.footerText} maxLength={200} rows={2} placeholder={t('settings.printer.footerPlaceholder')} onChange={(e) => set('footerText', e.target.value)} />
                </Field>
              )}
            </div>
          )}

          <details className="group rounded-md border border-line" open={fields.port || fields.printerName ? true : undefined}>
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-ink-2 hover:text-ink">
              <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
              {t('settings.printer.advanced')}
            </summary>
            <div className="grid gap-4 border-t border-line p-3 sm:grid-cols-2">
              <p className="text-[13px] text-ink-3 sm:col-span-2">{t('settings.printer.advancedHint')}</p>
              <Field label={t('settings.printer.port')} htmlFor={`port-${printer.id}`} hint={t('settings.printer.portHint')} error={fields.port}>
                <Input id={`port-${printer.id}`} className="num max-w-28" inputMode="numeric" value={String(d.port)} onChange={(e) => /^\d{0,5}$/.test(e.target.value) && set('port', Number(e.target.value) || 0)} invalid={!!fields.port} />
              </Field>
              <Field label={t('settings.printer.printerName')} htmlFor={`pname-${printer.id}`} hint={t('settings.printer.printerNameHint')} error={fields.printerName} optional>
                <Input id={`pname-${printer.id}`} value={d.printerName ?? ''} maxLength={80} onChange={(e) => set('printerName', e.target.value)} />
              </Field>
            </div>
          </details>
        </div>
      </SectionPanel>

      <div className="xl:sticky xl:top-2">
        <p className="mb-2 text-[13px] font-medium text-ink-2">{isReceipt ? t('settings.printer.preview') : t('settings.printer.previewKitchen')}</p>
        <div className={cn('rounded-lg border border-line bg-paper-2/60 p-4', !d.enabled && 'opacity-50')}>
          <ReceiptPreview doc={doc} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Language ───────────────────────────

function LanguageSection({ data }: { data: SettingsData }) {
  const t = useT();
  const qc = useQueryClient();
  const saved = data.settings.language;
  const [lang, setLang] = useState<'en' | 'kn'>(saved);
  useEffect(() => setLang(saved), [saved]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    // The server expects the bare language code as the JSON body.
    mutationFn: () => api.put<AppSettings>('/settings/language', lang as unknown as object),
    onMutate: () => setError(null),
    onSuccess: (settings) => {
      setLanguage(lang);
      qc.setQueryData<SettingsData>(KEY, (old) => (old ? { ...old, settings } : old));
      toast.success(t('settings.language.saved'));
    },
    onError: (err) => {
      const msg = errorMessage(err);
      setError(msg);
      toast.error(msg);
    },
  });

  return (
    <SectionPanel title={t('settings.nav.language')} subtitle={t('settings.language.intro')} dirty={lang !== saved} saving={save.isPending} error={error} onSave={() => save.mutate()}>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-ink-2">{t('settings.language.label')}</legend>
        <div className="grid max-w-xl gap-2 sm:grid-cols-2">
          <RadioCard name="lang" checked={lang === 'en'} onChange={() => setLang('en')} title={t('settings.language.en')} />
          <RadioCard name="lang" checked={lang === 'kn'} onChange={() => setLang('kn')} title={<span lang="kn">{t('settings.language.kn')}</span>} hint={t('settings.language.knHint')} />
        </div>
      </fieldset>
    </SectionPanel>
  );
}

// ─────────────────────────── Backups ───────────────────────────

interface BackupFile {
  name: string;
  size: number;
  at: string;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function BackupsSection() {
  const t = useT();
  const qc = useQueryClient();
  const key = ['settings', 'backups'];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<BackupFile[]>('/backups') });
  const make = useMutation({
    mutationFn: () => api.post<BackupFile>('/backups', {}, { timeoutMs: 120_000 }),
    onSuccess: (f) => {
      toast.success(t('settings.backups.made', { name: f.name }));
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-5">
      <Panel
        title={t('settings.nav.backups')}
        subtitle={t('settings.backups.intro')}
        action={
          <Button variant="primary" icon={<HardDriveDownload className="h-4 w-4" />} loading={make.isPending} onClick={() => make.mutate()}>
            {t('settings.backups.makeNow')}
          </Button>
        }
      >
        <div className="space-y-2 text-sm text-ink-2">
          <p>{t('settings.backups.auto')}</p>
          <p className="rounded-md border border-accent/25 bg-accent-50 px-3 py-2 text-ink">{t('settings.backups.penDrive')}</p>
        </div>
      </Panel>
      <Panel title={t('settings.backups.list')} bodyClassName="p-0">
        {isLoading ? (
          <SkeletonRows className="p-4" rows={4} />
        ) : error ? (
          <EmptyState icon={<DatabaseBackup />} title={errorMessage(error)} />
        ) : !data?.length ? (
          <EmptyState icon={<DatabaseBackup />} title={t('settings.backups.none')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('settings.backups.made_at')}</th>
                  <th className="px-2 py-2 font-medium">{t('settings.backups.kind')}</th>
                  <th className="px-2 py-2 font-medium">{t('settings.backups.file')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('settings.backups.size')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((b) => (
                  <tr key={b.name}>
                    <td className="num px-4 py-2 whitespace-nowrap">{formatDateTime(b.at)}</td>
                    <td className="px-2 py-2">{b.name.includes('-manual') ? <Badge tone="brand">{t('settings.backups.manual_kind')}</Badge> : <Badge>{t('settings.backups.auto_kind')}</Badge>}</td>
                    <td className="px-2 py-2 font-mono text-[12px] text-ink-3">{b.name}</td>
                    <td className="num px-4 py-2 text-right">{fileSize(b.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
