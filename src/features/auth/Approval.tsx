import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Keypad, applyKey } from '../../components/ui/Keypad';
import { usePos } from '../pos/store';
import { t } from '../../i18n';
import { cn } from '../../utils/cn';
import type { PermissionKey } from '../../../shared/permissions';

interface Req {
  permission: PermissionKey;
  reason: string;
  resolve: (token: string | null) => void;
}
const useApproval = create<{ req: Req | null }>(() => ({ req: null }));

/**
 * Asks a manager to type their PIN on this screen. Resolves to a signed
 * approval token, or null if cancelled. Needs the server (the PIN is checked
 * there), so offline it explains and returns null.
 */
export function requestApproval(permission: PermissionKey, reason: string): Promise<string | null> {
  return new Promise((resolve) => useApproval.setState({ req: { permission, reason, resolve } }));
}

export function ApprovalHost() {
  const req = useApproval((s) => s.req);
  const offline = usePos((s) => s.connection === 'offline');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPin('');
    setError(null);
  }, [req]);

  const finish = (token: string | null) => {
    req?.resolve(token);
    useApproval.setState({ req: null });
  };

  const submit = async (value = pin) => {
    if (!req || value.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ token: string; approvedBy: string }>('/auth/approve', { pin: value, permission: req.permission, reason: req.reason });
      finish(r.token);
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => applyKey(p, e.key, 6));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') {
        e.preventDefault(); // don't also 'click' whatever button has focus
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Dialog open={!!req} onClose={() => finish(null)} title={t('approval.title')} size="sm">
      <div className="flex flex-col items-center text-center">
        <ShieldCheck className="h-8 w-8 text-brand" aria-hidden />
        <p className="mt-2 text-sm text-ink-2">{req?.reason}</p>
        {offline ? (
          <p className="mt-4 rounded-md bg-warn-50 px-3 py-2 text-sm text-warn">{t('approval.offline')}</p>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-ink-3">{t('approval.enterPin')}</p>
            <div className="my-3 flex gap-2.5" aria-label={t('approval.pinEntered', { n: pin.length })}>
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span key={i} className={cn('h-3.5 w-3.5 rounded-full border-2', i < pin.length ? 'border-brand bg-brand' : 'border-line-2')} />
              ))}
            </div>
            {error && (
              <p role="alert" className="mb-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Keypad size="md" className="w-full" onKey={(k) => setPin((p) => applyKey(p, k, 6))} />
            <Button variant="primary" size="lg" block className="mt-3" loading={busy} disabled={pin.length < 4} onClick={() => submit()}>
              {t('approval.approve')}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
