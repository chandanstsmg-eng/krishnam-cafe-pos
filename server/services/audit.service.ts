import type { Prisma } from '@prisma/client';
import { db, type Tx } from '../db/prisma.js';
import type { SessionUser } from '../../shared/types.js';

export interface AuditEntry {
  action: string;
  summary: string;
  entity?: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
}

/** Writes a human-readable audit entry, e.g. "Changed Tea price ₹15 → ₹20". */
export async function audit(user: Pick<SessionUser, 'id' | 'name'> | null, entry: AuditEntry, tx?: Tx) {
  await (tx ?? db()).auditLog.create({
    data: {
      userId: user?.id ?? null,
      userName: user?.name ?? 'System',
      action: entry.action,
      summary: entry.summary,
      entity: entry.entity,
      entityId: entry.entityId,
      details: entry.details,
    },
  });
}
