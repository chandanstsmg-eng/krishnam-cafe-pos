import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { ROOT, config } from './config.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import api from './routes/index.js';

export async function createApp(opts: { dev?: boolean; serveClient?: boolean } = {}): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      // Vite's dev server injects inline scripts; production gets a strict policy.
      contentSecurityPolicy: opts.dev
        ? false
        : {
            useDefaults: true,
            directives: {
              'script-src': ["'self'"],
              'style-src': ["'self'", "'unsafe-inline'"],
              'img-src': ["'self'", 'data:', 'blob:'],
              'connect-src': ["'self'"],
              'upgrade-insecure-requests': null,
            },
          },
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
      strictTransportSecurity: false,
    }),
  );
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/events') && compression.filter(req, res) }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb', strict: false }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', authenticate, api);
  app.use('/api', errorHandler);

  if (opts.serveClient === false) return app;

  if (opts.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: ROOT, server: { middlewareMode: true, ws: { port: config.port + 1 } }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(ROOT, 'dist');
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, file) => {
          if (file.endsWith('sw.js') || file.endsWith('.html') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    const indexHtml = path.join(dist, 'index.html');
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(fs.readFileSync(indexHtml, 'utf8'));
    });
  }
  app.use(errorHandler);
  return app;
}
