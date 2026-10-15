import { create } from 'zustand';
import { AlertTriangle, BellRing, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn';
import { t } from '../../i18n';

type Tone = 'success' | 'error' | 'info' | 'warning' | 'alert';
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
  action?: ToastAction;
}

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let nextId = 1;

function push(tone: Tone, title: string, detail?: string, ms = tone === 'error' ? 6500 : 3200, action?: ToastAction) {
  const id = nextId++;
  useToasts.setState((s) => ({ items: [...s.items.filter((i) => i.title !== title), { id, tone, title, detail, action }].slice(-4) }));
  setTimeout(() => dismiss(id), ms);
}
const dismiss = (id: number) => useToasts.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));

export const toast = {
  success: (title: string, detail?: string) => push('success', title, detail),
  error: (title: string, detail?: string) => push('error', title, detail),
  info: (title: string, detail?: string) => push('info', title, detail),
  warning: (title: string, detail?: string) => push('warning', title, detail, 5000),
  /** Something another device did that needs this person's attention (stays longer, can jump to it). */
  alert: (title: string, detail?: string, action?: ToastAction) => push('alert', title, detail, 12000, action),
};

const icons = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle, alert: BellRing };
const tones = {
  success: 'text-ok',
  error: 'text-danger',
  info: 'text-info',
  warning: 'text-warn',
  alert: 'text-accent',
};

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed top-16 left-1/2 z-[100] flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2">
      {items.map((i) => {
        const Icon = icons[i.tone];
        return (
          <div key={i.id} role={i.tone === 'error' || i.tone === 'alert' ? 'alert' : 'status'} className={cn('animate-pop pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-pop', i.tone === 'alert' ? 'border-accent/40' : 'border-line')}>
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tones[i.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{i.title}</p>
              {i.detail && <p className="mt-0.5 text-[13px] text-ink-3">{i.detail}</p>}
            </div>
            {i.action && (
              <button
                onClick={() => {
                  dismiss(i.id);
                  i.action!.onClick();
                }}
                className="-my-1 shrink-0 rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-600"
              >
                {i.action.label}
              </button>
            )}
            <button onClick={() => dismiss(i.id)} aria-label={t('common.dismiss')} className="-m-1 rounded p-1 text-ink-4 hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
