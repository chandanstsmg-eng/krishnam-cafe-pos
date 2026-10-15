import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Phone, Plus, Search, Truck, X } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { Checkbox, Field, Input, Switch, Textarea } from '../../components/ui/Field';
import { EmptyState, Money, PageHeader, SkeletonRows } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatDateLong } from '../../../shared/dates';
import { SUPPLIERS_KEY, type Supplier } from './types';

export default function SuppliersPage() {
  const t = useT();
  const { data, isLoading } = useQuery({ queryKey: SUPPLIERS_KEY, queryFn: () => api.get<Supplier[]>('/suppliers') });
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [edit, setEdit] = useState<Supplier | 'new' | null>(null);

  const all = data ?? [];
  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  const visible = all.filter(
    (s) =>
      (showInactive || s.active) &&
      (!term || s.name.toLowerCase().includes(term) || (s.contactPerson ?? '').toLowerCase().includes(term) || (digits.length >= 3 && (s.phone ?? '').replace(/\D/g, '').includes(digits))),
  );
  const inactiveCount = all.filter((s) => !s.active).length;

  return (
    <div>
      <PageHeader
        title={t('suppliers.title')}
        subtitle={t('suppliers.subtitle')}
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>
            {t('suppliers.addSupplier')}
          </Button>
        }
      />
      <section className="rounded-lg border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2.5">
          <div className="relative min-w-52 flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('suppliers.searchPlaceholder')} aria-label={t('suppliers.searchPlaceholder')} className="pl-9" />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {inactiveCount > 0 && <Checkbox checked={showInactive} onChange={setShowInactive} label={`${t('suppliers.showInactive')} (${inactiveCount})`} />}
        </div>

        {isLoading ? (
          <SkeletonRows className="p-4" rows={6} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Truck />}
            title={t('suppliers.noSuppliers')}
            action={
              <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>
                {t('suppliers.addSupplier')}
              </Button>
            }
          >
            {t('suppliers.noSuppliersHint')}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState icon={<Search />} title={t('suppliers.noMatch')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('suppliers.colName')}</th>
                  <th className="px-2 py-2 font-medium">{t('suppliers.colPhone')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('suppliers.colItems')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('suppliers.colPaid')}</th>
                  <th className="px-2 py-2 font-medium">{t('suppliers.colLastPaid')}</th>
                  <th className="px-2 py-2 font-medium">{t('suppliers.colStatus')}</th>
                  <th className="w-12 px-2 py-2">
                    <span className="sr-only">{t('common.edit')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((s) => (
                  <tr key={s.id} className={cn('hover:bg-paper', !s.active && 'text-ink-3')}>
                    <td className="px-4 py-2">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => setEdit(s)}>
                        {s.name}
                      </button>
                      {(s.contactPerson || s.gstin) && (
                        <p className="text-[12px] text-ink-3">
                          {[s.contactPerson, s.gstin ? `GSTIN ${s.gstin}` : null].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {s.phone ? (
                        <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-10 items-center gap-1.5 rounded-md px-1 text-brand hover:underline" aria-label={t('suppliers.call', { name: s.name })}>
                          <Phone className="h-4 w-4" aria-hidden />
                          <span className="num">{s.phone}</span>
                        </a>
                      ) : (
                        <span className="text-ink-4">{t('suppliers.noPhone')}</span>
                      )}
                    </td>
                    <td className="num px-2 py-2 text-right">{s.items}</td>
                    <td className="num px-2 py-2 text-right font-semibold">
                      <Money value={s.totalPaid} />
                    </td>
                    <td className="px-2 py-2 text-ink-2">{s.lastPaid ? formatDateLong(s.lastPaid) : <span className="text-ink-4">{t('suppliers.never')}</span>}</td>
                    <td className="px-2 py-2">
                      <Badge size="sm" tone={s.active ? 'ok' : 'neutral'}>
                        {s.active ? t('suppliers.active') : t('suppliers.inactive')}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      <IconButton label={t('suppliers.edit', { name: s.name })} size="sm" onClick={() => setEdit(s)}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {all.length > 0 && <p className="border-t border-line px-4 py-2 text-[12px] text-ink-3">{t('suppliers.paidHint')}</p>}
      </section>

      <SupplierDialog state={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

interface Form {
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  gstin: string;
  notes: string;
  active: boolean;
}

const empty: Form = { name: '', contactPerson: '', phone: '', address: '', gstin: '', notes: '', active: true };

function SupplierDialog({ state, onClose }: { state: Supplier | 'new' | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState(state);
  if (state !== last) {
    setLast(state);
    setError(null);
    setForm(
      !state || state === 'new'
        ? empty
        : { name: state.name, contactPerson: state.contactPerson ?? '', phone: state.phone ?? '', address: state.address ?? '', gstin: state.gstin ?? '', notes: state.notes ?? '', active: state.active },
    );
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isNew = state === 'new';
  const phoneBad = form.phone.trim() !== '' && !/^[+\d\s-]{6,16}$/.test(form.phone.trim());
  const gstinBad = form.gstin.trim() !== '' && !/^[0-9A-Z]{15}$/.test(form.gstin.trim());
  const ok = form.name.trim() && !phoneBad && !gstinBad;

  const submit = async () => {
    if (!ok || !state) return;
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      gstin: form.gstin.trim() || null,
      notes: form.notes.trim() || null,
      active: form.active,
    };
    try {
      if (state === 'new') await api.post('/suppliers', body);
      else await api.patch(`/suppliers/${state.id}`, body);
      toast.success(isNew ? t('suppliers.created', { name: body.name }) : t('suppliers.saved', { name: body.name }));
      await qc.invalidateQueries({ queryKey: SUPPLIERS_KEY });
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
      size="lg"
      title={isNew ? t('suppliers.newSupplier') : t('suppliers.editSupplier')}
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
        <Field label={t('suppliers.name')} htmlFor="sp-name" className="sm:col-span-2">
          <Input id="sp-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder={t('suppliers.namePlaceholder')} autoFocus={isNew} />
        </Field>
        <Field label={t('suppliers.contactPerson')} htmlFor="sp-person" optional>
          <Input id="sp-person" value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} maxLength={60} />
        </Field>
        <Field label={t('suppliers.phone')} htmlFor="sp-phone" optional error={phoneBad ? t('suppliers.phoneInvalid') : null}>
          <Input id="sp-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={16} invalid={phoneBad} />
        </Field>
        <Field label={t('suppliers.address')} htmlFor="sp-addr" optional className="sm:col-span-2">
          <Textarea id="sp-addr" value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={240} className="min-h-16" />
        </Field>
        <Field label={t('suppliers.gstin')} htmlFor="sp-gst" optional hint={t('suppliers.gstinHint')} error={gstinBad ? t('suppliers.gstinInvalid') : null}>
          <Input id="sp-gst" value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().replace(/\s/g, ''))} maxLength={15} className="font-mono uppercase" invalid={gstinBad} />
        </Field>
        <Field label={t('suppliers.notes')} htmlFor="sp-notes" optional>
          <Input id="sp-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={400} placeholder={t('suppliers.notesPlaceholder')} />
        </Field>
        {!isNew && (
          <div className="sm:col-span-2">
            <Switch checked={form.active} onChange={(v) => set('active', v)} label={t('suppliers.activeLabel')} description={t('suppliers.activeHint')} />
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
