import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Staff never see stack traces. Known problems get a plain sentence; anything
 * unexpected is logged in full and answered with a generic message and a
 * reference number the technician can look up in data/logs/app.log.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code, fields: err.fields });
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] = issue.message;
    const first = err.issues[0];
    return res.status(400).json({
      error: first ? `Please check ${labelFor(first.path)}: ${first.message.toLowerCase()}` : 'Please check the details entered.',
      code: 'VALIDATION',
      fields,
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = err.meta?.target;
      const field = (Array.isArray(target) ? String(target[0]) : typeof target === 'string' ? target : '').replace(/^.*_(\w+)_key$/, '$1');
      const names: Record<string, string> = { code: 'short code', username: 'username', name: 'name', phone: 'mobile number', number: 'number' };
      const what = names[field];
      return res
        .status(409)
        .json({ error: what ? `That ${what} is already used. Please choose a different one.` : 'That already exists. Please use a different value.', code: 'DUPLICATE', fields: field ? { [field]: 'Already in use' } : undefined });
    }
    if (err.code === 'P2025') return res.status(404).json({ error: 'That record no longer exists.', code: 'NOT_FOUND' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'This is still in use elsewhere, so it cannot be removed.', code: 'IN_USE' });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request could not be read.', code: 'BAD_JSON' });
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That is too much data to send at once.', code: 'TOO_LARGE' });
  }
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  logger.error(`[${ref}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: `Something went wrong. Please try again. (Ref ${ref})`, code: 'SERVER' });
}

function labelFor(path: PropertyKey[]) {
  const last = String(path[path.length - 1] ?? 'the details');
  return last.replace(/([A-Z])/g, ' $1').toLowerCase();
}
