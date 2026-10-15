/**
 * India does not observe daylight saving, so IST is a fixed +05:30. Business
 * dates ("which day does this bill belong to") are always calculated in IST,
 * regardless of the clock settings of the machine running the server.
 */
export const IST_OFFSET_MIN = 330;

const pad = (n: number) => String(n).padStart(2, '0');

/** Shifts a Date so that its UTC fields read as IST wall-clock time. */
export const toIstFields = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * 60_000);

/** YYYY-MM-DD of the IST calendar day containing `d`. */
export function businessDate(d: Date = new Date()) {
  const x = toIstFields(d);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/** Start instant (UTC Date) of the IST day `ymd`. */
export function istDayStart(ymd: string) {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - IST_OFFSET_MIN * 60_000);
}

export function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Date value for a Postgres DATE column. */
export const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const ymdOf = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** 27/09/2026 */
export function formatDate(d: Date | string) {
  const x = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : toIstFields(new Date(d));
  return `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}`;
}

/** 10:42 AM */
export function formatTime(d: Date | string) {
  const x = toIstFields(new Date(d));
  const h = x.getUTCHours();
  return `${pad(((h + 11) % 12) + 1)}:${pad(x.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

export const formatDateTime = (d: Date | string) => `${formatDate(d)}  ${formatTime(d)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 27 Sep 2026 */
export function formatDateLong(d: Date | string) {
  const x = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : toIstFields(new Date(d));
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

/** Sat, 27 Sep */
export function formatDayShort(ymd: string) {
  const x = new Date(`${ymd}T00:00:00Z`);
  return `${DAYS[x.getUTCDay()]}, ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};

/** Minutes elapsed since `d`. */
export const minutesSince = (d: Date | string, now = Date.now()) => Math.max(0, Math.floor((now - new Date(d).getTime()) / 60_000));

export function formatDuration(mins: number) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}
