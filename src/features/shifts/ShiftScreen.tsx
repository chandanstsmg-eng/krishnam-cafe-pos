import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Lock, PlayCircle, Printer, Wallet } from 'lucide-react';
import { api, errorMessage } from '../../api/client';
import { usePos } from '../pos/store';
import { refresh } from '../../services/sync';
import { useCan } from '../auth/session';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, MoneyInput, Textarea } from '../../components/ui/Field';
import { EmptyState, Panel, SkeletonRows } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, toPaise } from '../../../shared/money';
import { formatDateLong, formatDuration, formatTime, minutesSince } from '../../../shared/dates';
import { receiptHtml } from '../../services/print';
import { printPage } from '../../services/print';

interface ShiftSummary {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedBy: string;
  closedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  cashSales: number;
  upiSales: number;
  cardSales: number;
  bankSales: number;
  totalSales: number;
  bills: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  closingNote: string | null;
  movements: { id: string; type: 'CASH_IN' | 'CASH_OUT'; amount: number; reason: string; by: string; at: string }[];
}

export const DENOMINATIONS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

export function ShiftScreen() {
  const t = useT();
  const can = useCan();
  const offline = usePos((s) => s.connection === 'offline');
  const [shift, setShift] = useState<ShiftSummary | null | undefined>(undefined);
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [move, setMove] = useState<'CASH_IN' | 'CASH_OUT' | null>(null);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<ShiftSummary | null>(null);

  const load = async () => {
    try {
      setShift(await api.get<ShiftSummary | null>('/shifts/current'));
    } catch (err) {
      setShift(null);
      if (!offline) toast.error(errorMessage(err));
    }
  };
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async () => {
    setBusy(true);
    try {
      setShift(await api.post<ShiftSummary>('/shifts/open', { openingCash: toPaise(opening || '0') }));
      setClosed(null);
      void refresh();
      toast.success(t('shift.opened'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (offline) return <EmptyState className="h-full" icon={<Wallet />} title={t('shift.offlineTitle')}>{t('shift.offlineHint')}</EmptyState>;
  if (shift === undefined) return <SkeletonRows className="mx-auto max-w-3xl p-6" rows={6} />;

  if (!shift) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        {closed && <ClosedSummary s={closed} />}
        <Panel title={t('shift.startTitle')} subtitle={t('shift.startHint')} className={cn(closed && 'mt-6')}>
          {can('shifts.manage') ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void open();
              }}
            >
              <Field label={t('shift.openingCash')} htmlFor="open-cash" className="w-56">
                <MoneyInput id="open-cash" size="lg" value={opening} onValueChange={setOpening} placeholder="0" autoFocus />
              </Field>
              <Button type="submit" variant="primary" size="lg" icon={<PlayCircle className="h-5 w-5" />} loading={busy}>
                {t('shift.start')}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-ink-3">{t('shift.noPermission')}</p>
          )}
        </Panel>
      </div>
    );
  }

  const running = minutesSince(shift.openedAt);
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold">{t('shift.currentTitle')}</h1>
            <p className="mt-1 text-sm text-ink-3">{t('shift.openedBy', { name: shift.openedBy, time: formatTime(shift.openedAt), dur: formatDuration(running) })}</p>
          </div>
          {can('shifts.manage') && (
            <div className="flex flex-wrap gap-2">
              <Button icon={<ArrowDownLeft className="h-4 w-4" />} onClick={() => setMove('CASH_IN')}>
                {t('shift.addCash')}
              </Button>
              <Button icon={<ArrowUpRight className="h-4 w-4" />} onClick={() => setMove('CASH_OUT')}>
                {t('shift.payOut')}
              </Button>
              <Button variant="primary" icon={<Lock className="h-4 w-4" />} onClick={() => setClosing(true)}>
                {t('shift.close')}
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <Panel title={t('shift.drawer')}>
            <dl className="space-y-2 text-[15px]">
              <Line label={t('shift.openingCash')} value={shift.openingCash} />
              <Line label={t('shift.cashSales')} value={shift.cashSales} sign="+" />
              {shift.cashIn > 0 && <Line label={t('shift.cashAdded')} value={shift.cashIn} sign="+" />}
              {shift.cashOut > 0 && <Line label={t('shift.paidOut')} value={shift.cashOut} sign="−" />}
              {shift.cashRefunds > 0 && <Line label={t('shift.cashRefunds')} value={shift.cashRefunds} sign="−" />}
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="font-semibold">{t('shift.expectedCash')}</dt>
                <dd className="num text-[28px] font-bold">{formatMoney(shift.expectedCash)}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title={t('shift.salesThisShift')}>
            <dl className="space-y-2 text-[15px]">
              <Line label={t('pay.cash')} value={shift.cashSales} />
              <Line label={t('pay.upi')} value={shift.upiSales} />
              <Line label={t('pay.card')} value={shift.cardSales} />
              {shift.bankSales > 0 && <Line label={t('pay.bank')} value={shift.bankSales} />}
              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="font-semibold">{t('shift.totalSales', { n: shift.bills })}</dt>
                <dd className="num text-xl font-bold">{formatMoney(shift.totalSales)}</dd>
              </div>
            </dl>
          </Panel>
        </div>

        <Panel title={t('shift.movements')} className="mt-4" bodyClassName="p-0">
          {shift.movements.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-3">{t('shift.noMovements')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {shift.movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-full', m.type === 'CASH_IN' ? 'bg-ok-50 text-ok' : 'bg-warn-50 text-warn')}>
                    {m.type === 'CASH_IN' ? <ArrowDownLeft className="h-4 w-4" aria-label={t('shift.cashAdded')} /> : <ArrowUpRight className="h-4 w-4" aria-label={t('shift.paidOut')} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{m.reason}</span>
                    <span className="text-[12px] text-ink-3">
                      {formatTime(m.at)} · {m.by}
                    </span>
                  </span>
                  <span className="num font-semibold">
                    {m.type === 'CASH_IN' ? '+' : '−'}
                    {formatMoney(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <CashMoveDialog
        type={move}
        onClose={() => setMove(null)}
        onDone={(s) => {
          setShift(s);
          setMove(null);
        }}
      />
      <CloseShiftDialog
        open={closing}
        shift={shift}
        onClose={() => setClosing(false)}
        onDone={(s) => {
          setClosing(false);
          setClosed(s);
          setShift(null);
          void refresh();
        }}
      />
    </div>
  );
}

function Line({ label, value, sign }: { label: string; value: number; sign?: '+' | '−' }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-2">{label}</dt>
      <dd className="num">
        {sign && value > 0 ? `${sign} ` : ''}
        {formatMoney(value)}
      </dd>
    </div>
  );
}

function CashMoveDialog({ type, onClose, onDone }: { type: 'CASH_IN' | 'CASH_OUT' | null; onClose: () => void; onDone: (s: ShiftSummary) => void }) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAmount('');
    setReason('');
  }, [type]);
  const quick = type === 'CASH_OUT' ? [t('shift.reasonMilk'), t('shift.reasonVeg'), t('shift.reasonGas'), t('shift.reasonAdvance')] : [t('shift.reasonChange'), t('shift.reasonOwner')];
  const submit = async () => {
    if (!type) return;
    setBusy(true);
    try {
      onDone(await api.post<ShiftSummary>('/shifts/cash', { type, amount: toPaise(amount), reason }));
      toast.success(type === 'CASH_IN' ? t('shift.cashAddedDone') : t('shift.payOutDone'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!type}
      onClose={onClose}
      title={type === 'CASH_IN' ? t('shift.addCash') : t('shift.payOut')}
      description={type === 'CASH_OUT' ? t('shift.payOutHint') : t('shift.addCashHint')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!(toPaise(amount) > 0) || reason.trim().length < 2}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('shift.amount')} htmlFor="mv-amt">
          <MoneyInput id="mv-amt" size="lg" value={amount} onValueChange={setAmount} autoFocus />
        </Field>
        <Field label={t('common.reason')} htmlFor="mv-reason">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button key={q} type="button" onClick={() => setReason(q)} className="h-8 rounded-full border border-line-2 px-3 text-[13px] text-ink-2 hover:bg-paper">
                {q}
              </button>
            ))}
          </div>
          <Input id="mv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={160} />
        </Field>
      </div>
    </Dialog>
  );
}

function CloseShiftDialog({ open, shift, onClose, onDone }: { open: boolean; shift: ShiftSummary; onClose: () => void; onDone: (s: ShiftSummary) => void }) {
  const t = useT();
  const noteAbove = usePos((s) => s.boot?.settings.shift.noteRequiredAbove ?? 5000);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [manual, setManual] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCounts({});
      setManual('');
      setNote('');
      setError(null);
    }
  }, [open]);

  const fromNotes = useMemo(() => DENOMINATIONS.reduce((a, d) => a + d * (Number(counts[d]) || 0), 0) + toPaise(counts.coins || '0'), [counts]);
  const usingNotes = Object.values(counts).some((v) => v);
  const counted = usingNotes ? fromNotes : toPaise(manual || '0');
  const diff = counted - shift.expectedCash;
  const needNote = Math.abs(diff) > noteAbove;
  const hasCount = usingNotes || manual !== '';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const denominations = usingNotes ? Object.fromEntries(Object.entries(counts).filter(([, v]) => v).map(([k, v]) => [k, k === 'coins' ? toPaise(v) : Number(v)])) : null;
      const s = await api.post<ShiftSummary>('/shifts/close', { countedCash: counted, denominations, note: note.trim() || null });
      toast.success(t('shift.closedToast'));
      onDone(s);
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
      title={t('shift.closeTitle')}
      description={t('shift.closeHint')}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!hasCount || (needNote && note.trim().length < 3)}>
            {t('shift.closeConfirm')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink-2">{t('shift.countNotes')}</p>
          <div className="space-y-1.5">
            {DENOMINATIONS.map((d) => (
              <div key={d} className="flex items-center gap-2">
                <span className="num w-16 text-right text-sm font-medium">{formatMoney(d)}</span>
                <span className="text-ink-4">×</span>
                <Input
                  aria-label={t('shift.notesOf', { d: formatMoney(d) })}
                  inputMode="numeric"
                  value={counts[d] ?? ''}
                  onChange={(e) => /^\d{0,4}$/.test(e.target.value) && setCounts((c) => ({ ...c, [d]: e.target.value }))}
                  className="h-9 w-20"
                />
                <span className="num ml-auto text-sm text-ink-3">{counts[d] ? formatMoney(d * Number(counts[d])) : ''}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-16 text-right text-sm font-medium">{t('shift.coins')}</span>
              <span className="text-ink-4">₹</span>
              <Input aria-label={t('shift.coins')} inputMode="decimal" value={counts.coins ?? ''} onChange={(e) => /^\d{0,6}(\.\d{0,2})?$/.test(e.target.value) && setCounts((c) => ({ ...c, coins: e.target.value }))} className="h-9 w-20" />
            </div>
          </div>
          {!usingNotes && (
            <Field label={t('shift.orTotal')} htmlFor="count-total" className="mt-4">
              <MoneyInput id="count-total" value={manual} onValueChange={setManual} />
            </Field>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <dl className="space-y-2 rounded-lg bg-paper p-4 text-[15px]">
            <Line label={t('shift.expectedCash')} value={shift.expectedCash} />
            <Line label={t('shift.counted')} value={counted} />
            <div className={cn('flex items-baseline justify-between border-t border-line-2 pt-2 font-semibold', diff < 0 ? 'text-danger' : diff > 0 ? 'text-warn' : 'text-ok')}>
              <dt>{diff === 0 ? t('shift.matched') : diff < 0 ? t('shift.short') : t('shift.over')}</dt>
              <dd className="num text-2xl">
                {diff > 0 ? '+' : diff < 0 ? '−' : ''}
                {formatMoney(Math.abs(diff))}
              </dd>
            </div>
          </dl>
          <Field label={t('shift.note')} htmlFor="close-note" optional={!needNote} hint={needNote ? t('shift.noteRequired', { amount: formatMoney(noteAbove) }) : undefined}>
            <Textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          {error && (
            <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ClosedSummary({ s }: { s: ShiftSummary }) {
  const t = useT();
  const printSlip = () => {
    const rows = [
      [t('shift.openingCash'), s.openingCash],
      [t('shift.cashSales'), s.cashSales],
      [t('shift.cashAdded'), s.cashIn],
      [t('shift.paidOut'), -s.cashOut],
      [t('shift.cashRefunds'), -s.cashRefunds],
      [t('shift.expectedCash'), s.expectedCash],
      [t('shift.counted'), s.countedCash ?? 0],
      [t('shift.difference'), s.difference ?? 0],
      [t('pay.upi'), s.upiSales],
      [t('pay.card'), s.cardSales],
    ] as const;
    const html = receiptHtml({
      width: 80,
      lines: [
        { t: 'text', text: t('shift.slipTitle'), align: 'center', bold: true },
        { t: 'text', text: `${s.openedBy} · ${formatDateLong(s.openedAt)}`, align: 'center' },
        { t: 'text', text: `${formatTime(s.openedAt)} – ${s.closedAt ? formatTime(s.closedAt) : ''}`, align: 'center' },
        { t: 'rule' },
        ...rows.map(([l, v]) => ({ t: 'row' as const, left: l, right: formatMoney(v) })),
        { t: 'rule' },
        { t: 'row', left: t('shift.bills'), right: String(s.bills) },
        ...(s.closingNote ? [{ t: 'text' as const, text: s.closingNote }] : []),
      ],
    });
    printPage(t('shift.slipTitle'), `<style>${'.rcpt{font-family:Arial;width:72mm}.row{display:flex;justify-content:space-between}.center{text-align:center}.b{font-weight:700}.rule{border-top:1px dashed #000;margin:4px 0}'}</style>${html}`);
  };
  return (
    <Panel
      title={t('shift.closedTitle')}
      subtitle={`${s.openedBy} · ${formatTime(s.openedAt)} – ${s.closedAt ? formatTime(s.closedAt) : ''}`}
      action={
        <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={printSlip}>
          {t('common.print')}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-[13px] text-ink-3">{t('shift.expectedCash')}</p>
          <p className="num text-xl font-semibold">{formatMoney(s.expectedCash)}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-3">{t('shift.counted')}</p>
          <p className="num text-xl font-semibold">{formatMoney(s.countedCash ?? 0)}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-3">{t('shift.difference')}</p>
          <p className={cn('num text-xl font-semibold', (s.difference ?? 0) < 0 ? 'text-danger' : (s.difference ?? 0) > 0 ? 'text-warn' : 'text-ok')}>{formatMoney(s.difference ?? 0)}</p>
        </div>
      </div>
    </Panel>
  );
}
