/** Order status follows its kitchen tickets — same rule on the till and the server. */
export function deriveOrderStatus(tickets: { status: string }[], hasUnsentKitchenItems: boolean): 'NEW' | 'PREPARING' | 'READY' | 'SERVED' {
  const live = tickets.filter((t) => t.status !== 'CANCELLED');
  if (!live.length) return hasUnsentKitchenItems ? 'NEW' : 'SERVED';
  if (live.every((t) => t.status === 'SERVED')) return hasUnsentKitchenItems ? 'NEW' : 'SERVED';
  if (live.every((t) => t.status === 'READY' || t.status === 'SERVED')) return 'READY';
  if (live.some((t) => t.status !== 'NEW')) return 'PREPARING';
  return 'NEW';
}
