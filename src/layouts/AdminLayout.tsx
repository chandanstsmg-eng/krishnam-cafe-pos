import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  Armchair,
  BarChart3,
  BookUser,
  CalendarCheck2,
  FileText,
  Gauge,
  History,
  IndianRupee,
  Menu as MenuIcon,
  MonitorSmartphone,
  Package,
  Settings,
  Tags,
  Truck,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCan } from '../features/auth/session';
import { NotificationsBell } from '../components/NotificationsBell';
import { GlobalSearch } from '../components/GlobalSearch';
import { UserMenu } from '../components/UserMenu';
import { BrandMark } from '../components/BrandMark';
import { Button } from '../components/ui/Button';
import { SkeletonRows } from '../components/ui/Misc';
import { currentLanguage, setLanguage, useT } from '../i18n';
import { cn } from '../utils/cn';
import type { AppSettings } from '../../shared/types';
import type { PermissionKey } from '../../shared/permissions';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  perm: PermissionKey[];
  end?: boolean;
}

/** Back office for the owner and manager. */
export function AdminLayout() {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ settings: AppSettings }>('/settings'), staleTime: 60_000 });

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const lang = data?.settings.language;
    if (lang && lang !== currentLanguage()) setLanguage(lang);
  }, [data?.settings.language]);

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: t('nav.groupToday'),
      items: [
        { to: '/admin', label: t('nav.dashboard'), icon: Gauge, perm: ['reports.view'], end: true },
        { to: '/admin/sales', label: t('nav.sales'), icon: BarChart3, perm: ['reports.view'] },
        { to: '/admin/closing', label: t('nav.closing'), icon: CalendarCheck2, perm: ['day.close'] },
      ],
    },
    {
      title: t('nav.groupMoney'),
      items: [
        { to: '/admin/reports', label: t('nav.reports'), icon: FileText, perm: ['reports.view'] },
        { to: '/admin/expenses', label: t('nav.expenses'), icon: IndianRupee, perm: ['expenses.manage'] },
        { to: '/admin/shifts', label: t('nav.shifts'), icon: Wallet, perm: ['reports.view', 'shifts.manage'] },
      ],
    },
    {
      title: t('nav.groupMenuStock'),
      items: [
        { to: '/admin/menu', label: t('nav.menu'), icon: UtensilsCrossed, perm: ['menu.manage'] },
        { to: '/admin/prices', label: t('nav.prices'), icon: Tags, perm: ['menu.prices', 'menu.manage'] },
        { to: '/admin/inventory', label: t('nav.inventory'), icon: Package, perm: ['inventory.manage'] },
        { to: '/admin/suppliers', label: t('nav.suppliers'), icon: Truck, perm: ['inventory.manage', 'expenses.manage'] },
      ],
    },
    {
      title: t('nav.groupPeople'),
      items: [
        { to: '/admin/floor', label: t('nav.floor'), icon: Armchair, perm: ['tables.manage', 'settings.manage'] },
        { to: '/admin/customers', label: t('nav.customers'), icon: BookUser, perm: ['customers.view'] },
        { to: '/admin/staff', label: t('nav.staff'), icon: UsersRound, perm: ['staff.manage'] },
      ],
    },
    {
      title: t('nav.groupSystem'),
      items: [
        { to: '/admin/settings', label: t('nav.settings'), icon: Settings, perm: ['settings.manage'] },
        { to: '/admin/audit', label: t('nav.audit'), icon: History, perm: ['audit.view'] },
      ],
    },
  ];

  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.perm.some((p) => can(p))) })).filter((g) => g.items.length);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
        <BrandMark size={30} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[14px] font-semibold">{data?.settings.business.name ?? t('app.name')}</p>
          <p className="text-[11px] text-ink-3">{t('nav.backOffice')}</p>
        </div>
      </div>
      <nav aria-label={t('nav.backOffice')} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        {visible.map((g) => (
          <div key={g.title} className="mb-4">
            <p className="mb-1 px-2.5 text-[11px] font-semibold tracking-[0.06em] text-ink-4 uppercase">{g.title}</p>
            {g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.end}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[14px] transition-colors',
                    isActive ? 'bg-brand-50 font-semibold text-brand' : 'text-ink-2 hover:bg-paper-2 hover:text-ink',
                  )
                }
              >
                <i.icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
                {i.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {(can('orders.take') || can('payments.accept')) && (
        <div className="border-t border-line p-3">
          <Button variant="dark" block icon={<MonitorSmartphone className="h-4 w-4" />} onClick={() => navigate('/pos/tables')}>
            {t('nav.openPos')}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.backOffice')}>
          <div className="w-64 bg-surface shadow-pop">{sidebar}</div>
          <button className="flex-1 bg-ink/40" aria-label={t('common.close')} onClick={() => setOpen(false)}>
            <X className="absolute top-3 left-[17rem] h-6 w-6 text-white" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 lg:px-6">
          <button className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-paper-2 lg:hidden" aria-label={t('nav.openMenu')} onClick={() => setOpen(true)}>
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <GlobalSearch />
          <NotificationsBell />
          <UserMenu area="admin" />
        </header>
        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-4 py-5 lg:px-6 lg:py-6">
            <Suspense fallback={<SkeletonRows rows={8} />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

