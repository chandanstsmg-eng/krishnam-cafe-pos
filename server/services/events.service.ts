/**
 * Server-sent events: tells every open screen (POS terminals, kitchen display,
 * owner dashboard) that something changed so it can refresh. Plain HTTP, no
 * extra services, works over the café's local Wi-Fi.
 */
import type { Request, Response } from 'express';

export type EventTopic = 'orders' | 'kitchen' | 'tables' | 'menu' | 'inventory' | 'settings' | 'shift' | 'invoices';

const clients = new Set<Response>();

export function subscribe(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

let pending = new Set<EventTopic>();
let timer: NodeJS.Timeout | null = null;

/** Topics are batched for 150 ms so a burst of writes causes one refresh. */
export function publish(...topics: EventTopic[]) {
  topics.forEach((t) => pending.add(t));
  if (timer) return;
  timer = setTimeout(() => {
    const data = JSON.stringify({ topics: [...pending], at: Date.now() });
    pending = new Set();
    timer = null;
    for (const c of clients) c.write(`event: change\ndata: ${data}\n\n`);
  }, 150);
}

export function closeAll() {
  for (const c of clients) c.end();
  clients.clear();
}
