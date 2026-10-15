/**
 * UUID v4 that also works on tablets opening the app over plain http on the
 * local network (crypto.randomUUID is only available on https/localhost).
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function stored(key: string, make: () => string) {
  try {
    let v = localStorage.getItem(key);
    if (!v) {
      v = make();
      localStorage.setItem(key, v);
    }
    return v;
  } catch {
    return make();
  }
}

/** A short code identifying this till, used in bill numbers issued offline. */
export const terminalCode = () =>
  stored('ap.terminal', () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(3)), (x) => chars[x % chars.length]).join('');
  });

export function nextOfflineBillNo() {
  let n = 1;
  try {
    n = Number(localStorage.getItem('ap.offlineSeq') ?? '0') + 1;
    localStorage.setItem('ap.offlineSeq', String(n));
  } catch {
    n = Date.now() % 10000;
  }
  return `OFL-${terminalCode()}-${String(n).padStart(4, '0')}`;
}
