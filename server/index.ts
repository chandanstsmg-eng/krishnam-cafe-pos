/**
 * Starts everything with one command:
 *   database → migrations → demo data (first run) → web app + API on one port.
 *
 *   npm start      production build (builds the screens first if needed)
 *   npm run dev    live-reload while editing the code
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR, ROOT, config } from './config.js';
import { ensureDatabase, stopDatabase } from './db/postgres.js';
import { db, disconnect } from './db/prisma.js';
import { logger } from './utils/logger.js';

const dev = !config.isProd;
const t0 = Date.now();

function banner(lines: string[]) {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  console.log('\n  ┌' + '─'.repeat(w) + '┐');
  for (const l of lines) console.log('  │  ' + l.padEnd(w - 2) + '│');
  console.log('  └' + '─'.repeat(w) + '┘\n');
}

function portFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

async function alreadyRunning(port: number) {
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

function runPrisma(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const cli = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
    const child = spawn(process.execPath, [cli, ...args], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`prisma ${args.join(' ')} failed:\n${out}`))));
  });
}

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

async function ensureClientBuild() {
  const stamp = path.join(ROOT, 'dist', '.build-stamp');
  const sources = Math.max(
    newestMtime(path.join(ROOT, 'src')),
    newestMtime(path.join(ROOT, 'shared')),
    newestMtime(path.join(ROOT, 'public')),
    fs.statSync(path.join(ROOT, 'index.html')).mtimeMs,
  );
  if (fs.existsSync(stamp) && fs.statSync(stamp).mtimeMs >= sources) return;
  logger.info('Preparing the screens (first start or after an update)…');
  const { build } = await import('vite');
  await build({ root: ROOT, logLevel: 'warn' });
  fs.writeFileSync(stamp, new Date().toISOString());
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address);
}

async function main() {
  console.log(`\n  Annapoorna POS — starting${dev ? ' (developer mode)' : ''}…`);

  if (!(await portFree(config.port))) {
    if (await alreadyRunning(config.port)) {
      banner([`Annapoorna POS is already running.`, `Open  http://localhost:${config.port}`]);
      process.exitCode = 0;
      return;
    }
    banner([
      `Port ${config.port} is being used by another program.`,
      `Close that program, or change PORT in the .env file`,
      `(for example PORT=4200) and run the command again.`,
    ]);
    process.exitCode = 1;
    return;
  }

  await ensureDatabase();
  logger.info('Database ready');
  await runPrisma(['migrate', 'deploy']);

  const users = await db().user.count();
  if (users === 0 && process.env.FIRST_RUN_DATA === 'clean') {
    logger.info('First start: creating a clean database with one owner account…');
    const { seedClean } = await import('../prisma/seed-clean.js');
    const admin = await seedClean();
    if (admin.generated) {
      // Running as a service there is no console to read, so leave it in a file.
      const file = path.join(DATA_DIR, 'FIRST-LOGIN.txt');
      fs.writeFileSync(file, `Sign in as: ${admin.username}\nPassword:   ${admin.password}\n\nChange it in Back office → Staff, then delete this file.\n`, { mode: 0o600 });
      logger.info(`Owner sign-in written to ${file} — change the password after signing in.`);
    } else logger.info(`Owner account created — sign in as "${admin.username}" with ADMIN_PASSWORD from .env`);
  } else if (users === 0) {
    logger.info('Loading demo data for Annapoorna Café & Hotel (first start only)…');
    const { seed } = await import('../prisma/seed.js');
    await seed();
  }

  if (!dev) await ensureClientBuild();

  const { createApp } = await import('./app.js');
  const app = await createApp({ dev });
  const server = app.listen(config.port, config.host);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const { scheduleBackups } = await import('./services/backup.service.js');
  scheduleBackups();

  const lan = lanAddresses();
  banner([
    `Annapoorna POS is running   (ready in ${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    ``,
    `On this computer:   http://localhost:${config.port}`,
    ...(config.host === '0.0.0.0' ? lan.slice(0, 2).map((ip) => `Tablets on Wi-Fi:   http://${ip}:${config.port}`) : [`Listening on ${config.host} only (behind the https proxy)`]),
    ``,
    ...(process.env.FIRST_RUN_DATA === 'clean'
      ? [`Sign in as the owner (admin).`]
      : [`Demo sign-in:  admin / manager / cashier / kitchen`, `Password: see DEMO_PASSWORD in .env   (PINs there too)`]),
    ``,
    `Press Ctrl+C to stop. Your data stays in the data folder.`,
  ]);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n  Stopping (${signal})…`);
    const { closeAll } = await import('./services/events.service.js');
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r(null)));
    await disconnect();
    await stopDatabase();
    console.log('  Stopped safely. Goodbye.\n');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('Ctrl+C'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGBREAK', () => void shutdown('window closed'));
}

main().catch(async (err) => {
  logger.error('Could not start', err);
  console.error('\n  The app could not start. Details:\n');
  console.error('  ' + String(err?.message ?? err).split('\n').join('\n  '));
  console.error('\n  Full log: data/logs/app.log\n');
  await disconnect().catch(() => {});
  process.exit(1);
});
