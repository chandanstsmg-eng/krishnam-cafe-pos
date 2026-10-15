import { cn } from '../../utils/cn';

/** Compact on/off switch for table rows. Always shows its state as a word too. */
export function RowSwitch({ checked, onChange, onText, offText, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; onText: string; offText: string; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex h-10 items-center gap-2 rounded-md pr-1 text-[13px] disabled:opacity-40"
    >
      <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line-2')}>
        <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </span>
      <span className={cn('whitespace-nowrap', checked ? 'text-ink-2' : 'font-medium text-ink-3')}>{checked ? onText : offText}</span>
    </button>
  );
}
