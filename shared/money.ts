/**
 * Money helpers. All amounts are integers in paise (₹1 = 100 paise) so that
 * bills never suffer from floating point drift.
 */

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** ₹1,23,456 — drops the paise when they are zero. */
export function formatMoney(paise: number, opts: { symbol?: boolean; decimals?: 'auto' | 'always' } = {}) {
  const { symbol = true, decimals = 'auto' } = opts;
  const neg = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const body = decimals === 'always' || paise % 100 !== 0 ? inr2.format(rupees) : inr.format(rupees);
  return `${neg ? '-' : ''}${symbol ? '₹' : ''}${body}`;
}

/** Plain ASCII variant for thermal printers and PDFs that lack the ₹ glyph. */
export function formatMoneyAscii(paise: number) {
  const neg = paise < 0;
  const rupees = Math.abs(paise) / 100;
  return `${neg ? '-' : ''}${paise % 100 !== 0 ? inr2.format(rupees) : inr.format(rupees)}`;
}

export const toPaise = (rupees: number | string) => {
  const n = typeof rupees === 'string' ? Number(rupees.replace(/[,₹\s]/g, '')) : rupees;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const toRupees = (paise: number) => paise / 100;

/** Rupee value suitable for an <input>: "60" or "62.50". */
export const rupeeInput = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));
