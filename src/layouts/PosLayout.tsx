import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { OPEN_ORDER_EVENT } from '../services/liveAlerts';
import { ChefHat, LayoutGrid, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import { initPos } from '../services/sync';
import { usePos } from '../features/pos/store';
import { useCan } from '../features/auth/session';
import { ConnectionStatus, OfflineBanner } from '../components/ConnectionStatus';
import { NotificationsBell } from '../components/NotificationsBell';
import { GlobalSearch } from '../components/GlobalSearch';
import { UserMenu } from '../components/UserMenu';
import { BrandMark } from '../components/BrandMark';
import { useNow } from '../hooks/useNow';
import { useT } from '../i18n';
import { cn } from '../utils/cn';
import { formatDateLong, formatTime } from '../../shared/dates';

/** Full-screen till: a slim top bar and nothing else competing for space. */
export function PosLayout() {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const business = usePos((s) => s.boot?.settings.business.name);
  const hasDraft = usePos((s) => !!s.draft?.items.length);
  const shiftOpen = usePos((s) => !!s.boot?.shift);
  const requireShift = usePos((s) => s.boot?.settings.pos.requireShift ?? false);
  const ready = usePos((s) => s.ready);
  const now = useNow(30_000);

  useEffect(() => {
    void initPos();
  }, []);

  // "Open" on a live alert (new order from a waiter, food ready, …).
  useEffect(() => {
    const onOpen = (e: Event) => navigate(`/pos?order=${(e as CustomEvent<string>).detail}`);
    window.addEventListener(OPEN_ORDER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ORDER_EVENT, onOpen);
  }, [navigate]);

  const tabs = [
    { to: '/pos/tables', label: t('nav.tables'), icon: LayoutGrid, show: true },
    { to: '/pos', label: t('nav.order'), icon: ShoppingBag, show: true, end: true, dot: hasDraft },
    { to: '/pos/bills', label: t('nav.bills'), icon: Receipt, show: can('receipts.print') || can('bills.create') },
    { to: '/pos/shift', label: t('nav.shift'), icon: Wallet, show: can('shifts.manage'), warn: ready && requireShift && !shiftOpen },
    { to: '/kitchen', label: t('nav.kitchen'), icon: ChefHat, show: can('kitchen.view') },
  ].filter((x) => x.show);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:gap-3 sm:px-3">
        <div className="flex min-w-0 items-center gap-2.5 pr-1">
          <BrandMark />
          <div className="hidden min-w-0 leading-tight md:block">
            <p className="max-w-44 truncate text-[14px] font-semibold">{business ?? t('app.name')}</p>
            <p className="num text-[11px] text-ink-3">
              {formatDateLong(new Date(now))} · {formatTime(new Date(now))}
            </p>
          </div>
        </div>
        <nav aria-label={t('nav.pos')} className="no-scrollbar hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'relative flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-[14px] font-medium transition-colors',
                  isActive ? 'bg-ink text-white' : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
                )
              }
            >
              <tab.icon className="h-[18px] w-[18px]" aria-hidden />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.dot && <span className="absolute top-2 right-1.5 h-2 w-2 rounded-full bg-accent" aria-label={t('nav.orderInProgress')} />}
              {tab.warn && <span className="absolute top-2 right-1.5 h-2 w-2 rounded-full bg-danger" aria-label={t('nav.shiftNotOpen')} />}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1 sm:hidden" />
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="hidden md:block">
            <GlobalSearch />
          </div>
          <span className="sm:hidden">
            <ConnectionStatus compact />
          </span>
          <span className="hidden sm:inline-flex">
            <ConnectionStatus />
          </span>
          <NotificationsBell />
          <UserMenu area="pos" />
        </div>
      </header>
      <OfflineBanner />
      {ready && requireShift && !shiftOpen && can('shifts.manage') && (
        <div className="flex items-center justify-center gap-2 border-b border-accent/25 bg-accent-50 px-4 py-1.5 text-[13px] text-ink-2">
          <Wallet className="h-4 w-4 text-accent" aria-hidden />
          {t('shift.notOpenBanner')}
          <NavLink to="/pos/shift" className="font-semibold text-brand underline">
            {t('shift.openNow')}
          </NavLink>
        </div>
      )}
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
      {/* Phones: the tabs move to a thumb-reachable bar at the bottom. */}
      <nav aria-label={t('nav.pos')} className="pb-safe flex shrink-0 border-t border-line bg-surface sm:hidden">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn('relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'text-brand' : 'text-ink-3')
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', isActive && 'bg-brand-50')}>
                  <tab.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="max-w-full truncate px-1">{tab.label}</span>
                {tab.dot && <span className="absolute top-1.5 left-[calc(50%+10px)] h-2 w-2 rounded-full bg-accent" aria-label={t('nav.orderInProgress')} />}
                {tab.warn && <span className="absolute top-1.5 left-[calc(50%+10px)] h-2 w-2 rounded-full bg-danger" aria-label={t('nav.shiftNotOpen')} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
