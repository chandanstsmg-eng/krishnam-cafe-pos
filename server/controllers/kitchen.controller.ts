import type { Request, Response } from 'express';
import { z } from 'zod';
import { listTickets, setTicketStatus } from '../services/kitchen.service.js';

export const tickets = async (_req: Request, res: Response) => res.json(await listTickets());

export async function setStatus(req: Request, res: Response) {
  const { status } = z.object({ status: z.enum(['NEW', 'PREPARING', 'READY', 'SERVED']) }).parse(req.body);
  await setTicketStatus(String(req.params.id), status);
  res.json({ ok: true });
}
