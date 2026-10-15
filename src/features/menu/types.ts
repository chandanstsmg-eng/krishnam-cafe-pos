/** Shapes returned by GET /api/menu/admin and GET /api/menu/price-changes. */

export interface AdminCategory {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  active: boolean;
  itemCount: number;
}

export interface AdminTaxRate {
  id: string;
  name: string;
  rate: number;
  active: boolean;
}

export interface AdminModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  options: { id: string; name: string; priceDelta: number; isDefault: boolean }[];
}

export interface AdminRecipeLine {
  inventoryItemId: string;
  name: string;
  unit: string;
  quantity: number;
  cost: number;
}

export interface AdminMenuItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  categoryId: string;
  price: number;
  taxRateId: string | null;
  isVeg: boolean;
  available: boolean;
  active: boolean;
  sendToKitchen: boolean;
  imageUrl: string | null;
  sortOrder: number;
  modifierGroups: AdminModifierGroup[];
  recipe: AdminRecipeLine[];
  unitCost: number | null;
  lastPriceChange: { oldPrice: number; newPrice: number; at: string; by: string | null } | null;
}

export interface AdminMenu {
  categories: AdminCategory[];
  taxRates: AdminTaxRate[];
  items: AdminMenuItem[];
}

export interface PriceChangeRow {
  id: string;
  menuItemId: string;
  item: string;
  oldPrice: number;
  newPrice: number;
  by: string | null;
  at: string;
}

export const MENU_KEY = ['menu-admin'] as const;
export const PRICE_HISTORY_KEY = ['menu-price-changes'] as const;
