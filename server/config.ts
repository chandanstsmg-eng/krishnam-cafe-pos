import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');

/** Creates .env from .env.example on first run, filling in random secrets. */
function ensureEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) return;
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const filled = example.replace(/__generate__/g, () => crypto.randomBytes(24).toString('base64url'));
  fs.writeFileSync(envPath, filled);
}

ensureEnvFile();
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);

export const config = {
  port: int(process.env.PORT, 4100),
  /** 0.0.0.0 = tablets on the café Wi-Fi can connect. 127.0.0.1 = only a proxy (Caddy) on this machine. */
  host: process.env.HOST?.trim() || '0.0.0.0',
  pgPort: int(process.env.PG_PORT, 54329),
  pgPassword: process.env.PG_PASSWORD ?? '',
  externalDatabaseUrl: process.env.DATABASE_URL,
  sessionSecret: process.env.SESSION_SECRET ?? '',
  /**
   * Which proxies to believe about the visitor's address and https.
   * 'loopback' (default) = Nginx/Caddy on the same machine; a number = that many
   * proxy hops (e.g. 1 behind Cloudflare or a cloud load balancer).
   */
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY ?? '') ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY || 'loopback',
  isProd: !process.argv.includes('--dev') && process.env.NODE_ENV !== 'development',
  isTest: process.env.NODE_ENV === 'test' || !!process.env.VITEST,
  sessionHours: 14,
  demo: {
    password: process.env.DEMO_PASSWORD ?? '',
    pins: {
      admin: process.env.DEMO_PIN_ADMIN ?? '',
      manager: process.env.DEMO_PIN_MANAGER ?? '',
      cashier: process.env.DEMO_PIN_CASHIER ?? '',
      kitchen: process.env.DEMO_PIN_KITCHEN ?? '',
      waiter: process.env.DEMO_PIN_WAITER ?? '',
    },
  },
};

if (!config.sessionSecret || config.sessionSecret.length < 16) {
  throw new Error('SESSION_SECRET in .env is missing or too short.');
}
