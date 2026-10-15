import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/prisma.js';
import { hashSecret, verifySecret } from '../utils/crypto.js';
import { audit } from '../services/audit.service.js';
import { badRequest, conflict } from '../utils/errors.js';
import { id, optText, phone, ymd } from '../validators/common.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { dateOnly } from '../../shared/dates.js';

export async function list(_req: Request, res: Response) {
  const [users, roles] = await Promise.all([
    db().user.findMany({ include: { role: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    db().role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { createdAt: 'asc' } }),
  ]);
  res.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      phone: u.phone,
      roleId: u.roleId,
      roleName: u.role.name,
      active: u.active,
      hasPin: !!u.pinHash,
      joinedOn: u.joinedOn?.toISOString().slice(0, 10) ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      maxDiscountPercent: r.maxDiscountPercent,
      isSystem: r.isSystem,
      users: r._count.users,
      permissions: r.permissions.map((p) => p.permissionKey),
    })),
    permissions: PERMISSIONS,
  });
}

/** PINs identify a person on the approval pad, so no two people may share one. */
async function pinTaken(pin: string, exceptUserId?: string) {
  const users = await db().user.findMany({ where: { pinHash: { not: null }, active: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { pinHash: true } });
  for (const u of users) if (await verifySecret(pin, u.pinHash)) return true;
  return false;
}

const userBody = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, 'Use 3–30 letters, numbers, dots or dashes'),
  phone,
  roleId: id,
  password: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN is 4 to 6 digits').optional(),
  active: z.boolean().optional(),
  joinedOn: ymd.nullish(),
});

export async function create(req: Request, res: Response) {
  const b = userBody.parse(req.body);
  if (!b.password) throw badRequest('Set a password.', { password: 'Required' });
  if (b.pin && (await pinTaken(b.pin))) throw badRequest('Someone else already uses this PIN.', { pin: 'Already in use' });
  const role = await db().role.findUniqueOrThrow({ where: { id: b.roleId } });
  const u = await db().user.create({
    data: {
      name: b.name,
      username: b.username,
      phone: b.phone || null,
      roleId: b.roleId,
      passwordHash: await hashSecret(b.password),
      pinHash: b.pin ? await hashSecret(b.pin) : null,
      joinedOn: b.joinedOn ? dateOnly(b.joinedOn) : null,
    },
  });
  await audit(req.user!, { action: 'user.create', entity: 'user', entityId: u.id, summary: `Added staff ${u.name} as ${role.name}` });
  res.status(201).json({ id: u.id });
}

export async function update(req: Request, res: Response) {
  const b = userBody.partial().parse(req.body);
  const uid = String(req.params.id);
  const before = await db().user.findUniqueOrThrow({ where: { id: uid }, include: { role: true } });
  if (uid === req.user!.id && (b.active === false || (b.roleId && b.roleId !== before.roleId))) {
    throw badRequest('You cannot turn off or change the role of your own account.');
  }
  if (before.role.key === 'admin' && ((b.roleId && b.roleId !== before.roleId) || b.active === false)) {
    const admins = await db().user.count({ where: { active: true, role: { key: 'admin' } } });
    if (admins <= 1) throw conflict('This is the only active admin. Make someone else admin first.');
  }
  if (b.pin && (await pinTaken(b.pin, uid))) throw badRequest('Someone else already uses this PIN.', { pin: 'Already in use' });
  const u = await db().user.update({
    where: { id: uid },
    data: {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.username !== undefined ? { username: b.username } : {}),
      ...(b.phone !== undefined ? { phone: b.phone || null } : {}),
      ...(b.roleId !== undefined ? { roleId: b.roleId } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
      ...(b.joinedOn !== undefined ? { joinedOn: b.joinedOn ? dateOnly(b.joinedOn) : null } : {}),
      ...(b.password ? { passwordHash: await hashSecret(b.password) } : {}),
      ...(b.pin ? { pinHash: await hashSecret(b.pin) } : {}),
    },
    include: { role: true },
  });
  if (b.active === false || b.password) await db().session.deleteMany({ where: { userId: uid } });
  const changes: string[] = [];
  if (b.roleId && b.roleId !== before.roleId) changes.push(`role ${before.role.name} → ${u.role.name}`);
  if (b.active !== undefined && b.active !== before.active) changes.push(b.active ? 'reactivated' : 'deactivated');
  if (b.password) changes.push('password reset');
  if (b.pin) changes.push('PIN changed');
  if (b.name && b.name !== before.name) changes.push(`name → ${b.name}`);
  await audit(req.user!, { action: 'user.update', entity: 'user', entityId: uid, summary: `Updated staff ${before.name}${changes.length ? `: ${changes.join(', ')}` : ''}` });
  res.json({ ok: true });
}

const roleBody = z.object({
  name: z.string().trim().min(1).max(40),
  description: optText(120),
  maxDiscountPercent: z.number().int().min(0).max(100),
  permissions: z.array(z.enum(PERMISSIONS.map((p) => p.key) as [string, ...string[]])),
});

export async function createRole(req: Request, res: Response) {
  const b = roleBody.parse(req.body);
  const key = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36).slice(-4);
  const r = await db().role.create({
    data: { key, name: b.name, description: b.description, maxDiscountPercent: b.maxDiscountPercent, permissions: { create: b.permissions.map((p) => ({ permissionKey: p })) } },
  });
  await audit(req.user!, { action: 'role.create', entity: 'role', entityId: r.id, summary: `Created role ${r.name} with ${b.permissions.length} permissions` });
  res.status(201).json({ id: r.id });
}

export async function updateRole(req: Request, res: Response) {
  const b = roleBody.partial().parse(req.body);
  const rid = String(req.params.id);
  const before = await db().role.findUniqueOrThrow({ where: { id: rid }, include: { permissions: true } });
  if (before.key === 'admin' && b.permissions && !b.permissions.includes('staff.manage')) {
    throw badRequest('Admin must keep "Manage staff & permissions", or nobody could fix permissions later.');
  }
  await db().$transaction(async (tx) => {
    await tx.role.update({
      where: { id: rid },
      data: {
        ...(b.name ? { name: b.name } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.maxDiscountPercent !== undefined ? { maxDiscountPercent: b.maxDiscountPercent } : {}),
      },
    });
    const parts: string[] = [];
    if (b.permissions) {
      const old = new Set(before.permissions.map((p) => p.permissionKey));
      const next = new Set(b.permissions);
      const added = [...next].filter((p) => !old.has(p));
      const removed = [...old].filter((p) => !next.has(p));
      await tx.rolePermission.deleteMany({ where: { roleId: rid } });
      await tx.rolePermission.createMany({ data: b.permissions.map((p) => ({ roleId: rid, permissionKey: p })) });
      const label = (k: string) => PERMISSIONS.find((p) => p.key === k)?.label ?? k;
      if (added.length) parts.push(`allowed ${added.map(label).join(', ')}`);
      if (removed.length) parts.push(`removed ${removed.map(label).join(', ')}`);
    }
    if (b.maxDiscountPercent !== undefined && b.maxDiscountPercent !== before.maxDiscountPercent) parts.push(`discount limit ${before.maxDiscountPercent}% → ${b.maxDiscountPercent}%`);
    if (parts.length) await audit(req.user!, { action: 'role.permissions', entity: 'role', entityId: rid, summary: `${before.name}: ${parts.join('; ')}` }, tx);
  });
  res.json({ ok: true });
}
