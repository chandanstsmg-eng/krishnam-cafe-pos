/**
 * Integration tests run against a brand-new database created for this run
 * ("annapoorna_test_<time>") on the same built-in PostgreSQL. Real café data
 * is never touched, and the test database is dropped afterwards.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { PrismaClient } from '@prisma/client';
import { ROOT, config } from '../server/config.js';
import { ensureDatabase } from '../server/db/postgres.js';

const withDb = (url: string, name: string) => url.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);

export default async function setup(project: TestProject) {
  const mainUrl = await ensureDatabase();
  const name = `annapoorna_test_${Date.now()}`;
  const url = withDb(mainUrl, name);
  const cli = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
  // `migrate deploy` creates the new database and applies migrations; it never deletes anything.
  const r = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Could not prepare the test database:\n${r.stdout}\n${r.stderr}`);

  process.env.DATABASE_URL = url;
  const { seed } = await import('../prisma/seed.js');
  await seed({ quiet: true });
  const { disconnect } = await import('../server/db/prisma.js');
  await disconnect();
  project.provide('testDbUrl', url);

  return async () => {
    const admin = new PrismaClient({ datasourceUrl: config.externalDatabaseUrl ?? mainUrl });
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.$disconnect();
    }
  };
}
