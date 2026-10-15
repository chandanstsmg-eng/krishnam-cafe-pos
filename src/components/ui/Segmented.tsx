import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
  className,
  block,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  size?: 'sm' | 'md' | 'lg';
  label: string;
  className?: string;
  block?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md border border-line-2 bg-paper p-0.5', block && 'flex w-full', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium whitespace-nowrap transition-colors disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-[13px]' : size === 'lg' ? 'h-11 px-4 text-[15px]' : 'h-9 px-3.5 text-sm',
              block && 'flex-1',
              active ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(28_26_22/0.12)] ring-1 ring-line-2' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('no-scrollbar flex gap-1 overflow-x-auto border-b border-line', className)}>
      {tabs.map((tb) => {
        const active = tb.value === value;
        return (
          <button
            key={tb.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tb.value)}
            className={cn(
              '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            {tb.label}
            {tb.count !== undefined && <span className={cn('num rounded px-1.5 text-xs', active ? 'bg-brand-50 text-brand' : 'bg-paper-2 text-ink-3')}>{tb.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
