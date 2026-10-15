/**
 * Small chart and figure helpers shared by the owner's pages. One series per
 * chart, one colour (brand green); the tooltip carries exact ₹ values.
 */
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps } from 'recharts';
import { formatMoney } from '../../../shared/money';
import { t } from '../../i18n';
import { cn } from '../../utils/cn';

// Mirrors the design tokens in styles.css (SVG attributes need literal colours).
const C = { brand: '#1f5b45', brandSoft: '#a9cbb9', grid: '#ebe6dc', axis: '#7d766a', hover: '#f4f1ea' };

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

/** Indian short form for axis ticks: ₹950, ₹12.5k, ₹3.2L, ₹1.1Cr. */
export function compactRupees(paise: number) {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? '-' : '';
  if (r >= 1e7) return `${sign}₹${trim(Math.round(r / 1e6) / 10)}Cr`;
  if (r >= 1e5) return `${sign}₹${trim(Math.round(r / 1e4) / 10)}L`;
  if (r >= 1e3) return `${sign}₹${trim(Math.round(r / 100) / 10)}k`;
  return `${sign}₹${Math.round(r)}`;
}

const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** 1,234 or 2.5 — counts and quantities. */
export const formatNum = (n: number) => nf.format(n);

/** Summary figures read better without paise. */
export const wholeRupees = (paise: number) => Math.round(paise / 100) * 100;

/** Picks `<key>One` for a count of 1 ("1 bill"), else `<key>` ("3 bills"). */
export const plural = (key: string, n: number) => t(n === 1 ? `${key}One` : key, { n: formatNum(n) });

/** Whole-number % change, or null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** "↑ 12% vs last Saturday" — plain words, arrow plus text (never colour alone). */
export function Change({ cur, prev, against, neutral, className }: { cur: number; prev: number; against: string; neutral?: boolean; className?: string }) {
  const p = pctChange(cur, prev);
  if (p === null) return <span className={cn('text-ink-3', className)}>{t('dashboard.noCompare', { against })}</span>;
  const text = p === 0 ? t('dashboard.sameAs', { against }) : t(p > 0 ? 'dashboard.up' : 'dashboard.down', { pct: Math.abs(p), against });
  return <span className={cn(neutral || p === 0 ? 'text-ink-2' : p > 0 ? 'text-ok' : 'text-danger', className)}>{text}</span>;
}

export interface SeriesPoint {
  label: string;
  /** full label for the tooltip, e.g. "Sat, 27 Sep" */
  title: string;
  sales: number;
  bills: number;
  /** drawn in the lighter step, e.g. today's partial figure */
  muted?: boolean;
}

function ChartTip({ active, point }: { active?: boolean; point?: SeriesPoint }) {
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-[13px] shadow-pop">
      <p className="font-medium text-ink">{point.title}</p>
      <p className="num text-ink-2">
        {formatMoney(point.sales)} · {plural('sales.billsN', point.bills)}
      </p>
    </div>
  );
}

/** Sales per period as columns. */
export function SalesColumns({ data, height = 220, ariaLabel }: { data: SeriesPoint[]; height?: number; ariaLabel: string }) {
  const many = data.length > 16;
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={many ? '18%' : '28%'}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            tick={{ fill: C.axis, fontSize: 12 }}
            interval="preserveStartEnd"
            minTickGap={10}
          />
          <YAxis tickFormatter={(v: number) => compactRupees(v)} tickLine={false} axisLine={false} tick={{ fill: C.axis, fontSize: 12 }} width={56} allowDecimals={false} />
          <Tooltip cursor={{ fill: C.hover }} content={(p) => <ChartTip active={p.active} point={p.payload?.[0]?.payload as SeriesPoint | undefined} />} isAnimationActive={false} />
          <Bar
            dataKey="sales"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
            shape={(p: BarShapeProps) => <Rectangle {...p} fill={data[p.index]?.muted ? C.brandSoft : C.brand} />}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal share bars: label, bar, ₹ and %. Plain HTML so labels never clip. */
export function ShareBars({ rows, empty }: { rows: { key: string; label: ReactNode; value: number; sub?: ReactNode }[]; empty?: ReactNode }) {
  const total = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <>{empty}</>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = total ? (r.value / total) * 100 : 0;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">
                {r.label}
                {r.sub && <span className="ml-2 text-[13px] text-ink-3">{r.sub}</span>}
              </span>
              <span className="num shrink-0 text-ink">
                {formatMoney(wholeRupees(r.value))}
                <span className="ml-2 inline-block w-11 text-right text-[13px] text-ink-3">{pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%</span>
              </span>
            </div>
            <div className="mt-1 h-2 rounded-sm bg-paper-2" aria-hidden>
              <div className="h-2 rounded-sm bg-brand" style={{ width: `${Math.max(0.5, (r.value / max) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
