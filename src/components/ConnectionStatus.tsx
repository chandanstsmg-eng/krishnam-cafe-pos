import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { usePos } from '../features/pos/store';
import { flush } from '../services/sync';
import { useT } from '../i18n';
import { cn } from '../utils/cn';

/**
 * ● Online — all changes saved
 * ● Offline — working offline, changes will sync
 * ● Syncing — sending queued changes
 */
export function ConnectionStatus({ compact }: { compact?: boolean }) {
  const t = useT();
  const connection = usePos((s) => s.connection);
  const queued = usePos((s) => s.outbox.length);
  const label = connection === 'offline' ? t('sync.offline') : connection === 'syncing' || queued ? t('sync.syncing', { n: queued }) : t('sync.online');
  const detail = connection === 'offline' ? t('sync.offlineDetail') : queued ? t('sync.syncingDetail') : t('sync.allSynced');
  return (
    <button
      onClick={() => void flush()}
      title={detail}
      aria-label={`${label}. ${detail}`}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap',
        connection === 'offline' ? 'border-warn/40 bg-warn-50 text-warn' : queued ? 'border-info/30 bg-info-50 text-info' : 'border-line-2 bg-surface text-ink-2',
      )}
    >
      <span aria-hidden className={cn('h-2 w-2 rounded-full', connection === 'offline' ? 'bg-warn' : queued ? 'animate-pulse bg-info' : 'bg-ok')} />
      {connection === 'offline' ? <CloudOff className="h-3.5 w-3.5" aria-hidden /> : queued ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wifi className="hidden h-3.5 w-3.5" aria-hidden />}
      {!compact && <span>{label}</span>}
    </button>
  );
}

export function OfflineBanner() {
  const t = useT();
  const offline = usePos((s) => s.connection === 'offline');
  const queued = usePos((s) => s.outbox.length);
  if (!offline) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-warn/25 bg-warn-50 px-4 py-1.5 text-[13px] text-warn">
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">{t('sync.offline')}.</strong> {t('sync.offlineDetail')}
        {queued > 0 && ` ${t('sync.queued', { n: queued })}`}
      </span>
    </div>
  );
}
