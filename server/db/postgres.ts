/**
 * Built-in PostgreSQL.
 *
 * The café should not have to install or look after a database server, so the
 * app ships PostgreSQL binaries (via the embedded-postgres packages) and runs
 * a private server from data/pg. It is started with pg_ctl, which means:
 *   - a crash of the Node process does not take the database down with it,
 *     and the next start simply reuses the running server;
 *   - PostgreSQL's own write-ahead log protects the data if the PC loses power.
 *
 * If DATABASE_URL is set in .env, none of this runs and that server is used.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.js';
import { logger } from '../utils/logger.js';

const run = promisify(execFile);
const PG_DIR = path.join(DATA_DIR, 'pg');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'postgres.log');
const DB_NAME = 'annapoorna';

let managed = false;

async function binaries(): Promise<{ pg_ctl: string; initdb: string }> {
  const platform = os.platform() === 'win32' ? 'windows' : os.platform();
  const pkg = `@embedded-postgres/${platform}-${os.arch()}`;
  try {
    return await import(pkg);
  } catch {
    throw new Error(`Built-in database is not available for ${os.platform()}-${os.arch()}. Set DATABASE_URL in .env to use your own PostgreSQL.`);
  }
}

async function isRunning(pgCtl: string) {
  try {
    await run(pgCtl, ['status', '-D', PG_DIR], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function startServer(pgCtl: string): Promise<void> {
  // stdio must be ignored: postgres inherits the handles and would otherwise
  // keep the pipe (and this promise) open for as long as it runs.
  return new Promise((resolve, reject) => {
    const child = spawn(
      pgCtl,
      ['start', '-D', PG_DIR, '-w', '-t', '90', '-l', LOG_FILE, '-o', `-p ${config.pgPort} -c listen_addresses=localhost`],
      { stdio: 'ignore', windowsHide: true },
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      const tail = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-6).join('\n') : '';
      reject(new Error(`Database did not start (pg_ctl exit ${code}).\n${tail}`));
    });
  });
}

/** Starts (or adopts) the built-in database and sets DATABASE_URL. */
export async function ensureDatabase(): Promise<string> {
  if (config.externalDatabaseUrl) {
    logger.info('Using external database from DATABASE_URL');
    return config.externalDatabaseUrl;
  }
  if (!config.pgPassword) throw new Error('PG_PASSWORD is missing in .env');

  const { pg_ctl, initdb } = await binaries();
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

  if (!fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))) {
    logger.info('Creating the database for the first time…');
    fs.mkdirSync(PG_DIR, { recursive: true });
    const pwFile = path.join(DATA_DIR, '.pgpass-init');
    fs.writeFileSync(pwFile, config.pgPassword, { mode: 0o600 });
    try {
      await run(initdb, ['-D', PG_DIR, '-U', 'pos', `--pwfile=${pwFile}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--no-locale'], { windowsHide: true });
    } finally {
      fs.rmSync(pwFile, { force: true });
    }
    // Sensible settings for a small shop PC.
    fs.appendFileSync(
      path.join(PG_DIR, 'postgresql.conf'),
      '\n# Annapoorna POS\nshared_buffers = 64MB\nmax_connections = 40\ntimezone = \'Asia/Kolkata\'\nlog_timezone = \'Asia/Kolkata\'\n',
    );
  }

  if (await isRunning(pg_ctl)) {
    logger.info('Database already running — reusing it');
  } else {
    await startServer(pg_ctl);
  }
  managed = true;

  const url = `postgresql://pos:${encodeURIComponent(config.pgPassword)}@localhost:${config.pgPort}/${DB_NAME}?connection_limit=10`;
  process.env.DATABASE_URL = url;
  return url;
}

export async function stopDatabase() {
  if (!managed && config.externalDatabaseUrl) return;
  const { pg_ctl } = await binaries();
  if (!fs.existsSync(path.join(PG_DIR, 'PG_VERSION'))) return;
  if (!(await isRunning(pg_ctl))) return;
  try {
    await run(pg_ctl, ['stop', '-D', PG_DIR, '-m', 'fast', '-w', '-t', '30'], { windowsHide: true });
  } catch (err) {
    logger.warn('Database stop reported a problem', err);
  }
}
