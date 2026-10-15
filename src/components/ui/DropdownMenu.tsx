import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../utils/cn';

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}

/** Small popover menu, keyboard friendly (arrows, Enter, Esc). */
export function DropdownMenu({ trigger, items, align = 'right', className, label }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; items: (MenuItem | 'divider')[]; align?: 'left' | 'right'; className?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (idx + 1) % btns.length : (idx - 1 + btns.length) % btns.length;
        btns[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          className={cn('animate-pop absolute z-50 mt-1.5 min-w-52 rounded-lg border border-line bg-surface p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}
        >
          {items.map((it, i) =>
            it === 'divider' ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm focus:outline-none disabled:opacity-40',
                  it.danger ? 'text-danger hover:bg-danger-50 focus:bg-danger-50' : 'text-ink hover:bg-paper focus:bg-paper',
                )}
              >
                {it.icon && <span className={cn('shrink-0 [&>svg]:h-4 [&>svg]:w-4', it.danger ? 'text-danger' : 'text-ink-3')}>{it.icon}</span>}
                <span className="flex-1">{it.label}</span>
                {it.hint && <span className="text-xs text-ink-4">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
