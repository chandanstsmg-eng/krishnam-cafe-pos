import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Banknote, CheckCircle2, CloudOff, CreditCard, Landmark, Plus, Printer, QrCode, Split, Trash2, UserPlus } from 'lucide-react';
import { usePos } from '../pos/store';
import { prepareForPayment } from '../pos/orderActions';
import { billFor, payDraft, refresh } from '../../services/sync';
import { printReceipt } from '../../services/print';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Field, Input, MoneyInput, Select } from '../../components/ui/Field';
import { Keypad, applyKey } from '../../components/ui/Keypad';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, rupeeInput, toPaise } from '../../../shared/money';
import { settle, type PayMethod, type PaymentInput } from '../../../shared/billing';
import type { InvoiceDTO, OrderType } from '../../../shared/types';

export type PayTab = PayMethod | 'SPLIT';

interface SplitRow {
  method: PayMethod;
  amount: string;
  reference: string;
}

/** Notes a customer is likely to hand over for this amount. */
function suggestions(total: number, extra: number[]) {
  const s = new Set<number>([total]);
  for (const step of [5000, 10000, 20000, 50000, 200000]) {
    const up = Math.ceil(total / step) * step;
    if (up > total) s.add(up);
  }
  for (const e of extra) if (e > total) s.add(e);
  return [...s].sort((a, b) => a - b).slice(0, 5);
}

export function PaymentDialog({ tab, onClose }: { tab: PayTab | null; onClose: (paidType?: OrderType) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const draft = usePos((s) => s.draft);
  const settings = usePos((s) => s.boot?.settings);
  const receiptPrinter = usePos((s) => s.boot?.printers.find((p) => p.id === 'receipt'));
  const [method, setMethod] = useState<PayTab>('CASH');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [split, setSplit] = useState<SplitRow[]>([]);
  const [showCustomer, setShowCustomer] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [phase, setPhase] = useState<'prep' | 'enter' | 'busy' | 'done'>('prep');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [done, setDone] = useState<{ invoice: InvoiceDTO; offline: boolean; change: number; type: OrderType } | null>(null);
  const [printed, setPrinted] = useState(false);
  const receivedRef = useRef<HTMLInputElement>(null);

  const bill = useMemo(() => (draft ? billFor(draft) : null), [draft]);
  const total = bill?.total ?? 0;

  // Opening: save pending edits (and collect approvals) first.
  useEffect(() => {
    if (!tab) return;
    setMethod(tab);
    setReceived('');
    setReference('');
    setError(null);
    setDone(null);
    setPrinted(false);
    setShowCustomer(false);
    setCustName(draft?.customerName ?? '');
    setCustPhone(draft?.customerPhone ?? '');
    setPhase('prep');
    void prepareForPayment().then((r) => {
      if (r !== 'ok') onClose();
      else setPhase('enter');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (method === 'SPLIT' && bill) {
      const half = Math.round(bill.total / 2 / 100) * 100;
      setSplit([
        { method: 'CASH', amount: rupeeInput(half), reference: '' },
        { method: 'UPI', amount: rupeeInput(bill.total - half), reference: '' },
      ]);
    }
  }, [method, bill?.total]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'enter' && method === 'CASH') setTimeout(() => receivedRef.current?.focus(), 30);
  }, [phase, method]);

  const receivedPaise = received ? toPaise(received) : total;
  const change = Math.max(0, receivedPaise - total);
  const splitPayments: PaymentInput[] = split.map((r) => ({ method: r.method, amount: toPaise(r.amount), reference: r.reference || null }));
  const splitState = settle(total, splitPayments);

  const payments: PaymentInput[] | null = (() => {
    if (method === 'CASH') return receivedPaise >= total ? [{ method: 'CASH', amount: total, tendered: receivedPaise }] : null;
    if (method === 'SPLIT') return splitState.due === 0 && splitState.over === 0 && splitPayments.every((p) => p.amount > 0) ? splitPayments : null;
    return [{ method, amount: total, reference: reference.trim() || null }];
  })();

  const phoneOk = !custPhone || custPhone.replace(/\D/g, '').length === 10;

  const complete = async () => {
    if (!payments || phase !== 'enter' || !draft || !phoneOk) return;
    setPhase('busy');
    setError(null);
    const type = draft.type;
    const r = await payDraft(payments, { name: custName.trim() || null, phone: custPhone.replace(/\D/g, '') || null });
    if (!r.ok) {
      setError({ message: r.error, code: r.code });
      setPhase('enter');
      if (r.code === 'TOTAL_CHANGED') void refresh();
      return;
    }
    const ch = payments.reduce((a, p) => a + (p.tendered ? p.tendered - p.amount : 0), 0);
    setDone({ invoice: r.invoice, offline: r.offline, change: ch, type });
    setPhase('done');
    if (receiptPrinter?.enabled && receiptPrinter.autoPrint) {
      setPrinted(true);
      void printReceipt(r.invoice);
    }
  };

  // Keyboard: digits go to "amount received", Enter completes.
  useEffect(() => {
    if (!tab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        if (phase === 'done') {
          e.preventDefault();
          finish();
        } else if (phase === 'enter' && !(e.target instanceof HTMLSelectElement)) {
          e.preventDefault();
          void complete();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finish = () => {
    const type = done?.type;
    setPhase('prep');
    onClose(type);
  };

  if (!tab) return <Dialog open={false} onClose={() => onClose()} />;

  const methods: { value: PayTab; label: string; icon: React.ReactNode }[] = [
    { value: 'CASH', label: t('pay.cash'), icon: <Banknote className="h-4 w-4" /> },
    { value: 'UPI', label: t('pay.upi'), icon: <QrCode className="h-4 w-4" /> },
    { value: 'CARD', label: t('pay.card'), icon: <CreditCard className="h-4 w-4" /> },
    { value: 'BANK_TRANSFER', label: t('pay.bank'), icon: <Landmark className="h-4 w-4" /> },
    { value: 'SPLIT', label: t('pay.split'), icon: <Split className="h-4 w-4" /> },
  ];

  // ── Paid ──
  if (phase === 'done' && done) {
    return (
      <Dialog open onClose={finish} size="md" dismissible>
        <div className="flex flex-col items-center py-4 text-center">
          <CheckCircle2 className="h-14 w-14 text-ok" aria-hidden />
          <h2 className="mt-3 text-xl font-semibold">{t('pay.complete')}</h2>
          <p className="mt-1 text-sm text-ink-3">
            {t('pay.billNo', { n: done.invoice.number })} · <span className="num">{formatMoney(done.invoice.total)}</span>
          </p>
          {done.change > 0 && (
            <div className="mt-5 w-full rounded-lg border-2 border-ok/30 bg-ok-50 px-6 py-4" role="status">
              <p className="text-sm font-medium text-ok">{t('pay.returnChange')}</p>
              <p className="num text-[44px] leading-tight font-bold text-ink">{formatMoney(done.change)}</p>
            </div>
          )}
          {done.offline && (
            <p className="mt-4 flex items-center gap-2 rounded-md bg-warn-50 px-3 py-2 text-[13px] text-warn">
              <CloudOff className="h-4 w-4" aria-hidden />
              {t('pay.savedOffline')}
            </p>
          )}
          <div className="mt-6 grid w-full grid-cols-2 gap-2">
            <Button
              size="xl"
              icon={<Printer className="h-5 w-5" />}
              onClick={() => {
                setPrinted(true);
                void printReceipt(done.invoice);
              }}
            >
              {printed ? t('pay.printAgain') : t('pay.printReceipt')}
            </Button>
            <Button size="xl" variant="primary" onClick={finish} data-autofocus>
              {done.type === 'DINE_IN' ? t('pay.backToTables') : t('pay.nextOrder')}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ── Taking payment ──
  return (
    <Dialog open onClose={() => phase !== 'busy' && onClose()} title={t('pay.title')} size="xl" dismissible={phase !== 'busy'} bodyClassName="p-0">
      <div className="grid md:grid-cols-[1fr_1.25fr]">
        {/* Amount due */}
        <div className="flex flex-col border-b border-line bg-paper/60 p-4 sm:p-5 md:border-r md:border-b-0">
          <p className="text-sm text-ink-3">{draft?.tableName ? t('pos.tableN', { n: draft.tableName }) : t(`orderType.${draft?.type ?? 'TAKEAWAY'}`)}</p>
          <p className="mt-2 text-[13px] font-medium tracking-wide text-ink-3 uppercase sm:mt-4">{t('pay.amountDue')}</p>
          <p className="num text-[38px] leading-none font-bold tracking-tight sm:text-[46px]">{formatMoney(total)}</p>
          {bill && (
            <dl className="mt-3 space-y-1 text-sm sm:mt-5">
              <div className="flex justify-between text-ink-2">
                <dt>{t('pay.items', { n: bill.itemCount })}</dt>
                <dd className="num">{formatMoney(bill.subtotal)}</dd>
              </div>
              {bill.discount > 0 && (
                <div className="flex justify-between text-ink-2">
                  <dt>{t('billing.discount')}</dt>
                  <dd className="num">−{formatMoney(bill.discount)}</dd>
                </div>
              )}
              {bill.tax > 0 && (
                <div className="flex justify-between text-ink-2">
                  <dt>{bill.taxInclusive ? t('billing.taxIncluded') : t('billing.tax')}</dt>
                  <dd className="num">{formatMoney(bill.tax)}</dd>
                </div>
              )}
              {bill.roundOff !== 0 && (
                <div className="flex justify-between text-ink-3">
                  <dt>{t('billing.roundOff')}</dt>
                  <dd className="num">{formatMoney(bill.roundOff, { decimals: 'always' })}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="mt-auto pt-3 sm:pt-5">
            {!showCustomer ? (
              <button onClick={() => setShowCustomer(true)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
                <UserPlus className="h-4 w-4" aria-hidden />
                {custName || custPhone ? [custName, custPhone].filter(Boolean).join(' · ') : t('pay.addCustomer')}
              </button>
            ) : (
              <div className="space-y-2">
                <Input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder={t('pos.customerName')} aria-label={t('pos.customerName')} maxLength={80} />
                <Input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder={t('pos.customerPhone')} aria-label={t('pos.customerPhone')} inputMode="tel" maxLength={14} invalid={!phoneOk} />
              </div>
            )}
          </div>
        </div>

        {/* Method */}
        <div className="p-4 sm:p-5">
          <div role="tablist" aria-label={t('pay.method')} className="mb-4 grid grid-cols-5 gap-1.5">
            {methods.map((m) => (
              <button
                key={m.value}
                role="tab"
                aria-selected={method === m.value}
                onClick={() => {
                  setMethod(m.value);
                  setError(null);
                  setReference('');
                }}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[12px] font-medium transition-colors',
                  method === m.value ? 'border-brand bg-brand text-white' : 'border-line-2 text-ink-2 hover:bg-paper',
                )}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {method === 'CASH' && (
            <div className="space-y-3">
              <Field label={t('pay.amountReceived')} htmlFor="cash-in" hint={received ? undefined : t('pay.exactHint')}>
                <MoneyInput ref={receivedRef} id="cash-in" size="xl" value={received} onValueChange={setReceived} placeholder={rupeeInput(total)} invalid={!!received && receivedPaise < total} />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {suggestions(total, settings?.pos.quickCash ?? []).map((v) => (
                  <button
                    key={v}
                    onClick={() => setReceived(rupeeInput(v))}
                    className={cn('num h-10 rounded-md border px-3.5 text-sm font-medium', receivedPaise === v && received ? 'border-brand bg-brand-50 text-brand' : 'border-line-2 hover:bg-paper')}
                  >
                    {v === total ? t('pay.exact') : formatMoney(v)}
                  </button>
                ))}
              </div>
              <div className={cn('flex items-center justify-between rounded-lg px-4 py-3', receivedPaise < total ? 'bg-danger-50' : change > 0 ? 'bg-ok-50' : 'bg-paper')}>
                <span className={cn('text-[15px] font-medium', receivedPaise < total ? 'text-danger' : 'text-ink-2')}>{receivedPaise < total ? t('pay.stillDue') : t('pay.change')}</span>
                <span className="num text-[30px] leading-none font-bold">{formatMoney(receivedPaise < total ? total - receivedPaise : change)}</span>
              </div>
              <Keypad size="md" allowDot onKey={(k) => setReceived((v) => applyKey(v, k, 9))} className="hidden md:grid" />
            </div>
          )}

          {(method === 'UPI' || method === 'CARD' || method === 'BANK_TRANSFER') && (
            <div className="space-y-4">
              <div className="rounded-lg bg-paper px-4 py-4 text-center">
                <p className="text-sm text-ink-3">{method === 'UPI' ? t('pay.upiAsk') : method === 'CARD' ? t('pay.cardAsk') : t('pay.bankAsk')}</p>
                <p className="num mt-1 text-[38px] leading-tight font-bold">{formatMoney(total)}</p>
              </div>
              <Field label={method === 'UPI' ? t('pay.upiRef') : method === 'CARD' ? t('pay.cardRef') : t('pay.bankRef')} htmlFor="pay-ref" optional hint={method === 'UPI' ? t('pay.upiRefHint') : undefined}>
                <Input id="pay-ref" size="lg" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} autoFocus autoComplete="off" />
              </Field>
            </div>
          )}

          {method === 'SPLIT' && (
            <div className="space-y-2">
              {split.map((row, i) => (
                <div key={i} className="flex flex-wrap gap-2 border-b border-line pb-2 last:border-0 sm:flex-nowrap sm:border-0 sm:pb-0">
                  <Select
                    aria-label={t('pay.method')}
                    value={row.method}
                    onChange={(e) => setSplit((rows) => rows.map((r, j) => (j === i ? { ...r, method: e.target.value as PayMethod } : r)))}
                    className="w-32 shrink-0"
                  >
                    <option value="CASH">{t('pay.cash')}</option>
                    <option value="UPI">{t('pay.upi')}</option>
                    <option value="CARD">{t('pay.card')}</option>
                    <option value="BANK_TRANSFER">{t('pay.bank')}</option>
                  </Select>
                  <MoneyInput aria-label={t('pay.amount')} value={row.amount} onValueChange={(v) => setSplit((rows) => rows.map((r, j) => (j === i ? { ...r, amount: v } : r)))} className="min-w-0 flex-1" />
                  <Input aria-label={t('pay.reference')} placeholder={t('pay.reference')} value={row.reference} onChange={(e) => setSplit((rows) => rows.map((r, j) => (j === i ? { ...r, reference: e.target.value } : r)))} className="order-last w-full sm:order-none sm:w-32" />
                  <button
                    onClick={() => setSplit((rows) => rows.filter((_, j) => j !== i))}
                    disabled={split.length <= 2}
                    aria-label={t('common.remove')}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-paper disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="h-4 w-4" />}
                  disabled={split.length >= 4}
                  onClick={() => setSplit((rows) => [...rows, { method: 'CARD', amount: rupeeInput(Math.max(0, splitState.due)), reference: '' }])}
                >
                  {t('pay.addPart')}
                </Button>
                {splitState.due > 0 && (
                  <button className="text-[13px] font-medium text-brand hover:underline" onClick={() => setSplit((rows) => rows.map((r, j) => (j === rows.length - 1 ? { ...r, amount: rupeeInput(toPaise(r.amount) + splitState.due) } : r)))}>
                    {t('pay.fillRemaining')}
                  </button>
                )}
              </div>
              <div className={cn('flex items-center justify-between rounded-lg px-4 py-3', splitState.due || splitState.over ? 'bg-warn-50' : 'bg-ok-50')}>
                <span className="text-[15px] font-medium text-ink-2">{splitState.over ? t('pay.overBy') : t('pay.balance')}</span>
                <span className="num text-[26px] font-bold">{formatMoney(splitState.over || splitState.due)}</span>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-4 rounded-md border border-danger/25 bg-danger-50 px-3 py-2.5 text-sm text-danger">
              {error.message}
              {error.code === 'NO_SHIFT' && (
                <button className="ml-2 font-semibold underline" onClick={() => (onClose(), navigate('/pos/shift'))}>
                  {t('pay.openShiftNow')}
                </button>
              )}
            </div>
          )}

          <Button size="xl" variant="primary" block className="mt-5" onClick={complete} disabled={!payments || phase !== 'enter' || !phoneOk} loading={phase === 'busy' || phase === 'prep'}>
            {method === 'UPI' || method === 'CARD' || method === 'BANK_TRANSFER' ? t('pay.received') : t('pay.completePayment')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
