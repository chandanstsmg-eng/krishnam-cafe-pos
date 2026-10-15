/**
 * Bill calculation — the single source of truth used by the POS screen, the
 * offline queue and the server. Because both sides run this exact function on
 * the same price snapshot, a bill taken offline always matches what the server
 * records when it syncs.
 */

export type TaxMode = 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE';
export type DiscountKind = 'PERCENT' | 'AMOUNT';

export interface BillLineInput {
  key: string;
  unitPrice: number; // paise, modifiers included
  qty: number;
  taxRate: number; // percent, e.g. 5
}

export interface DiscountInput {
  type: DiscountKind;
  /** percent (0–100) for PERCENT, paise for AMOUNT */
  value: number;
}

export interface BillOptions {
  taxMode: TaxMode;
  roundOff: boolean;
}

export interface BillLine {
  key: string;
  gross: number;
  discountShare: number;
  taxable: number;
  tax: number;
}

export interface Bill {
  lines: BillLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  taxInclusive: boolean;
  roundOff: number;
  total: number;
}

export function discountAmount(subtotal: number, discount?: DiscountInput | null) {
  if (!discount || !(discount.value > 0) || subtotal <= 0) return 0;
  if (discount.type === 'PERCENT') {
    const pct = Math.min(100, discount.value);
    return Math.min(subtotal, Math.round((subtotal * pct) / 100));
  }
  return Math.min(subtotal, Math.round(discount.value));
}

/** Splits `amount` across weights so the parts add up exactly (largest remainder). */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const parts = raw.map(Math.floor);
  let rest = amount - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) parts[order[k][1]] += 1;
  return parts;
}

export function computeBill(lines: BillLineInput[], discount: DiscountInput | null | undefined, opts: BillOptions): Bill {
  const gross = lines.map((l) => Math.round(l.unitPrice * l.qty));
  const subtotal = gross.reduce((a, b) => a + b, 0);
  const disc = discountAmount(subtotal, discount);
  const shares = allocate(disc, gross);

  const out: BillLine[] = lines.map((l, i) => {
    const net = gross[i] - shares[i];
    let tax = 0;
    let taxable = net;
    if (opts.taxMode === 'EXCLUSIVE' && l.taxRate > 0) {
      tax = Math.round((net * l.taxRate) / 100);
    } else if (opts.taxMode === 'INCLUSIVE' && l.taxRate > 0) {
      tax = Math.round((net * l.taxRate) / (100 + l.taxRate));
      taxable = net - tax;
    }
    return { key: l.key, gross: gross[i], discountShare: shares[i], taxable, tax };
  });

  const tax = out.reduce((a, l) => a + l.tax, 0);
  const taxable = out.reduce((a, l) => a + l.taxable, 0);
  const beforeRound = opts.taxMode === 'EXCLUSIVE' ? subtotal - disc + tax : subtotal - disc;
  const total = opts.roundOff ? Math.round(beforeRound / 100) * 100 : beforeRound;
  const cgst = Math.round(tax / 2);

  return {
    lines: out,
    itemCount: lines.reduce((a, l) => a + l.qty, 0),
    subtotal,
    discount: disc,
    taxable,
    tax,
    cgst,
    sgst: tax - cgst,
    taxInclusive: opts.taxMode === 'INCLUSIVE',
    roundOff: total - beforeRound,
    total,
  };
}

export type PayMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER';

export interface PaymentInput {
  method: PayMethod;
  /** amount applied to the bill, paise */
  amount: number;
  /** cash handed over by the customer, paise (cash only) */
  tendered?: number | null;
  reference?: string | null;
}

/** Totals up a set of payments against a bill total. */
export function settle(total: number, payments: PaymentInput[]) {
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const change = payments.reduce((a, p) => a + (p.method === 'CASH' && p.tendered ? Math.max(0, p.tendered - p.amount) : 0), 0);
  return { paid, due: Math.max(0, total - paid), over: Math.max(0, paid - total), change };
}

export function discountLabel(d?: DiscountInput | null) {
  if (!d || !(d.value > 0)) return null;
  return d.type === 'PERCENT' ? `${+d.value.toFixed(2)}%` : 'Flat';
}
