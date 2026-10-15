import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { requestApproval } from '../auth/Approval';
import { useCan } from '../auth/session';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Field, MoneyInput, Select, Input } from '../../components/ui/Field';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import type { InvoiceDTO } from '../../../shared/types';

export function RefundDialog({ invoice, onClose, onDone }: { invoice: InvoiceDTO | null; onClose: () => void; onDone: (inv: InvoiceDTO) => void }) {
  const t = useT();
  const can = useCan();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const left = invoice ? invoice.total - invoice.refunded : 0;

  useEffect(() => {
    if (!invoice) return;
    setAmount(rupeeInput(invoice.total - invoice.refunded));
    setMethod(invoice.payments[0]?.method ?? 'CASH');
    setReason('');
    setOther('');
  }, [invoice]);

  const reasons = [t('reasons.itemNotServed'), t('reasons.qualityComplaint'), t('reasons.overcharged'), t('reasons.customerCancelled')];
  const paise = toPaise(amount);
  const finalReason = reason === '__other' ? other.trim() : reason;
  const valid = paise > 0 && paise <= left && finalReason.length > 1;

  const submit = async () => {
    if (!invoice || !valid) return;
    let token: string | null = null;
    if (!can('refunds.create')) {
      token = await requestApproval('refunds.create', t('approval.refundReason', { amount: formatMoney(paise), n: invoice.number }));
      if (!token) return;
    }
    setBusy(true);
    try {
      const updated = await api.post<InvoiceDTO>(`/invoices/${invoice.id}/refund`, { amount: paise, method, reason: finalReason, approvalToken: token });
      toast.success(t('bills.refundDone', { amount: formatMoney(paise) }), method === 'CASH' ? t('bills.refundCashNote') : undefined);
      onDone(updated);
      onClose();
    } catch (err) {
      toast.error(t('bills.refundFailed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!invoice}
      onClose={onClose}
      title={invoice ? t('bills.refundTitle', { n: invoice.number }) : ''}
      description={invoice ? t('bills.refundLeft', { amount: formatMoney(left) }) : ''}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} disabled={!valid} loading={busy}>
            {t('bills.giveRefund')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('bills.refundAmount')} htmlFor="rf-amt" error={paise > left ? t('bills.refundTooMuch', { amount: formatMoney(left) }) : null}>
          <MoneyInput id="rf-amt" size="lg" value={amount} onValueChange={setAmount} invalid={paise > left} />
        </Field>
        <Field label={t('bills.refundMethod')} htmlFor="rf-method">
          <Select id="rf-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">{t('pay.cash')}</option>
            <option value="UPI">{t('pay.upi')}</option>
            <option value="CARD">{t('pay.card')}</option>
            <option value="BANK_TRANSFER">{t('pay.bank')}</option>
          </Select>
        </Field>
        <Field label={t('common.reason')} htmlFor="rf-reason">
          <Select id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('common.chooseReason')}</option>
            {reasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
            <option value="__other">{t('common.other')}</option>
          </Select>
        </Field>
        {reason === '__other' && <Input aria-label={t('common.describe')} value={other} onChange={(e) => setOther(e.target.value)} maxLength={180} autoFocus />}
      </div>
    </Dialog>
  );
}
