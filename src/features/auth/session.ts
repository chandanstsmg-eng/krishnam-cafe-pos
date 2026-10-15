import { create } from 'zustand';
import { api, isNetworkError } from '../../api/client';
import type { SessionUser } from '../../../shared/types';
import type { PermissionKey } from '../../../shared/permissions';

interface SessionState {
  status: 'loading' | 'authed' | 'anon';
  user: SessionUser | null;
  /** signed-in user restored from this device because the server was unreachable */
  offlineRestore: boolean;
}

const CACHE_KEY = 'ap.lastUser';

const remember = (u: SessionUser | null) => {
  try {
    if (u) localStorage.setItem(CACHE_KEY, JSON.stringify(u));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
};

export const useSession = create<SessionState>(() => ({ status: 'loading', user: null, offlineRestore: false }));

export async function loadSession() {
  try {
    const { user } = await api.get<{ user: SessionUser | null }>('/auth/me', { timeoutMs: 6000 });
    remember(user);
    useSession.setState({ status: user ? 'authed' : 'anon', user, offlineRestore: false });
  } catch (err) {
    // Server unreachable: let the cashier keep billing as the last signed-in person.
    if (isNetworkError(err)) {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as SessionUser | null;
        if (cached) return useSession.setState({ status: 'authed', user: cached, offlineRestore: true });
      } catch {
        /* ignore */
      }
    }
    useSession.setState({ status: 'anon', user: null, offlineRestore: false });
  }
}

export function setSessionUser(user: SessionUser) {
  remember(user);
  useSession.setState({ status: 'authed', user, offlineRestore: false });
}

export async function signOut() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* offline sign-out still clears this device */
  }
  remember(null);
  useSession.setState({ status: 'anon', user: null, offlineRestore: false });
}

export const can = (perm: PermissionKey, user = useSession.getState().user) => !!user?.permissions.includes(perm);

export function useCan() {
  const user = useSession((s) => s.user);
  return (perm: PermissionKey) => !!user?.permissions.includes(perm);
}

/** Where a person lands after signing in. */
export function homeFor(user: SessionUser) {
  const p = new Set(user.permissions);
  if (user.roleKey === 'kitchen' || (p.has('kitchen.view') && !p.has('orders.take'))) return '/kitchen';
  if (user.roleKey === 'admin' || user.roleKey === 'manager') return '/admin';
  if (p.has('orders.take') || p.has('payments.accept')) return '/pos/tables';
  if (p.has('reports.view')) return '/admin';
  return '/pos';
}
