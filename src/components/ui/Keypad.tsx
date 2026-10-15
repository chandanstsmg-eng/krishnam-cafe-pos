import { Delete } from 'lucide-react';
import { cn } from '../../utils/cn';
import { t } from '../../i18n';

/** Big touch keypad for PINs and cash amounts. */
export function Keypad({ onKey, allowDot, className, size = 'lg' }: { onKey: (k: string) => void; allowDot?: boolean; className?: string; size?: 'md' | 'lg' }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDot ? '.' : 'clear', '0', 'back'];
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          aria-label={k === 'back' ? t('common.backspace') : k === 'clear' ? t('common.clear') : k}
          className={cn(
            'num flex items-center justify-center rounded-lg border border-line bg-surface font-medium text-ink transition-colors hover:bg-paper active:bg-paper-2',
            size === 'lg' ? 'h-14 text-xl' : 'h-11 text-lg',
            (k === 'clear' || k === 'back') && 'text-[15px] text-ink-3',
          )}
        >
          {k === 'back' ? <Delete className="h-5 w-5" /> : k === 'clear' ? t('common.clear') : k}
        </button>
      ))}
    </div>
  );
}

export function applyKey(value: string, key: string, maxLen = 8) {
  if (key === 'back') return value.slice(0, -1);
  if (key === 'clear') return '';
  if (key === '.' && value.includes('.')) return value;
  if (/\.\d{2}$/.test(value)) return value;
  return (value + key).slice(0, maxLen);
}
