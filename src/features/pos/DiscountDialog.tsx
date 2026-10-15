import { useEffect, useState } from 'react';
import { usePos } from './store';
import { setDiscount } from './draft';
import { billFor } from '../../services/sync';
import { useSession, useCan } from '../auth/session';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Field, Input, MoneyInput, Select } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Segmented';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import { discountAmount } from '../../../shared/billing';

const PRESETS = [5, 10, 15, 20];

export function DiscountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const can = useCan();
  const user = useSession((s) => s.user);
  const draft = usePos((s) => s.draft);
  const [type, setType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setType(draft?.discount?.type ?? 'PERCENT');
    setValue(draft?.discount ? (draft.discount.type === 'PERCENT' ? String(draft.discount.value) : rupeeInput(draft.discount.value)) : '');
    setReason(draft?.discount?.reason ?? '');
  }, [open, draft?.discount]);

  if (!draft) return null;
  const subtotal = billFor({ items: draft.items, discount: null }).subtotal;
  const disc = { type, value: type === 'PERCENT' ? Math.min(100, Number(value) || 0) : toPaise(value) };
  const amount = discountAmount(subtotal, disc);
  const pct = subtotal ? (amount / subtotal) * 100 : 0;
  const limit = can('discounts.apply') ? (user?.maxDiscountPercent ?? 0) : 0;
  const needsApproval = amount > 0 && pct > limit + 0.001;
  const reasons = [t('reasons.regularCustomer'), t('reasons.staffMeal'), t('reasons.lateService'), t('reasons.bulkOrder'), t('reasons.complaint'), t('reasons.ownerApproved')];

  const apply = () => {
    setDiscount(amount > 0 ? { ...disc, reason: reason || null } : null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('pos.discount')}
      size="sm"
      footer={
        <>
          {draft.discount && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => {
                setDiscount(null);
                onClose();
              }}
            >
              {t('pos.removeDiscount')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={apply} disabled={amount <= 0}>
            {t('pos.applyDiscount')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          label={t('pos.discountType')}
          block
          value={type}
          onChange={(v) => {
            setType(v);
            setValue('');
          }}
          options={[
            { value: 'PERCENT', label: t('pos.percent') },
            { value: 'AMOUNT', label: t('pos.flatAmount') },
          ]}
        />
        {type === 'PERCENT' ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setValue(String(p))}
                  className={cn('h-11 rounded-md border text-[15px] font-medium', Number(value) === p ? 'border-brand bg-brand-50 text-brand ring-1 ring-brand' : 'border-line-2 hover:bg-paper')}
                >
                  {p}%
                </button>
              ))}
            </div>
            <Field label={t('pos.otherPercent')} htmlFor="disc-pct">
              <Input id="disc-pct" inputMode="decimal" value={value} onChange={(e) => /^\d{0,3}(\.\d{0,2})?$/.test(e.target.value) && setValue(e.target.value)} placeholder="0" />
            </Field>
          </>
        ) : (
          <Field label={t('pos.discountAmount')} htmlFor="disc-amt">
            <MoneyInput id="disc-amt" value={value} onValueChange={setValue} size="lg" autoFocus />
          </Field>
        )}
        <Field label={t('common.reason')} htmlFor="disc-reason" optional>
          <Select id="disc-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('common.chooseReason')}</option>
            {reasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <div className="rounded-md bg-paper px-3 py-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-2">{t('billing.subtotal')}</span>
            <span className="num">{formatMoney(subtotal)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>{t('billing.discount')}</span>
            <span className="num">−{formatMoney(amount)}</span>
          </div>
        </div>
        {needsApproval && <p className="rounded-md bg-warn-50 px-3 py-2 text-[13px] text-warn">{limit ? t('pos.discountOverLimit', { n: limit }) : t('pos.discountNeedsApproval')}</p>}
      </div>
    </Dialog>
  );
}
