import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Search, X } from 'lucide-react';
import { usePos, NONE } from './store';
import { addItem } from './draft';
import { ItemOptionsDialog } from './ItemOptionsDialog';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Kbd } from '../../components/ui/Misc';
import { toast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../api/client';
import { useCan } from '../auth/session';
import { refresh } from '../../services/sync';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../../shared/money';
import type { CatalogItem } from '../../../shared/types';

export function CategoryRail({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT();
  const boot = usePos((s) => s.boot);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of boot?.items ?? []) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1);
    return m;
  }, [boot]);
  if (!boot) return null;
  const cats = [{ id: 'all', name: t('pos.allItems'), icon: 'utensils-all' }, ...boot.categories];
  return (
    <nav aria-label={t('pos.categories')} className="scroll-thin flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
      {cats.map((c) => {
        const active = value === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            aria-current={active || undefined}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2.5 rounded-md px-3 text-left text-[14px] font-medium transition-colors lg:w-full',
              active ? 'bg-brand text-white' : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
            )}
          >
            <CategoryIcon name={c.icon} className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-white/85' : 'text-ink-3')} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            {c.id !== 'all' && <span className={cn('num hidden text-xs lg:inline', active ? 'text-white/70' : 'text-ink-4')}>{counts.get(c.id) ?? 0}</span>}
          </button>
        );
      })}
    </nav>
  );
}

export function MenuGrid({ category, onCategory }: { category: string; onCategory: (id: string) => void }) {
  const t = useT();
  const can = useCan();
  const items = usePos((s) => s.boot?.items ?? NONE);
  const categories = usePos((s) => s.boot?.categories ?? NONE);
  const draft = usePos((s) => s.draft);
  const offline = usePos((s) => s.connection === 'offline');
  const [q, setQ] = useState('');
  const [optionsFor, setOptionsFor] = useState<CatalogItem | null>(null);
  const [soldOutMode, setSoldOutMode] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const inOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of draft?.items ?? []) m.set(l.menuItemId, (m.get(l.menuItemId) ?? 0) + l.qty);
    return m;
  }, [draft]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term) {
      const code = term.toUpperCase();
      return items
        .filter((i) => i.name.toLowerCase().includes(term) || i.code === code)
        .sort((a, b) => Number(b.code === code) - Number(a.code === code) || Number(b.name.toLowerCase().startsWith(term)) - Number(a.name.toLowerCase().startsWith(term)));
    }
    if (category !== 'all') return items.filter((i) => i.categoryId === category);
    const order = new Map(categories.map((c, idx) => [c.id, idx]));
    return [...items].sort((a, b) => (order.get(a.categoryId) ?? 99) - (order.get(b.categoryId) ?? 99));
  }, [items, categories, q, category]);

  // "/" or Ctrl+F jumps to search, like most tills.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName) || document.querySelector('dialog[open]');
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tap = async (item: CatalogItem) => {
    if (soldOutMode) {
      try {
        await api.patch(`/menu/${item.id}`, { available: !item.available });
        toast.success(item.available ? t('pos.markedSoldOut', { name: item.name }) : t('pos.markedAvailable', { name: item.name }));
        void refresh();
      } catch (err) {
        toast.error(errorMessage(err));
      }
      return;
    }
    if (!item.available) return;
    if (!draft) return;
    if (item.modifierGroups.length) setOptionsFor(item);
    else addItem(item);
  };

  const addFirst = () => {
    const first = shown.find((i) => i.available);
    if (!first) return;
    if (first.modifierGroups.length) setOptionsFor(first);
    else addItem(first);
    setQ('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-4" aria-hidden />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addFirst();
              if (e.key === 'Escape') setQ('');
            }}
            placeholder={t('pos.searchMenu')}
            aria-label={t('pos.searchMenu')}
            className="h-10 w-full rounded-md border border-line-2 bg-paper/60 pr-16 pl-9 text-sm placeholder:text-ink-4 focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/15"
          />
          {q ? (
            <button onClick={() => setQ('')} aria-label={t('common.clear')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-4 hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <span className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 lg:block">
              <Kbd>/</Kbd>
            </span>
          )}
        </div>
        {can('orders.take') && (
          <button
            onClick={() => setSoldOutMode((v) => !v)}
            disabled={offline}
            aria-pressed={soldOutMode}
            title={t('pos.soldOutModeHint')}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors disabled:opacity-40',
              soldOutMode ? 'border-danger/40 bg-danger-50 text-danger' : 'border-line-2 text-ink-2 hover:bg-paper',
            )}
          >
            <Ban className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{soldOutMode ? t('pos.soldOutModeOn') : t('pos.soldOutMode')}</span>
          </button>
        )}
      </div>

      {soldOutMode && <div className="border-b border-danger/20 bg-danger-50 px-4 py-2 text-[13px] text-danger">{t('pos.soldOutModeBanner')}</div>}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {q && (
          <p className="mb-2 text-[13px] text-ink-3">
            {t('pos.searchResults', { n: shown.length })}
            {shown.length > 0 && <span className="ml-2 hidden md:inline">{t('pos.enterToAdd')}</span>}
          </p>
        )}
        {shown.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-3">
            {t('pos.noMenuMatch')}
            {q && category !== 'all' && (
              <button className="ml-1 text-brand underline" onClick={() => onCategory('all')}>
                {t('pos.searchAll')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(142px,1fr))] gap-2">
            {shown.map((item) => {
              const n = inOrder.get(item.id) ?? 0;
              const disabled = !item.available && !soldOutMode;
              return (
                <button
                  key={item.id}
                  onClick={() => tap(item)}
                  onContextMenu={(e) => {
                    if (!can('orders.take')) return;
                    e.preventDefault();
                    setSoldOutMode(true);
                  }}
                  disabled={disabled || (!draft && !soldOutMode)}
                  aria-label={`${item.name}, ${formatMoney(item.price)}${!item.available ? `, ${t('pos.soldOut')}` : ''}${n ? `, ${t('pos.inOrder', { n })}` : ''}`}
                  className={cn(
                    'group relative flex h-[82px] flex-col justify-between rounded-md border bg-surface px-3 py-2.5 text-left transition-[background-color,border-color,transform] duration-75 active:scale-[0.98]',
                    n ? 'border-brand/50 bg-brand-50/50' : 'border-line hover:border-line-2 hover:bg-paper/50',
                    !item.available && 'border-dashed bg-paper opacity-60',
                    soldOutMode && 'ring-1 ring-danger/20',
                  )}
                >
                  <span className="line-clamp-2 pr-5 text-[14px] leading-tight font-medium text-ink">{item.name}</span>
                  <span className="flex items-end justify-between gap-1">
                    <span className="num text-[14px] font-semibold text-ink-2">{formatMoney(item.price)}</span>
                    {!item.available ? (
                      <span className="text-[11px] font-semibold tracking-wide text-danger uppercase">{t('pos.soldOut')}</span>
                    ) : item.modifierGroups.length ? (
                      <span className="text-[11px] text-ink-4">{t('pos.options')}</span>
                    ) : item.code ? (
                      <span className="font-mono text-[11px] text-ink-4">{item.code}</span>
                    ) : null}
                  </span>
                  {n > 0 && <span className="num absolute top-1.5 right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{n}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ItemOptionsDialog
        item={optionsFor}
        onClose={() => setOptionsFor(null)}
        onAdd={(mods, qty, note) => {
          if (optionsFor) addItem(optionsFor, mods, qty, note);
          setOptionsFor(null);
          setQ('');
        }}
      />
    </div>
  );
}

