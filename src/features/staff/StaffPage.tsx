import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../api/client';
import { useSession } from '../auth/session';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Switch } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, SkeletonRows } from '../../components/ui/Misc';
import { Tabs } from '../../components/ui/Segmented';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatDateLong, formatDateTime } from '../../../shared/dates';
import { PIN_LENGTH, PIN_RE, PIN_TYPING_RE } from '../../../shared/pin';

interface StaffUser {
  id: string;
  name: string;
  username: string;
  phone: string | null;
  roleId: string;
  roleName: string;
  active: boolean;
  hasPin: boolean;
  joinedOn: string | null;
  lastLoginAt: string | null;
}

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  maxDiscountPercent: number;
  isSystem: boolean;
  users: number;
  permissions: string[];
}

interface Permission {
  key: string;
  label: string;
  group: string;
}

interface StaffData {
  users: StaffUser[];
  roles: Role[];
  permissions: Permission[];
}

const KEY = ['staff'];
const fieldsOf = (err: unknown) => (err instanceof ApiError && err.fields ? err.fields : {});

export default function StaffPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'roles' ? 'roles' : 'staff';
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: () => api.get<StaffData>('/staff') });

  return (
    <>
      <PageHeader title={t('staff.title')} subtitle={t('staff.subtitle')} />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => setParams(v === 'roles' ? { tab: 'roles' } : {}, { replace: true })}
        tabs={[
          { value: 'staff', label: t('staff.tabStaff'), count: data?.users.filter((u) => u.active).length },
          { value: 'roles', label: t('staff.tabRoles') },
        ]}
      />
      {isLoading ? (
        <SkeletonRows rows={8} />
      ) : error || !data ? (
        <EmptyState icon={<UsersRound />} title={errorMessage(error)} />
      ) : tab === 'staff' ? (
        <StaffList data={data} />
      ) : (
        <RolesMatrix data={data} />
      )}
    </>
  );
}

// ─────────────────────────── Staff list ───────────────────────────

function StaffList({ data }: { data: StaffData }) {
  const t = useT();
  const me = useSession((s) => s.user?.id);
  const [editing, setEditing] = useState<StaffUser | 'new' | null>(null);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          {t('staff.addStaff')}
        </Button>
      </div>
      <Panel bodyClassName="p-0">
        {data.users.length === 0 ? (
          <EmptyState icon={<UsersRound />} title={t('staff.noStaff')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('staff.name')}</th>
                  <th className="px-2 py-2 font-medium">{t('staff.username')}</th>
                  <th className="px-2 py-2 font-medium">{t('staff.role')}</th>
                  <th className="px-2 py-2 font-medium">{t('staff.phone')}</th>
                  <th className="px-2 py-2 font-medium">{t('staff.status')}</th>
                  <th className="px-2 py-2 font-medium">{t('staff.pin')}</th>
                  <th className="px-2 py-2 font-medium">{t('staff.lastSignIn')}</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">{t('staff.edit')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.users.map((u) => (
                  <tr key={u.id} className={cn(!u.active && 'text-ink-3')}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{u.name}</span>
                      {u.id === me && <span className="ml-2 text-[12px] text-ink-3">({t('staff.you')})</span>}
                      {u.joinedOn && <span className="block text-[12px] text-ink-3">{`${t('staff.joinedOn')} ${formatDateLong(u.joinedOn)}`}</span>}
                    </td>
                    <td className="px-2 py-2.5 font-mono text-[13px]">{u.username}</td>
                    <td className="px-2 py-2.5">{u.roleName}</td>
                    <td className="num px-2 py-2.5 text-ink-2">{u.phone || '—'}</td>
                    <td className="px-2 py-2.5">{u.active ? <Badge tone="ok">{t('staff.active')}</Badge> : <Badge tone="neutral">{t('staff.inactive')}</Badge>}</td>
                    <td className="px-2 py-2.5">
                      {u.hasPin ? (
                        <span className="inline-flex items-center gap-1 text-ink-2">
                          <KeyRound className="h-3.5 w-3.5" aria-hidden />
                          {t('staff.pinSet')}
                        </span>
                      ) : (
                        <span className="text-ink-4">{t('staff.noPin')}</span>
                      )}
                    </td>
                    <td className="num px-2 py-2.5 whitespace-nowrap text-ink-2">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-ink-4">{t('staff.never')}</span>}</td>
                    <td className="px-4 py-1.5 text-right">
                      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(u)} aria-label={t('staff.editStaff', { name: u.name })}>
                        {t('staff.edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <StaffDialog value={editing} roles={data.roles} isSelf={editing !== 'new' && !!editing && editing.id === me} onClose={() => setEditing(null)} />
    </>
  );
}

function StaffDialog({ value, roles, isSelf, onClose }: { value: StaffUser | 'new' | null; roles: Role[]; isSelf: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const isNew = value === 'new';
  const defaultRole = roles.find((r) => r.key === 'cashier')?.id ?? roles[0]?.id ?? '';
  const blank = { name: '', username: '', phone: '', roleId: defaultRole, password: '', pin: '', active: true, joinedOn: '' };
  const [f, setF] = useState(blank);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    setF(
      value === 'new'
        ? blank
        : { name: value.name, username: value.username, phone: value.phone ?? '', roleId: value.roleId, password: '', pin: '', active: value.active, joinedOn: value.joinedOn ?? '' },
    );
    setFields({});
    setError(null);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        username: f.username.trim().toLowerCase(),
        phone: f.phone.trim() || null,
        roleId: f.roleId,
        joinedOn: f.joinedOn || null,
      };
      if (f.password) body.password = f.password;
      if (f.pin) body.pin = f.pin;
      if (!isNew) body.active = f.active;
      return isNew ? api.post('/staff', body) : api.patch(`/staff/${(value as StaffUser).id}`, body);
    },
    onSuccess: () => {
      toast.success(isNew ? t('staff.added', { name: f.name.trim() }) : t('staff.saved', { name: f.name.trim() }));
      void qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
    onError: (err) => {
      setFields(fieldsOf(err));
      setError(errorMessage(err));
    },
  });

  const pwShort = f.password.length > 0 && f.password.length < 8;
  const pinBad = f.pin.length > 0 && !PIN_RE.test(f.pin);
  const canSave = f.name.trim() && f.username.trim().length >= 3 && f.roleId && (!isNew || f.password.length >= 8) && !pwShort && !pinBad;

  return (
    <Dialog
      open={!!value}
      onClose={onClose}
      title={isNew ? t('staff.addStaff') : t('staff.editStaff', { name: (value as StaffUser | null)?.name ?? '' })}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="staff-form" loading={save.isPending} disabled={!canSave}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="staff-form"
        className="grid gap-3 sm:grid-cols-2"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate();
        }}
      >
        <Field label={t('staff.name')} htmlFor="st-name" error={fields.name}>
          <Input id="st-name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={60} autoFocus invalid={!!fields.name} />
        </Field>
        <Field label={t('staff.username')} htmlFor="st-user" hint={t('staff.usernameHint')} error={fields.username}>
          <Input id="st-user" value={f.username} onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))} maxLength={30} autoCapitalize="none" spellCheck={false} invalid={!!fields.username} />
        </Field>
        <Field label={t('staff.role')} htmlFor="st-role" error={fields.roleId}>
          <Select id="st-role" value={f.roleId} onChange={(e) => set('roleId', e.target.value)} disabled={isSelf}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('staff.phone')} htmlFor="st-phone" error={fields.phone} optional>
          <Input id="st-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={16} invalid={!!fields.phone} />
        </Field>
        <Field
          label={t('staff.passwordNew')}
          htmlFor="st-pw"
          hint={isNew ? t('staff.passwordHintCreate') : t('staff.passwordHintEdit')}
          error={fields.password ?? (pwShort ? t('user.passwordHint') : null)}
          optional={!isNew}
        >
          <Input id="st-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} maxLength={200} invalid={!!fields.password || pwShort} />
        </Field>
        <Field label={t('staff.pinLabel')} htmlFor="st-pin" hint={isNew ? t('staff.pinHintCreate') : t('staff.pinHintEdit')} error={fields.pin ?? (pinBad ? t('user.pinHint') : null)} optional>
          <Input
            id="st-pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={f.pin}
            maxLength={PIN_LENGTH}
            onChange={(e) => PIN_TYPING_RE.test(e.target.value) && set('pin', e.target.value)}
            className="max-w-36"
            invalid={!!fields.pin || pinBad}
          />
        </Field>
        <Field label={t('staff.joinedOn')} htmlFor="st-joined" error={fields.joinedOn} optional>
          <Input id="st-joined" type="date" value={f.joinedOn} onChange={(e) => set('joinedOn', e.target.value)} className="max-w-48" />
        </Field>
        {!isNew && (
          <div className="sm:col-span-2">
            <Switch checked={f.active} onChange={(v) => set('active', v)} label={t('staff.canSignIn')} description={t('staff.canSignInHint')} disabled={isSelf} />
          </div>
        )}
        {error && !Object.keys(fields).length && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

// ─────────────────────────── Roles & permissions ───────────────────────────

interface Draft {
  permissions: string[];
  maxDiscountPercent: string;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function RolesMatrix({ data }: { data: StaffData }) {
  const t = useT();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Role | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Permission[]>();
    for (const p of data.permissions) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [data.permissions]);

  const current = (r: Role): Draft => drafts[r.id] ?? { permissions: r.permissions, maxDiscountPercent: String(r.maxDiscountPercent) };
  const isDirty = (r: Role) => {
    const d = drafts[r.id];
    return !!d && (!same(d.permissions, r.permissions) || Number(d.maxDiscountPercent) !== r.maxDiscountPercent);
  };

  const update = (r: Role, next: Partial<Draft>) => {
    setDrafts((s) => ({ ...s, [r.id]: { ...current(r), ...next } }));
    setErrors((e) => ({ ...e, [r.id]: '' }));
  };

  const toggle = (r: Role, key: string, on: boolean) => {
    const perms = current(r).permissions;
    update(r, { permissions: on ? [...perms, key] : perms.filter((k) => k !== key) });
  };

  const reset = (r: Role) => {
    setDrafts(({ [r.id]: _drop, ...rest }) => rest);
    setErrors((e) => ({ ...e, [r.id]: '' }));
  };

  const save = async (r: Role) => {
    const d = current(r);
    const pct = Number(d.maxDiscountPercent);
    setSaving(r.id);
    try {
      await api.patch(`/roles/${r.id}`, { permissions: d.permissions, maxDiscountPercent: Number.isFinite(pct) ? Math.round(pct) : 0 });
      await qc.invalidateQueries({ queryKey: KEY });
      reset(r);
      toast.success(t('staff.roleSaved', { role: r.name }));
    } catch (err) {
      const msg = errorMessage(err);
      setErrors((e) => ({ ...e, [r.id]: msg }));
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  const roles = data.roles;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl text-sm text-ink-3">
          <p>{t('staff.matrixHint')}</p>
          <p className="mt-1 inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-ink-4" aria-hidden />
            {t('staff.adminNote')}
          </p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
          {t('staff.addRole')}
        </Button>
      </div>

      <Panel bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ minWidth: 260 + roles.length * 130 }}>
            <thead>
              <tr className="border-b border-line bg-paper align-bottom">
                <th scope="col" className="sticky left-0 z-10 min-w-40 bg-paper px-4 py-3 sm:w-64 sm:min-w-56 text-left text-[12px] font-medium tracking-wide text-ink-3 uppercase">
                  {t('staff.permission')}
                </th>
                {roles.map((r) => (
                  <th key={r.id} scope="col" className="min-w-[130px] border-l border-line px-3 py-3 text-left align-bottom font-normal">
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{r.name}</p>
                        <p className="text-[12px] text-ink-3">{r.users === 1 ? t('staff.onePerson') : t('staff.peopleCount', { n: r.users })}</p>
                      </div>
                      <IconButton size="sm" label={t('staff.editRole', { role: r.name })} onClick={() => setRenaming(r)} className="-mt-1 -mr-1">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                    {r.description && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-3">{r.description}</p>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, perms]) => (
                <Fragment key={group}>
                  <tr className="bg-paper-2/60">
                    <th colSpan={roles.length + 1} scope="colgroup" className="px-4 py-1.5 text-left text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                      {t(`staff.group.${group}`)}
                    </th>
                  </tr>
                  {perms.map((p) => (
                    <tr key={p.key} className="border-b border-line hover:bg-paper/60">
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal text-ink">
                        {p.label}
                      </th>
                      {roles.map((r) => {
                        const on = current(r).permissions.includes(p.key);
                        const changed = on !== r.permissions.includes(p.key);
                        return (
                          <td key={r.id} className={cn('border-l border-line p-0 text-center', changed && 'bg-accent-50')}>
                            <label className="flex h-10 cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => toggle(r, p.key, e.target.checked)}
                                aria-label={t('staff.allowFor', { perm: p.label, role: r.name })}
                                className="h-[18px] w-[18px] rounded border-line-2 accent-brand"
                              />
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-b border-line bg-paper/50">
                <th scope="row" className="sticky left-0 z-10 bg-paper px-4 py-2.5 text-left font-medium text-ink">
                  {t('staff.maxDiscount')}
                  <span className="block text-[12px] font-normal text-ink-3">{t('staff.maxDiscountHint')}</span>
                </th>
                {roles.map((r) => {
                  const v = current(r).maxDiscountPercent;
                  const changed = Number(v) !== r.maxDiscountPercent;
                  return (
                    <td key={r.id} className={cn('border-l border-line px-3 py-2', changed && 'bg-accent-50')}>
                      <div className="flex items-center gap-1.5">
                        <Input
                          inputMode="numeric"
                          aria-label={t('staff.maxDiscountFor', { role: r.name })}
                          value={v}
                          onChange={(e) => /^\d{0,3}$/.test(e.target.value) && Number(e.target.value || 0) <= 100 && update(r, { maxDiscountPercent: e.target.value })}
                          className="num max-w-16 text-right"
                        />
                        <span className="text-ink-3">%</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="sticky left-0 z-10 bg-surface" />
                {roles.map((r) => {
                  const dirty = isDirty(r);
                  return (
                    <td key={r.id} className="border-l border-line px-3 py-3 align-top">
                      <div className="flex flex-col gap-1.5">
                        <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={saving === r.id} onClick={() => void save(r)} aria-label={`${t('staff.saveRole')} — ${r.name}`}>
                          {t('staff.saveRole')}
                        </Button>
                        {dirty && (
                          <button type="button" className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => reset(r)}>
                            {t('staff.reset')}
                          </button>
                        )}
                        {errors[r.id] && (
                          <p role="alert" className="text-[12px] leading-snug text-danger">
                            {errors[r.id]}
                          </p>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      <AddRoleDialog open={adding} roles={roles} onClose={() => setAdding(false)} />
      <RenameRoleDialog role={renaming} onClose={() => setRenaming(null)} />
    </>
  );
}

function AddRoleDialog({ open, roles, onClose }: { open: boolean; roles: Role[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pct, setPct] = useState('0');
  const [copyFrom, setCopyFrom] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setPct('0');
      setCopyFrom(roles.find((r) => r.key === 'cashier')?.id ?? '');
      setFields({});
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () =>
      api.post('/roles', {
        name: name.trim(),
        description: description.trim() || null,
        maxDiscountPercent: Number(pct) || 0,
        permissions: roles.find((r) => r.id === copyFrom)?.permissions ?? [],
      }),
    onSuccess: () => {
      toast.success(t('staff.roleAdded', { role: name.trim() }));
      void qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
    onError: (err) => {
      setFields(fieldsOf(err));
      setError(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('staff.addRole')}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="role-form" loading={save.isPending} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="role-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <Field label={t('staff.roleName')} htmlFor="rl-name" error={fields.name}>
          <Input id="rl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus invalid={!!fields.name} />
        </Field>
        <Field label={t('staff.roleDescription')} htmlFor="rl-desc" error={fields.description} optional>
          <Input id="rl-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('staff.copyFrom')} htmlFor="rl-copy">
          <Select id="rl-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">{t('staff.startEmpty')}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('staff.maxDiscount')} htmlFor="rl-pct" hint={t('staff.maxDiscountHint')} error={fields.maxDiscountPercent}>
          <div className="flex items-center gap-1.5">
            <Input id="rl-pct" inputMode="numeric" value={pct} onChange={(e) => /^\d{0,3}$/.test(e.target.value) && Number(e.target.value || 0) <= 100 && setPct(e.target.value)} className="num max-w-20 text-right" />
            <span className="text-ink-3">%</span>
          </div>
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

function RenameRoleDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role) {
      setName(role.name);
      setDescription(role.description ?? '');
      setFields({});
      setError(null);
    }
  }, [role]);

  const save = useMutation({
    mutationFn: () => api.patch(`/roles/${role!.id}`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: () => {
      toast.success(t('staff.roleSaved', { role: name.trim() }));
      void qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
    onError: (err) => {
      setFields(fieldsOf(err));
      setError(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={!!role}
      onClose={onClose}
      title={t('staff.editRole', { role: role?.name ?? '' })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="rename-role-form" loading={save.isPending} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="rename-role-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <Field label={t('staff.roleName')} htmlFor="rr-name" error={fields.name}>
          <Input id="rr-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus invalid={!!fields.name} />
        </Field>
        <Field label={t('staff.roleDescription')} htmlFor="rr-desc" error={fields.description} optional>
          <Input id="rr-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} />
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
