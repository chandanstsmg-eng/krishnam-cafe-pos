import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FileText, Printer } from 'lucide-react';
import { api, errorMessage, qs } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { EmptyState, PageHeader, Panel, SkeletonRows, Stat } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { printPage } from '../../services/print';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney, formatMoneyAscii } from '../../../shared/money';
import { addDays, businessDate, formatDate, formatDateLong, formatDateTime } from '../../../shared/dates';
import type { AppSettings } from '../../../shared/types';
import { formatNum } from './charts';

type ColType = 'text' | 'money' | 'number' | 'qty' | 'percent' | 'date' | 'datetime';
type Cell = string | number | null | undefined;

interface ReportMeta {
  key: string;
  title: string;
}

interface Report {
  key: string;
  title: string;
  from: string;
  to: string;
  columns: { key: string; label: string; type: ColType }[];
  rows: Record<string, Cell>[];
  totals?: Record<string, Cell>;
  summary?: { label: string; value: number; type: ColType }[];
  note?: string;
}

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom';

function presetRange(p: Exclude<Preset, 'custom'>, today = businessDate()): { from: string; to: string } {
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week': {
      // Week starts on Monday.
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
      return { from: addDays(today, -((dow + 6) % 7)), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
  }
}

const isNumeric = (t: ColType) => t === 'money' || t === 'number' || t === 'qty' || t === 'percent';

/** Formats one cell. `ascii` swaps ₹ for plain numbers (PDF standard fonts lack the glyph). */
function formatCell(v: Cell, type: ColType, ascii = false): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') {
    if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
    if (type === 'datetime' && v.includes('T')) return formatDateTime(v).replace(/\s+/g, ' ');
    return v;
  }
  switch (type) {
    case 'money':
      return ascii ? formatMoneyAscii(v) : formatMoney(v);
    case 'percent':
      return `${formatNum(v)}%`;
    default:
      return formatNum(v);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default function ReportsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState(() => presetRange('today'));
  const today = businessDate();

  // Re-checked now and then: new reports appear after an update without closing the tab.
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportMeta[]>('/reports'), staleTime: 5 * 60_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ settings: AppSettings }>('/settings'), staleTime: 60_000 });
  const reports = list.data ?? [];
  const key = params.get('key') || 'sales';
  const badRange = range.from > range.to;

  const report = useQuery({
    queryKey: ['report', key, range.from, range.to],
    queryFn: () => api.get<Report>(`/reports/${encodeURIComponent(key)}${qs({ from: range.from, to: range.to })}`),
    enabled: !badRange,
    placeholderData: keepPreviousData,
  });
  const r = report.data && report.data.key === key ? report.data : undefined;

  const choose = (k: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set('key', k);
    return n;
  });

  const pickPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(p, today));
  };

  const businessName = settings.data?.settings.business.name ?? t('app.name');
  const rangeText = range.from === range.to ? formatDateLong(range.from) : t('reportsPage.rangeText', { from: formatDateLong(range.from), to: formatDateLong(range.to) });
  const csvHref = `/api/reports/${encodeURIComponent(key)}${qs({ from: range.from, to: range.to, format: 'csv' })}`;

  const presets: { value: Preset; label: string }[] = [
    { value: 'today', label: t('reportsPage.today') },
    { value: 'yesterday', label: t('reportsPage.yesterday') },
    { value: 'week', label: t('reportsPage.thisWeek') },
    { value: 'month', label: t('reportsPage.thisMonth') },
    { value: 'lastMonth', label: t('reportsPage.lastMonth') },
    { value: 'custom', label: t('reportsPage.custom') },
  ];

  const printReport = () => {
    if (!r) return;
    const head = r.columns.map((c) => `<th class="${isNumeric(c.type) ? 'r' : ''}">${esc(c.label)}</th>`).join('');
    const row = (x: Record<string, Cell>) => r.columns.map((c) => `<td class="${isNumeric(c.type) ? 'r' : ''}">${esc(formatCell(x[c.key], c.type))}</td>`).join('');
    const summary = r.summary?.length ? `<p class="meta">${r.summary.map((s) => `${esc(s.label)}: <b>${esc(formatCell(s.value, s.type))}</b>`).join(' &nbsp;·&nbsp; ')}</p>` : '';
    const html = `<h1>${esc(r.title)}</h1><p class="meta">${esc(businessName)} · ${esc(rangeText)} · ${esc(t('reportsPage.printedAt', { at: formatDateTime(new Date()) }))}</p>${summary}
      <table><thead><tr>${head}</tr></thead><tbody>${r.rows.map((x) => `<tr>${row(x)}</tr>`).join('')}</tbody>${r.totals ? `<tfoot><tr>${row(r.totals)}</tr></tfoot>` : ''}</table>
      ${r.note ? `<p class="meta" style="margin-top:10px">${esc(r.note)}</p>` : ''}`;
    printPage(`${r.title} — ${rangeText}`, html);
  };

  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadPdf = async () => {
    if (!r) return;
    setPdfBusy(true);
    try {
      const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
      const wide = r.columns.length > 7;
      const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(r.title, 14, 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(`${businessName}  ·  ${rangeText}  ·  ${t('reportsPage.amountsInRs')}`, 14, 22);
      let y = 27;
      if (r.summary?.length) {
        doc.setTextColor(20);
        doc.text(r.summary.map((s) => `${s.label}: ${s.type === 'money' ? `Rs ${formatMoneyAscii(s.value)}` : formatCell(s.value, s.type, true)}`).join('    '), 14, y);
        y += 5;
      }
      const align = Object.fromEntries(r.columns.map((c, i) => [i, { halign: isNumeric(c.type) ? ('right' as const) : ('left' as const) }]));
      const cells = (x: Record<string, Cell>) => r.columns.map((c) => formatCell(x[c.key], c.type, true));
      autoTable(doc, {
        startY: y,
        head: [r.columns.map((c) => (c.type === 'money' ? `${c.label} (Rs)` : c.label))],
        body: r.rows.map(cells),
        foot: r.totals ? [cells(r.totals)] : undefined,
        showFoot: 'lastPage',
        styles: { fontSize: 8, cellPadding: 1.6, textColor: 20 },
        headStyles: { fillColor: [31, 91, 69], textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [235, 230, 220], textColor: 20, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 246, 241] },
        columnStyles: align,
        margin: { left: 14, right: 14 },
      });
      if (r.note) {
        const endY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
        doc.setFontSize(8);
        doc.setTextColor(90);
        doc.text(doc.splitTextToSize(r.note, doc.internal.pageSize.getWidth() - 28), 14, endY + 6);
      }
      doc.save(`${r.key}-${r.from}-to-${r.to}.pdf`);
    } catch (err) {
      toast.error(t('reportsPage.pdfFailed'), errorMessage(err));
    } finally {
      setPdfBusy(false);
    }
  };

  const title = reports.find((x) => x.key === key)?.title ?? r?.title ?? '';

  return (
    <div>
      <PageHeader title={t('reportsPage.title')} subtitle={t('reportsPage.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Report list */}
        <nav aria-label={t('reportsPage.listLabel')} className="min-w-0">
          <div className="lg:hidden">
            <Field label={t('reportsPage.report')} htmlFor="report-pick">
              <Select id="report-pick" value={key} onChange={(e) => choose(e.target.value)}>
                {reports.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="hidden rounded-lg border border-line bg-surface p-1.5 shadow-card lg:block">
            {list.isLoading ? (
              <SkeletonRows rows={12} className="space-y-1.5 p-1" />
            ) : (
              <ul>
                {reports.map((x) => (
                  <li key={x.key}>
                    <button
                      type="button"
                      onClick={() => choose(x.key)}
                      aria-current={x.key === key ? 'page' : undefined}
                      className={cn(
                        'flex min-h-10 w-full items-center rounded-md px-3 text-left text-[14px] transition-colors',
                        x.key === key ? 'bg-brand-50 font-semibold text-brand' : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
                      )}
                    >
                      {x.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </nav>

        {/* The report */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
                <p className="text-[13px] text-ink-3">{rangeText}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={csvHref}
                  download
                  aria-disabled={!r || badRange}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-md border border-line-2 bg-surface px-4 text-sm font-medium text-ink hover:bg-paper',
                    (!r || badRange) && 'pointer-events-none text-ink-4',
                  )}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  {t('reportsPage.csv')}
                </a>
                <Button icon={<FileText className="h-4 w-4" />} onClick={downloadPdf} loading={pdfBusy} disabled={!r || badRange}>
                  {t('reportsPage.pdf')}
                </Button>
                <Button icon={<Printer className="h-4 w-4" />} onClick={printReport} disabled={!r || badRange}>
                  {t('common.print')}
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <div className="max-w-full overflow-x-auto" role="radiogroup" aria-label={t('reportsPage.dates')}>
                <div className="inline-flex rounded-md border border-line-2 bg-paper p-0.5">
                  {presets.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={preset === p.value}
                      onClick={() => pickPreset(p.value)}
                      className={cn(
                        'inline-flex h-9 items-center rounded-[5px] px-3 text-sm font-medium whitespace-nowrap transition-colors',
                        preset === p.value ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(28_26_22/0.12)] ring-1 ring-line-2' : 'text-ink-3 hover:text-ink',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 items-end gap-2 sm:flex [&>*]:min-w-0">
                <Field label={t('common.from')} htmlFor="rep-from">
                  <Input
                    id="rep-from"
                    type="date"
                    value={range.from}
                    max={today}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setPreset('custom');
                      setRange((x) => ({ ...x, from: e.target.value }));
                    }}
                    className="w-full sm:w-40"
                  />
                </Field>
                <Field label={t('common.to')} htmlFor="rep-to">
                  <Input
                    id="rep-to"
                    type="date"
                    value={range.to}
                    max={today}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setPreset('custom');
                      setRange((x) => ({ ...x, to: e.target.value }));
                    }}
                    className="w-full sm:w-40"
                  />
                </Field>
              </div>
            </div>
            {badRange && (
              <p role="alert" className="mt-2 text-[13px] text-danger">
                {t('reportsPage.badRange')}
              </p>
            )}
          </section>

          {report.error && !r ? (
            <Panel>
              <EmptyState title={t('reportsPage.loadFailed')} action={<Button onClick={() => report.refetch()}>{t('dashboard.tryAgain')}</Button>}>
                {errorMessage(report.error)}
              </EmptyState>
            </Panel>
          ) : !r ? (
            badRange ? null : <SkeletonRows rows={8} />
          ) : (
            <div className={cn('space-y-4', report.isFetching && 'opacity-70 transition-opacity')} aria-busy={report.isFetching || undefined}>
              {!!r.summary?.length && (
                <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-line bg-surface px-5 py-4 shadow-card sm:grid-cols-4" aria-label={t('reportsPage.summary')}>
                  {r.summary.map((s) => (
                    <Stat key={s.label} label={s.label} value={formatCell(s.value, s.type) || '0'} />
                  ))}
                </section>
              )}

              <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
                {r.rows.length === 0 ? (
                  <EmptyState icon={<FileText />} title={t('reportsPage.empty')}>
                    {t('reportsPage.emptyHint')}
                  </EmptyState>
                ) : (
                  <div className="scroll-thin max-h-[max(20rem,calc(100dvh-300px))] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-[12px] tracking-wide text-ink-3 uppercase">
                        <tr>
                          {r.columns.map((c) => (
                            <th key={c.key} scope="col" className={cn('sticky top-0 z-10 border-b border-line bg-paper px-3 py-2 font-medium whitespace-nowrap', isNumeric(c.type) && 'text-right')}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {r.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-paper/60">
                            {r.columns.map((c) => (
                              <td key={c.key} className={cn('px-3 py-2', isNumeric(c.type) ? 'num text-right whitespace-nowrap' : c.type === 'text' ? 'text-ink' : 'num whitespace-nowrap text-ink-2')}>
                                {formatCell(row[c.key], c.type) || (row[c.key] === null ? <span className="text-ink-4">—</span> : '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                      {r.totals && (
                        <tfoot>
                          <tr>
                            {r.columns.map((c) => (
                              <td key={c.key} className={cn('sticky bottom-0 border-t-2 border-line-2 bg-paper-2 px-3 py-2 font-semibold', isNumeric(c.type) && 'num text-right whitespace-nowrap')}>
                                {formatCell(r.totals![c.key], c.type)}
                              </td>
                            ))}
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </section>
              {r.note && <p className="text-[13px] text-ink-3">{r.note}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
