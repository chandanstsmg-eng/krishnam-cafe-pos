import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChefHat, KeyRound, LayoutDashboard, LogOut, MonitorSmartphone, UserRoundCog } from 'lucide-react';
import { DropdownMenu } from './ui/DropdownMenu';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { toast } from './ui/Toast';
import { signOut, useCan, useSession } from '../features/auth/session';
import { flush, resetPosSession } from '../services/sync';
import { usePos } from '../features/pos/store';
import { api, errorMessage } from '../api/client';
import { useT } from '../i18n';
import { PIN_LENGTH, PIN_RE, PIN_TYPING_RE } from '../../shared/pin';

export function UserMenu({ area }: { area: 'pos' | 'admin' | 'kitchen' }) {
  const t = useT();
  const navigate = useNavigate();
  const can = useCan();
  const user = useSession((s) => s.user);
  const [pwOpen, setPwOpen] = useState(false);
  if (!user) return null;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const switchUser = async () => {
    await flush();
    const { draft, dirty } = usePos.getState();
    if (draft && dirty && draft.items.length) {
      toast.warning(t('user.saveFirst'));
      return;
    }
    await signOut();
    resetPosSession();
    navigate('/login?switch=1');
  };

  const backOffice = can('reports.view') || can('menu.manage') || can('inventory.manage') || can('staff.manage') || can('settings.manage') || can('expenses.manage');
  const pos = can('orders.take') || can('payments.accept');

  return (
    <>
      <DropdownMenu
        label={t('user.menu')}
        trigger={({ toggle, open }) => (
          <button onClick={toggle} aria-expanded={open} className="flex h-9 items-center gap-2 rounded-md pr-2 pl-1 hover:bg-paper-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[12px] font-semibold text-white">{initials}</span>
            <span className="hidden text-left leading-tight lg:block">
              <span className="block text-[13px] font-medium">{user.name}</span>
              <span className="block text-[11px] text-ink-3">{user.roleName}</span>
            </span>
          </button>
        )}
        items={[
          ...(area !== 'admin' && backOffice ? [{ label: t('nav.backOffice'), icon: <LayoutDashboard />, onSelect: () => navigate('/admin') }] : []),
          ...(area !== 'pos' && pos ? [{ label: t('nav.openPos'), icon: <MonitorSmartphone />, onSelect: () => navigate('/pos/tables') }] : []),
          ...(area !== 'kitchen' && can('kitchen.view') ? [{ label: t('nav.kitchen'), icon: <ChefHat />, onSelect: () => navigate('/kitchen') }] : []),
          { label: t('user.changePassword'), icon: <KeyRound />, onSelect: () => setPwOpen(true) },
          'divider' as const,
          { label: t('user.switchUser'), icon: <UserRoundCog />, onSelect: () => void switchUser() },
          {
            label: t('user.signOut'),
            icon: <LogOut />,
            onSelect: async () => {
              await flush();
              await signOut();
              resetPosSession();
              navigate('/login');
            },
          },
        ]}
      />
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password', { currentPassword: cur, newPassword: next, ...(pin ? { newPin: pin } : {}) });
      toast.success(t('user.passwordChanged'));
      setCur('');
      setNext('');
      setPin('');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('user.changePassword')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!cur || next.length < 8 || (!!pin && !PIN_RE.test(pin))}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('user.currentPassword')} htmlFor="pw-cur">
          <Input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label={t('user.newPassword')} htmlFor="pw-new" hint={t('user.passwordHint')}>
          <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label={t('user.newPin')} htmlFor="pw-pin" optional hint={t('user.pinHint')}>
          <Input id="pw-pin" inputMode="numeric" autoComplete="off" value={pin} maxLength={PIN_LENGTH} onChange={(e) => PIN_TYPING_RE.test(e.target.value) && setPin(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
