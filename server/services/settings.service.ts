import { db } from '../db/prisma.js';
import { DEFAULT_SETTINGS, type AppSettings, type PrinterSettingsDTO } from '../../shared/types.js';

let cache: AppSettings | null = null;

type Section = keyof AppSettings;

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache;
  const rows = await db().setting.findMany();
  const merged = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  for (const row of rows) {
    const key = row.key as Section;
    if (!(key in merged)) continue;
    const cur = merged[key];
    (merged as unknown as Record<string, unknown>)[key] =
      typeof cur === 'object' && cur !== null ? { ...cur, ...(row.value as object) } : row.value;
  }
  cache = merged;
  return merged;
}

export async function saveSettingsSection<K extends Section>(key: K, value: AppSettings[K]) {
  await db().setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  cache = null;
  return getSettings();
}

export const clearSettingsCache = () => {
  cache = null;
};

export async function getPrinters(): Promise<PrinterSettingsDTO[]> {
  const rows = await db().printerSetting.findMany({ orderBy: { id: 'desc' } });
  return rows.map((r) => ({
    id: r.id as PrinterSettingsDTO['id'],
    label: r.label,
    enabled: r.enabled,
    connection: r.connection,
    printerName: r.printerName,
    ipAddress: r.ipAddress,
    port: r.port,
    paperWidth: (r.paperWidth === 58 ? 58 : 80) as 58 | 80,
    printLogo: r.printLogo,
    printTax: r.printTax,
    printFooter: r.printFooter,
    footerText: r.footerText,
    autoPrint: r.autoPrint,
    copies: r.copies,
    openDrawer: r.openDrawer,
  }));
}
