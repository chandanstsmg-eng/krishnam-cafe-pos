/**
 *   npm run backup                              make a backup now
 *   npm run backup -- --list                    list backups
 *   npm run backup -- --restore <file>          restore one (stop the app first)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDatabase } from '../server/db/postgres.js';
import { disconnect } from '../server/db/prisma.js';
import { BACKUP_DIR, createBackup, listBackups, restoreBackup } from '../server/services/backup.service.js';

const args = process.argv.slice(2);
await ensureDatabase();

if (args.includes('--list')) {
  for (const b of listBackups()) console.log(`  ${b.name}   ${(b.size / 1024).toFixed(0)} KB`);
} else if (args.includes('--restore')) {
  const name = args[args.indexOf('--restore') + 1];
  const file = name && fs.existsSync(name) ? name : path.join(BACKUP_DIR, name ?? '');
  if (!name || !fs.existsSync(file)) {
    console.log('  Give the backup file name. See: npm run backup -- --list');
    process.exit(1);
  }
  console.log(`  Restoring ${path.basename(file)}…`);
  await restoreBackup(file);
  console.log('  Restored. Start the app with: npm start');
} else {
  const b = await createBackup('manual');
  console.log(`  Backup saved: data/backups/${b.name} (${(b.size / 1024).toFixed(0)} KB)`);
}
await disconnect();
process.exit(0);
