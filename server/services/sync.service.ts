/**
 * Applies POS commands in the order the till produced them.
 *
 * A terminal sends every change through here, online or not. When it could not
 * reach the server it keeps the commands in a queue and replays them later;
 * each command id is recorded so a replay (e.g. the response was lost when the
 * Wi-Fi dropped) is answered from the log instead of being applied twice.
 */
import type { Prisma } from '@prisma/client';
import { db } from '../db/prisma.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { SessionUser, SyncCommand, SyncResult } from '../../shared/types.js';
import { cancelOrder, getOrder, markServed, payOrder, saveOrder } from './orders.service.js';

async function apply(user: SessionUser, cmd: SyncCommand): Promise<Omit<SyncResult, 'id' | 'ok'>> {
  const ctx = { offline: !!cmd.offline, at: new Date(cmd.at) };
  switch (cmd.type) {
    case 'order.save':
      return { order: await saveOrder(user, cmd.payload, ctx) };
    case 'order.pay': {
      const r = await payOrder(user, cmd.payload, ctx);
      return { order: r.order, invoice: r.invoice };
    }
    case 'order.cancel':
      return { order: await cancelOrder(user, cmd.payload, ctx) };
    case 'order.served':
      return { order: await markServed(user, cmd.payload.orderId) };
    default:
      throw new AppError(400, 'Unknown action.');
  }
}

export async function processCommands(user: SessionUser, commands: SyncCommand[]): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const seen = await db().syncCommand.findMany({ where: { id: { in: commands.map((c) => c.id) } } });
  const seenMap = new Map(seen.map((s) => [s.id, s]));

  for (const cmd of commands) {
    const prev = seenMap.get(cmd.id);
    if (prev) {
      // Replay: return the current state rather than applying again.
      const r = (prev.result ?? {}) as { error?: string; code?: string; orderId?: string };
      const orderId = r.orderId ?? ('orderId' in cmd.payload ? cmd.payload.orderId : cmd.type === 'order.save' ? cmd.payload.order.id : undefined);
      results.push({ id: cmd.id, ok: prev.ok, error: r.error, order: orderId ? await getOrder(orderId) : null });
      continue;
    }
    try {
      const out = await apply(user, cmd);
      results.push({ id: cmd.id, ok: true, ...out });
      await db().syncCommand.create({
        data: { id: cmd.id, type: cmd.type, userId: user.id, ok: true, result: { orderId: out.order?.id ?? null } as Prisma.InputJsonValue },
      });
    } catch (err) {
      const known = err instanceof AppError;
      if (!known) logger.error(`Sync command ${cmd.type} ${cmd.id} failed`, err);
      const message = known ? err.message : 'This change could not be saved. Please check the order.';
      results.push({ id: cmd.id, ok: false, error: message, code: known ? err.code : 'SERVER' });
      // Approval / shift problems can be fixed and retried, so don't remember them.
      const retryable = known && ['APPROVAL_REQUIRED', 'NO_SHIFT', 'TOTAL_CHANGED', 'UNAUTHENTICATED'].includes(err.code ?? '');
      if (!retryable) {
        await db()
          .syncCommand.create({ data: { id: cmd.id, type: cmd.type, userId: user.id, ok: false, result: { error: message } } })
          .catch(() => {});
      }
    }
  }
  return results;
}
