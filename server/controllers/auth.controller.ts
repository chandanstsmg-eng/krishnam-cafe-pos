import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { config } from '../config.js';
import { hashSecret, randomToken, sha256, signApproval, verifySecret } from '../utils/crypto.js';
import { AppError, badRequest } from '../utils/errors.js';
import { accountLock, assertNotLocked, clearFailures, recordFailure } from '../utils/lockout.js';
import { SESSION_COOKIE, toSessionUser } from '../middleware/auth.js';
import { audit } from '../services/audit.service.js';
import { getSettings } from '../services/settings.service.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { PIN_ERROR, PIN_RE } from '../../shared/pin.js';

const userInclude = { role: { include: { permissions: true } } } as const;

async function startSession(req: Request, res: Response, userId: string) {
  const token = randomToken();
  await db().session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + config.sessionHours * 3600_000),
      userAgent: req.get('user-agent')?.slice(0, 200),
      ip: req.ip,
    },
  });
  await db().user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  // Keep old sessions from piling up.
  await db().session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: 30 * 24 * 3600_000,
    path: '/',
  });
}

const loginBody = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) });

export async function login(req: Request, res: Response) {
  const { username, password } = loginBody.parse(req.body);
  const lock = accountLock(`pw:${username.toLowerCase()}`, req.ip);
  lock.check();
  const user = await db().user.findUnique({ where: { username: username.toLowerCase() }, include: userInclude });
  const ok = user && user.active && (await verifySecret(password, user.passwordHash));
  if (!ok) {
    lock.fail();
    throw new AppError(401, 'Username or password is incorrect.', 'BAD_LOGIN');
  }
  lock.clear();
  await startSession(req, res, user.id);
  res.json({ user: toSessionUser(user) });
}

const pinBody = z.object({ userId: z.string().min(1).max(64), pin: z.string().regex(PIN_RE, PIN_ERROR) });

export async function pinLogin(req: Request, res: Response) {
  const { userId, pin } = pinBody.parse(req.body);
  const lock = accountLock(`pin:${userId}`, req.ip);
  lock.check();
  const user = await db().user.findUnique({ where: { id: userId }, include: userInclude });
  const ok = user && user.active && (await verifySecret(pin, user.pinHash));
  if (!ok) {
    lock.fail();
    throw new AppError(401, 'Wrong PIN. Please try again.', 'BAD_PIN');
  }
  lock.clear();
  await startSession(req, res, user.id);
  res.json({ user: toSessionUser(user) });
}

/** Staff shown on the quick PIN sign-in screen. */
export async function staffList(_req: Request, res: Response) {
  const users = await db().user.findMany({
    where: { active: true, pinHash: { not: null } },
    select: { id: true, name: true, role: { select: { name: true, key: true } } },
    orderBy: [{ name: 'asc' }],
  });
  const settings = await getSettings();
  res.json({
    business: { name: settings.business.name, tagline: settings.business.tagline, city: settings.business.city },
    staff: users.map((u) => ({ id: u.id, name: u.name, role: u.role.name, roleKey: u.role.key })),
  });
}

export async function me(req: Request, res: Response) {
  res.json({ user: req.user ?? null });
}

export async function logout(req: Request, res: Response) {
  if (req.sessionId) await db().session.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
}

const approveBody = z.object({
  pin: z.string().regex(PIN_RE, PIN_ERROR),
  permission: z.enum(PERMISSIONS.map((p) => p.key) as [string, ...string[]]),
  reason: z.string().max(200).optional(),
});

/**
 * A manager types their PIN on the cashier's screen to approve one action.
 * Returns a signed token the till attaches to that action.
 */
export async function approve(req: Request, res: Response) {
  const { pin, permission } = approveBody.parse(req.body);
  // Guessing a manager's PIN from a signed-in till: lock that till's session.
  const key = `approve:${req.sessionId}`;
  assertNotLocked(key);
  const candidates = await db().user.findMany({
    where: { active: true, pinHash: { not: null }, role: { permissions: { some: { permissionKey: permission } } } },
    select: { id: true, name: true, pinHash: true, role: { select: { key: true } } },
  });
  for (const u of candidates) {
    if (await verifySecret(pin, u.pinHash)) {
      if (!['admin', 'manager'].includes(u.role.key) && u.id === req.user!.id) continue;
      clearFailures(key);
      return res.json({ token: signApproval({ by: u.id, byName: u.name, permission }), approvedBy: u.name });
    }
  }
  recordFailure(key);
  throw new AppError(403, 'PIN not recognised, or that person cannot approve this.', 'BAD_APPROVAL');
}

const changeBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Use at least 8 characters').max(200),
  newPin: z.string().regex(PIN_RE, PIN_ERROR).optional(),
});

export async function changePassword(req: Request, res: Response) {
  const body = changeBody.parse(req.body);
  const user = await db().user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifySecret(body.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect.', { currentPassword: 'Incorrect' });
  await db().user.update({
    where: { id: user.id },
    data: { passwordHash: await hashSecret(body.newPassword), ...(body.newPin ? { pinHash: await hashSecret(body.newPin) } : {}) },
  });
  await db().session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId } } });
  await audit(req.user!, { action: 'user.password', entity: 'user', entityId: user.id, summary: `${user.name} changed their password${body.newPin ? ' and PIN' : ''}` });
  res.json({ ok: true });
}
