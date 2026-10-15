import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { Button, IconButton } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import type { CatalogItem, OrderModifier } from '../../../shared/types';

export const QUICK_NOTES = ['lessSpicy', 'noOnion', 'extraChutney', 'parcel', 'lessOil', 'noSugar'];

/** Choose options (Butter / Ghee, Half / Full…), quantity and a note. */
export function ItemOptionsDialog({ item, onClose, onAdd }: { item: CatalogItem | null; onClose: () => void; onAdd: (mods: OrderModifier[], qty: number, note: string | null) => void }) {
  const t = useT();
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!item) return;
    const init: Record<string, string[]> = {};
    for (const g of item.modifierGroups) {
      const def = g.options.find((o) => o.isDefault) ?? (g.required ? g.options[0] : undefined);
      init[g.id] = def ? [def.id] : [];
    }
    setChosen(init);
    setQty(1);
    setNote('');
  }, [item]);

  if (!item) return <Dialog open={false} onClose={onClose} />;

  const mods: OrderModifier[] = item.modifierGroups.flatMap((g) =>
    (chosen[g.id] ?? []).map((oid) => {
      const o = g.options.find((x) => x.id === oid)!;
      return { groupName: g.name, name: o.name, priceDelta: o.priceDelta };
    }),
  );
  const unit = item.price + mods.reduce((a, m) => a + m.priceDelta, 0);
  const missing = item.modifierGroups.some((g) => g.required && !(chosen[g.id] ?? []).length);

  const toggle = (gid: string, oid: string, multiple: boolean, required: boolean) =>
    setChosen((c) => {
      const cur = c[gid] ?? [];
      if (!multiple) return { ...c, [gid]: cur[0] === oid && !required ? [] : [oid] };
      return { ...c, [gid]: cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur, oid] };
    });

  const add = () => !missing && onAdd(mods, qty, note.trim() || null);

  return (
    <Dialog
      open
      onClose={onClose}
      title={item.name}
      description={formatMoney(item.price)}
      size="md"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <IconButton label={t('pos.less')} onClick={() => setQty((q) => Math.max(1, q - 1))} className="border border-line-2">
              <Minus className="h-4 w-4" />
            </IconButton>
            <span className="num w-8 text-center text-lg font-semibold" aria-live="polite">
              {qty}
            </span>
            <IconButton label={t('pos.more')} onClick={() => setQty((q) => Math.min(99, q + 1))} className="border border-line-2">
              <Plus className="h-4 w-4" />
            </IconButton>
          </div>
          <Button variant="primary" size="lg" onClick={add} disabled={missing}>
            {t('pos.addToOrder')} · <span className="num">{formatMoney(unit * qty)}</span>
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="space-y-5"
      >
        {item.modifierGroups.map((g) => (
          <fieldset key={g.id}>
            <legend className="mb-2 text-[13px] font-medium text-ink-2">
              {g.name}
              {g.required ? '' : ` (${t('common.optional')})`}
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {g.options.map((o) => {
                const on = (chosen[g.id] ?? []).includes(o.id);
                return (
                  <button
                    type="button"
                    key={o.id}
                    role={g.multiple ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    onClick={() => toggle(g.id, o.id, g.multiple, g.required)}
                    className={cn(
                      'flex h-14 flex-col items-start justify-center rounded-md border px-3 text-left transition-colors',
                      on ? 'border-brand bg-brand-50 ring-1 ring-brand' : 'border-line-2 hover:bg-paper',
                    )}
                  >
                    <span className="text-sm font-medium">{o.name}</span>
                    <span className="num text-xs text-ink-3">{o.priceDelta === 0 ? t('pos.noExtra') : `${o.priceDelta > 0 ? '+' : '−'}${formatMoney(Math.abs(o.priceDelta))}`}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div>
          <label htmlFor="item-note" className="mb-2 block text-[13px] font-medium text-ink-2">
            {t('pos.note')} <span className="font-normal text-ink-4">({t('common.optional')})</span>
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((k) => {
              const label = t(`notes.${k}`);
              return (
                <button
                  type="button"
                  key={k}
                  onClick={() => setNote((n) => (n.includes(label) ? n : n ? `${n}, ${label}` : label))}
                  className="h-8 rounded-full border border-line-2 px-3 text-[13px] text-ink-2 hover:bg-paper"
                >
                  {label}
                </button>
              );
            })}
          </div>
          <Input id="item-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder={t('pos.notePlaceholder')} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
