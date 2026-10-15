/** Shapes exchanged between the POS screen and the server. */
import type { DiscountInput, PayMethod, PaymentInput, TaxMode } from './billing.js';

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'CANCELLED';
export type TicketStatus = 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
export type InvoiceStatus = 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOID';

export interface OrderModifier {
  groupName: string;
  name: string;
  priceDelta: number;
}

export interface OrderItemDTO {
  id: string;
  menuItemId: string;
  name: string;
  basePrice: number;
  unitPrice: number;
  modifiers: OrderModifier[];
  qty: number;
  sentQty: number;
  note: string | null;
  taxRate: number;
  kitchen: boolean;
}

export interface OrderDiscount extends DiscountInput {
  reason?: string | null;
}

export interface TicketSummary {
  id: string;
  round: number;
  status: TicketStatus;
  createdAt: string;
}

export interface OrderDTO {
  id: string;
  /** null while an order created offline has not reached the server yet */
  number: number | null;
  type: OrderType;
  status: OrderStatus;
  tableId: string | null;
  tableName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  guests: number | null;
  note: string | null;
  discount: OrderDiscount | null;
  billPrintedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  items: OrderItemDTO[];
  tickets: TicketSummary[];
  invoiceId?: string | null;
}

export interface InvoiceDTO {
  id: string;
  number: string;
  orderId: string;
  orderNumber: number | null;
  orderType: OrderType;
  tableName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  subtotal: number;
  discount: number;
  discountLabel: string | null;
  taxable: number;
  tax: number;
  taxInclusive: boolean;
  roundOff: number;
  total: number;
  paid: number;
  change: number;
  refunded: number;
  status: InvoiceStatus;
  cashierName: string | null;
  createdAt: string;
  reprintCount: number;
  offline: boolean;
  voidReason: string | null;
  items: {
    name: string;
    modifiersText: string | null;
    note: string | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    taxRate: number;
  }[];
  payments: { method: PayMethod; amount: number; tendered: number | null; change: number | null; reference: string | null }[];
}

// ─── Sync commands (POS terminal → server) ───

export interface OrderSavePayload {
  order: {
    id: string;
    type: OrderType;
    tableId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddress: string | null;
    guests: number | null;
    note: string | null;
    discount: OrderDiscount | null;
    createdAt: string;
    items: Omit<OrderItemDTO, 'sentQty'>[];
  };
  sendToKitchen: boolean;
  /** ticket id to use if a kitchen ticket is created, so replays are idempotent */
  ticketId?: string;
  printBill?: boolean;
  /** manager approval for a discount above the cashier's own limit */
  discountApproval?: string | null;
  /** manager approval for removing items the kitchen has already started */
  removalApproval?: string | null;
  /**
   * Lines this till deliberately removed. Any other saved line missing from
   * `items` was added on another device (a waiter's tablet, say) after this
   * till loaded the order, so the server keeps it. Absent = replace all lines.
   */
  removedItemIds?: string[];
}

export interface OrderPayPayload {
  orderId: string;
  invoiceId: string;
  /** provisional number assigned by an offline terminal */
  offlineNumber?: string | null;
  payments: PaymentInput[];
  customerName?: string | null;
  customerPhone?: string | null;
  paidAt: string;
  /** client-computed total, used to detect a price mismatch */
  expectedTotal: number;
}

export interface OrderCancelPayload {
  orderId: string;
  reason: string;
  approvalToken?: string | null;
}

export interface OrderStatusPayload {
  orderId: string;
  status: 'SERVED';
}

interface CommandBase {
  id: string;
  /** when the cashier did it (may be long before the server hears about it) */
  at: string;
  /** true if the command was queued while the terminal could not reach the server */
  offline?: boolean;
}

export type SyncCommand =
  | (CommandBase & { type: 'order.save'; payload: OrderSavePayload })
  | (CommandBase & { type: 'order.pay'; payload: OrderPayPayload })
  | (CommandBase & { type: 'order.cancel'; payload: OrderCancelPayload })
  | (CommandBase & { type: 'order.served'; payload: OrderStatusPayload });

export interface SyncResult {
  id: string;
  ok: boolean;
  error?: string;
  code?: string;
  order?: OrderDTO | null;
  invoice?: InvoiceDTO | null;
}

// ─── Settings ───

export interface BusinessSettings {
  name: string;
  tagline: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  gstin: string;
  fssai: string;
}

export interface BillingSettings {
  taxMode: TaxMode;
  roundOff: boolean;
  invoicePrefix: string;
  /** a void, refund or discount above the cashier's limit needs a manager PIN */
  requireApprovalForVoid: boolean;
}

export interface PosSettings {
  requireShift: boolean;
  kitchenDisplay: boolean;
  printKot: boolean;
  allowDelivery: boolean;
  tableWarnMinutes: number;
  billWarnMinutes: number;
  quickCash: number[];
}

export interface ShiftSettings {
  /** paise; a closing difference larger than this needs an explanation */
  noteRequiredAbove: number;
}

export interface AppSettings {
  business: BusinessSettings;
  billing: BillingSettings;
  pos: PosSettings;
  shift: ShiftSettings;
  language: 'en' | 'kn';
}

export interface PrinterSettingsDTO {
  id: 'receipt' | 'kitchen';
  label: string;
  enabled: boolean;
  connection: 'BROWSER' | 'NETWORK';
  printerName: string | null;
  ipAddress: string | null;
  port: number;
  paperWidth: 58 | 80;
  printLogo: boolean;
  printTax: boolean;
  printFooter: boolean;
  footerText: string;
  autoPrint: boolean;
  copies: number;
  openDrawer: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  business: {
    name: 'Krishnam Cafe',
    tagline: 'Brew · Bite · Bliss',
    address: '',
    city: '',
    state: 'Karnataka',
    pincode: '',
    phone: '',
    gstin: '',
    fssai: '',
  },
  billing: { taxMode: 'EXCLUSIVE', roundOff: true, invoicePrefix: 'INV-', requireApprovalForVoid: true },
  pos: { requireShift: true, kitchenDisplay: true, printKot: false, allowDelivery: true, tableWarnMinutes: 45, billWarnMinutes: 15, quickCash: [10000, 20000, 50000, 200000] },
  shift: { noteRequiredAbove: 5000 },
  language: 'en',
};

// ─── Catalog sent to the POS ───

export interface CatalogCategory {
  id: string;
  name: string;
  icon: string | null;
  sortOrder: number;
}

export interface CatalogModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  options: { id: string; name: string; priceDelta: number; isDefault: boolean }[];
}

export interface CatalogItem {
  id: string;
  name: string;
  code: string | null;
  categoryId: string;
  price: number;
  taxRate: number;
  isVeg: boolean;
  available: boolean;
  sendToKitchen: boolean;
  imageUrl: string | null;
  modifierGroups: CatalogModifierGroup[];
}

export interface CatalogTable {
  id: string;
  name: string;
  area: string | null;
  capacity: number;
  hold: 'NONE' | 'RESERVED' | 'CLEANING';
  reservation?: { name: string; time: string; guests: number } | null;
}

export interface ShiftDTO {
  id: string;
  userName: string;
  openedAt: string;
  openingCash: number;
}

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  maxDiscountPercent: number;
}

export interface PosBootstrap {
  serverTime: string;
  businessDate: string;
  settings: AppSettings;
  printers: PrinterSettingsDTO[];
  categories: CatalogCategory[];
  items: CatalogItem[];
  tables: CatalogTable[];
  openOrders: OrderDTO[];
  recentInvoices: InvoiceDTO[];
  shift: ShiftDTO | null;
}
