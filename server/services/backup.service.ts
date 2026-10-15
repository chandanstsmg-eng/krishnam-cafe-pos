/**
 * Backups: every table dumped as JSON into one gzip file under data/backups.
 * Made automatically (at start-up and every 6 hours) and on demand. Copy the
 * folder to a pen drive now and then — that is the café's safety net.
 *
 * Restore with:  npm run backup -- --restore data/backups/<file>.json.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db } from '../db/prisma.js';
import { DATA_DIR } from '../config.js';
import { logger } from '../utils/logger.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 40;

async function tableNames(): Promise<string[]> {
  const rows = await db().$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
    ORDER BY table_name`;
  return rows.map((r) => r.table_name);
}

export async function createBackup(kind: 'auto' | 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dump: Record<string, unknown[]> = {};
  for (const t of await tableNames()) {
    if (t === 'sessions') continue;
    const [row] = await db().$queryRawUnsafe<{ data: unknown[] | null }[]>(`SELECT json_agg(t) AS data FROM "${t}" t`);
    dump[t] = row.data ?? [];
  }
  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
  const name = `backup-${stamp}-${kind}.json.gz`;
  const file = path.join(BACKUP_DIR, name);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: dump })));
  prune();
  return { name, size: fs.statSync(file).size, at: new Date().toISOString() };
}

function prune() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json.gz'))
    .sort()
    .reverse();
  for (const f of files.slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export async function restoreBackup(file: string) {
  const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString()) as { tables: Record<string, unknown[]> };
  const names = await tableNames();
  await db().$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET session_replication_role = replica`);
      await tx.$executeRawUnsafe(`TRUNCATE ${names.map((n) => `"${n}"`).join(', ')} CASCADE`);
      for (const [t, rows] of Object.entries(json.tables)) {
        if (!names.includes(t) || !rows.length) continue;
        for (let i = 0; i < rows.length; i += 2000) {
          await tx.$executeRawUnsafe(`INSERT INTO "${t}" SELECT * FROM json_populate_recordset(NULL::"${t}", $1::json)`, JSON.stringify(rows.slice(i, i + 2000)));
        }
      }
      await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
    },
    { timeout: 300_000 },
  );
}

let timer: NodeJS.Timeout | null = null;

export function scheduleBackups() {
  const run = () => createBackup('auto').catch((err) => logger.warn('Automatic backup failed', err));
  setTimeout(run, 60_000).unref();
  timer = setInterval(run, 6 * 3600_000);
  timer.unref();
}
