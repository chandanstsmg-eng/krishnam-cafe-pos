import { Bell, CheckCheck, ChefHat, CircleDashed, Receipt } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { useT } from '../../i18n';
import type { OrderDTO } from '../../../shared/types';

export function OrderStatusBadge({ order, size }: { order: Pick<OrderDTO, 'status' | 'billPrintedAt' | 'items'>; size?: 'sm' | 'md' }) {
  const t = useT();
  const unsent = order.items.some((i) => i.kitchen && i.qty > i.sentQty);
  if (order.billPrintedAt)
    return (
      <Badge tone="accent" size={size} icon={<Receipt className="h-3 w-3" />}>
        {t('status.billPrinted')}
      </Badge>
    );
  if (unsent && order.status !== 'PREPARING')
    return (
      <Badge tone="neutral" size={size} icon={<CircleDashed className="h-3 w-3" />}>
        {t('status.notSent')}
      </Badge>
    );
  switch (order.status) {
    case 'NEW':
      return (
        <Badge tone="info" size={size} icon={<ChefHat className="h-3 w-3" />}>
          {t('status.NEW')}
        </Badge>
      );
    case 'PREPARING':
      return (
        <Badge tone="warn" size={size} icon={<ChefHat className="h-3 w-3" />}>
          {t('status.PREPARING')}
        </Badge>
      );
    case 'READY':
      return (
        <Badge tone="ok" size={size} icon={<Bell className="h-3 w-3" />}>
          {t('status.READY')}
        </Badge>
      );
    case 'SERVED':
      return (
        <Badge tone="brand" size={size} icon={<CheckCheck className="h-3 w-3" />}>
          {t('status.SERVED')}
        </Badge>
      );
    default:
      return <Badge size={size}>{t(`status.${order.status}`)}</Badge>;
  }
}
