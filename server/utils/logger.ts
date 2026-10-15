/**
 * Minimal logger. Technical details go to the terminal and data/logs/app.log;
 * cashiers only ever see friendly messages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const LOG_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const file = path.join(LOG_DIR, 'app.log');

function write(level: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}${extra ? ' ' + format(extra) : ''}`;
  try {
    fs.appendFileSync(file, line + '\n');
  } catch {
    /* logging must never break the app */
  }
  return line;
}

function format(v: unknown) {
  if (v instanceof Error) return `${v.message}\n${v.stack ?? ''}`;
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const quiet = () => !!process.env.VITEST;

export const logger = {
  info(msg: string, extra?: unknown) {
    const l = write('INFO', msg, extra);
    if (!quiet()) console.log(`  ${msg}`);
    return l;
  },
  warn(msg: string, extra?: unknown) {
    write('WARN', msg, extra);
    if (!quiet()) console.warn(`  ! ${msg}`);
  },
  error(msg: string, extra?: unknown) {
    write('ERROR', msg, extra);
    if (!quiet()) console.error(`  x ${msg}`, extra instanceof Error ? extra.message : '');
  },
};
