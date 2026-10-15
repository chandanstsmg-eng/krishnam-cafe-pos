import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Armchair, ArrowDown, ArrowUp, CalendarDays, CalendarPlus, Check, CheckCheck, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError, errorMessage, qs } from '../../api/client';
import { useCan } from '../auth/session';
import { useLive } from '../../hooks/useLive';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Switch, Textarea } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, SkeletonRows } from '../../components/ui/Misc';
import { Segmented, Tabs } from '../../components/ui/Segmented';
import { confirm } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { addDays, businessDate, formatDayShort } from '../../../shared/dates';

interface AdminTable {
  id: string;
  name: string;
  area: string | null;
  capacity: number;
  active: boolean;
  hold: 'NONE' | 'RESERVED' | 'CLEANING';
  openOrders?: number;
  sortOrder: number;
}

type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

interface Booking {
  id: string;
  customerName: string;
  phone: string | null;
  date: string;
  time: string;
  guests: number;
  tableId: string | null;
  tableName: string | null;
  notes: string | null;
  status: BookingStatus;
  createdAt: string;
}

const TABLES_KEY = ['floor', 'tables'] as const;

const fieldsOf = (err: unknown) => (err instanceof ApiError && err.fields ? err.fields : {});

/** "19:30" → "7:30 PM" */
function clock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export default function FloorPage() {
  const t = useT();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const canBook = can('tables.manage');
  const tab = params.get('tab') === 'bookings' && canBook ? 'bookings' : 'tables';

  return (
    <>
      <PageHeader title={t('floor.title')} subtitle={t('floor.subtitle')} />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => setParams(v === 'bookings' ? { tab: 'bookings' } : {}, { replace: true })}
        tabs={[{ value: 'tables' as const, label: t('floor.tabTables') }, ...(canBook ? [{ value: 'bookings' as const, label: t('floor.tabBookings') }] : [])]}
      />
      {tab === 'tables' ? <TablesTab /> : <BookingsTab />}
    </>
  );
}

// ─────────────────────────── Tables ───────────────────────────

function useTables() {
  useLive(['tables'], [[...TABLES_KEY]]);
  return useQuery({ queryKey: TABLES_KEY, queryFn: () => api.get<AdminTable[]>('/tables/admin') });
}

function holdBadge(tb: AdminTable, t: (k: string) => string) {
  if (!tb.active) return <Badge tone="neutral">{t('floor.turnedOff')}</Badge>;
  if (tb.openOrders) return <Badge tone="brand">{t('tables.occupied')}</Badge>;
  if (tb.hold === 'RESERVED') return <Badge tone="info">{t('tables.reserved')}</Badge>;
  if (tb.hold === 'CLEANING') return <Badge tone="warn">{t('tables.cleaning')}</Badge>;
  return <Badge tone="ok">{t('tables.available')}</Badge>;
}

function TablesTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const owner = can('settings.manage');
  const { data, isLoading, error } = useTables();
  const [editing, setEditing] = useState<AdminTable | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, AdminTable[]>();
    for (const tb of data ?? []) {
      const k = tb.area?.trim() || '';
      map.set(k, [...(map.get(k) ?? []), tb]);
    }
    return [...map.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : 0));
  }, [data]);
  const areas = useMemo(() => [...new Set((data ?? []).map((d) => d.area?.trim()).filter(Boolean) as string[])], [data]);

  const patch = async (tb: AdminTable, body: Partial<AdminTable>) => {
    setBusyId(tb.id);
    try {
      const next = await api.patch<AdminTable>(`/tables/${tb.id}`, body);
      // PATCH replies lack openOrders, so merge rather than replace.
      qc.setQueryData<AdminTable[]>(TABLES_KEY, (old) => old?.map((x) => (x.id === next.id ? { ...x, ...next } : x)));
      return next;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (tb: AdminTable, active: boolean) => {
    const next = await patch(tb, { active });
    if (next) toast.success(active ? t('floor.tableOn', { name: tb.name }) : t('floor.tableOff', { name: tb.name }));
  };

  const move = async (list: AdminTable[], i: number, dir: -1 | 1) => {
    const a = list[i];
    const b = list[i + dir];
    if (!a || !b) return;
    // Give each a distinct slot even if they had the same sortOrder.
    const sa = a.sortOrder === b.sortOrder ? b.sortOrder + dir : b.sortOrder;
    const sb = a.sortOrder;
    setBusyId(a.id);
    try {
      await api.patch(`/tables/${a.id}`, { sortOrder: sa });
      await api.patch(`/tables/${b.id}`, { sortOrder: sb });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: TABLES_KEY });
    }
  };

  const remove = async (tb: AdminTable) => {
    const ok = await confirm({ title: t('floor.deleteTitle', { name: tb.name }), message: t('floor.deleteMessage'), confirmLabel: t('common.delete'), danger: true });
    if (!ok) return;
    try {
      const r = await api.del<{ deleted: boolean; message?: string }>(`/tables/${tb.id}`);
      if (r.deleted) toast.success(t('floor.deleted', { name: tb.name }));
      else toast.info(r.message ?? t('floor.tableOff', { name: tb.name }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      void qc.invalidateQueries({ queryKey: TABLES_KEY });
    }
  };

  if (isLoading) return <SkeletonRows rows={8} />;
  if (error) return <EmptyState icon={<Armchair />} title={errorMessage(error)} />;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">{owner ? t('floor.offHint') : t('floor.onlyOwnerAdds')}</p>
        {owner && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            {t('floor.addTable')}
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Armchair />}
            title={t('floor.noTables')}
            action={
              owner && (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                  {t('floor.addTable')}
                </Button>
              )
            }
          >
            {t('floor.noTablesHint')}
          </EmptyState>
        </Panel>
      ) : (
        <div className="space-y-4">
          {groups.map(([area, list]) => {
            const on = list.filter((x) => x.active);
            return (
              <Panel key={area || '_'} title={area || t('floor.noArea')} subtitle={t('floor.tableCount', { n: on.length, seats: on.reduce((a, x) => a + x.capacity, 0) })} bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                      <tr>
                        <th className="px-4 py-2 font-medium">{t('floor.name')}</th>
                        <th className="px-2 py-2 text-right font-medium">{t('floor.seats')}</th>
                        <th className="px-4 py-2 font-medium">{t('floor.status')}</th>
                        <th className="px-2 py-2 font-medium">{t('common.active')}</th>
                        <th className="px-4 py-2 text-right font-medium">
                          <span className="sr-only">{t('common.edit')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {list.map((tb, i) => (
                        <tr key={tb.id} className={cn(!tb.active && 'text-ink-3')}>
                          <td className="px-4 py-2 font-semibold">{tb.name}</td>
                          <td className="num px-2 py-2 text-right">{tb.capacity}</td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {holdBadge(tb, t)}
                              {tb.active && tb.hold !== 'NONE' && (
                                <Button size="sm" variant="ghost" onClick={() => void patch(tb, { hold: 'NONE' })} disabled={busyId === tb.id}>
                                  {t('floor.clearHold')}
                                </Button>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-2">
                              <div className="-ml-4">
                                <Switch
                                  checked={tb.active}
                                  onChange={(v) => void toggle(tb, v)}
                                  disabled={busyId === tb.id}
                                  label={<span className="sr-only">{tb.active ? t('floor.turnOff', { name: tb.name }) : t('floor.turnOn', { name: tb.name })}</span>}
                                />
                              </div>
                              <span className="text-[13px] text-ink-3">{tb.active ? t('common.active') : t('floor.turnedOff')}</span>
                            </div>
                          </td>
                          <td className="px-4 py-1">
                            <div className="flex items-center justify-end gap-0.5">
                              <IconButton label={t('floor.moveUp', { name: tb.name })} disabled={i === 0 || !!busyId} onClick={() => void move(list, i, -1)}>
                                <ArrowUp className="h-4 w-4" />
                              </IconButton>
                              <IconButton label={t('floor.moveDown', { name: tb.name })} disabled={i === list.length - 1 || !!busyId} onClick={() => void move(list, i, 1)}>
                                <ArrowDown className="h-4 w-4" />
                              </IconButton>
                              <IconButton label={t('floor.edit', { name: tb.name })} onClick={() => setEditing(tb)}>
                                <Pencil className="h-4 w-4" />
                              </IconButton>
                              {owner && (
                                <IconButton tone="danger" label={t('floor.deleteTable', { name: tb.name })} onClick={() => void remove(tb)}>
                                  <Trash2 className="h-4 w-4" />
                                </IconButton>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <TableDialog value={editing} areas={areas} onClose={() => setEditing(null)} />
    </>
  );
}

function TableDialog({ value, areas, onClose }: { value: AdminTable | 'new' | null; areas: string[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const isNew = value === 'new';
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    setName(value === 'new' ? '' : value.name);
    setArea(value === 'new' ? (areas[0] ?? '') : (value.area ?? ''));
    setCapacity(value === 'new' ? '4' : String(value.capacity));
    setFields({});
    setError(null);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), area: area.trim() || null, capacity: Number(capacity) || 0 };
      return isNew ? api.post<AdminTable>('/tables', body) : api.patch<AdminTable>(`/tables/${(value as AdminTable).id}`, body);
    },
    onSuccess: (tb) => {
      toast.success(isNew ? t('floor.tableAdded', { name: tb.name }) : t('floor.tableSaved', { name: tb.name }));
      void qc.invalidateQueries({ queryKey: TABLES_KEY });
      onClose();
    },
    onError: (err) => {
      setFields(fieldsOf(err));
      setError(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={!!value}
      onClose={onClose}
      title={isNew ? t('floor.addTable') : t('floor.editTable')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="table-form" loading={save.isPending} disabled={!name.trim() || !(Number(capacity) > 0)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="table-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('floor.name')} htmlFor="tb-name" hint={t('floor.nameHint')} error={fields.name}>
          <Input id="tb-name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={12} autoFocus invalid={!!fields.name} />
        </Field>
        <Field label={t('floor.area')} htmlFor="tb-area" hint={t('floor.areaHint')} error={fields.area} optional>
          <Input id="tb-area" value={area} onChange={(e) => setArea(e.target.value)} maxLength={40} list="tb-areas" invalid={!!fields.area} />
          <datalist id="tb-areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label={t('floor.seats')} htmlFor="tb-cap" error={fields.capacity}>
          <Input id="tb-cap" className="max-w-28" inputMode="numeric" value={capacity} onChange={(e) => /^\d{0,2}$/.test(e.target.value) && setCapacity(e.target.value)} invalid={!!fields.capacity} />
        </Field>
        {error && !Object.keys(fields).length && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

// ─────────────────────────── Bookings ───────────────────────────

const statusTone: Record<BookingStatus, Tone> = { PENDING: 'warn', CONFIRMED: 'info', COMPLETED: 'ok', CANCELLED: 'neutral' };

function BookingsTab() {
  const t = useT();
  const qc = useQueryClient();
  const today = businessDate();
  const tomorrow = addDays(today, 1);
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<Booking | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const key = ['floor', 'bookings', date];
  useLive(['tables'], [key]);
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api.get<Booking[]>(`/reservations${qs({ from: date, to: date })}`) });
  const { data: tables } = useTables();

  const live = (data ?? []).filter((b) => b.status !== 'CANCELLED');
  const which = date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'other';

  const setStatus = async (b: Booking, status: BookingStatus) => {
    if (status === 'CANCELLED') {
      const ok = await confirm({
        title: t('floor.cancelTitle', { name: b.customerName }),
        message: t('floor.cancelMessage', { guests: b.guests, time: clock(b.time) }),
        confirmLabel: t('floor.cancelConfirm'),
        cancelLabel: t('floor.keep'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusyId(b.id);
    try {
      const next = await api.patch<Booking>(`/reservations/${b.id}`, { status });
      qc.setQueryData<Booking[]>(key, (old) => old?.map((x) => (x.id === next.id ? next : x)));
      const msg = status === 'CONFIRMED' ? 'floor.markedConfirmed' : status === 'COMPLETED' ? 'floor.markedArrived' : 'floor.markedCancelled';
      toast.success(t(msg, { name: b.customerName }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label={t('floor.day')}
          value={which}
          onChange={(v) => v !== 'other' && setDate(v === 'today' ? today : tomorrow)}
          options={[
            { value: 'today', label: t('floor.today') },
            { value: 'tomorrow', label: t('floor.tomorrow') },
            ...(which === 'other' ? [{ value: 'other' as const, label: formatDayShort(date) }] : []),
          ]}
        />
        <Input type="date" aria-label={t('floor.pickDate')} title={t('floor.pickDate')} value={date} onChange={(e) => setDate(e.target.value || today)} className="max-w-44" />
        <p className="text-sm text-ink-3">
          <span className="font-medium text-ink-2">{formatDayShort(date)}</span>
          {data && <> · {t('floor.dayCount', { n: live.length, g: live.reduce((a, b) => a + b.guests, 0) })}</>}
        </p>
        <Button className="ml-auto" variant="primary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          {t('floor.addBooking')}
        </Button>
      </div>

      <Panel bodyClassName="p-0">
        {isLoading ? (
          <SkeletonRows className="p-4" rows={5} />
        ) : error ? (
          <EmptyState icon={<CalendarDays />} title={errorMessage(error)} />
        ) : !data?.length ? (
          <EmptyState
            icon={<CalendarDays />}
            title={t('floor.noBookings')}
            action={
              <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                {t('floor.addBooking')}
              </Button>
            }
          >
            {t('floor.noBookingsHint')}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('floor.time')}</th>
                  <th className="px-2 py-2 font-medium">{t('floor.guestName')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('floor.guests')}</th>
                  <th className="px-3 py-2 font-medium">{t('floor.table')}</th>
                  <th className="px-2 py-2 font-medium">{t('floor.notes')}</th>
                  <th className="px-2 py-2 font-medium">{t('floor.bookingStatus')}</th>
                  <th className="px-4 py-2 text-right font-medium">
                    <span className="sr-only">{t('common.edit')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.map((b) => {
                  const done = b.status === 'COMPLETED' || b.status === 'CANCELLED';
                  return (
                    <tr key={b.id} className={cn(b.status === 'CANCELLED' && 'text-ink-3')}>
                      <td className="num px-4 py-2.5 font-semibold whitespace-nowrap">{clock(b.time)}</td>
                      <td className="px-2 py-2.5">
                        <span className={cn('block font-medium', b.status === 'CANCELLED' && 'line-through')}>{b.customerName}</span>
                        {b.phone && <span className="num text-[12px] text-ink-3">{b.phone}</span>}
                      </td>
                      <td className="num px-2 py-2.5 text-right">{b.guests}</td>
                      <td className="px-3 py-2.5">{b.tableName ?? <span className="text-ink-4">—</span>}</td>
                      <td className="max-w-[240px] px-2 py-2.5 text-ink-2">{b.notes ? <span className="line-clamp-2">{b.notes}</span> : <span className="text-ink-4">—</span>}</td>
                      <td className="px-2 py-2.5">
                        <Badge tone={statusTone[b.status]}>{t(`floor.${b.status}`)}</Badge>
                      </td>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {b.status === 'PENDING' && (
                            <Button size="sm" variant="subtle" icon={<Check className="h-4 w-4" />} disabled={busyId === b.id} onClick={() => void setStatus(b, 'CONFIRMED')}>
                              {t('floor.confirm')}
                            </Button>
                          )}
                          {!done && (
                            <Button size="sm" icon={<CheckCheck className="h-4 w-4" />} disabled={busyId === b.id} onClick={() => void setStatus(b, 'COMPLETED')}>
                              {t('floor.arrived')}
                            </Button>
                          )}
                          {!done && (
                            <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} disabled={busyId === b.id} onClick={() => void setStatus(b, 'CANCELLED')}>
                              {t('floor.cancelBooking')}
                            </Button>
                          )}
                          <IconButton size="sm" label={`${t('floor.editBooking')} — ${b.customerName}`} onClick={() => setEditing(b)}>
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <BookingDialog
        value={editing}
        defaultDate={date}
        tables={(tables ?? []).filter((x) => x.active)}
        onClose={() => setEditing(null)}
        onSaved={(b) => {
          setEditing(null);
          if (b.date !== date) setDate(b.date);
          void qc.invalidateQueries({ queryKey: ['floor', 'bookings'] });
        }}
      />
    </>
  );
}

function BookingDialog({ value, defaultDate, tables, onClose, onSaved }: { value: Booking | 'new' | null; defaultDate: string; tables: AdminTable[]; onClose: () => void; onSaved: (b: Booking) => void }) {
  const t = useT();
  const isNew = value === 'new';
  const blank = { customerName: '', phone: '', date: defaultDate, time: '19:30', guests: '2', tableId: '', notes: '' };
  const [f, setF] = useState(blank);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    setF(
      value === 'new'
        ? blank
        : { customerName: value.customerName, phone: value.phone ?? '', date: value.date, time: value.time, guests: String(value.guests), tableId: value.tableId ?? '', notes: value.notes ?? '' },
    );
    setFields({});
    setError(null);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const table = tables.find((x) => x.id === f.tableId);
  const guests = Number(f.guests) || 0;

  const save = useMutation({
    mutationFn: () => {
      const body = { customerName: f.customerName.trim(), phone: f.phone.trim() || null, date: f.date, time: f.time, guests, tableId: f.tableId || null, notes: f.notes.trim() || null };
      return isNew ? api.post<Booking>('/reservations', body) : api.patch<Booking>(`/reservations/${(value as Booking).id}`, body);
    },
    onSuccess: (b) => {
      toast.success(isNew ? t('floor.bookingAdded', { name: b.customerName }) : t('floor.bookingSaved'));
      onSaved(b);
    },
    onError: (err) => {
      setFields(fieldsOf(err));
      setError(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={!!value}
      onClose={onClose}
      title={isNew ? t('floor.addBooking') : t('floor.editBooking')}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="booking-form" loading={save.isPending} disabled={!f.customerName.trim() || !f.date || !f.time || guests < 1}>
            {t('floor.save')}
          </Button>
        </>
      }
    >
      <form
        id="booking-form"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('floor.guestName')} htmlFor="bk-name" error={fields.customerName}>
          <Input id="bk-name" value={f.customerName} onChange={(e) => set('customerName')(e.target.value)} maxLength={80} autoFocus invalid={!!fields.customerName} />
        </Field>
        <Field label={t('floor.phone')} htmlFor="bk-phone" error={fields.phone} optional>
          <Input id="bk-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone')(e.target.value)} maxLength={16} invalid={!!fields.phone} />
        </Field>
        <Field label={t('floor.date')} htmlFor="bk-date" error={fields.date}>
          <Input id="bk-date" type="date" value={f.date} onChange={(e) => set('date')(e.target.value)} invalid={!!fields.date} />
        </Field>
        <Field label={t('floor.time')} htmlFor="bk-time" error={fields.time}>
          <Input id="bk-time" type="time" step={300} value={f.time} onChange={(e) => set('time')(e.target.value)} invalid={!!fields.time} />
        </Field>
        <Field label={t('floor.guests')} htmlFor="bk-guests" error={fields.guests}>
          <Input id="bk-guests" inputMode="numeric" value={f.guests} onChange={(e) => /^\d{0,2}$/.test(e.target.value) && set('guests')(e.target.value)} invalid={!!fields.guests} />
        </Field>
        <Field label={t('floor.table')} htmlFor="bk-table" error={fields.tableId} hint={table && guests > table.capacity ? t('floor.tooSmall', { table: table.name, n: table.capacity }) : undefined} optional>
          <Select id="bk-table" value={f.tableId} onChange={(e) => set('tableId')(e.target.value)}>
            <option value="">{t('floor.anyTable')}</option>
            {tables.map((x) => (
              <option key={x.id} value={x.id}>
                {t('floor.tableSeats', { name: x.area ? `${x.name} (${x.area})` : x.name, n: x.capacity })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('floor.notes')} htmlFor="bk-notes" error={fields.notes} optional className="sm:col-span-2">
          <Textarea id="bk-notes" value={f.notes} onChange={(e) => set('notes')(e.target.value)} maxLength={240} placeholder={t('floor.notesPlaceholder')} />
        </Field>
        {error && !Object.keys(fields).length && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
