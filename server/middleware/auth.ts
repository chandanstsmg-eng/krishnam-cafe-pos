import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/prisma.js';
import { sha256 } from '../utils/crypto.js';
import { AppError, forbidden } from '../utils/errors.js';
import { config } from '../config.js';
import type { SessionUser } from '../../shared/types.js';
import type { PermissionKey } from '../../shared/permissions.js';

export const SESSION_COOKIE = 'ap_session';

export async function loadSessionUser(token: string | undefined): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token) return null;
  const id = sha256(token);
  const session = await db().session.findUnique({
    where: { id },
    include: { user: { include: { role: { include: { permissions: true } } } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;

  // Rolling expiry: an active till stays signed in through a long shift.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db().session.update({
      where: { id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + config.sessionHours * 3600_000) },
    });
  }
  return { user: toSessionUser(session.user), sessionId: id };
}

export function toSessionUser(u: {
  id: string;
  name: string;
  username: string;
  role: { key: string; name: string; maxDiscountPercent: number; permissions: { permissionKey: string }[] };
}): SessionUser {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    roleKey: u.role.key,
    roleName: u.role.name,
    permissions: u.role.permissions.map((p) => p.permissionKey),
    maxDiscountPercent: u.role.maxDiscountPercent,
  };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const found = await loadSessionUser(req.cookies?.[SESSION_COOKIE]);
    if (found) {
      req.user = found.user;
      req.sessionId = found.sessionId;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, 'Please sign in again.', 'UNAUTHENTICATED'));
  next();
}

export const can = (user: SessionUser | undefined, perm: PermissionKey) => !!user?.permissions.includes(perm);

/** Allows the request if the user has ANY of the listed permissions. */
export function requirePermission(...perms: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, 'Please sign in again.', 'UNAUTHENTICATED'));
    if (!perms.some((p) => req.user!.permissions.includes(p))) return next(forbidden());
    next();
  };
}
