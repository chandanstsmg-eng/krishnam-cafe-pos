import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Field, Select, Textarea } from './Field';
import { t } from '../../i18n';

interface ConfirmRequest {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  /** when set, the user must pick/enter a reason */
  reasons?: string[];
  resolve: (v: { ok: boolean; reason?: string }) => void;
}

const useConfirmStore = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

/**
 * Promise-based confirmation.
 *   if (await confirm({ title: 'Cancel this order?', ... })) ...
 */
export function confirm(o: Omit<ConfirmRequest, 'resolve' | 'confirmLabel' | 'cancelLabel'> & { confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return new Promise((resolve) =>
    useConfirmStore.setState({
      req: { confirmLabel: t('common.confirm'), cancelLabel: t('common.cancel'), ...o, resolve: (v) => resolve(v.ok) },
    }),
  );
}

/** Same, but asks for a reason. Resolves to the reason, or null if cancelled. */
export function confirmWithReason(o: Omit<ConfirmRequest, 'resolve' | 'confirmLabel' | 'cancelLabel' | 'reasons'> & { reasons: string[]; confirmLabel?: string; cancelLabel?: string }): Promise<string | null> {
  return new Promise((resolve) =>
    useConfirmStore.setState({
      req: { confirmLabel: t('common.confirm'), cancelLabel: t('common.cancel'), ...o, resolve: (v) => resolve(v.ok ? (v.reason ?? '') : null) },
    }),
  );
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const close = (ok: boolean) => {
    if (!req) return;
    const r = reason === '__other' ? other.trim() : reason;
    req.resolve({ ok, reason: r });
    useConfirmStore.setState({ req: null });
    setReason('');
    setOther('');
  };
  const needReason = !!req?.reasons?.length;
  const reasonOk = !needReason || (reason && (reason !== '__other' || other.trim().length > 2));
  return (
    <Dialog
      open={!!req}
      onClose={() => close(false)}
      title={req?.title}
      size="sm"
      footer={
        <>
          <Button onClick={() => close(false)} autoFocus={!req?.danger}>
            {req?.cancelLabel}
          </Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => close(true)} disabled={!reasonOk} autoFocus={!!req?.danger && !needReason}>
            {req?.confirmLabel}
          </Button>
        </>
      }
    >
      {req?.message && <div className="text-sm text-ink-2">{req.message}</div>}
      {needReason && (
        <div className="mt-4 space-y-3">
          <Field label={t('common.reason')} htmlFor="confirm-reason">
            <Select id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('common.chooseReason')}</option>
              {req!.reasons!.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value="__other">{t('common.other')}</option>
            </Select>
          </Field>
          {reason === '__other' && (
            <Field label={t('common.describe')} htmlFor="confirm-other">
              <Textarea id="confirm-other" value={other} onChange={(e) => setOther(e.target.value)} maxLength={180} autoFocus />
            </Field>
          )}
        </div>
      )}
    </Dialog>
  );
}
