/**
 * Thin fetch wrapper. Errors always carry a sentence a cashier can read;
 * technical details stay in the browser console for the technician.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** The server could not be reached at all (Wi-Fi down, server PC off). */
export class NetworkError extends Error {
  constructor() {
    super('Cannot reach the server. Check the connection and try again.');
  }
}

type Json = Record<string, unknown> | unknown[] | null;

async function request<T>(method: string, path: string, body?: Json | object, opts: { timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (err) {
    console.warn(`[api] ${method} ${path} failed`, err);
    throw new NetworkError();
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
    const d = (data ?? {}) as { error?: string; code?: string; fields?: Record<string, string> };
    // A gateway error without our own message means the server itself is unreachable.
    if (res.status >= 502 && res.status <= 504 && !d.error) throw new NetworkError();
    console.warn(`[api] ${method} ${path} → ${res.status}`, data);
    throw new ApiError(res.status, d.error ?? 'Something went wrong. Please try again.', d.code, d.fields);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: { timeoutMs?: number }) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: Json | object, opts?: { timeoutMs?: number }) => request<T>('POST', path, body ?? {}, opts),
  patch: <T>(path: string, body: Json | object) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: Json | object) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.') {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  if (err != null) console.error(err);
  return fallback;
}

export const isNetworkError = (err: unknown) => err instanceof NetworkError;

/** Build a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
