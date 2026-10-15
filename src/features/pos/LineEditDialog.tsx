import { useEffect, useState } from 'react';
import { ChefHat, Minus, Plus, Trash2 } from 'lucide-react';
import { removeLine, updateLine } from './draft';
import { QUICK_NOTES } from './ItemOptionsDialog';
import { Dialog } from '../../components/ui/Dialog';
import { Button, IconButton } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { useT } from '../../i18n';
import { formatMoney } from '../../../shared/money';
import type { OrderItemDTO } from '../../../shared/types';

export function LineEditDialog({ line, onClose }: { line: OrderItemDTO | null; onClose: () => void }) {
  const t = useT();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (line) {
      setQty(line.qty);
      setNote(line.note ?? '');
    }
  }, [line]);
  if (!line) return <Dialog open={false} onClose={onClose} />;
  const save = () => {
    updateLine(line.id, { qty, note: note.trim() || null });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={line.name}
      description={line.modifiers.map((m) => m.name).join(', ') || formatMoney(line.unitPrice)}
      size="sm"
      footer={
        <>
          <Button
            variant="danger-outline"
            icon={<Trash2 className="h-4 w-4" />}
            className="mr-auto"
            onClick={() => {
              removeLine(line.id);
              onClose();
            }}
          >
            {t('common.remove')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {line.sentQty > 0 && (
          <p className="flex items-center gap-2 rounded-md bg-paper px-3 py-2 text-[13px] text-ink-2">
            <ChefHat className="h-4 w-4 text-ink-3" aria-hidden />
            {t('pos.alreadySent', { n: line.sentQty })}
          </p>
        )}
        <div className="flex items-center justify-center gap-4">
          <IconButton label={t('pos.less')} size="lg" className="border border-line-2" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            <Minus className="h-5 w-5" />
          </IconButton>
          <span className="num w-12 text-center text-3xl font-semibold" aria-live="polite">
            {qty}
          </span>
          <IconButton label={t('pos.more')} size="lg" className="border border-line-2" onClick={() => setQty((q) => Math.min(999, q + 1))}>
            <Plus className="h-5 w-5" />
          </IconButton>
        </div>
        <p className="num text-center text-sm text-ink-3">{formatMoney(line.unitPrice * qty)}</p>
        <Field label={t('pos.note')} htmlFor="line-note" optional>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_NOTES.map((k) => {
              const label = t(`notes.${k}`);
              return (
                <button type="button" key={k} onClick={() => setNote((n) => (n.includes(label) ? n : n ? `${n}, ${label}` : label))} className="h-8 rounded-full border border-line-2 px-3 text-[13px] text-ink-2 hover:bg-paper">
                  {label}
                </button>
              );
            })}
          </div>
          <Input id="line-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder={t('pos.notePlaceholder')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
