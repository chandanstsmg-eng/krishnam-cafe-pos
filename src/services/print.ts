/**
 * Printing for the till.
 *
 *  - "This computer" printers (USB thermal printers installed in Windows):
 *    the receipt is laid out at 80/58 mm and sent through the browser's print.
 *    Start the app with START-POS.bat to skip the print dialog entirely.
 *  - Network printers: the server sends ESC/POS bytes straight to the printer.
 *
 * The cashier only ever presses "Print receipt".
 */
import { api } from '../api/client';
import { usePos } from '../features/pos/store';
import { toast } from '../components/ui/Toast';
import { t } from '../i18n';
import { buildKot, buildPreBill, buildReceipt, type ReceiptDoc, type ReceiptLine } from '../../shared/receipt';
import type { InvoiceDTO, OrderDTO, PrinterSettingsDTO } from '../../shared/types';
import { billFor } from './sync';
import { can } from '../features/auth/session';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// On screen and on paper the rupee sign reads better than "Rs".
const pretty = (s: string) => s.replace(/^Rs /, '₹');

function lineHtml(l: ReceiptLine): string {
  switch (l.t) {
    case 'rule':
      return `<div class="rule ${l.style === 'double' ? 'double' : ''}"></div>`;
    case 'feed':
      return `<div class="feed"></div>`;
    case 'text':
      return `<div class="text ${l.align ?? 'left'} ${l.bold ? 'b' : ''} ${l.size === 'large' ? 'lg' : ''}">${esc(l.text)}</div>`;
    case 'row':
      return `<div class="row ${l.bold ? 'b' : ''} ${l.size === 'large' ? 'lg' : ''}"><span>${esc(l.left)}</span><span>${esc(pretty(l.right))}</span></div>`;
    case 'item':
      return `<div class="item"><span class="n">${esc(l.name)}</span><span class="q">${esc(l.qty)}</span><span class="a">${esc(l.amount)}</span></div>${(l.sub ?? [])
        .map((s) => `<div class="sub">${esc(s)}</div>`)
        .join('')}`;
  }
}

export const RECEIPT_CSS = `
.rcpt{font-family:'IBM Plex Sans',Arial,sans-serif;color:#000;font-size:12px;line-height:1.35;width:72mm;padding:2mm 0}
.rcpt.w58{width:48mm;font-size:11px}
.rcpt .text{white-space:pre-wrap;word-break:break-word}
.rcpt .center{text-align:center}.rcpt .right{text-align:right}
.rcpt .b{font-weight:700}.rcpt .lg{font-size:1.4em;line-height:1.25}
.rcpt .row{display:flex;justify-content:space-between;gap:6px}
.rcpt .row span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}
.rcpt .item{display:grid;grid-template-columns:1fr 3.2em 5.2em;gap:4px}
.rcpt .item .q,.rcpt .item .a{text-align:right;font-variant-numeric:tabular-nums}
.rcpt .sub{padding-left:8px;font-size:.9em;color:#222}
.rcpt .rule{border-top:1px dashed #000;margin:4px 0}
.rcpt .rule.double{border-top:3px double #000}
.rcpt .feed{height:8px}`;

export function receiptHtml(doc: ReceiptDoc) {
  return `<div class="rcpt ${doc.width === 58 ? 'w58' : ''}">${doc.lines.map(lineHtml).join('')}</div>`;
}

function printInFrame(doc: ReceiptDoc) {
  return new Promise<void>((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const w = frame.contentWindow!;
    const fonts = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join('');
    w.document.open();
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>@page{size:${doc.width}mm auto;margin:0}html,body{margin:0;padding:0;background:#fff}body{padding:0 ${doc.width === 58 ? 5 : 4}mm}${RECEIPT_CSS}</style></head><body>${receiptHtml(doc)}</body></html>`,
    );
    w.document.close();
    const go = () => {
      w.focus();
      w.print();
      setTimeout(() => {
        frame.remove();
        resolve();
      }, 1000);
    };
    // Give the fonts a moment; never wait long at the counter.
    const ready = (w.document as Document & { fonts?: FontFaceSet }).fonts?.ready;
    Promise.race([ready, new Promise((r) => setTimeout(r, 400))]).then(() => setTimeout(go, 50));
  });
}

function printer(id: 'receipt' | 'kitchen'): PrinterSettingsDTO | undefined {
  return usePos.getState().boot?.printers.find((p) => p.id === id);
}

/**
 * Waiters' phones have no printer of their own: `remoteOnly` prints only to a
 * network printer and otherwise does nothing (the counter prints instead).
 */
async function send(p: PrinterSettingsDTO | undefined, doc: ReceiptDoc, opts: { remoteOnly?: boolean } = {}) {
  if (!p) return opts.remoteOnly ? undefined : printInFrame(doc);
  if (p.connection === 'NETWORK' && usePos.getState().connection !== 'offline') {
    try {
      await api.post('/print/document', { printerId: p.id, doc });
      return;
    } catch (err) {
      toast.warning(t('print.networkFailed'), err instanceof Error ? err.message : undefined);
    }
  }
  if (opts.remoteOnly) return;
  return printInFrame(doc);
}

/** Phones and tablets carried around the floor print nothing locally. */
const handheld = () => !can('payments.accept');

export function receiptDoc(inv: InvoiceDTO, duplicate = false) {
  const s = usePos.getState().boot;
  const p = printer('receipt');
  if (!s || !p) return null;
  return buildReceipt(inv, s.settings, p, { duplicate });
}

export async function printReceipt(inv: InvoiceDTO, opts: { duplicate?: boolean } = {}) {
  const doc = receiptDoc(inv, opts.duplicate);
  if (!doc) return;
  await send(printer('receipt'), doc);
}

export async function printPreBill(order: OrderDTO) {
  const s = usePos.getState().boot;
  const p = printer('receipt');
  if (!s || !p) return;
  const b = billFor(order);
  await send(p, buildPreBill(order, b, s.settings, p), { remoteOnly: handheld() });
}

export async function printKot(order: OrderDTO, items: { name: string; qty: number; modifiers?: string | null; note?: string | null }[], round: number) {
  const p = printer('kitchen');
  if (!p?.enabled || !items.length) return;
  await send(p, buildKot({ round, createdAt: new Date().toISOString(), items, note: round === 1 ? order.note : null }, order, p.paperWidth), { remoteOnly: handheld() });
}

export async function printTest(p: PrinterSettingsDTO, businessName: string) {
  const doc: ReceiptDoc = {
    width: p.paperWidth,
    lines: [
      { t: 'text', text: businessName.toUpperCase(), align: 'center', bold: true, size: 'large' },
      { t: 'text', text: `${p.label} — test print`, align: 'center' },
      { t: 'rule' },
      { t: 'item', name: 'Masala Dosa', qty: '2', amount: '120' },
      { t: 'item', name: 'Coffee', qty: '1', amount: '20' },
      { t: 'rule', style: 'double' },
      { t: 'row', left: 'TOTAL', right: 'Rs 140', bold: true, size: 'large' },
      { t: 'rule', style: 'double' },
      { t: 'text', text: 'If this is clear and fits the paper, the printer is ready.', align: 'center' },
    ],
  };
  if (p.connection === 'NETWORK') return api.post(`/printers/${p.id}/test`);
  return printInFrame(doc);
}

/** Prints any report table or document on normal A4 via the browser. */
export function printPage(title: string, bodyHtml: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const w = frame.contentWindow!;
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:A4;margin:14mm}body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#111;font-size:11px}
    h1{font-size:16px;margin:0 0 2px}p.meta{color:#555;margin:0 0 10px}
    table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left}
    th{font-size:10px;text-transform:uppercase;letter-spacing:.03em;color:#444;border-bottom:1.5px solid #333}
    td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}tfoot td{font-weight:700;border-top:1.5px solid #333}
  </style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
    setTimeout(() => frame.remove(), 1500);
  }, 200);
}
