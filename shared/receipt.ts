/**
 * Receipt layout, independent of how it is printed. The same list of lines is
 * rendered to HTML (browser / Windows printer) and to ESC/POS bytes (network
 * thermal printer), so both look the same.
 */
import { formatMoneyAscii } from './money.js';
import { formatDate, formatTime } from './dates.js';
import type { AppSettings, InvoiceDTO, OrderDTO, PrinterSettingsDTO } from './types.js';

export type ReceiptLine =
  | { t: 'text'; text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; size?: 'normal' | 'large' }
  | { t: 'row'; left: string; right: string; bold?: boolean; size?: 'normal' | 'large' }
  | { t: 'item'; name: string; qty: string; amount: string; sub?: string[] }
  | { t: 'rule'; style?: 'single' | 'double' }
  | { t: 'feed' };

export interface ReceiptDoc {
  width: 58 | 80;
  lines: ReceiptLine[];
  openDrawer?: boolean;
}

const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer' };
export const paymentLabel = (m: string) => METHOD_LABEL[m] ?? m;
export const orderTypeLabel = (t: string) => (t === 'DINE_IN' ? 'Dine-in' : t === 'TAKEAWAY' ? 'Takeaway' : 'Delivery');

const rs = (p: number) => formatMoneyAscii(p);

function header(settings: AppSettings, printer: PrinterSettingsDTO): ReceiptLine[] {
  const b = settings.business;
  const lines: ReceiptLine[] = [];
  if (printer.printLogo) lines.push({ t: 'text', text: b.name.toUpperCase(), align: 'center', bold: true, size: 'large' });
  else lines.push({ t: 'text', text: b.name, align: 'center', bold: true });
  if (b.tagline) lines.push({ t: 'text', text: b.tagline, align: 'center' });
  const place = [b.address, b.city].filter(Boolean).join(', ');
  if (place) lines.push({ t: 'text', text: place, align: 'center' });
  const st = [b.state, b.pincode].filter(Boolean).join(' - ');
  if (st) lines.push({ t: 'text', text: st, align: 'center' });
  if (b.phone) lines.push({ t: 'text', text: `Ph: ${b.phone}`, align: 'center' });
  if (b.gstin && printer.printTax) lines.push({ t: 'text', text: `GSTIN: ${b.gstin}`, align: 'center' });
  if (b.fssai) lines.push({ t: 'text', text: `FSSAI: ${b.fssai}`, align: 'center' });
  return lines;
}

export function buildReceipt(
  inv: InvoiceDTO,
  settings: AppSettings,
  printer: PrinterSettingsDTO,
  opts: { duplicate?: boolean } = {},
): ReceiptDoc {
  const L: ReceiptLine[] = header(settings, printer);
  L.push({ t: 'rule' });
  if (inv.status === 'VOID') L.push({ t: 'text', text: '*** VOID — NOT A VALID BILL ***', align: 'center', bold: true });
  if (opts.duplicate) L.push({ t: 'text', text: 'DUPLICATE COPY', align: 'center', bold: true });
  L.push({ t: 'row', left: `Bill No: ${inv.number}`, right: inv.orderNumber ? `Order #${inv.orderNumber}` : '' });
  L.push({ t: 'row', left: `Date: ${formatDate(inv.createdAt)}`, right: formatTime(inv.createdAt) });
  const where = inv.orderType === 'DINE_IN' && inv.tableName ? `Table: ${inv.tableName}` : orderTypeLabel(inv.orderType).toUpperCase();
  L.push({ t: 'row', left: where, right: inv.cashierName ? `Cashier: ${inv.cashierName.split(' ')[0]}` : '' });
  if (inv.customerName || inv.customerPhone) {
    L.push({ t: 'text', text: `Customer: ${[inv.customerName, inv.customerPhone].filter(Boolean).join(' / ')}` });
  }
  L.push({ t: 'rule' });
  L.push({ t: 'item', name: 'ITEM', qty: 'QTY', amount: 'AMOUNT' });
  L.push({ t: 'rule' });
  for (const it of inv.items) {
    const sub: string[] = [];
    if (it.modifiersText) sub.push(it.modifiersText);
    if (it.qty > 1) sub.push(`@ ${rs(it.unitPrice)}`);
    L.push({ t: 'item', name: it.name, qty: String(it.qty), amount: rs(it.lineTotal), sub });
  }
  L.push({ t: 'rule' });
  L.push({ t: 'row', left: 'Subtotal', right: rs(inv.subtotal) });
  if (inv.discount > 0) L.push({ t: 'row', left: `Discount${inv.discountLabel && inv.discountLabel !== 'Flat' ? ` (${inv.discountLabel})` : ''}`, right: `-${rs(inv.discount)}` });
  if (inv.tax > 0 && printer.printTax) {
    const half = Math.round(inv.tax / 2);
    if (settings.business.gstin) {
      L.push({ t: 'row', left: `CGST${inv.taxInclusive ? ' (incl.)' : ''}`, right: rs(half) });
      L.push({ t: 'row', left: `SGST${inv.taxInclusive ? ' (incl.)' : ''}`, right: rs(inv.tax - half) });
    } else {
      L.push({ t: 'row', left: `Tax${inv.taxInclusive ? ' (included)' : ''}`, right: rs(inv.tax) });
    }
  }
  if (inv.roundOff !== 0) L.push({ t: 'row', left: 'Round off', right: rs(inv.roundOff) });
  L.push({ t: 'rule', style: 'double' });
  L.push({ t: 'row', left: 'TOTAL', right: `Rs ${rs(inv.total)}`, bold: true, size: 'large' });
  L.push({ t: 'rule', style: 'double' });
  for (const p of inv.payments) {
    L.push({ t: 'row', left: `Paid by ${paymentLabel(p.method)}${p.reference ? ` (${p.reference})` : ''}`, right: rs(p.amount) });
    if (p.method === 'CASH' && p.tendered && p.tendered > p.amount) {
      L.push({ t: 'row', left: '  Cash received', right: rs(p.tendered) });
      L.push({ t: 'row', left: '  Change returned', right: rs(p.tendered - p.amount) });
    }
  }
  if (inv.refunded > 0) L.push({ t: 'row', left: 'Refunded', right: `-${rs(inv.refunded)}` });
  if (printer.printFooter && printer.footerText) {
    L.push({ t: 'feed' });
    for (const line of printer.footerText.split('\n')) L.push({ t: 'text', text: line, align: 'center', bold: true });
  }
  return { width: printer.paperWidth, lines: L, openDrawer: printer.openDrawer && inv.payments.some((p) => p.method === 'CASH') && !opts.duplicate };
}

/** Pre-bill for the table ("check") before payment. */
export function buildPreBill(
  order: OrderDTO,
  totals: { subtotal: number; discount: number; tax: number; taxInclusive: boolean; roundOff: number; total: number },
  settings: AppSettings,
  printer: PrinterSettingsDTO,
): ReceiptDoc {
  const L: ReceiptLine[] = header(settings, printer);
  L.push({ t: 'rule' });
  L.push({ t: 'text', text: 'BILL — PAYMENT PENDING', align: 'center', bold: true });
  L.push({ t: 'row', left: order.number ? `Order #${order.number}` : 'Order', right: `${formatDate(new Date())} ${formatTime(new Date())}` });
  L.push({ t: 'text', text: order.tableName ? `Table: ${order.tableName}` : orderTypeLabel(order.type).toUpperCase() });
  L.push({ t: 'rule' });
  for (const it of order.items) {
    const sub = it.modifiers.length ? [it.modifiers.map((m) => m.name).join(', ')] : [];
    L.push({ t: 'item', name: it.name, qty: String(it.qty), amount: rs(it.unitPrice * it.qty), sub });
  }
  L.push({ t: 'rule' });
  L.push({ t: 'row', left: 'Subtotal', right: rs(totals.subtotal) });
  if (totals.discount) L.push({ t: 'row', left: 'Discount', right: `-${rs(totals.discount)}` });
  if (totals.tax && printer.printTax) L.push({ t: 'row', left: totals.taxInclusive ? 'Tax (included)' : 'Tax', right: rs(totals.tax) });
  if (totals.roundOff) L.push({ t: 'row', left: 'Round off', right: rs(totals.roundOff) });
  L.push({ t: 'rule', style: 'double' });
  L.push({ t: 'row', left: 'TO PAY', right: `Rs ${rs(totals.total)}`, bold: true, size: 'large' });
  L.push({ t: 'rule', style: 'double' });
  L.push({ t: 'text', text: 'Cash / UPI / Card accepted', align: 'center' });
  return { width: printer.paperWidth, lines: L };
}

/** Kitchen order ticket. */
export function buildKot(
  t: { round: number; createdAt: string; items: { name: string; qty: number; modifiers?: string | null; note?: string | null }[]; note?: string | null },
  order: { number: number | null; type: string; tableName: string | null },
  width: 58 | 80,
): ReceiptDoc {
  const L: ReceiptLine[] = [
    { t: 'text', text: 'KITCHEN ORDER', align: 'center', bold: true },
    { t: 'text', text: order.type === 'DINE_IN' && order.tableName ? `TABLE ${order.tableName}` : orderTypeLabel(order.type).toUpperCase(), align: 'center', bold: true, size: 'large' },
    { t: 'row', left: `Order #${order.number ?? '-'}${t.round > 1 ? ` (add-on ${t.round - 1})` : ''}`, right: formatTime(t.createdAt) },
    { t: 'rule' },
  ];
  for (const it of t.items) {
    L.push({ t: 'text', text: `${it.qty} x ${it.name}`, bold: true, size: 'large' });
    if (it.modifiers) L.push({ t: 'text', text: `   ${it.modifiers}` });
    if (it.note) L.push({ t: 'text', text: `   NOTE: ${it.note}`, bold: true });
  }
  if (t.note) {
    L.push({ t: 'rule' });
    L.push({ t: 'text', text: `NOTE: ${t.note}`, bold: true });
  }
  return { width, lines: L };
}

export interface TextLine {
  text: string;
  bold?: boolean;
  /** double width & height (centered headings only) */
  wide?: boolean;
  /** double height, normal width */
  tall?: boolean;
}

/**
 * Fixed-width text rendering for thermal printers (48 columns on 80 mm paper,
 * 32 on 58 mm). Wide lines are laid out at half the width.
 */
export function receiptTextLines(doc: ReceiptDoc): TextLine[] {
  const W = doc.width === 58 ? 32 : 48;
  const out: TextLine[] = [];
  const fit = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
  for (const l of doc.lines) {
    if (l.t === 'rule') out.push({ text: (l.style === 'double' ? '=' : '-').repeat(W) });
    else if (l.t === 'feed') out.push({ text: '' });
    else if (l.t === 'text') {
      const wide = l.size === 'large' && l.align === 'center';
      const w = wide ? Math.floor(W / 2) : W;
      for (const chunk of wrap(l.text, w)) {
        const pad = l.align === 'center' ? Math.floor((w - chunk.length) / 2) : l.align === 'right' ? w - chunk.length : 0;
        out.push({ text: ' '.repeat(Math.max(0, pad)) + chunk, bold: l.bold, wide, tall: l.size === 'large' && !wide });
      }
    } else if (l.t === 'row') {
      const right = fit(l.right, W);
      const left = fit(l.left, Math.max(0, W - right.length - 1));
      out.push({ text: left + ' '.repeat(Math.max(1, W - left.length - right.length)) + right, bold: l.bold, tall: l.size === 'large' });
    } else if (l.t === 'item') {
      const amtW = W === 48 ? 10 : 8;
      const qtyW = 4;
      const nameW = W - amtW - qtyW;
      wrap(l.name, nameW - 1).forEach((w, i) =>
        out.push({ text: i === 0 ? w.padEnd(nameW) + l.qty.padStart(qtyW) + l.amount.padStart(amtW) : w }),
      );
      for (const s of l.sub ?? []) out.push({ text: '  ' + fit(s, W - 2) });
    }
  }
  return out;
}

export const receiptToText = (doc: ReceiptDoc) => receiptTextLines(doc).map((l) => l.text).join('\n');

function wrap(s: string, n: number) {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n) {
      if (cur) lines.push(cur);
      cur = w.slice(0, n);
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
