import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Armchair, Receipt, Search, ShoppingBag, User, UtensilsCrossed } from 'lucide-react';
import { api, qs } from '../api/client';
import { Dialog } from './ui/Dialog';
import { Kbd } from './ui/Misc';
import { useCan } from '../features/auth/session';
import { openOrder, openTable } from '../features/pos/draft';
import { usePos } from '../features/pos/store';
import { useT } from '../i18n';
import { formatMoney } from '../../shared/money';
import { formatTime } from '../../shared/dates';

interface Results {
  invoices: { id: string; number: string; total: number; method: string; tableName: string | null; orderType: string; createdAt: string; status: string }[];
  orders: { id: string; number: number; tableName: string | null; type: string; total: number; status: string }[];
  items: { id: string; name: string; price: number; category: string; available: boolean }[];
  customers: { id: string; name: string | null; phone: string | null }[];
  tables: { id: string; name: string }[];
}

/** Ctrl+K: find a bill, order, item, customer or table from anywhere. */
export function GlobalSearch() {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results | null>(null);
  const offline = usePos((s) => s.connection === 'offline');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQ('');
      setRes(null);
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2 || offline) return setRes(null);
    const h = setTimeout(() => {
      api
        .get<Results>(`/search${qs({ q: q.trim() })}`)
        .then(setRes)
        .catch(() => setRes(null));
    }, 180);
    return () => clearTimeout(h);
  }, [q, offline]);

  const go = (path: string, before?: () => void) => {
    before?.();
    setOpen(false);
    navigate(path);
  };

  const empty = res && !res.invoices.length && !res.orders.length && !res.items.length && !res.customers.length && !res.tables.length;

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex h-9 items-center gap-2 rounded-md border border-line-2 bg-paper/60 px-3 text-sm text-ink-3 hover:bg-paper" aria-label={t('search.open')}>
        <Search className="h-4 w-4" aria-hidden />
        <span className="hidden xl:inline">{t('search.placeholderShort')}</span>
        <span className="hidden xl:inline">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} size="lg" bodyClassName="p-0">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="h-5 w-5 text-ink-4" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="h-14 flex-1 bg-transparent text-base focus:outline-none"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {offline && <p className="px-3 py-6 text-center text-sm text-ink-3">{t('search.offline')}</p>}
          {!offline && q.trim().length < 2 && <p className="px-3 py-6 text-center text-sm text-ink-3">{t('search.hint')}</p>}
          {empty && <p className="px-3 py-6 text-center text-sm text-ink-3">{t('search.none', { q })}</p>}
          {res && (
            <>
              <Group title={t('search.bills')} show={res.invoices.length > 0}>
                {res.invoices.map((i) => (
                  <Hit key={i.id} icon={<Receipt />} onClick={() => go(`/pos/bills?bill=${i.id}`)} title={i.number} sub={`${i.tableName ? t('pos.tableN', { n: i.tableName }) : t(`orderType.${i.orderType}`)} · ${i.method} · ${formatTime(i.createdAt)}${i.status === 'VOID' ? ` · ${t('bills.void')}` : ''}`} right={formatMoney(i.total)} />
                ))}
              </Group>
              <Group title={t('search.openOrders')} show={res.orders.length > 0}>
                {res.orders.map((o) => (
                  <Hit key={o.id} icon={<ShoppingBag />} onClick={() => go('/pos', () => openOrder(o.id))} title={`#${o.number}`} sub={o.tableName ? t('pos.tableN', { n: o.tableName }) : t(`orderType.${o.type}`)} right={formatMoney(o.total)} />
                ))}
              </Group>
              <Group title={t('search.tables')} show={res.tables.length > 0 && can('orders.take')}>
                {res.tables.map((tb) => (
                  <Hit key={tb.id} icon={<Armchair />} onClick={() => go('/pos', () => openTable(tb.id))} title={t('pos.tableN', { n: tb.name })} />
                ))}
              </Group>
              <Group title={t('search.menuItems')} show={res.items.length > 0}>
                {res.items.map((i) => (
                  <Hit key={i.id} icon={<UtensilsCrossed />} onClick={() => go(can('menu.manage') ? `/admin/menu?item=${i.id}` : '/pos')} title={i.name} sub={`${i.category}${i.available ? '' : ` · ${t('pos.soldOut')}`}`} right={formatMoney(i.price)} />
                ))}
              </Group>
              <Group title={t('search.customers')} show={res.customers.length > 0}>
                {res.customers.map((c) => (
                  <Hit key={c.id} icon={<User />} onClick={() => go(`/admin/customers?id=${c.id}`)} title={c.name ?? c.phone ?? ''} sub={c.name ? (c.phone ?? '') : ''} />
                ))}
              </Group>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

function Group({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="mb-2">
      <p className="px-3 pt-2 pb-1 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{title}</p>
      {children}
    </div>
  );
}

function Hit({ icon, title, sub, right, onClick }: { icon: React.ReactNode; title: string; sub?: string; right?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-paper focus:bg-paper focus:outline-none">
      <span className="text-ink-3 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block truncate text-[12px] text-ink-3">{sub}</span>}
      </span>
      {right && <span className="num text-sm font-semibold">{right}</span>}
    </button>
  );
}
