import type { Request, Response } from 'express';
import { z } from 'zod';
import { getInvoice, markReprint, refundInvoice, searchInvoices, voidInvoice } from '../services/invoices.service.js';
import { getPrinters, getSettings } from '../services/settings.service.js';
import { printDoc } from '../services/printing.service.js';
import { buildReceipt } from '../../shared/receipt.js';
import { can } from '../middleware/auth.js';
import { forbidden } from '../utils/errors.js';
import { paise, payMethod, ymd } from '../validators/common.js';

const searchQuery = z.object({
  q: z.string().max(60).optional(),
  date: ymd.optional(),
  from: ymd.optional(),
  to: ymd.optional(),
  status: z.enum(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID']).optional(),
  method: payMethod.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function search(req: Request, res: Response) {
  res.json(await searchInvoices(searchQuery.parse(req.query)));
}

export async function one(req: Request, res: Response) {
  res.json(await getInvoice(String(req.params.id)));
}

/**
 * Print or reprint a bill. The first print right after payment is not a
 * reprint; any later print is counted and marked DUPLICATE on the paper.
 */
export async function print(req: Request, res: Response) {
  const { reprint } = z.object({ reprint: z.boolean().default(true) }).parse(req.body ?? {});
  if (!can(req.user, 'receipts.print')) throw forbidden();
  const inv = reprint ? await markReprint(req.user!, String(req.params.id)) : await getInvoice(String(req.params.id));
  const printer = (await getPrinters()).find((p) => p.id === 'receipt');
  let printed = false;
  if (printer?.enabled && printer.connection === 'NETWORK') {
    await printDoc(printer, buildReceipt(inv, await getSettings(), printer, { duplicate: reprint }));
    printed = true;
  }
  res.json({ invoice: inv, printedByServer: printed });
}

export async function voidBill(req: Request, res: Response) {
  const body = z.object({ reason: z.string().trim().min(1).max(200), approvalToken: z.string().max(2000).nullish() }).parse(req.body);
  res.json(await voidInvoice(req.user!, String(req.params.id), body.reason, body.approvalToken));
}

export async function refund(req: Request, res: Response) {
  const body = z
    .object({ amount: paise.min(1), method: payMethod, reason: z.string().trim().min(1).max(200), approvalToken: z.string().max(2000).nullish() })
    .parse(req.body);
  res.json(await refundInvoice(req.user!, String(req.params.id), body));
}
