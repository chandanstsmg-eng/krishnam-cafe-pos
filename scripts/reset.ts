/**
 * Wipes the database and loads fresh demo data.
 *   npm run reset            (asks for confirmation)
 *   npm run reset -- --yes   (no question)
 * Stop the app first. A backup of the current data is made before wiping.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { ROOT, config } from '../server/config.js';
import { ensureDatabase } from '../server/db/postgres.js';
import { db, disconnect } from '../server/db/prisma.js';

async function portInUse() {
  try {
    const r = await fetch(`http://localhost:${config.port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

if (await portInUse()) {
  console.log('\n  The app is running. Stop it (Ctrl+C in its window) and run this again.\n');
  process.exit(1);
}

if (!process.argv.includes('--yes')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('\n  This deletes ALL bills, stock and settings and loads demo data. Type RESET to continue: ');
  rl.close();
  if (a.trim() !== 'RESET') {
    console.log('  Cancelled.\n');
    process.exit(0);
  }
}

await ensureDatabase();
try {
  const { createBackup } = await import('../server/services/backup.service.js');
  if ((await db().user.count()) > 0) {
    const b = await createBackup('manual');
    console.log(`  Saved a backup first: data/backups/${b.name}`);
  }
} catch {
  /* empty or brand-new database */
}
await disconnect();

const cli = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const res = spawnSync(process.execPath, [cli, 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'], { cwd: ROOT, env: process.env, stdio: 'inherit' });
if (res.status !== 0) process.exit(res.status ?? 1);

console.log('\n  Loading demo data…');
const t = Date.now();
const { seed } = await import('../prisma/seed.js');
await seed();
await disconnect();
console.log(`  Done in ${((Date.now() - t) / 1000).toFixed(1)} s. Start the app with: npm start\n`);
process.exit(0);
