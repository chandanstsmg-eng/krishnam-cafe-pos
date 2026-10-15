/** Everything a staff member can be allowed to do. Roles are sets of these. */
export const PERMISSIONS = [
  { key: 'orders.take', label: 'Take orders', group: 'Counter' },
  { key: 'bills.create', label: 'Create bills', group: 'Counter' },
  { key: 'payments.accept', label: 'Accept payments', group: 'Counter' },
  { key: 'receipts.print', label: 'Print & reprint receipts', group: 'Counter' },
  { key: 'discounts.apply', label: 'Apply discounts', group: 'Counter' },
  { key: 'shifts.manage', label: 'Open & close cash shifts', group: 'Counter' },
  { key: 'tables.manage', label: 'Tables & reservations', group: 'Counter' },
  { key: 'customers.view', label: 'View customers', group: 'Counter' },
  { key: 'kitchen.view', label: 'Use kitchen screen', group: 'Kitchen' },
  { key: 'bills.void', label: 'Cancel / void bills', group: 'Control' },
  { key: 'refunds.create', label: 'Give refunds', group: 'Control' },
  { key: 'reports.view', label: 'View sales & reports', group: 'Control' },
  { key: 'day.close', label: 'Close the day', group: 'Control' },
  { key: 'menu.prices', label: 'Change prices', group: 'Back office' },
  { key: 'menu.manage', label: 'Manage menu', group: 'Back office' },
  { key: 'inventory.manage', label: 'Manage stock', group: 'Back office' },
  { key: 'expenses.manage', label: 'Record expenses', group: 'Back office' },
  { key: 'staff.manage', label: 'Manage staff & permissions', group: 'Owner' },
  { key: 'settings.manage', label: 'Settings & printer', group: 'Owner' },
  { key: 'audit.view', label: 'View audit log', group: 'Owner' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const ALL = PERMISSIONS.map((p) => p.key);

export const DEFAULT_ROLES: {
  key: string;
  name: string;
  description: string;
  maxDiscountPercent: number;
  permissions: PermissionKey[];
}[] = [
  { key: 'admin', name: 'Admin', description: 'Owner — full control', maxDiscountPercent: 100, permissions: ALL },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Runs the floor, approves voids and discounts',
    maxDiscountPercent: 30,
    permissions: ALL.filter((k) => !['staff.manage', 'settings.manage'].includes(k)),
  },
  {
    key: 'cashier',
    name: 'Cashier',
    description: 'Takes orders and payments at the counter',
    maxDiscountPercent: 10,
    permissions: ['orders.take', 'bills.create', 'payments.accept', 'receipts.print', 'discounts.apply', 'shifts.manage', 'tables.manage', 'customers.view'],
  },
  {
    key: 'waiter',
    name: 'Waiter',
    description: 'Takes table orders on a tablet',
    maxDiscountPercent: 0,
    permissions: ['orders.take', 'bills.create', 'receipts.print', 'tables.manage'],
  },
  {
    key: 'kitchen',
    name: 'Kitchen Staff',
    description: 'Sees and updates kitchen orders',
    maxDiscountPercent: 0,
    permissions: ['kitchen.view'],
  },
];
