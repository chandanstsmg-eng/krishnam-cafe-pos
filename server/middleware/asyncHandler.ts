import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 5 forwards rejected promises already; this just keeps handler types tidy. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
