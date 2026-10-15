import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'plum' | 'accent';

const tones: Record<Tone, string> = {
  neutral: 'bg-paper-2 text-ink-2 border-line',
  ok: 'bg-ok-50 text-ok border-ok/20',
  warn: 'bg-warn-50 text-warn border-warn/20',
  danger: 'bg-danger-50 text-danger border-danger/20',
  info: 'bg-info-50 text-info border-info/20',
  brand: 'bg-brand-50 text-brand border-brand/20',
  plum: 'bg-plum-50 text-plum border-plum/20',
  accent: 'bg-accent-50 text-accent border-accent/25',
};

/** Always pair the colour with an icon or a word. */
export function Badge({ tone = 'neutral', icon, children, className, size = 'md' }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-px text-[11px]' : 'px-2 py-0.5 text-xs',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  const bg: Record<Tone, string> = { neutral: 'bg-ink-4', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', info: 'bg-info', brand: 'bg-brand', plum: 'bg-plum', accent: 'bg-accent' };
  return <span aria-hidden className={cn('inline-block h-2 w-2 shrink-0 rounded-full', bg[tone], className)} />;
}
