import type { Tx } from '../db/prisma.js';

/** Atomically increments a named counter and returns the new value. */
export async function nextNumber(tx: Tx, key: string, start: number): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters (key, value) VALUES (${key}, ${start})
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  return rows[0].value;
}

export const formatInvoiceNo = (prefix: string, n: number) => `${prefix}${String(n).padStart(6, '0')}`;
