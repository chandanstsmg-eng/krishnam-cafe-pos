/**
 * Recalculates the stored totals of past day closings from the bills
 * (e.g. after correcting a bill). Does not change or delete anything else.
 *   npx tsx scripts/recalc-closings.ts
 */
import { ensureDatabase } from '../server/db/postgres.js';
import { db, disconnect } from '../server/db/prisma.js';
import { dayTotals } from '../server/services/dashboard.service.js';

await ensureDatabase();
const rows = await db().dailyClosing.findMany();
for (const r of rows) {
  const ymd = r.businessDate.toISOString().slice(0, 10);
  const prev = (r.totals ?? {}) as Record<string, unknown>;
  await db().dailyClosing.update({ where: { id: r.id }, data: { totals: { ...prev, ...(await dayTotals(ymd)) } } });
}
console.log(`  Recalculated ${rows.length} day closings.`);
await disconnect();
