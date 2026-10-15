import { useMemo } from 'react';
import { usePos, NONE } from './store';
import { openTable, setTable } from './draft';
import { Dialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/Toast';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import { billFor } from '../../services/sync';

/**
 * Pick (or move to) a table. A table with a running order stays held until it
 * is paid: it can't take a second order, but an empty draft can jump to it.
 */
export function TablePickerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const tables = usePos((s) => s.boot?.tables ?? NONE);
  const orders = usePos((s) => s.orders);
  const draft = usePos((s) => s.draft);
  const blankDraft = !!draft && !draft.items.length && !orders[draft.id];

  const busy = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of Object.values(orders)) if (o.tableId && o.id !== draft?.id) m.set(o.tableId, (m.get(o.tableId) ?? 0) + billFor(o).total);
    return m;
  }, [orders, draft?.id]);

  const areas = useMemo(() => {
    const m = new Map<string, typeof tables>();
    for (const tb of tables) {
      const a = tb.area || t('tables.noArea');
      m.set(a, [...(m.get(a) ?? []), tb]);
    }
    return [...m.entries()];
  }, [tables, t]);

  return (
    <Dialog open={open} onClose={onClose} title={draft?.tableId ? t('pos.moveTable') : t('pos.chooseTable')} size="lg">
      <div className="space-y-5">
        {areas.map(([area, list]) => (
          <section key={area}>
            <h3 className="mb-2 text-[13px] font-medium text-ink-3">{area}</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
              {list.map((tb) => {
                const amount = busy.get(tb.id);
                const current = draft?.tableId === tb.id;
                return (
                  <button
                    key={tb.id}
                    onClick={() => {
                      if (amount != null) {
                        if (!blankDraft) return toast.error(t('tables.busyTitle', { n: tb.name }), t('tables.busyDetail'));
                        openTable(tb.id);
                      } else setTable(tb.id);
                      onClose();
                    }}
                    aria-current={current || undefined}
                    aria-disabled={(amount != null && !blankDraft) || undefined}
                    className={cn(
                      'flex h-20 flex-col items-start justify-between rounded-md border p-2.5 text-left transition-colors',
                      current ? 'border-brand bg-brand-50 ring-1 ring-brand' : amount != null ? cn('border-warn/40 bg-warn-50/60', blankDraft ? 'hover:bg-warn-50' : 'cursor-not-allowed opacity-60') :tb.hold === 'RESERVED' ? 'border-plum/30 bg-plum-50/60' : 'border-line-2 hover:bg-paper',
                    )}
                  >
                    <span className="text-[17px] font-semibold">{tb.name}</span>
                    <span className="text-[12px] text-ink-3">
                      {current ? t('tables.thisOrder') : amount != null ? `${blankDraft ? t('tables.openRunning') : t('tables.occupied')} · ${formatMoney(amount)}` : tb.hold === 'RESERVED' ? t('tables.reserved') : t('tables.seats', { n: tb.capacity })}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
