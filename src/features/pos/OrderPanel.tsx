import { useEffect, useState } from 'react';
import {
  Armchair,
  Banknote,
  CheckCheck,
  ChefHat,
  ChevronDown,
  CreditCard,
  MoreHorizontal,
  Minus,
  NotebookPen,
  Percent,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Split,
  Trash2,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { usePos } from './store';
import * as D from './draft';
import { cancelCurrentOrder, printBill, sendToKitchen } from './orderActions';
import { OrderStatusBadge } from './OrderStatusBadge';
import { TablePickerDialog } from './TablePickerDialog';
import { LineEditDialog } from './LineEditDialog';
import { DiscountDialog } from './DiscountDialog';
import { PaymentDialog, type PayTab } from '../billing/PaymentDialog';
import { billFor, markServed } from '../../services/sync';
import { Button, IconButton } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Segmented';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { Kbd } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { useCan } from '../auth/session';
import { api } from '../../api/client';
import { useNow } from '../../hooks/useNow';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { formatDuration, minutesSince } from '../../../shared/dates';
import type { OrderItemDTO } from '../../../shared/types';

export function OrderPanel({ onPaid }: { onPaid: (kind: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY') => void }) {
  const t = useT();
  const can = useCan();
  const draft = usePos((s) => s.draft);
  const allowDelivery = usePos((s) => s.boot?.settings.pos.allowDelivery ?? true);
  const [tablePicker, setTablePicker] = useState(false);
  const [editLine, setEditLine] = useState<OrderItemDTO | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [payTab, setPayTab] = useState<PayTab | null>(null);
  const now = useNow();

  const bill = draft ? billFor(draft) : null;
  const unsentCount = draft ? draft.items.filter((l) => l.kitchen).reduce((a, l) => a + Math.max(0, l.qty - l.sentQty), 0) : 0;
  const hasItems = !!draft?.items.length;
  const canPay = can('payments.accept');
  const dirty = usePos((s) => s.dirty);
  const running = usePos((s) => !!draft && draft.type === 'DINE_IN' && !!s.orders[draft.id]);

  const needTable = () => {
    toast.info(t('pos.chooseTableFirst'));
    setTablePicker(true);
  };

  const onSend = async () => {
    const r = await sendToKitchen();
    if (r === 'need-table') needTable();
  };
  const onPrintBill = async () => {
    const r = await printBill();
    if (r === 'need-table') needTable();
  };
  const openPay = (tab: PayTab) => {
    if (!draft || !hasItems) return;
    if (draft.type === 'DINE_IN' && !draft.tableId) return needTable();
    if (!can('payments.accept')) return toast.error(t('pos.noPaymentPermission'));
    setPayTab(tab);
  };

  // Till shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'F8') (e.preventDefault(), openPay('CASH'));
      else if (e.key === 'F9') (e.preventDefault(), openPay('UPI'));
      else if (e.key === 'F10') (e.preventDefault(), openPay('CARD'));
      else if (e.key === 'F4') (e.preventDefault(), void onPrintBill());
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), void onSend());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keyed so the same instance survives the order being cleared by payment
  // (it still has to show the change to return and the receipt buttons).
  const payDialog = (
    <PaymentDialog
      key="pay"
      tab={payTab}
      onClose={(paidType) => {
        setPayTab(null);
        if (paidType) onPaid(paidType);
      }}
    />
  );

  if (!draft) {
    return (
      <aside className="flex h-full flex-col items-center justify-center gap-3 border-l border-line bg-surface p-6 text-center">
        <p className="font-medium text-ink-2">{t('pos.noOrderOpen')}</p>
        <p className="max-w-60 text-sm text-ink-3">{t('pos.noOrderOpenHint')}</p>
        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={() => D.newOrder('TAKEAWAY')}>
            {t('pos.newTakeaway')}
          </Button>
          <Button onClick={() => (D.newOrder('DINE_IN'), setTablePicker(true))}>{t('pos.newDineIn')}</Button>
        </div>
        <TablePickerDialog open={tablePicker} onClose={() => setTablePicker(false)} />
        {payDialog}
      </aside>
    );
  }

  const elapsed = draft.number !== null ? minutesSince(draft.createdAt, now) : 0;

  return (
    <aside aria-label={t('pos.currentOrder')} className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      {/* ── Who / where ── */}
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <Segmented
            label={t('pos.orderType')}
            value={draft.type}
            onChange={(v) => {
              D.setOrderType(v);
              if (v === 'DINE_IN' && !draft.tableId) setTablePicker(true);
            }}
            block
            size="sm"
            options={[
              { value: 'DINE_IN', label: t('orderType.DINE_IN') },
              { value: 'TAKEAWAY', label: t('orderType.TAKEAWAY') },
              ...(allowDelivery ? [{ value: 'DELIVERY' as const, label: t('orderType.DELIVERY') }] : []),
            ]}
          />
          <DropdownMenu
            label={t('pos.orderOptions')}
            trigger={({ toggle }) => (
              <IconButton label={t('pos.orderOptions')} onClick={toggle} size="sm" className="border border-line-2">
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            )}
            items={[
              { label: t('pos.discount'), icon: <Percent />, onSelect: () => setDiscountOpen(true), disabled: !hasItems },
              { label: t('pos.orderNote'), icon: <NotebookPen />, onSelect: () => setNoteOpen(true) },
              { label: t('pos.customerDetails'), icon: <User />, onSelect: () => setCustomerOpen(true) },
              ...(draft.type === 'DINE_IN' ? [{ label: t('pos.moveTable'), icon: <Armchair />, onSelect: () => setTablePicker(true) }] : []),
              ...(canPay ? [{ label: t('pos.splitPayment'), icon: <Split />, onSelect: () => openPay('SPLIT'), disabled: !hasItems }] : []),
              ...(draft.status === 'READY' || draft.status === 'PREPARING' ? [{ label: t('pos.markServed'), icon: <CheckCheck />, onSelect: () => markServed(draft.id) }] : []),
              'divider' as const,
              { label: t('pos.cancelOrder'), icon: <XCircle />, danger: true, onSelect: () => void cancelCurrentOrder() },
            ]}
          />
        </div>

        {draft.type === 'DINE_IN' ? (
          <div className="flex gap-2">
            <button
              onClick={() => setTablePicker(true)}
              className={cn(
                'flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-left transition-colors',
                draft.tableId ? 'border-line-2 hover:bg-paper' : 'border-dashed border-warn/60 bg-warn-50 text-warn',
              )}
            >
              <Armchair className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 truncate font-semibold">{draft.tableId ? t('pos.tableN', { n: draft.tableName ?? '' }) : t('pos.chooseTable')}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            </button>
            <div className="flex h-11 items-center rounded-md border border-line-2" aria-label={t('pos.guests')}>
              <Users className="ml-2.5 h-4 w-4 text-ink-3" aria-hidden />
              <button aria-label={t('pos.fewerGuests')} className="h-full px-2 text-ink-3 hover:text-ink" onClick={() => D.setGuests(Math.max(1, (draft.guests ?? 1) - 1))}>
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className={cn('num w-5 text-center text-sm font-medium', !draft.guests && 'text-ink-4')}>{draft.guests ?? 0}</span>
              <button aria-label={t('pos.moreGuests')} className="h-full px-2 text-ink-3 hover:text-ink" onClick={() => D.setGuests(Math.min(99, (draft.guests ?? 0) + 1))}>
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCustomerOpen(true)} className="flex h-11 w-full items-center gap-2 rounded-md border border-line-2 px-3 text-left hover:bg-paper">
            <User className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            <span className={cn('flex-1 truncate text-sm', draft.customerName || draft.customerPhone ? 'font-medium text-ink' : 'text-ink-3')}>
              {[draft.customerName, draft.customerPhone].filter(Boolean).join(' · ') || t(draft.type === 'DELIVERY' ? 'pos.addDeliveryDetails' : 'pos.addCustomerOptional')}
            </span>
          </button>
        )}

        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="font-medium text-ink-2">
            {draft.number ? t('pos.orderN', { n: draft.number }) : draft.items.length ? t('pos.newOrderUnsaved') : t('pos.newOrder')}
            {draft.number !== null && elapsed > 0 && <span className="ml-2 font-normal text-ink-3">{formatDuration(elapsed)}</span>}
          </span>
          {draft.number !== null && <OrderStatusBadge order={draft} size="sm" />}
        </div>
        {running && (
          <p className={cn('rounded-md px-2.5 py-1.5 text-[12px]', draft.billPrintedAt && dirty ? 'bg-warn-50 font-medium text-warn' : 'bg-paper text-ink-3')}>
            {draft.billPrintedAt && dirty ? t('pos.reprintAfterAdding') : t('pos.addingToRunning')}
          </p>
        )}
      </div>

      {/* ── Items ── */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!draft.items.length ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-ink-3">
            <p>{t('pos.emptyOrder')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {draft.items.map((l) => (
              <OrderLine key={l.id} line={l} onEdit={() => setEditLine(l)} />
            ))}
          </ul>
        )}
        {draft.note && (
          <button onClick={() => setNoteOpen(true)} className="mx-3 my-2 flex w-[calc(100%-24px)] items-start gap-2 rounded-md bg-accent-50 px-3 py-2 text-left text-[13px] text-ink-2">
            <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            <span>{draft.note}</span>
          </button>
        )}
      </div>

      {/* ── Totals ── */}
      {bill && (
        <div className="border-t border-line px-4 pt-2.5 pb-2 text-sm">
          <Row label={t('billing.subtotal')} value={formatMoney(bill.subtotal)} />
          <Row
            label={
              <button onClick={() => setDiscountOpen(true)} disabled={!hasItems} className="text-left underline decoration-line-2 underline-offset-2 hover:decoration-ink-3 disabled:no-underline">
                {t('billing.discount')}
                {draft.discount && draft.discount.type === 'PERCENT' ? ` (${draft.discount.value}%)` : ''}
              </button>
            }
            value={bill.discount ? `−${formatMoney(bill.discount)}` : formatMoney(0)}
            muted={!bill.discount}
          />
          <Row label={bill.taxInclusive ? t('billing.taxIncluded') : t('billing.tax')} value={formatMoney(bill.tax)} muted={!bill.tax} />
          {bill.roundOff !== 0 && <Row label={t('billing.roundOff')} value={`${bill.roundOff > 0 ? '+' : '−'}${formatMoney(Math.abs(bill.roundOff), { decimals: 'always' })}`} muted />}
          <div className="mt-1.5 flex items-baseline justify-between border-t border-dashed border-line-2 pt-2">
            <span className="text-[15px] font-semibold tracking-wide uppercase">{t('billing.total')}</span>
            <span className="num text-[26px] leading-none font-bold tracking-tight">{formatMoney(bill.total)}</span>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
      {!canPay ? (
        // Waiters: send to kitchen, then hand the bill to the cashier. No payment buttons.
        <div className="space-y-2 border-t border-line bg-paper/50 p-3">
          <Button onClick={onSend} disabled={!hasItems} size="xl" block variant={unsentCount ? 'primary' : 'secondary'} icon={<ChefHat className="h-5 w-5" />}>
            {t('pos.sendKitchen')}
            {unsentCount > 0 && <span className="num ml-0.5 rounded-full bg-white/25 px-1.5 text-[12px]">{unsentCount}</span>}
          </Button>
          <Button onClick={onPrintBill} disabled={!hasItems} size="xl" block variant={draft.billPrintedAt ? 'subtle' : 'secondary'} icon={draft.billPrintedAt ? <CheckCheck className="h-5 w-5" /> : <Receipt className="h-5 w-5" />}>
            {draft.billPrintedAt ? t('pos.billWithCashier') : t('pos.sendBillToCashier')}
          </Button>
          <p className="text-center text-[12px] text-ink-3">{t('pos.paymentAtCounter')}</p>
        </div>
      ) : (
      <div className="space-y-2 border-t border-line bg-paper/50 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onSend} disabled={!hasItems} size="lg" variant={unsentCount ? 'subtle' : 'secondary'} icon={<ChefHat className="h-[18px] w-[18px]" />} className="relative">
            {t('pos.sendKitchen')}
            {unsentCount > 0 && <span className="num ml-0.5 rounded-full bg-brand px-1.5 text-[11px] text-white">{unsentCount}</span>}
          </Button>
          <Button onClick={onPrintBill} disabled={!hasItems} size="lg" icon={<Printer className="h-[18px] w-[18px]" />}>
            {t('pos.printBill')}
            <span className="ml-1 hidden xl:inline">
              <Kbd>F4</Kbd>
            </span>
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <PayButton icon={<Banknote />} label={t('pay.cash')} hint="F8" onClick={() => openPay('CASH')} disabled={!hasItems} primary />
          <PayButton icon={<QrCode />} label={t('pay.upi')} hint="F9" onClick={() => openPay('UPI')} disabled={!hasItems} primary />
          <PayButton icon={<CreditCard />} label={t('pay.card')} hint="F10" onClick={() => openPay('CARD')} disabled={!hasItems} />
        </div>
      </div>
      )}

      <TablePickerDialog open={tablePicker} onClose={() => setTablePicker(false)} />
      <LineEditDialog line={editLine} onClose={() => setEditLine(null)} />
      <DiscountDialog open={discountOpen} onClose={() => setDiscountOpen(false)} />
      <NoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} />
      <CustomerDialog open={customerOpen} onClose={() => setCustomerOpen(false)} />
      {payDialog}
    </aside>
  );
}

function Row({ label, value, muted }: { label: React.ReactNode; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-ink-2">{label}</span>
      <span className={cn('num', muted ? 'text-ink-4' : 'text-ink')}>{value}</span>
    </div>
  );
}

function PayButton({ icon, label, hint, onClick, disabled, primary }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-lg text-[15px] font-semibold transition-colors disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5',
        primary ? 'bg-brand text-white hover:bg-brand-600 active:bg-brand-700' : 'border border-line-2 bg-surface text-ink hover:bg-paper',
      )}
    >
      <span className="flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={cn('hidden text-[10px] font-normal xl:block', primary ? 'text-white/60' : 'text-ink-4')}>{hint}</span>
    </button>
  );
}

function OrderLine({ line, onEdit }: { line: OrderItemDTO; onEdit: () => void }) {
  const t = useT();
  const unsent = line.qty - line.sentQty;
  const sentAll = line.sentQty >= line.qty && line.sentQty > 0;
  return (
    <li className="group flex items-start gap-2 px-3 py-2.5">
      <div className="flex shrink-0 items-center rounded-md border border-line-2" aria-label={t('pos.quantity')}>
        <button onClick={() => D.setQty(line.id, line.qty - 1)} aria-label={t('pos.lessOf', { name: line.name })} className="flex h-9 w-8 items-center justify-center text-ink-3 hover:text-ink">
          {line.qty === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
        </button>
        <span className="num w-6 text-center text-[15px] font-semibold">{line.qty}</span>
        <button onClick={() => D.setQty(line.id, line.qty + 1)} aria-label={t('pos.moreOf', { name: line.name })} className="flex h-9 w-8 items-center justify-center text-ink-3 hover:text-ink">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <button onClick={onEdit} className="min-w-0 flex-1 pt-0.5 text-left">
        <span className="block text-[14px] leading-snug font-medium text-ink">{line.name}</span>
        {line.modifiers.length > 0 && <span className="block text-[12px] text-ink-3">{line.modifiers.map((m) => m.name).join(', ')}</span>}
        {line.note && <span className="mt-0.5 block text-[12px] font-medium text-accent">“{line.note}”</span>}
        {line.kitchen && (sentAll || unsent > 0) && line.sentQty > 0 && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-4">
            <ChefHat className="h-3 w-3" aria-hidden />
            {unsent > 0 ? t('pos.sentPlusNew', { sent: line.sentQty, n: unsent }) : t('pos.sent')}
          </span>
        )}
      </button>
      <span className="num shrink-0 pt-1 text-[14px] font-medium">{formatMoney(line.unitPrice * line.qty)}</span>
    </li>
  );
}

function NoteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const draft = usePos((s) => s.draft);
  const [v, setV] = useState('');
  useEffect(() => {
    if (open) setV(draft?.note ?? '');
  }, [open, draft?.note]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('pos.orderNote')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => (D.setNote(v.trim() || null), onClose())}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('pos.noteForKitchen')} htmlFor="order-note">
        <Textarea id="order-note" value={v} onChange={(e) => setV(e.target.value)} maxLength={200} autoFocus placeholder={t('pos.orderNotePlaceholder')} />
      </Field>
    </Dialog>
  );
}

function CustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const draft = usePos((s) => s.draft);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  useEffect(() => {
    if (open) {
      setName(draft?.customerName ?? '');
      setPhone(draft?.customerPhone ?? '');
      setAddress(draft?.deliveryAddress ?? '');
    }
  }, [open, draft]);
  const phoneOk = !phone || phone.replace(/\D/g, '').length === 10;
  const [known, setKnown] = useState<{ name: string | null; visits: number } | null>(null);
  // A regular? Fill in the name from their last visit.
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    setKnown(null);
    if (!open || digits.length !== 10) return;
    let live = true;
    api
      .get<{ name: string | null; visits: number } | null>(`/customers/lookup?phone=${digits}`)
      .then((c) => {
        if (!live || !c) return;
        setKnown(c);
        if (c.name) setName((n) => n || c.name!);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [phone, open]);
  const save = () => {
    if (!phoneOk) return;
    D.setCustomer({ customerName: name.trim() || null, customerPhone: phone.replace(/\D/g, '') || null, deliveryAddress: address.trim() || null });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('pos.customerDetails')}
      description={t('pos.customerOptionalHint')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={!phoneOk}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label={t('pos.customerName')} htmlFor="c-name" optional>
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </Field>
        <Field label={t('pos.customerPhone')} htmlFor="c-phone" optional error={phoneOk ? null : t('pos.phoneInvalid')} hint={known ? t('pos.knownCustomer', { n: known.visits }) : undefined}>
          <Input id="c-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={14} invalid={!phoneOk} />
        </Field>
        {draft?.type === 'DELIVERY' && (
          <Field label={t('pos.deliveryAddress')} htmlFor="c-addr">
            <Textarea id="c-addr" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={240} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
