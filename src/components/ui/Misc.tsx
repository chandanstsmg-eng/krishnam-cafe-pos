import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('relative overflow-hidden rounded-md bg-paper-2 before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/50 before:to-transparent', className)} />;
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 text-ink-4 [&>svg]:h-9 [&>svg]:w-9">{icon}</div>}
      <p className="font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Money({ value, className, decimals }: { value: number | null | undefined; className?: string; decimals?: 'auto' | 'always' }) {
  if (value == null) return <span className={cn('text-ink-4', className)}>—</span>;
  return <span className={cn('num', className)}>{formatMoney(value, { decimals })}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-2 bg-paper px-1.5 py-px font-mono text-[11px] text-ink-3">{children}</kbd>;
}

export function Panel({ title, action, children, className, bodyClassName, subtitle }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface shadow-card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="text-[13px] text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A labelled figure. Used for the owner's numbers — plain, not decorated. */
export function Stat({ label, value, sub, tone, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'danger'; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[13px] text-ink-3">{label}</p>
      <p className={cn('num mt-1 text-2xl leading-none font-semibold tracking-[-0.01em]', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</p>
      {sub && <p className="mt-1.5 text-[13px] text-ink-3">{sub}</p>}
    </div>
  );
}

export function VegMark({ veg = true }: { veg?: boolean }) {
  return (
    <span aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'} className={cn('inline-flex h-3 w-3 shrink-0 items-center justify-center border', veg ? 'border-ok' : 'border-danger')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', veg ? 'bg-ok' : 'bg-danger')} />
    </span>
  );
}
