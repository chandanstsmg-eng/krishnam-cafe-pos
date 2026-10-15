import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Bell, CalendarX, Clock, Package, Receipt, Wallet } from 'lucide-react';
import { api } from '../api/client';
import { useLive } from '../hooks/useLive';
import { useT } from '../i18n';
import { cn } from '../utils/cn';

interface Notice {
  id: string;
  kind: 'low_stock' | 'table_waiting' | 'payment_pending' | 'shift_open' | 'day_open';
  title: string;
  detail: string;
  link: string;
}

const ICONS = { low_stock: Package, table_waiting: Clock, payment_pending: Receipt, shift_open: Wallet, day_open: CalendarX };

/** A handful of useful alerts only — never a stream of noise. */
export function NotificationsBell() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notice[]>('/notifications'), refetchInterval: 60_000, retry: false });
  useLive(['orders', 'inventory', 'shift', 'kitchen'], [['notifications']]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={data.length ? t('notices.countLabel', { n: data.length }) : t('notices.label')}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-paper-2 hover:text-ink"
      >
        <Bell className="h-[18px] w-[18px]" />
        {data.length > 0 && <span className="num absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{data.length}</span>}
      </button>
      {open && (
        <div className="animate-pop absolute right-0 z-50 mt-2 w-[340px] max-w-[calc(100vw-24px)] rounded-lg border border-line bg-surface shadow-pop">
          <p className="border-b border-line px-4 py-2.5 text-sm font-semibold">{t('notices.title')}</p>
          {data.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-3">{t('notices.none')}</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {data.map((n) => {
                const Icon = ICONS[n.kind];
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        setOpen(false);
                        navigate(n.link);
                      }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-paper"
                    >
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', n.kind === 'low_stock' ? 'text-warn' : n.kind === 'day_open' || n.kind === 'shift_open' ? 'text-accent' : 'text-info')} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{n.title}</span>
                        <span className="block text-[13px] text-ink-3">{n.detail}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
