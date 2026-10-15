import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { loadSession, homeFor, useSession, useCan } from './features/auth/session';
import { LoginPage } from './features/auth/LoginPage';
import { PosLayout } from './layouts/PosLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { OrderScreen } from './features/pos/OrderScreen';
import { TablesScreen } from './features/tables/TablesScreen';
import { BillsScreen } from './features/billing/BillsScreen';
import { ShiftScreen } from './features/shifts/ShiftScreen';
import { KitchenScreen } from './features/kitchen/KitchenScreen';
import { ApprovalHost } from './features/auth/Approval';
import { ConfirmHost } from './components/ui/Confirm';
import { Toaster } from './components/ui/Toast';
import { Button } from './components/ui/Button';
import { SkeletonRows } from './components/ui/Misc';
import { t, useT } from './i18n';
import type { PermissionKey } from '../shared/permissions';

// Back-office pages load on demand so the till starts fast on older PCs.
const Dashboard = lazy(() => import('./features/reports/DashboardPage'));
const SalesPage = lazy(() => import('./features/reports/SalesPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const ClosingPage = lazy(() => import('./features/reports/ClosingPage'));
const MenuPage = lazy(() => import('./features/menu/MenuPage'));
const PricesPage = lazy(() => import('./features/menu/PricesPage'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'));
const SuppliersPage = lazy(() => import('./features/inventory/SuppliersPage'));
const ExpensesPage = lazy(() => import('./features/expenses/ExpensesPage'));
const FloorPage = lazy(() => import('./features/tables/FloorPage'));
const CustomersPage = lazy(() => import('./features/customers/CustomersPage'));
const StaffPage = lazy(() => import('./features/staff/StaffPage'));
const ShiftsPage = lazy(() => import('./features/shifts/ShiftsPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const AuditPage = lazy(() => import('./features/audit/AuditPage'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

/** Never show a stack trace to staff. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error('[ui] screen crashed', err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">{t('errors.screenTitle')}</p>
        <p className="max-w-md text-sm text-ink-3">{t('errors.screenDetail')}</p>
        <Button variant="primary" onClick={() => location.reload()}>
          {t('errors.reload')}
        </Button>
      </div>
    );
  }
}

function RequireAuth({ children, any }: { children: ReactNode; any?: PermissionKey[] }) {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const can = useCan();
  const location = useLocation();
  const tr = useT();
  if (status === 'loading') return <SkeletonRows className="p-6" rows={6} />;
  if (status !== 'authed' || !user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (any && !any.some((p) => can(p))) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-semibold">{tr('errors.noAccessTitle')}</p>
        <p className="text-sm text-ink-3">{tr('errors.noAccessDetail')}</p>
        <Button onClick={() => history.back()}>{tr('common.back')}</Button>
      </div>
    );
  }
  return <>{children}</>;
}

function Home() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  if (status === 'loading') return null;
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

function SessionWatcher() {
  const navigate = useNavigate();
  useEffect(() => {
    const onExpired = () => {
      useSession.setState({ status: 'anon', user: null });
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [navigate]);
  return null;
}

const page = (el: ReactNode, any?: PermissionKey[]) => (
  <RequireAuth any={any}>
    <Suspense fallback={<SkeletonRows rows={8} />}>{el}</Suspense>
  </RequireAuth>
);

export function App() {
  useEffect(() => {
    void loadSession();
  }, []);
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionWatcher />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/pos"
              element={
                <RequireAuth any={['orders.take', 'bills.create', 'payments.accept']}>
                  <PosLayout />
                </RequireAuth>
              }
            >
              <Route index element={<OrderScreen />} />
              <Route path="tables" element={<TablesScreen />} />
              <Route path="bills" element={page(<BillsScreen />, ['receipts.print', 'bills.create'])} />
              <Route path="shift" element={page(<ShiftScreen />, ['shifts.manage'])} />
            </Route>
            <Route path="/kitchen" element={page(<KitchenScreen />, ['kitchen.view'])} />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <AdminLayout />
                </RequireAuth>
              }
            >
              <Route index element={page(<Dashboard />, ['reports.view'])} />
              <Route path="sales" element={page(<SalesPage />, ['reports.view'])} />
              <Route path="reports" element={page(<ReportsPage />, ['reports.view'])} />
              <Route path="closing" element={page(<ClosingPage />, ['day.close', 'reports.view'])} />
              <Route path="menu" element={page(<MenuPage />, ['menu.manage'])} />
              <Route path="prices" element={page(<PricesPage />, ['menu.prices', 'menu.manage'])} />
              <Route path="inventory" element={page(<InventoryPage />, ['inventory.manage'])} />
              <Route path="suppliers" element={page(<SuppliersPage />, ['inventory.manage', 'expenses.manage'])} />
              <Route path="expenses" element={page(<ExpensesPage />, ['expenses.manage'])} />
              <Route path="floor" element={page(<FloorPage />, ['tables.manage', 'settings.manage'])} />
              <Route path="customers" element={page(<CustomersPage />, ['customers.view'])} />
              <Route path="staff" element={page(<StaffPage />, ['staff.manage'])} />
              <Route path="shifts" element={page(<ShiftsPage />, ['reports.view', 'shifts.manage'])} />
              <Route path="settings" element={page(<SettingsPage />, ['settings.manage'])} />
              <Route path="audit" element={page(<AuditPage />, ['audit.view'])} />
            </Route>
            <Route path="*" element={<Home />} />
          </Routes>
          <ConfirmHost />
          <ApprovalHost />
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
