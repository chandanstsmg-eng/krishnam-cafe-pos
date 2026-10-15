/**
 * One live connection to the server per screen. The server says which parts
 * changed ("orders", "kitchen", "menu"…) and each screen refreshes itself.
 */
type Listener = (topics: string[]) => void;

let source: EventSource | null = null;
const listeners = new Set<Listener>();
const openListeners = new Set<() => void>();
const errorListeners = new Set<() => void>();

function ensure() {
  if (source) return;
  source = new EventSource('/api/events');
  source.addEventListener('change', (e) => {
    let topics: string[] = [];
    try {
      topics = JSON.parse((e as MessageEvent).data).topics ?? [];
    } catch {
      return;
    }
    listeners.forEach((l) => l(topics));
  });
  source.onopen = () => openListeners.forEach((l) => l());
  source.onerror = () => errorListeners.forEach((l) => l());
}

export function onServerChange(fn: Listener, opts: { onOpen?: () => void; onError?: () => void } = {}) {
  ensure();
  listeners.add(fn);
  if (opts.onOpen) openListeners.add(opts.onOpen);
  if (opts.onError) errorListeners.add(opts.onError);
  return () => {
    listeners.delete(fn);
    if (opts.onOpen) openListeners.delete(opts.onOpen);
    if (opts.onError) errorListeners.delete(opts.onError);
  };
}

export function closeServerEvents() {
  source?.close();
  source = null;
}
