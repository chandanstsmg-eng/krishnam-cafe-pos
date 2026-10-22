import { addDays, businessDate } from '../../../shared/dates';

/** Date-range shortcuts shared by the Reports page and the dashboard card filters. */
export type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom';

export function presetRange(p: Exclude<Preset, 'custom'>, today = businessDate()): { from: string; to: string } {
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week': {
      // Week starts on Monday.
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
      return { from: addDays(today, -((dow + 6) % 7)), to: today };
    }
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'lastMonth': {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev };
    }
  }
}
