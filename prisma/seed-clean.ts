/**
 * A clean start for a real outlet: settings, roles, GST rates, printer
 * defaults and one owner account. No demo staff, menu, tables or sales —
 * those are entered in Back office.
 *
 * Used on first start when FIRST_RUN_DATA=clean in .env.
 */
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../server/db/prisma.js';
import { hashSecret } from '../server/utils/crypto.js';
import { DEFAULT_ROLES, PERMISSIONS } from '../shared/permissions.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';

export async function seedClean(): Promise<{ username: string; password: string; generated: boolean }> {
  const given = process.env.ADMIN_PASSWORD?.trim() ?? '';
  const password = given.length >= 8 ? given : crypto.randomBytes(9).toString('base64url');
  const pin = process.env.ADMIN_PIN?.trim() ?? '';
  const passwordHash = await hashSecret(password);
  const pinHash = /^\d{4,6}$/.test(pin) ? await hashSecret(pin) : null;

  // All or nothing: a half-made database would stop the next start.
  await db().$transaction(
    async (q) => {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await q.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: {} });
      }
      await q.printerSetting.createMany({
        data: [
          { id: 'receipt', label: 'Receipt printer', paperWidth: 80, footerText: 'Thank you! Visit again.' },
          { id: 'kitchen', label: 'Kitchen printer', paperWidth: 80, enabled: false, printLogo: false, printTax: false, printFooter: false, footerText: '', autoPrint: false },
        ],
        skipDuplicates: true,
      });

      await q.permission.createMany({ data: PERMISSIONS.map((p, i) => ({ key: p.key, label: p.label, group: p.group, sortOrder: i })), skipDuplicates: true });
      let adminRoleId = '';
      for (const r of DEFAULT_ROLES) {
        const role = await q.role.create({
          data: { key: r.key, name: r.name, description: r.description, maxDiscountPercent: r.maxDiscountPercent, isSystem: true, permissions: { create: r.permissions.map((k) => ({ permissionKey: k })) } },
        });
        if (r.key === 'admin') adminRoleId = role.id;
      }

      await q.taxRate.createMany({ data: [{ name: 'GST 5%', rate: 5 }, { name: 'GST 12%', rate: 12 }, { name: 'GST 18%', rate: 18 }] });
      await q.user.create({ data: { name: 'Owner', username: 'admin', roleId: adminRoleId, passwordHash, pinHash } });
    },
    { timeout: 60_000 },
  );
  return { username: 'admin', password, generated: given.length < 8 };
}
