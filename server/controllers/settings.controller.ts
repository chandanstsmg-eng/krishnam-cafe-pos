import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { audit } from '../services/audit.service.js';
import { publish } from '../services/events.service.js';
import { getPrinters, getSettings, saveSettingsSection } from '../services/settings.service.js';
import { printDoc } from '../services/printing.service.js';
import { createBackup, listBackups } from '../services/backup.service.js';
import { buildKot, type ReceiptDoc } from '../../shared/receipt.js';
import { formatDateTime } from '../../shared/dates.js';
import { notFound } from '../utils/errors.js';
import { paise } from '../validators/common.js';
import type { AppSettings } from '../../shared/types.js';

export async function get(_req: Request, res: Response) {
  res.json({ settings: await getSettings(), printers: await getPrinters() });
}

const s = (max = 120) => z.string().trim().max(max);
const sections = {
  business: z.object({
    name: s(60).min(1, 'Enter the business name'),
    tagline: s(60),
    address: s(160),
    city: s(60),
    state: s(40),
    pincode: z.string().trim().regex(/^(\d{6})?$/, 'PIN code is 6 digits'),
    phone: s(40),
    gstin: z.string().trim().toUpperCase().regex(/^([0-9A-Z]{15})?$/, 'GSTIN is 15 characters'),
    fssai: z.string().trim().regex(/^(\d{14})?$/, 'FSSAI licence is 14 digits'),
  }),
  billing: z.object({
    taxMode: z.enum(['EXCLUSIVE', 'INCLUSIVE', 'NONE']),
    roundOff: z.boolean(),
    invoicePrefix: z.string().trim().regex(/^[A-Z0-9/-]{0,10}$/i, 'Use up to 10 letters, numbers, / or -'),
    requireApprovalForVoid: z.boolean(),
  }),
  pos: z.object({
    requireShift: z.boolean(),
    kitchenDisplay: z.boolean(),
    printKot: z.boolean(),
    allowDelivery: z.boolean(),
    tableWarnMinutes: z.number().int().min(5).max(600),
    billWarnMinutes: z.number().int().min(1).max(600),
    quickCash: z.array(paise).max(6),
  }),
  shift: z.object({ noteRequiredAbove: paise }),
  language: z.enum(['en', 'kn']),
} as const;

const LABEL: Record<string, string> = { business: 'business details', billing: 'billing & tax settings', pos: 'counter settings', shift: 'shift settings', language: 'language' };

export async function update(req: Request, res: Response) {
  const key = String(req.params.section) as keyof typeof sections;
  const schema = sections[key];
  if (!schema) throw notFound('Settings section');
  const value = schema.parse(req.body);
  const before = await getSettings();
  const settings = await saveSettingsSection(key, value as AppSettings[typeof key]);
  const changed =
    typeof value === 'object'
      ? Object.keys(value).filter((k) => JSON.stringify((value as Record<string, unknown>)[k]) !== JSON.stringify((before[key] as unknown as Record<string, unknown>)[k]))
      : before[key] !== value
        ? [key]
        : [];
  if (changed.length) await audit(req.user!, { action: `settings.${key}`, entity: 'settings', entityId: key, summary: `Changed ${LABEL[key]}: ${changed.join(', ')}` });
  publish('settings');
  res.json(settings);
}

const printerBody = z.object({
  enabled: z.boolean(),
  connection: z.enum(['BROWSER', 'NETWORK']),
  printerName: s(80).nullish(),
  ipAddress: z
    .string()
    .trim()
    .regex(/^((\d{1,3}\.){3}\d{1,3})?$/, 'Enter an address like 192.168.1.50')
    .nullish(),
  port: z.number().int().min(1).max(65535),
  paperWidth: z.union([z.literal(58), z.literal(80)]),
  printLogo: z.boolean(),
  printTax: z.boolean(),
  printFooter: z.boolean(),
  footerText: s(200),
  autoPrint: z.boolean(),
  copies: z.number().int().min(1).max(3),
  openDrawer: z.boolean(),
});

export async function updatePrinter(req: Request, res: Response) {
  const id = String(req.params.id);
  const b = printerBody.parse(req.body);
  const p = await db().printerSetting.update({ where: { id }, data: { ...b, ipAddress: b.ipAddress || null } });
  await audit(req.user!, { action: 'settings.printer', entity: 'printer', entityId: id, summary: `Changed ${p.label} settings (${b.paperWidth} mm, ${b.connection === 'NETWORK' ? `network ${b.ipAddress}` : 'this computer'})` });
  publish('settings');
  res.json(await getPrinters());
}

function testDoc(width: 58 | 80, label: string, name: string): ReceiptDoc {
  return {
    width,
    lines: [
      { t: 'text', text: name.toUpperCase(), align: 'center', bold: true, size: 'large' },
      { t: 'text', text: `${label} — test print`, align: 'center' },
      { t: 'rule' },
      { t: 'row', left: 'Paper width', right: `${width} mm` },
      { t: 'row', left: 'Printed at', right: formatDateTime(new Date()) },
      { t: 'item', name: 'Masala Dosa', qty: '2', amount: '120' },
      { t: 'item', name: 'Filter Coffee', qty: '1', amount: '20' },
      { t: 'rule', style: 'double' },
      { t: 'row', left: 'TOTAL', right: 'Rs 140', bold: true, size: 'large' },
      { t: 'rule', style: 'double' },
      { t: 'text', text: 'If you can read this clearly, the printer is ready.', align: 'center' },
    ],
  };
}

/** Test print for a network printer. Browser printers print the test on the client. */
export async function testPrint(req: Request, res: Response) {
  const printer = (await getPrinters()).find((p) => p.id === req.params.id);
  if (!printer) throw notFound('Printer');
  const settings = await getSettings();
  await printDoc(printer, testDoc(printer.paperWidth, printer.label, settings.business.name));
  res.json({ ok: true, message: 'Test page sent to the printer.' });
}

/** Prints a document laid out by the till (pre-bill, receipt) on a network printer. */
export async function printDocument(req: Request, res: Response) {
  const b = z.object({ printerId: z.enum(['receipt', 'kitchen']), doc: z.object({ width: z.union([z.literal(58), z.literal(80)]), lines: z.array(z.any()).max(400), openDrawer: z.boolean().optional() }) }).parse(req.body);
  const printer = (await getPrinters()).find((p) => p.id === b.printerId);
  if (!printer) throw notFound('Printer');
  await printDoc(printer, b.doc as ReceiptDoc);
  res.json({ ok: true });
}

export async function printKot(req: Request, res: Response) {
  const t = await db().kitchenTicket.findUnique({ where: { id: String(req.params.id) }, include: { order: { include: { table: true } } } });
  if (!t) throw notFound('Kitchen ticket');
  const printer = (await getPrinters()).find((p) => p.id === 'kitchen');
  if (!printer) throw notFound('Printer');
  const doc = buildKot(
    { round: t.round, createdAt: t.createdAt.toISOString(), items: t.items as { name: string; qty: number }[], note: t.note },
    { number: t.order.number, type: t.order.type, tableName: t.order.table?.name ?? null },
    printer.paperWidth,
  );
  await printDoc(printer, doc);
  res.json({ ok: true });
}

export const backups = async (_req: Request, res: Response) => res.json(listBackups());

export async function backupNow(req: Request, res: Response) {
  const file = await createBackup('manual');
  await audit(req.user!, { action: 'settings.backup', summary: `Made a backup (${file.name})` });
  res.json(file);
}
