import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, Ban, CloudOff, Eye, Printer, Receipt, RotateCcw, Search, X } from 'lucide-react';
import { usePos } from '../pos/store';
import { recordReprint, upsertInvoice } from '../../services/sync';
import { printReceipt, receiptDoc } from '../../services/print';
import { api, errorMessage, qs } from '../../api/client';
import { requestApproval } from '../auth/Approval';
import { useCan, useSession } from '../auth/session';
import { ReceiptPreview } from './ReceiptPreview';
import { RefundDialog } from './RefundDialog';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Field';
import { EmptyState, SkeletonRows } from '../../components/ui/Misc';
import { confirmWithReason } from '../../components/ui/Confirm';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { businessDate, formatDateLong, formatTime } from '../../../shared/dates';
import { paymentLabel } from '../../../shared/receipt';
import type { InvoiceDTO } from '../../../shared/types';

export function statusBadge(inv: InvoiceDTO, t: (k: string) => string) {
  if (inv.status === 'VOID') return <Badge tone="danger" icon={<Ban className="h-3 w-3" />}>{t('bills.void')}</Badge>;
  if (inv.status === 'REFUNDED') return <Badge tone="warn" icon={<RotateCcw className="h-3 w-3" />}>{t('bills.refunded')}</Badge>;
  if (inv.status === 'PARTIALLY_REFUNDED') return <Badge tone="warn" icon={<RotateCcw className="h-3 w-3" />}>{t('bills.partRefunded')}</Badge>;
  return <Badge tone="ok">{t('bills.paid')}</Badge>;
}

/**
 * Today's bills (and any earlier day when online): find a bill by number,
 * table, amount or customer; view it, reprint it, void it or refund it.
 */
export function BillsScreen() {
  const t = useT();
  const can = useCan();
  const user = useSession((s) => s.user);
  const local = usePos((s) => s.invoices);
  const outbox = usePos((s) => s.outbox);
  const unsynced = useMemo(() => new Set(outbox.flatMap((c) => (c.type === 'order.pay' ? [c.payload.invoiceId] : []))), [outbox]);
  const offline = usePos((s) => s.connection === 'offline');
  const requireApproval = usePos((s) => s.boot?.settings.billing.requireApprovalForVoid ?? true);
  const [q, setQ] = useState('');
  const [date, setDate] = useState(businessDate());
  const [remote, setRemote] = useState<InvoiceDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('bill'));
  const [refundFor, setRefundFor] = useState<InvoiceDTO | null>(null);
  const today = businessDate();
  const searchingServer = !offline && (date !== today || q.trim().length >= 2);

  useEffect(() => {
    if (!searchingServer) {
      setRemote(null);
      return;
    }
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        setRemote(await api.get<InvoiceDTO[]>(`/invoices${qs({ q: q.trim() || undefined, date: q.trim() ? undefined : date, limit: 200 })}`));
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(h);
  }, [q, date, searchingServer]);

  const list = useMemo(() => {
    if (remote) return remote;
    const term = q.trim().toLowerCase();
    if (!term) return local;
    return local.filter((i) => i.number.toLowerCase().includes(term) || (i.tableName ?? '').toLowerCase() === term || String(i.total / 100) === term || (i.customerName ?? '').toLowerCase().includes(term) || (i.customerPhone ?? '').includes(term));
  }, [remote, local, q]);

  const [linked, setLinked] = useState<InvoiceDTO | null>(null);
  useEffect(() => {
    const id = params.get('bill');
    if (id && !local.some((i) => i.id === id)) api.get<InvoiceDTO>(`/invoices/${id}`).then(setLinked).catch(() => {});
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const inv = list.find((i) => i.id === selected) ?? (linked?.id === selected ? linked : null);
  const totals = useMemo(() => {
    const valid = list.filter((i) => i.status !== 'VOID');
    return { count: valid.length, sum: valid.reduce((a, i) => a + i.total - i.refunded, 0) };
  }, [list]);

  const replace = (next: InvoiceDTO) => {
    upsertInvoice(next);
    setRemote((r) => (r ? r.map((i) => (i.id === next.id ? next : i)) : r));
  };

  const reprint = async (i: InvoiceDTO) => {
    await printReceipt(i, { duplicate: true });
    const updated = await recordReprint(i.id);
    if (updated) replace(updated);
  };

  const voidBill = async (i: InvoiceDTO) => {
    const reason = await confirmWithReason({
      title: t('bills.voidTitle', { n: i.number }),
      message: t('bills.voidMessage', { amount: formatMoney(i.total) }),
      confirmLabel: t('bills.confirmVoid'),
      danger: true,
      reasons: [t('reasons.wrongOrder'), t('reasons.duplicateOrder'), t('reasons.customerCancelled'), t('reasons.wrongPayment')],
    });
    if (reason === null) return;
    const own = can('bills.void') && (!requireApproval || ['admin', 'manager'].includes(user?.roleKey ?? ''));
    let token: string | null = null;
    if (!own) {
      token = await requestApproval('bills.void', t('approval.voidReason', { n: i.number, amount: formatMoney(i.total) }));
      if (!token) return;
    }
    try {
      replace(await api.post<InvoiceDTO>(`/invoices/${i.id}/void`, { reason, approvalToken: token }));
      toast.success(t('bills.voided', { n: i.number }));
    } catch (err) {
      toast.error(t('bills.voidFailed'), errorMessage(err));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-3">
          <div className="relative min-w-0 basis-full sm:min-w-56 sm:basis-auto sm:flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('bills.searchPlaceholder')} aria-label={t('bills.searchPlaceholder')} className="pl-9" />
            {q && (
              <button onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-4 hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} aria-label={t('bills.date')} className="w-44" disabled={offline} />
          <div className="ml-auto text-right text-[13px] text-ink-3">
            {q ? t('bills.found', { n: list.length }) : date === today ? t('bills.today') : formatDateLong(date)}
            <span className="num ml-2 font-semibold text-ink">
              {totals.count} · {formatMoney(totals.sum)}
            </span>
          </div>
        </div>
        {offline && (
          <p className="flex items-center gap-2 border-b border-warn/20 bg-warn-50 px-4 py-2 text-[13px] text-warn">
            <CloudOff className="h-4 w-4" aria-hidden />
            {t('bills.offlineNote')}
          </p>
        )}
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          {loading && !remote ? (
            <SkeletonRows className="p-4" rows={8} />
          ) : list.length === 0 ? (
            <EmptyState icon={<Receipt />} title={q ? t('bills.noMatch') : t('bills.none')} />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-paper text-left text-[12px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('bills.billNo')}</th>
                  <th className="px-2 py-2 font-medium">{t('bills.time')}</th>
                  <th className="px-2 py-2 font-medium">{t('bills.tableType')}</th>
                  <th className="hidden px-2 py-2 font-medium sm:table-cell">{t('bills.payment')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('bills.amount')}</th>
                  <th className="px-4 py-2 font-medium">{t('bills.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-surface">
                {list.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setSelected(i.id)}
                    className={cn('cursor-pointer hover:bg-paper', selected === i.id && 'bg-brand-50/70 hover:bg-brand-50', i.status === 'VOID' && 'text-ink-3')}
                    aria-selected={selected === i.id}
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap sm:px-4">
                      <button className="font-mono text-[13px] font-medium hover:underline" onClick={() => setSelected(i.id)}>
                        {i.number}
                      </button>
                      {unsynced.has(i.id) && <CloudOff className="ml-1.5 inline h-3.5 w-3.5 text-warn" aria-label={t('bills.offlineBill')} />}
                    </td>
                    <td className="num px-2 py-2.5 text-ink-2">{date === today && !q ? formatTime(i.createdAt) : `${formatDateLong(i.createdAt)}, ${formatTime(i.createdAt)}`}</td>
                    <td className="px-2 py-2.5">{i.tableName ?? t(`orderType.${i.orderType}`)}</td>
                    <td className="hidden px-2 py-2.5 text-ink-2 sm:table-cell">{i.payments.map((p) => paymentLabel(p.method)).join(' + ')}</td>
                    <td className={cn('num px-2 py-2.5 text-right font-semibold', i.status === 'VOID' && 'line-through')}>{formatMoney(i.total)}</td>
                    <td className="px-4 py-2.5">{statusBadge(i, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Wide screens: always beside the list. Phones/tablets: opens over the list when a bill is chosen. */}
      <aside
        className={cn(
          'shrink-0 flex-col bg-paper-2/40 lg:static lg:flex lg:w-[400px] lg:border-l lg:border-line',
          inv ? 'pb-safe fixed inset-0 z-40 flex bg-paper lg:bg-paper-2/40 lg:pb-0' : 'hidden',
        )}
      >
        {!inv ? (
          <EmptyState icon={<Eye />} title={t('bills.selectBill')} className="my-auto" />
        ) : (
          <>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-1.5 lg:hidden">
              <button onClick={() => setSelected(null)} aria-label={t('common.back')} className="flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-paper-2">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="min-w-0 flex-1 truncate font-mono text-[14px] font-semibold">{inv.number}</span>
              <span className="pr-2">{statusBadge(inv, t)}</span>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
              {(() => {
                const doc = receiptDoc(inv, inv.reprintCount > 0);
                return doc ? <ReceiptPreview doc={doc} /> : null;
              })()}
              {inv.voidReason && <p className="mt-3 rounded-md bg-danger-50 px-3 py-2 text-[13px] text-danger">{t('bills.voidReason', { reason: inv.voidReason })}</p>}
              {inv.reprintCount > 0 && <p className="mt-2 text-center text-[12px] text-ink-3">{t('bills.reprinted', { n: inv.reprintCount })}</p>}
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-line bg-surface p-3">
              <Button icon={<Printer className="h-4 w-4" />} onClick={() => reprint(inv)} disabled={!can('receipts.print')}>
                {t('bills.reprint')}
              </Button>
              <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRefundFor(inv)} disabled={offline || inv.status === 'VOID' || inv.status === 'REFUNDED' || unsynced.has(inv.id)}>
                {t('bills.refund')}
              </Button>
              <Button variant="danger-outline" icon={<Ban className="h-4 w-4" />} onClick={() => voidBill(inv)} disabled={offline || inv.status !== 'PAID' || unsynced.has(inv.id)}>
                {t('bills.voidBtn')}
              </Button>
            </div>
          </>
        )}
      </aside>
      <RefundDialog invoice={refundFor} onClose={() => setRefundFor(null)} onDone={replace} />
    </div>
  );
}
