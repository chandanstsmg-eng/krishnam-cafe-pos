/** Shapes returned by the stock and supplier endpoints. */

export type StockStatus = 'OK' | 'LOW' | 'OUT';
export type MoveType = 'PURCHASE' | 'CONSUMPTION' | 'WASTE' | 'RETURN' | 'ADJUSTMENT';
export type MovementType = MoveType | 'OPENING';

export interface StockItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minStock: number;
  purchasePrice: number;
  supplierId: string | null;
  supplierName: string | null;
  active: boolean;
  usedInRecipes: number;
  usePerDay: number;
  daysLeft: number | null;
  status: StockStatus;
}

export interface Movement {
  id: string;
  at: string;
  item: string;
  unit: string;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  note: string | null;
  reference: string | null;
  supplier: string | null;
  by: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  active: boolean;
  items: number;
  totalPaid: number;
  lastPaid: string | null;
}

export const INVENTORY_KEY = ['inventory'] as const;
export const SUPPLIERS_KEY = ['suppliers'] as const;
export const MOVE_TYPES: MoveType[] = ['PURCHASE', 'CONSUMPTION', 'WASTE', 'RETURN', 'ADJUSTMENT'];

const qtyFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
export const formatQty = (n: number) => qtyFmt.format(Math.round(n * 1000) / 1000);
export const qtyWithUnit = (n: number, unit: string) => `${formatQty(n)} ${unit}`;

/** Accepts "12", "0.25", "1.5" — up to 3 decimals. */
export const isQtyInput = (v: string) => /^\d{0,6}(\.\d{0,3})?$/.test(v);
