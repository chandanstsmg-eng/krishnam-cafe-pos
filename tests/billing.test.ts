import { describe, expect, it } from 'vitest';
import { allocate, computeBill, settle } from '../shared/billing.js';
import { buildReceipt, receiptToText } from '../shared/receipt.js';
import { businessDate, istDayStart } from '../shared/dates.js';
import { formatMoney } from '../shared/money.js';
import { DEFAULT_SETTINGS, type InvoiceDTO, type PrinterSettingsDTO } from '../shared/types.js';

const R = (n: number) => n * 100;

describe('bill calculation', () => {
  it('adds GST on top when prices exclude tax, and rounds to the rupee', () => {
    // spec example: Masala Dosa ×2 ₹120, Tea ×2 ₹30, Vada ×1 ₹30 → ₹180 + 5% = ₹189
    const b = computeBill(
      [
        { key: 'a', unitPrice: R(60), qty: 2, taxRate: 5 },
        { key: 'b', unitPrice: R(15), qty: 2, taxRate: 5 },
        { key: 'c', unitPrice: R(30), qty: 1, taxRate: 5 },
      ],
      null,
      { taxMode: 'EXCLUSIVE', roundOff: true },
    );
    expect(b.subtotal).toBe(R(180));
    expect(b.tax).toBe(R(9));
    expect(b.total).toBe(R(189));
    expect(b.cgst + b.sgst).toBe(b.tax);
  });

  it('applies a percentage discount before tax', () => {
    const b = computeBill([{ key: 'a', unitPrice: R(500), qty: 1, taxRate: 0 }], { type: 'PERCENT', value: 10 }, { taxMode: 'EXCLUSIVE', roundOff: true });
    expect(b.discount).toBe(R(50));
    expect(b.total).toBe(R(450));
  });

  it('never discounts more than the bill', () => {
    const b = computeBill([{ key: 'a', unitPrice: R(40), qty: 1, taxRate: 5 }], { type: 'AMOUNT', value: R(100) }, { taxMode: 'EXCLUSIVE', roundOff: true });
    expect(b.discount).toBe(R(40));
    expect(b.total).toBe(0);
  });

  it('shows tax inside the price when prices include tax', () => {
    const b = computeBill([{ key: 'a', unitPrice: R(105), qty: 1, taxRate: 5 }], null, { taxMode: 'INCLUSIVE', roundOff: false });
    expect(b.total).toBe(R(105));
    expect(b.tax).toBe(R(5));
    expect(b.taxable).toBe(R(100));
  });

  it('can switch tax off entirely', () => {
    const b = computeBill([{ key: 'a', unitPrice: R(20), qty: 3, taxRate: 5 }], null, { taxMode: 'NONE', roundOff: true });
    expect(b.tax).toBe(0);
    expect(b.total).toBe(R(60));
  });

  it('splits a discount across lines so the parts add up exactly', () => {
    const parts = allocate(1000, [333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('works out change and mixed payments', () => {
    expect(settle(R(380), [{ method: 'CASH', amount: R(380), tendered: R(500) }])).toMatchObject({ due: 0, change: R(120) });
    expect(settle(R(1000), [{ method: 'CASH', amount: R(400) }, { method: 'UPI', amount: R(600) }])).toMatchObject({ due: 0, over: 0, paid: R(1000) });
    expect(settle(R(1000), [{ method: 'CASH', amount: R(400) }]).due).toBe(R(600));
  });
});

describe('formatting', () => {
  it('uses Indian digit grouping', () => {
    expect(formatMoney(R(18450))).toBe('₹18,450');
    expect(formatMoney(12345678)).toBe('₹1,23,456.78');
  });

  it('calculates the business day in IST', () => {
    expect(businessDate(new Date('2026-09-26T19:00:00Z'))).toBe('2026-09-27'); // 00:30 IST
    expect(istDayStart('2026-09-27').toISOString()).toBe('2026-09-26T18:30:00.000Z');
  });
});

describe('receipt', () => {
  const printer: PrinterSettingsDTO = {
    id: 'receipt', label: 'Receipt printer', enabled: true, connection: 'BROWSER', printerName: null, ipAddress: null, port: 9100,
    paperWidth: 80, printLogo: true, printTax: true, printFooter: true, footerText: 'THANK YOU!\nVISIT AGAIN', autoPrint: true, copies: 1, openDrawer: false,
  };
  const inv: InvoiceDTO = {
    id: 'x', number: 'INV-001245', orderId: 'o', orderNumber: 1024, orderType: 'DINE_IN', tableName: 'T04', customerName: null, customerPhone: null,
    subtotal: R(180), discount: 0, discountLabel: null, taxable: R(180), tax: R(9), taxInclusive: false, roundOff: 0, total: R(189), paid: R(189), change: 0, refunded: 0,
    status: 'PAID', cashierName: 'Lakshmi N', createdAt: '2026-09-27T05:12:00Z', reprintCount: 0, offline: false, voidReason: null,
    items: [
      { name: 'Masala Dosa', modifiersText: null, note: null, qty: 2, unitPrice: R(60), lineTotal: R(120), taxRate: 5 },
      { name: 'Tea', modifiersText: null, note: null, qty: 2, unitPrice: R(15), lineTotal: R(30), taxRate: 5 },
      { name: 'Vada', modifiersText: null, note: null, qty: 1, unitPrice: R(30), lineTotal: R(30), taxRate: 5 },
    ],
    payments: [{ method: 'UPI', amount: R(189), tendered: null, change: null, reference: null }],
  };

  it('fits 48 columns on 80 mm paper and 32 on 58 mm', () => {
    const settings = { ...DEFAULT_SETTINGS, business: { ...DEFAULT_SETTINGS.business, name: 'ABC Cafe', phone: '9800000000' } };
    for (const [width, cols] of [[80, 48], [58, 32]] as const) {
      const text = receiptToText(buildReceipt(inv, settings, { ...printer, paperWidth: width }, {}));
      for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(cols);
      expect(text).toContain('INV-001245');
      expect(text).toContain('Table: T04');
      expect(text).toContain('Paid by UPI');
      expect(text).toContain('THANK YOU!');
    }
  });

  it('marks reprints as duplicate copies', () => {
    const text = receiptToText(buildReceipt(inv, DEFAULT_SETTINGS, printer, { duplicate: true }));
    expect(text).toContain('DUPLICATE COPY');
  });
});
