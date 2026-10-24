/**
 * Demo data for "Annapoorna Café & Hotel" — a pure-veg café on a highway town
 * in Karnataka. Creates the menu, stock, staff and tables, then simulates about
 * two months of trading (bills, payments, shifts, purchases, expenses, daily
 * closings) so reports and the dashboard have something real to show.
 *
 * Prices here are demonstration values only. Everything is editable in Admin.
 */
import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../server/db/prisma.js';
import { config } from '../server/config.js';
import { hashSecret } from '../server/utils/crypto.js';
import { DEFAULT_ROLES, PERMISSIONS } from '../shared/permissions.js';
import { computeBill, discountLabel } from '../shared/billing.js';
import { addDays, businessDate, dateOnly, formatDateLong, istDayStart } from '../shared/dates.js';
import { formatMoney } from '../shared/money.js';
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types.js';
import { PIN_RE } from '../shared/pin.js';

const HISTORY_DAYS = 60;
const uuid = () => crypto.randomUUID();
const R = (rupees: number) => Math.round(rupees * 100);

// Deterministic randomness so every reset produces the same café.
let seedState = 20260927;
function rand() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
}

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

// ───────────────────────── Catalogue ─────────────────────────

type ModGroup = { name: string; required: boolean; multiple?: boolean; options: [string, number, boolean?][] };
type MenuDef = {
  name: string;
  code: string;
  price: number;
  tax?: 'gst5' | null;
  kitchen?: boolean;
  mods?: ModGroup[];
  recipe?: [string, number][];
  /** relative popularity by time of day */
  slots: Partial<Record<Slot, number>>;
};
type Slot = 'early' | 'breakfast' | 'midmorning' | 'lunch' | 'afternoon' | 'evening' | 'dinner';

const TEA_STYLE: ModGroup = { name: 'Style', required: true, options: [['Regular', 0, true], ['Strong', 0], ['Less sugar', 0], ['No sugar', 0]] };
const DOSA_STYLE: ModGroup = { name: 'Style', required: true, options: [['Normal', 0, true], ['Butter', 10], ['Ghee', 20]] };
const RICE_SIZE: ModGroup = { name: 'Size', required: true, options: [['Full', 0, true], ['Half', -35]] };

const MENU: Record<string, { icon: string; items: MenuDef[] }> = {
  'Tea & Coffee': {
    icon: 'coffee',
    items: [
      { name: 'Tea', code: 'T', price: 15, mods: [TEA_STYLE], recipe: [['Milk', 0.08], ['Tea Powder', 0.004], ['Sugar', 0.012]], slots: { early: 30, breakfast: 14, midmorning: 22, lunch: 3, afternoon: 22, evening: 26, dinner: 5 } },
      { name: 'Coffee', code: 'C', price: 20, mods: [TEA_STYLE], recipe: [['Milk', 0.1], ['Coffee Powder', 0.008], ['Sugar', 0.012]], slots: { early: 24, breakfast: 16, midmorning: 16, lunch: 3, afternoon: 16, evening: 18, dinner: 5 } },
      { name: 'Ginger Tea', code: 'GT', price: 20, recipe: [['Milk', 0.08], ['Tea Powder', 0.004], ['Sugar', 0.012]], slots: { early: 6, midmorning: 5, afternoon: 5, evening: 6 } },
      { name: 'Lemon Tea', code: 'LT', price: 20, recipe: [['Tea Powder', 0.004], ['Sugar', 0.015], ['Lemon', 0.5]], slots: { midmorning: 3, afternoon: 4, evening: 3 } },
      { name: 'Black Coffee', code: 'BC', price: 20, recipe: [['Coffee Powder', 0.008], ['Sugar', 0.01]], slots: { early: 2, afternoon: 2, evening: 2 } },
      { name: 'Badam Milk', code: 'BM', price: 30, recipe: [['Milk', 0.2], ['Sugar', 0.02]], slots: { evening: 4, dinner: 3, midmorning: 2 } },
      { name: 'Boost / Horlicks', code: 'BH', price: 30, recipe: [['Milk', 0.18], ['Sugar', 0.01]], slots: { early: 2, breakfast: 2, evening: 2 } },
    ],
  },
  Breakfast: {
    icon: 'sunrise',
    items: [
      { name: 'Idli', code: 'ID', price: 40, tax: 'gst5', recipe: [['Idli Rava', 0.08], ['Urad Dal', 0.03], ['Coconut', 0.1], ['Cooking Oil', 0.002]], slots: { early: 10, breakfast: 26, midmorning: 8, dinner: 6 } },
      { name: 'Vada', code: 'VD', price: 30, tax: 'gst5', recipe: [['Urad Dal', 0.05], ['Cooking Oil', 0.02], ['Onion', 0.01]], slots: { early: 8, breakfast: 20, midmorning: 8, evening: 6, dinner: 3 } },
      { name: 'Idli Vada', code: 'IV', price: 55, tax: 'gst5', recipe: [['Idli Rava', 0.04], ['Urad Dal', 0.06], ['Cooking Oil', 0.02], ['Coconut', 0.1]], slots: { breakfast: 12, midmorning: 4 } },
      { name: 'Masala Dosa', code: 'MD', price: 60, tax: 'gst5', mods: [DOSA_STYLE], recipe: [['Rice', 0.06], ['Urad Dal', 0.02], ['Potato', 0.08], ['Onion', 0.03], ['Cooking Oil', 0.015], ['Coconut', 0.1]], slots: { breakfast: 24, midmorning: 12, evening: 10, dinner: 20 } },
      { name: 'Plain Dosa', code: 'PD', price: 50, tax: 'gst5', mods: [DOSA_STYLE], recipe: [['Rice', 0.06], ['Urad Dal', 0.02], ['Cooking Oil', 0.012], ['Coconut', 0.1]], slots: { breakfast: 8, midmorning: 4, dinner: 8 } },
      { name: 'Mysore Masala Dosa', code: 'MMD', price: 75, tax: 'gst5', mods: [DOSA_STYLE], recipe: [['Rice', 0.06], ['Urad Dal', 0.02], ['Potato', 0.08], ['Onion', 0.03], ['Cooking Oil', 0.018]], slots: { breakfast: 6, dinner: 8, evening: 3 } },
      { name: 'Set Dosa', code: 'SD', price: 55, tax: 'gst5', recipe: [['Rice', 0.07], ['Urad Dal', 0.02], ['Cooking Oil', 0.01], ['Vegetables', 0.03]], slots: { breakfast: 7, dinner: 4 } },
      { name: 'Rava Idli', code: 'RI', price: 45, tax: 'gst5', recipe: [['Rava', 0.07], ['Curd', 0.03], ['Ghee', 0.004]], slots: { breakfast: 5, midmorning: 2 } },
      { name: 'Poori', code: 'PR', price: 50, tax: 'gst5', recipe: [['Wheat Flour', 0.08], ['Cooking Oil', 0.03], ['Potato', 0.06], ['Onion', 0.02]], slots: { breakfast: 12, midmorning: 5 } },
      { name: 'Khara Bath', code: 'KB', price: 40, tax: 'gst5', recipe: [['Rava', 0.08], ['Cooking Oil', 0.01], ['Vegetables', 0.03], ['Onion', 0.02]], slots: { early: 3, breakfast: 10, midmorning: 4 } },
      { name: 'Kesari Bath', code: 'KSB', price: 40, tax: 'gst5', recipe: [['Rava', 0.07], ['Sugar', 0.05], ['Ghee', 0.01]], slots: { breakfast: 5, midmorning: 2 } },
      { name: 'Chow Chow Bath', code: 'CCB', price: 70, tax: 'gst5', recipe: [['Rava', 0.14], ['Sugar', 0.05], ['Ghee', 0.01], ['Vegetables', 0.03], ['Cooking Oil', 0.01]], slots: { breakfast: 6, midmorning: 2 } },
      { name: 'Pongal', code: 'PG', price: 50, tax: 'gst5', recipe: [['Rice', 0.08], ['Ghee', 0.008]], slots: { breakfast: 4 } },
      { name: 'Onion Uttappam', code: 'OU', price: 60, tax: 'gst5', recipe: [['Rice', 0.07], ['Urad Dal', 0.02], ['Onion', 0.05], ['Cooking Oil', 0.012]], slots: { breakfast: 3, dinner: 5 } },
    ],
  },
  Meals: {
    icon: 'utensils',
    items: [
      { name: 'Meals', code: 'ML', price: 100, tax: 'gst5', recipe: [['Rice', 0.2], ['Vegetables', 0.12], ['Curd', 0.05], ['Cooking Oil', 0.015], ['Tomato', 0.03], ['Urad Dal', 0.02]], slots: { lunch: 40, dinner: 6 } },
      { name: 'Mini Meals', code: 'MM', price: 70, tax: 'gst5', recipe: [['Rice', 0.14], ['Vegetables', 0.08], ['Curd', 0.04], ['Cooking Oil', 0.01]], slots: { lunch: 16, dinner: 3 } },
      { name: 'North Indian Thali', code: 'NT', price: 130, tax: 'gst5', recipe: [['Wheat Flour', 0.1], ['Rice', 0.1], ['Vegetables', 0.15], ['Cooking Oil', 0.02], ['Curd', 0.05]], slots: { lunch: 6, dinner: 7 } },
      { name: 'Chapathi Curry', code: 'CH', price: 60, tax: 'gst5', recipe: [['Wheat Flour', 0.1], ['Cooking Oil', 0.01], ['Vegetables', 0.08]], slots: { lunch: 5, evening: 3, dinner: 14 } },
      { name: 'Parotta Kurma', code: 'PK', price: 70, tax: 'gst5', recipe: [['Maida', 0.12], ['Cooking Oil', 0.02], ['Vegetables', 0.08]], slots: { lunch: 3, dinner: 12 } },
    ],
  },
  Rice: {
    icon: 'cooking-pot',
    items: [
      { name: 'Lemon Rice', code: 'LR', price: 50, tax: 'gst5', recipe: [['Rice', 0.12], ['Lemon', 1], ['Cooking Oil', 0.01]], slots: { lunch: 8, midmorning: 2, dinner: 3 } },
      { name: 'Curd Rice', code: 'CR', price: 50, tax: 'gst5', recipe: [['Rice', 0.12], ['Curd', 0.12]], slots: { lunch: 9, dinner: 5 } },
      { name: 'Tomato Rice', code: 'TR', price: 50, tax: 'gst5', recipe: [['Rice', 0.12], ['Tomato', 0.06], ['Cooking Oil', 0.01]], slots: { lunch: 5, dinner: 2 } },
      { name: 'Bisi Bele Bath', code: 'BBB', price: 60, tax: 'gst5', recipe: [['Rice', 0.1], ['Vegetables', 0.06], ['Ghee', 0.005], ['Cooking Oil', 0.01]], slots: { lunch: 9, dinner: 4 } },
      { name: 'Veg Pulao', code: 'VP', price: 70, tax: 'gst5', recipe: [['Rice', 0.13], ['Vegetables', 0.06], ['Cooking Oil', 0.012]], slots: { lunch: 4, dinner: 4 } },
      { name: 'Veg Fried Rice', code: 'VFR', price: 90, tax: 'gst5', mods: [RICE_SIZE], slots: { lunch: 4, dinner: 7 } },
      { name: 'Veg Biryani', code: 'VB', price: 110, tax: 'gst5', mods: [RICE_SIZE], slots: { lunch: 5, dinner: 7 } },
    ],
  },
  Snacks: {
    icon: 'cookie',
    items: [
      { name: 'Samosa', code: 'SM', price: 20, tax: 'gst5', recipe: [['Maida', 0.03], ['Potato', 0.05], ['Cooking Oil', 0.02]], slots: { midmorning: 6, afternoon: 12, evening: 14 } },
      { name: 'Onion Bajji', code: 'OB', price: 30, tax: 'gst5', recipe: [['Onion', 0.06], ['Cooking Oil', 0.03], ['Maida', 0.02]], slots: { afternoon: 7, evening: 12 } },
      { name: 'Mirchi Bajji', code: 'MB', price: 30, tax: 'gst5', recipe: [['Cooking Oil', 0.03], ['Maida', 0.02]], slots: { afternoon: 6, evening: 10 } },
      { name: 'Gobi Manchurian', code: 'GM', price: 90, tax: 'gst5', recipe: [['Vegetables', 0.15], ['Cooking Oil', 0.04], ['Maida', 0.03]], slots: { evening: 6, dinner: 6 } },
      { name: 'Veg Puff', code: 'VPF', price: 25, tax: 'gst5', kitchen: false, slots: { midmorning: 4, afternoon: 6, evening: 5 } },
      { name: 'Masala Puri', code: 'MP', price: 40, tax: 'gst5', slots: { afternoon: 4, evening: 9 } },
      { name: 'Cutlet', code: 'CT', price: 30, tax: 'gst5', recipe: [['Potato', 0.06], ['Cooking Oil', 0.02]], slots: { afternoon: 3, evening: 5 } },
      { name: 'Veg Sandwich', code: 'VS', price: 50, tax: 'gst5', slots: { midmorning: 3, afternoon: 4, evening: 3 } },
    ],
  },
  Beverages: {
    icon: 'cup-soda',
    items: [
      { name: 'Water Bottle', code: 'W', price: 20, tax: null, kitchen: false, recipe: [['Water Bottles (1 L)', 1]], slots: { early: 3, breakfast: 6, midmorning: 4, lunch: 12, afternoon: 5, evening: 5, dinner: 8 } },
      { name: 'Cool Drink (200 ml)', code: 'CD', price: 20, tax: null, kitchen: false, recipe: [['Soft Drinks (200 ml)', 1]], slots: { midmorning: 3, lunch: 6, afternoon: 6, evening: 4, dinner: 3 } },
      { name: 'Buttermilk', code: 'BTM', price: 20, tax: 'gst5', kitchen: false, recipe: [['Curd', 0.1]], slots: { midmorning: 3, lunch: 10, afternoon: 6 } },
      { name: 'Sweet Lassi', code: 'SL', price: 40, tax: 'gst5', recipe: [['Curd', 0.2], ['Sugar', 0.03]], slots: { lunch: 4, afternoon: 5, evening: 2 } },
      { name: 'Fresh Lime Soda', code: 'FLS', price: 35, tax: 'gst5', mods: [{ name: 'Taste', required: true, options: [['Sweet', 0, true], ['Salt', 0], ['Mixed', 0]] }], recipe: [['Lemon', 1], ['Sugar', 0.02]], slots: { midmorning: 2, lunch: 3, afternoon: 5, evening: 3 } },
      { name: 'Watermelon Juice', code: 'WJ', price: 50, tax: 'gst5', slots: { lunch: 2, afternoon: 4, evening: 2 } },
    ],
  },
  Desserts: {
    icon: 'ice-cream-cone',
    items: [
      { name: 'Gulab Jamun', code: 'GJ', price: 40, tax: 'gst5', kitchen: false, slots: { lunch: 3, evening: 2, dinner: 4 } },
      { name: 'Payasam', code: 'PY', price: 30, tax: 'gst5', kitchen: false, recipe: [['Milk', 0.1], ['Sugar', 0.03]], slots: { lunch: 3, dinner: 2 } },
      { name: 'Carrot Halwa', code: 'CHL', price: 50, tax: 'gst5', kitchen: false, recipe: [['Milk', 0.06], ['Sugar', 0.04], ['Ghee', 0.01]], slots: { evening: 2, dinner: 3 } },
      { name: 'Ice Cream Cup', code: 'IC', price: 40, tax: null, kitchen: false, recipe: [['Ice Cream Cups', 1]], slots: { lunch: 3, afternoon: 4, evening: 3, dinner: 3 } },
    ],
  },
};

// Old prices, to give the price history some substance.
const PRICE_HISTORY: { item: string; old: number; daysAgo: number }[] = [
  { item: 'Tea', old: 12, daysAgo: 41 },
  { item: 'Coffee', old: 18, daysAgo: 41 },
  { item: 'Masala Dosa', old: 55, daysAgo: 26 },
  { item: 'Meals', old: 90, daysAgo: 18 },
  { item: 'Samosa', old: 15, daysAgo: 9 },
];

type InvDef = { name: string; category: string; unit: string; min: number; cost: number; supplier: string; pack: number; start: number };
const INVENTORY: InvDef[] = [
  { name: 'Milk', category: 'Dairy', unit: 'L', min: 10, cost: 52, supplier: 'Sri Lakshmi Dairy', pack: 20, start: 20 },
  { name: 'Curd', category: 'Dairy', unit: 'kg', min: 4, cost: 60, supplier: 'Sri Lakshmi Dairy', pack: 8, start: 8 },
  { name: 'Ghee', category: 'Dairy', unit: 'kg', min: 1, cost: 620, supplier: 'Sri Lakshmi Dairy', pack: 2, start: 2 },
  { name: 'Butter', category: 'Dairy', unit: 'kg', min: 1, cost: 540, supplier: 'Sri Lakshmi Dairy', pack: 2, start: 2 },
  { name: 'Tea Powder', category: 'Beverages', unit: 'kg', min: 1, cost: 420, supplier: 'Malnad Coffee & Tea Traders', pack: 3, start: 3 },
  { name: 'Coffee Powder', category: 'Beverages', unit: 'kg', min: 1.5, cost: 640, supplier: 'Malnad Coffee & Tea Traders', pack: 4, start: 4 },
  { name: 'Sugar', category: 'Grocery', unit: 'kg', min: 5, cost: 44, supplier: 'Manjunatha Provision Stores', pack: 25, start: 20 },
  { name: 'Rice', category: 'Grocery', unit: 'kg', min: 25, cost: 56, supplier: 'Manjunatha Provision Stores', pack: 75, start: 75 },
  { name: 'Idli Rava', category: 'Grocery', unit: 'kg', min: 5, cost: 48, supplier: 'Manjunatha Provision Stores', pack: 25, start: 20 },
  { name: 'Urad Dal', category: 'Grocery', unit: 'kg', min: 5, cost: 130, supplier: 'Manjunatha Provision Stores', pack: 20, start: 15 },
  { name: 'Wheat Flour', category: 'Grocery', unit: 'kg', min: 5, cost: 42, supplier: 'Manjunatha Provision Stores', pack: 20, start: 15 },
  { name: 'Maida', category: 'Grocery', unit: 'kg', min: 3, cost: 40, supplier: 'Manjunatha Provision Stores', pack: 10, start: 8 },
  { name: 'Rava', category: 'Grocery', unit: 'kg', min: 3, cost: 48, supplier: 'Manjunatha Provision Stores', pack: 15, start: 10 },
  { name: 'Cooking Oil', category: 'Grocery', unit: 'L', min: 8, cost: 150, supplier: 'Manjunatha Provision Stores', pack: 15, start: 15 },
  { name: 'Onion', category: 'Vegetables', unit: 'kg', min: 8, cost: 38, supplier: 'Ramesh — Vegetable Market', pack: 20, start: 15 },
  { name: 'Potato', category: 'Vegetables', unit: 'kg', min: 8, cost: 30, supplier: 'Ramesh — Vegetable Market', pack: 25, start: 20 },
  { name: 'Tomato', category: 'Vegetables', unit: 'kg', min: 5, cost: 36, supplier: 'Ramesh — Vegetable Market', pack: 10, start: 8 },
  { name: 'Vegetables', category: 'Vegetables', unit: 'kg', min: 5, cost: 45, supplier: 'Ramesh — Vegetable Market', pack: 15, start: 12 },
  { name: 'Coconut', category: 'Vegetables', unit: 'pcs', min: 10, cost: 30, supplier: 'Ramesh — Vegetable Market', pack: 40, start: 30 },
  { name: 'Lemon', category: 'Vegetables', unit: 'pcs', min: 20, cost: 4, supplier: 'Ramesh — Vegetable Market', pack: 100, start: 80 },
  { name: 'Water Bottles (1 L)', category: 'Packaged', unit: 'pcs', min: 24, cost: 9, supplier: 'Balaji Distributors', pack: 72, start: 60 },
  { name: 'Soft Drinks (200 ml)', category: 'Packaged', unit: 'pcs', min: 24, cost: 14, supplier: 'Balaji Distributors', pack: 72, start: 48 },
  { name: 'Ice Cream Cups', category: 'Packaged', unit: 'pcs', min: 12, cost: 22, supplier: 'Balaji Distributors', pack: 48, start: 30 },
  { name: 'LPG Cylinder (19 kg)', category: 'Gas', unit: 'pcs', min: 1, cost: 1850, supplier: 'Sri Venkateshwara Gas Agency', pack: 2, start: 2 },
  { name: 'Parcel Containers', category: 'Packaging', unit: 'pcs', min: 100, cost: 3, supplier: 'Balaji Distributors', pack: 500, start: 300 },
  { name: 'Paper Bags', category: 'Packaging', unit: 'pcs', min: 100, cost: 1.5, supplier: 'Balaji Distributors', pack: 500, start: 300 },
  { name: 'Tissue Paper', category: 'Packaging', unit: 'packet', min: 5, cost: 45, supplier: 'Balaji Distributors', pack: 20, start: 12 },
  { name: 'Dishwash Liquid', category: 'Cleaning', unit: 'L', min: 2, cost: 110, supplier: 'Manjunatha Provision Stores', pack: 5, start: 4 },
  { name: 'Floor Cleaner', category: 'Cleaning', unit: 'L', min: 1, cost: 95, supplier: 'Manjunatha Provision Stores', pack: 5, start: 3 },
];

const SUPPLIERS = [
  { name: 'Sri Lakshmi Dairy', contactPerson: 'Nagaraj', phone: '98450 21134', notes: 'Delivers milk daily 5:30 am. Pays monthly.' },
  { name: 'Manjunatha Provision Stores', contactPerson: 'Manjunath', phone: '94481 66720', address: 'Market Road', gstin: '29AKLPM4821K1Z3' },
  { name: 'Ramesh — Vegetable Market', contactPerson: 'Ramesh', phone: '97409 55301', notes: 'Cash only. Order the evening before.' },
  { name: 'Malnad Coffee & Tea Traders', contactPerson: 'Prashanth', phone: '99001 34276', address: 'Chikkamagaluru' },
  { name: 'Balaji Distributors', contactPerson: 'Venkatesh', phone: '96320 87415', gstin: '29BHXPV7310L1Z8' },
  { name: 'Sri Venkateshwara Gas Agency', contactPerson: 'Office', phone: '08132 220918' },
];

const CUSTOMERS: [string, string][] = [
  ['Shankar Hegde', '9845012871'], ['Anitha R', '9731406625'], ['Mohan Kumar', '9900312458'], ['Kavya S', '8147920336'],
  ['Basavaraj Patil', '9448217763'], ['Deepa M', '9611088412'], ['Girish', '9008564120'], ['Rekha Nayak', '9845360091'],
  ['Srinivas Murthy', '9741123098'], ['Harish Gowda', '9986342217'], ['Pooja K', '7760412389'], ['Naveen', '9535507741'],
  ['Chandrashekar', '9448804126'], ['Sowmya', '8050237716'], ['Ravindra', '9880045621'], ['Madhu', '9663190074'],
  ['Asha Rao', '9902876650'], ['Vinay', '8095521470'], ['Kiran Shetty', '9844667031'], ['Latha', '9481207755'],
  ['Prakash Jain', '9916234008'], ['Manjula', '9740088123'], ['Ajay (truck driver)', '9538041792'], ['Ganesh Travels', '9845566120'],
];

const HOURS: { slot: Slot; from: number; to: number; weight: number }[] = [
  { slot: 'early', from: 6 * 60, to: 7 * 60 + 30, weight: 10 },
  { slot: 'breakfast', from: 7 * 60 + 30, to: 10 * 60 + 30, weight: 30 },
  { slot: 'midmorning', from: 10 * 60 + 30, to: 12 * 60, weight: 9 },
  { slot: 'lunch', from: 12 * 60, to: 15 * 60, weight: 24 },
  { slot: 'afternoon', from: 15 * 60, to: 17 * 60, weight: 8 },
  { slot: 'evening', from: 17 * 60, to: 19 * 60 + 30, weight: 15 },
  { slot: 'dinner', from: 19 * 60 + 30, to: 22 * 60, weight: 14 },
];

// ───────────────────────── Seed ─────────────────────────

export async function seed(opts: { quiet?: boolean } = {}) {
  const q = db();
  const log = (m: string) => !opts.quiet && console.log(`  · ${m}`);
  const now = new Date();
  const today = businessDate(now);

  // ── Settings ──
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    business: {
      name: 'Krishnam Cafe',
      tagline: 'Brew · Bite · Bliss',
      address: 'NH 75, Near KSRTC Bus Stand',
      city: '',
      state: 'Karnataka',
      pincode: '572130',
      phone: '98765 43210',
      gstin: '29AAKFA1234B1Z5',
      fssai: '',
    },
  };
  for (const [key, value] of Object.entries(settings)) {
    await q.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
  }
  await q.printerSetting.createMany({
    data: [
      { id: 'receipt', label: 'Receipt printer', paperWidth: 80, footerText: 'Thank you! Visit again.\nಧನ್ಯವಾದಗಳು' },
      { id: 'kitchen', label: 'Kitchen printer', paperWidth: 80, enabled: false, printLogo: false, printTax: false, printFooter: false, footerText: '', autoPrint: false },
    ],
    skipDuplicates: true,
  });
  // Printers can't print Kannada text in their built-in fonts; keep the footer ASCII for network mode.
  await q.printerSetting.update({ where: { id: 'receipt' }, data: { footerText: 'Thank you! Visit again.' } });

  // ── Roles & staff ──
  await q.permission.createMany({ data: PERMISSIONS.map((p, i) => ({ key: p.key, label: p.label, group: p.group, sortOrder: i })), skipDuplicates: true });
  const roleIds: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) {
    const role = await q.role.create({
      data: { key: r.key, name: r.name, description: r.description, maxDiscountPercent: r.maxDiscountPercent, isSystem: true, permissions: { create: r.permissions.map((k) => ({ permissionKey: k })) } },
    });
    roleIds[r.key] = role.id;
  }
  const pw = await hashSecret(config.demo.password || crypto.randomBytes(12).toString('base64url'));
  const pin = async (p: string) => (PIN_RE.test(p) ? hashSecret(p) : null);
  const staffDefs = [
    { key: 'admin', name: 'Ravi Kumar', username: 'admin', role: 'admin', pin: config.demo.pins.admin, phone: '98450 11122', joined: 2016 },
    { key: 'manager', name: 'Suresh Gowda', username: 'manager', role: 'manager', pin: config.demo.pins.manager, phone: '97410 22233', joined: 2019 },
    { key: 'cashier', name: 'Lakshmi N', username: 'cashier', role: 'cashier', pin: config.demo.pins.cashier, phone: '81470 33344', joined: 2022 },
    { key: 'cashier2', name: 'Prakash S', username: 'prakash', role: 'cashier', pin: '', phone: '90080 44455', joined: 2023 },
    { key: 'kitchen', name: 'Mahadevappa', username: 'kitchen', role: 'kitchen', pin: config.demo.pins.kitchen, phone: '96630 55566', joined: 2017 },
    { key: 'waiter', name: 'Manju', username: 'manju', role: 'waiter', pin: config.demo.pins.waiter, phone: '77600 66677', joined: 2024 },
  ];
  const users: Record<string, string> = {};
  for (const s of staffDefs) {
    const u = await q.user.create({
      data: { name: s.name, username: s.username, phone: s.phone, roleId: roleIds[s.role], passwordHash: pw, pinHash: await pin(s.pin), joinedOn: dateOnly(`${s.joined}-06-01`) },
    });
    users[s.key] = u.id;
  }
  log('staff and roles');

  // ── Tax, menu ──
  const gst5 = await q.taxRate.create({ data: { name: 'GST 5%', rate: 5 } });
  await q.taxRate.create({ data: { name: 'GST 12%', rate: 12 } });
  await q.taxRate.create({ data: { name: 'GST 18%', rate: 18 } });

  const suppliers: Record<string, string> = {};
  for (const s of SUPPLIERS) suppliers[s.name] = (await q.supplier.create({ data: s })).id;

  const inv: Record<string, { id: string; def: InvDef; stock: number }> = {};
  for (const d of INVENTORY) {
    const it = await q.inventoryItem.create({
      data: { name: d.name, category: d.category, unit: d.unit, minStock: d.min, purchasePrice: R(d.cost), supplierId: suppliers[d.supplier], currentStock: 0 },
    });
    inv[d.name] = { id: it.id, def: d, stock: 0 };
  }

  type MenuRow = { id: string; def: MenuDef; categoryId: string; categoryName: string; price: number; taxRate: number; unitCost: number | null; mods: { group: string; options: { name: string; delta: number; def: boolean }[] }[] };
  const menu: MenuRow[] = [];
  let catOrder = 0;
  for (const [catName, cat] of Object.entries(MENU)) {
    const c = await q.menuCategory.create({ data: { name: catName, icon: cat.icon, sortOrder: catOrder++ } });
    let order = 0;
    for (const m of cat.items) {
      const item = await q.menuItem.create({
        data: {
          name: m.name,
          code: m.code,
          categoryId: c.id,
          price: R(m.price),
          taxRateId: m.tax === null ? null : gst5.id,
          // Tea & coffee are made at the counter, not in the kitchen.
          sendToKitchen: m.kitchen !== false && catName !== 'Tea & Coffee',
          sortOrder: order++,
          modifierGroups: m.mods
            ? {
                create: m.mods.map((g, gi) => ({
                  name: g.name,
                  required: g.required,
                  multiple: !!g.multiple,
                  sortOrder: gi,
                  options: { create: g.options.map(([name, delta, def], oi) => ({ name, priceDelta: R(delta), isDefault: !!def, sortOrder: oi })) },
                })),
              }
            : undefined,
        },
      });
      if (m.recipe) {
        await q.recipeLine.createMany({ data: m.recipe.map(([invName, qty]) => ({ menuItemId: item.id, inventoryItemId: inv[invName].id, quantity: qty })) });
      }
      const unitCost = m.recipe ? Math.round(m.recipe.reduce((a, [n, qty]) => a + qty * R(inv[n].def.cost), 0)) : null;
      menu.push({
        id: item.id,
        def: m,
        categoryId: c.id,
        categoryName: catName,
        price: R(m.price),
        taxRate: m.tax === null ? 0 : 5,
        unitCost,
        mods: (m.mods ?? []).map((g) => ({ group: g.name, options: g.options.map(([name, delta, def]) => ({ name, delta: R(delta), def: !!def })) })),
      });
    }
  }
  log(`menu: ${menu.length} items in ${catOrder} categories`);

  // ── Tables ──
  const tableDefs = [
    ...Array.from({ length: 8 }, (_, i) => ({ name: `T${String(i + 1).padStart(2, '0')}`, area: 'Main hall', capacity: i < 2 ? 2 : 4 })),
    { name: 'T09', area: 'Family room', capacity: 6 },
    { name: 'T10', area: 'Family room', capacity: 8 },
    { name: 'T11', area: 'Outside', capacity: 4 },
    { name: 'T12', area: 'Outside', capacity: 4 },
  ];
  const tables: { id: string; name: string }[] = [];
  for (const [i, t] of tableDefs.entries()) tables.push(await q.diningTable.create({ data: { ...t, sortOrder: i } }));

  const customers: { id: string; name: string; phone: string }[] = [];
  for (const [name, phone] of CUSTOMERS) {
    const c = await q.customer.create({ data: { name, phone, createdAt: istDayStart(addDays(today, -HISTORY_DAYS - between(5, 200))) } });
    customers.push({ id: c.id, name, phone });
  }

  // ── Simulated trading ──
  const priceOn = (row: MenuRow, day: string) => {
    const h = PRICE_HISTORY.find((p) => p.item === row.def.name);
    return h && day < addDays(today, -h.daysAgo) ? R(h.old) : row.price;
  };

  const orders: Prisma.OrderCreateManyInput[] = [];
  const orderItems: Prisma.OrderItemCreateManyInput[] = [];
  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  const invoiceItems: Prisma.InvoiceItemCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const refunds: Prisma.RefundCreateManyInput[] = [];
  const shifts: Prisma.ShiftCreateManyInput[] = [];
  const shiftTxns: Prisma.ShiftTransactionCreateManyInput[] = [];
  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const invTxns: Prisma.InventoryTransactionCreateManyInput[] = [];
  const audits: Prisma.AuditLogCreateManyInput[] = [];
  const closings: { date: string; closedAt: Date }[] = [];
  let orderNo = 1001;
  let invoiceNo = 1;
  const staffName: Record<string, string> = Object.fromEntries(staffDefs.map((s) => [users[s.key], s.name]));

  const auditAt = (at: Date, userKey: string, action: string, summary: string, entity?: string, entityId?: string) =>
    audits.push({ at, userId: users[userKey], userName: staffName[users[userKey]], action, summary, entity, entityId });

  // opening stock
  for (const x of Object.values(inv)) {
    x.stock = x.def.start;
    invTxns.push({ itemId: x.id, type: 'OPENING', quantity: x.def.start, balanceAfter: x.def.start, unitCost: R(x.def.cost), note: 'Opening stock', createdAt: istDayStart(addDays(today, -HISTORY_DAYS)), userId: users.admin });
  }

  const nowMin = (now.getTime() - istDayStart(today).getTime()) / 60_000;

  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const day = addDays(today, -d);
    const dayStart = istDayStart(day);
    const at = (min: number) => new Date(dayStart.getTime() + min * 60_000);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const isToday = d === 0;
    const weekend = dow === 0 || dow === 6;
    const festival = ['2026-08-15', '2026-09-14', '2026-09-15'].includes(day); // holidays / local fair days
    let billsToday = Math.round((weekend ? between(150, 185) : between(108, 138)) * (festival ? 1.35 : 1));

    // Shifts: morning (Lakshmi) and evening (Prakash).
    const morningShift = uuid();
    const eveningShift = uuid();
    const shiftDefs = [
      { id: morningShift, user: 'cashier', open: 5 * 60 + 50, close: 15 * 60, opening: R(3000) },
      { id: eveningShift, user: 'cashier2', open: 15 * 60, close: 22 * 60 + 25, opening: R(2000) },
    ];
    const cashBy: Record<string, number> = { [morningShift]: 0, [eveningShift]: 0 };
    const otherBy: Record<string, Record<string, number>> = { [morningShift]: {}, [eveningShift]: {} };
    const cashOutBy: Record<string, number> = { [morningShift]: 0, [eveningShift]: 0 };
    const billsBy: Record<string, number> = { [morningShift]: 0, [eveningShift]: 0 };

    const consumption = new Map<string, number>();
    const times: number[] = [];
    for (let i = 0; i < billsToday; i++) {
      const slot = weighted(HOURS.map((h) => [h, h.weight] as [typeof h, number]));
      times.push(between(slot.from, slot.to - 1));
    }
    times.sort((a, b) => a - b);

    for (const minute of times) {
      if (isToday && minute > nowMin - 5) break;
      const slot = HOURS.find((h) => minute >= h.from && minute < h.to)!.slot;
      const pool = menu.filter((m) => (m.def.slots[slot] ?? 0) > 0);
      const type = weighted<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>([['DINE_IN', 70], ['TAKEAWAY', 25], ['DELIVERY', slot === 'lunch' || slot === 'dinner' ? 6 : 1]]);
      const party = type === 'DINE_IN' ? weighted([[1, 30], [2, 35], [3, 15], [4, 14], [6, 6]]) : weighted([[1, 60], [2, 30], [4, 10]]);
      const lines = new Map<string, { row: MenuRow; qty: number; mods: { groupName: string; name: string; priceDelta: number }[]; note: string | null }>();
      const picks = Math.max(1, Math.round(party * (0.8 + rand() * 0.9)));
      for (let k = 0; k < picks; k++) {
        const row = weighted(pool.map((m) => [m, m.def.slots[slot]!] as [MenuRow, number]));
        const mods = row.mods.map((g) => {
          const opt = rand() < 0.75 ? g.options.find((o) => o.def)! : pick(g.options);
          return { groupName: g.group, name: opt.name, priceDelta: opt.delta };
        });
        const key = row.id + mods.map((m) => m.name).join('|');
        const cur = lines.get(key);
        if (cur) cur.qty++;
        else lines.set(key, { row, qty: 1, mods, note: rand() < 0.06 ? pick(['Less spicy', 'No onion', 'Extra chutney', 'Parcel', 'Less oil']) : null });
      }
      const orderId = uuid();
      const createdAt = at(minute);
      const table = type === 'DINE_IN' ? pick(tables) : null;
      const customer = rand() < (type === 'DELIVERY' ? 0.9 : 0.12) ? pick(customers) : null;
      const lineArr = [...lines.values()];

      const discount = rand() < 0.03 ? (rand() < 0.5 ? { type: 'PERCENT' as const, value: pick([5, 10]) } : { type: 'AMOUNT' as const, value: R(pick([10, 20])) }) : null;
      const discReason = discount ? pick(['Regular customer', 'Staff meal', 'Late service', 'Bulk order', 'Owner approved']) : null;
      const unit = (l: (typeof lineArr)[number]) => priceOn(l.row, day) + l.mods.reduce((a, m) => a + m.priceDelta, 0);
      const bill = computeBill(
        lineArr.map((l, i) => ({ key: String(i), unitPrice: unit(l), qty: l.qty, taxRate: l.row.taxRate })),
        discount,
        settings.billing,
      );
      const paidAt = new Date(createdAt.getTime() + (type === 'DINE_IN' ? between(14, 45) : between(4, 14)) * 60_000);
      const shiftId = minute < 15 * 60 ? morningShift : eveningShift;
      const cashier = minute < 15 * 60 ? 'cashier' : 'cashier2';
      const voided = rand() < 0.005;
      const cancelledNoBill = !voided && rand() < 0.004;

      orders.push({
        id: orderId,
        number: orderNo++,
        type,
        status: voided || cancelledNoBill ? 'CANCELLED' : 'COMPLETED',
        tableId: table?.id ?? null,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        deliveryAddress: type === 'DELIVERY' ? pick(['Bus stand road', 'Govt hospital, OPD', 'Petrol bunk, NH 75', 'Taluk office', 'Sri Rama temple street']) : null,
        guests: type === 'DINE_IN' ? party : null,
        discountType: discount?.type ?? null,
        discountValue: discount?.value ?? null,
        discountReason: discReason,
        createdById: users[cashier],
        createdAt,
        updatedAt: paidAt,
        completedAt: voided || cancelledNoBill ? null : paidAt,
        cancelledAt: cancelledNoBill ? new Date(createdAt.getTime() + 6 * 60_000) : voided ? new Date(paidAt.getTime() + 20 * 60_000) : null,
        cancelReason: cancelledNoBill ? pick(['Customer cancelled', 'Customer left', 'Wrong order']) : voided ? 'Bill voided: Duplicate order' : null,
        cancelledById: cancelledNoBill || voided ? users.manager : null,
      });
      lineArr.forEach((l, i) =>
        orderItems.push({
          id: uuid(),
          orderId,
          menuItemId: l.row.id,
          name: l.row.def.name,
          basePrice: priceOn(l.row, day),
          unitPrice: unit(l),
          modifiers: l.mods,
          qty: l.qty,
          sentQty: l.qty,
          note: l.note,
          taxRate: l.row.taxRate,
          kitchen: l.row.def.kitchen !== false && l.row.categoryName !== 'Tea & Coffee',
          sortOrder: i,
          createdAt,
        }),
      );
      if (cancelledNoBill) {
        auditAt(new Date(createdAt.getTime() + 6 * 60_000), 'manager', 'order.cancel', `Cancelled order #${orderNo - 1} — customer left`, 'order', orderId);
        continue;
      }

      // payments
      const method = weighted<string>([['CASH', 44], ['UPI', 46], ['CARD', bill.total > R(300) ? 14 : 3], ['MIXED', bill.total > R(250) ? 5 : 0], ['BANK_TRANSFER', type === 'DELIVERY' ? 3 : 0]]);
      const invId = uuid();
      const pays: { method: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER'; amount: number; tendered?: number; reference?: string }[] = [];
      const upiRef = () => String(between(100000, 999999)) + String(between(100000, 999999));
      if (method === 'MIXED') {
        const cashPart = Math.round((bill.total * (0.3 + rand() * 0.4)) / 1000) * 1000 || R(100);
        pays.push({ method: 'CASH', amount: Math.min(cashPart, bill.total - 100), tendered: Math.min(cashPart, bill.total - 100) });
        pays.push({ method: 'UPI', amount: bill.total - pays[0].amount, reference: upiRef() });
      } else if (method === 'CASH') {
        const notes = [R(10), R(20), R(50), R(100), R(200), R(500)];
        const tendered = rand() < 0.45 ? bill.total : notes.find((n) => n >= bill.total) ?? Math.ceil(bill.total / R(500)) * R(500);
        pays.push({ method: 'CASH', amount: bill.total, tendered });
      } else {
        pays.push({ method: method as 'UPI' | 'CARD' | 'BANK_TRANSFER', amount: bill.total, reference: method === 'UPI' ? (rand() < 0.7 ? upiRef() : undefined) : method === 'CARD' ? `XX${between(1000, 9999)}` : `NEFT${between(10000, 99999)}` });
      }
      const change = pays.reduce((a, p) => a + (p.tendered ? p.tendered - p.amount : 0), 0);
      const costKnown = lineArr.every((l) => l.row.unitCost != null);
      invoices.push({
        id: invId,
        number: `INV-${String(invoiceNo++).padStart(6, '0')}`,
        orderId,
        orderNumber: orderNo - 1,
        orderType: type,
        tableName: table?.name ?? null,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        subtotal: bill.subtotal,
        discount: bill.discount,
        discountLabel: discountLabel(discount),
        taxable: bill.taxable,
        tax: bill.tax,
        taxInclusive: false,
        roundOff: bill.roundOff,
        total: bill.total,
        paid: bill.total,
        change,
        costEstimate: costKnown ? lineArr.reduce((a, l) => a + (l.row.unitCost ?? 0) * l.qty, 0) : null,
        status: voided ? 'VOID' : 'PAID',
        cashierId: users[cashier],
        shiftId,
        businessDate: dateOnly(day),
        createdAt: paidAt,
        voidedAt: voided ? new Date(paidAt.getTime() + 20 * 60_000) : null,
        voidReason: voided ? 'Duplicate order' : null,
        voidedById: voided ? users.manager : null,
        reprintCount: rand() < 0.02 ? 1 : 0,
      });
      lineArr.forEach((l, i) =>
        invoiceItems.push({
          invoiceId: invId,
          menuItemId: l.row.id,
          categoryId: l.row.categoryId,
          categoryName: l.row.categoryName,
          name: l.row.def.name,
          modifiersText: l.mods.filter((m) => !['Regular', 'Normal', 'Full', 'Sweet'].includes(m.name) || l.mods.length > 1).map((m) => m.name).join(', ') || null,
          note: l.note,
          qty: l.qty,
          unitPrice: unit(l),
          lineTotal: bill.lines[i].gross,
          discountShare: bill.lines[i].discountShare,
          taxRate: l.row.taxRate,
          taxAmount: bill.lines[i].tax,
          costEstimate: l.row.unitCost != null ? l.row.unitCost * l.qty : null,
        }),
      );
      for (const p of pays) {
        payments.push({ invoiceId: invId, method: p.method, amount: p.amount, tendered: p.method === 'CASH' ? (p.tendered ?? p.amount) : null, change: p.tendered ? p.tendered - p.amount : null, reference: p.reference ?? null, shiftId, receivedById: users[cashier], voided, createdAt: paidAt });
      }
      if (voided) {
        auditAt(new Date(paidAt.getTime() + 20 * 60_000), 'manager', 'invoice.void', `Voided bill INV-${String(invoiceNo - 1).padStart(6, '0')} (${formatMoney(bill.total)}) — Duplicate order`, 'invoice', invId);
        continue;
      }
      billsBy[shiftId]++;
      for (const p of pays) {
        if (p.method === 'CASH') cashBy[shiftId] += p.amount;
        else otherBy[shiftId][p.method] = (otherBy[shiftId][p.method] ?? 0) + p.amount;
      }
      if (discount) {
        auditAt(createdAt, cashier, 'order.discount', `Discount ${discount.type === 'PERCENT' ? `${discount.value}%` : formatMoney(discount.value)} on order #${orderNo - 1} — ${discReason}`, 'order', orderId);
      }
      if (rand() < 0.0012) {
        const amt = lineArr[0].row.price;
        refunds.push({ invoiceId: invId, amount: amt, method: 'CASH', reason: 'Item not served', byId: users.manager, shiftId, createdAt: new Date(paidAt.getTime() + 10 * 60_000) });
        const inv0 = invoices[invoices.length - 1];
        inv0.refunded = amt;
        inv0.status = 'PARTIALLY_REFUNDED';
        cashOutBy[shiftId] += amt;
        auditAt(new Date(paidAt.getTime() + 10 * 60_000), 'manager', 'invoice.refund', `Refunded ${formatMoney(amt)} by cash on bill ${inv0.number} — Item not served`, 'invoice', invId);
      }
      for (const l of lineArr) for (const [n, qty] of l.row.def.recipe ?? []) consumption.set(n, (consumption.get(n) ?? 0) + qty * l.qty);
    }

    // stock: consumption for the day, then restock what is low (not on the last two days, so a few items read low)
    const closeMin = isToday ? Math.min(nowMin, 22 * 60) : 22 * 60;
    for (const [name, used] of consumption) {
      const x = inv[name];
      x.stock = Math.round((x.stock - used) * 1000) / 1000;
      if (!isToday) {
        invTxns.push({ itemId: x.id, type: 'CONSUMPTION', quantity: -Math.round(used * 1000) / 1000, balanceAfter: x.stock, note: 'Sold (day total)', reference: day, createdAt: at(closeMin), userId: users.cashier2 });
      }
    }
    // daily non-recipe usage (gas, packaging, cleaning)
    const fixedUse: [string, number][] = [['LPG Cylinder (19 kg)', 0.32], ['Parcel Containers', between(18, 40)], ['Paper Bags', between(20, 45)], ['Tissue Paper', 0.6], ['Dishwash Liquid', 0.25], ['Floor Cleaner', 0.12]];
    for (const [name, used] of fixedUse) {
      const x = inv[name];
      x.stock = Math.round((x.stock - used) * 1000) / 1000;
      invTxns.push({ itemId: x.id, type: 'CONSUMPTION', quantity: -used, balanceAfter: x.stock, note: 'Daily use', createdAt: at(closeMin + 1), userId: users.kitchen });
    }
    const restockSkip = new Set(['Milk', 'Coffee Powder', 'Water Bottles (1 L)', 'Tomato', 'Butter']);
    for (const x of Object.values(inv)) {
      const skip = d <= 2 && restockSkip.has(x.def.name);
      if (x.stock <= x.def.min * 1.6 && !skip && !isToday) {
        const qty = x.def.name === 'Milk' ? x.def.pack : Math.max(x.def.pack, Math.ceil(x.def.min * 2 - x.stock));
        x.stock = Math.round((x.stock + qty) * 1000) / 1000;
        const buyAt = at(6 * 60 + between(0, 90));
        invTxns.push({ itemId: x.id, type: 'PURCHASE', quantity: qty, balanceAfter: x.stock, unitCost: R(x.def.cost), supplierId: suppliers[x.def.supplier], note: `Bought ${qty} ${x.def.unit}`, createdAt: buyAt, userId: users.manager });
        const cashPaid = ['Ramesh — Vegetable Market'].includes(x.def.supplier) || rand() < 0.3;
        const amount = Math.round(qty * R(x.def.cost));
        const category = x.def.category === 'Gas' ? 'Gas' : ['Packaging', 'Packaged'].includes(x.def.category) ? 'Supplies' : x.def.category === 'Cleaning' ? 'Cleaning' : 'Ingredients';
        const fromDrawer = cashPaid && amount <= R(2500);
        const expId = uuid();
        expenses.push({ id: expId, category, description: `${x.def.name} — ${qty} ${x.def.unit}`, amount, date: dateOnly(day), paymentMethod: cashPaid ? 'CASH' : pick(['UPI', 'BANK_TRANSFER']), fromDrawer, shiftId: fromDrawer ? morningShift : null, supplierId: suppliers[x.def.supplier], createdById: users.manager, createdAt: buyAt });
        if (fromDrawer) {
          cashOutBy[morningShift] += amount;
          shiftTxns.push({ shiftId: morningShift, type: 'CASH_OUT', amount, reason: `${category}: ${x.def.name}`, expenseId: expId, userId: users.manager, createdAt: buyAt });
        }
      }
    }
    // occasional waste
    if (rand() < 0.12 && !isToday) {
      const x = inv[pick(['Milk', 'Curd', 'Tomato', 'Vegetables'])];
      const q2 = x.def.unit === 'L' || x.def.unit === 'kg' ? pick([0.5, 1, 1.5, 2]) : 2;
      x.stock = Math.round((x.stock - q2) * 1000) / 1000;
      invTxns.push({ itemId: x.id, type: 'WASTE', quantity: -q2, balanceAfter: x.stock, note: pick(['Spoiled', 'Went sour', 'Damaged']), createdAt: at(21 * 60), userId: users.manager });
      auditAt(at(21 * 60), 'manager', 'inventory.waste', `Wasted ${q2} ${x.def.unit} of ${x.def.name}`);
    }

    // fixed monthly expenses
    const dom = Number(day.slice(8));
    const fixed: [string, string, number, string][] = [];
    if (dom === 1) fixed.push(['Rent', 'Shop rent', 18000, 'BANK_TRANSFER'], ['Staff', 'Staff salaries (6 people)', 72000, 'BANK_TRANSFER']);
    if (dom === 5) fixed.push(['Electricity', 'BESCOM electricity bill', between(6200, 7800), 'UPI']);
    if (dom === 12 || dom === 26) fixed.push(['Transport', 'Auto hire — wholesale market trip', between(250, 400), 'CASH']);
    if (rand() < 0.04) fixed.push(['Maintenance', pick(['Mixer grinder repair', 'Plumber — kitchen sink', 'Fan repair', 'Gas stove burner service']), between(400, 1800), 'CASH']);
    if (dow === 1) fixed.push(['Cleaning', 'Pest control / deep clean', 450, 'CASH']);
    for (const [category, description, rupees, method] of fixed) {
      if (isToday && nowMin < 9 * 60) continue;
      expenses.push({ id: uuid(), category, description, amount: R(rupees), date: dateOnly(day), paymentMethod: method as 'CASH', createdById: users.admin, createdAt: at(11 * 60) });
    }

    // shifts
    for (const s of shiftDefs) {
      const isOpen = isToday && (s.id === morningShift ? nowMin < 15 * 60 : true);
      if (isToday && s.id === eveningShift && nowMin < 15 * 60) continue;
      const expected = s.opening + cashBy[s.id] - cashOutBy[s.id];
      const diff = rand() < 0.8 ? 0 : pick([R(-10), R(-20), R(-50), R(10), R(-100)]);
      const summary = {
        cashSales: cashBy[s.id],
        upiSales: otherBy[s.id].UPI ?? 0,
        cardSales: otherBy[s.id].CARD ?? 0,
        bankSales: otherBy[s.id].BANK_TRANSFER ?? 0,
        cashOut: cashOutBy[s.id],
        cashIn: 0,
        cashRefunds: 0,
        bills: billsBy[s.id],
        expectedCash: expected,
      };
      shifts.push({
        id: s.id,
        userId: users[s.user],
        status: isOpen ? 'OPEN' : 'CLOSED',
        openedAt: at(s.open),
        openingCash: s.opening,
        closedAt: isOpen ? null : at(s.close),
        closedById: isOpen ? null : users[s.user],
        expectedCash: isOpen ? null : expected,
        countedCash: isOpen ? null : expected + diff,
        difference: isOpen ? null : diff,
        closingNote: isOpen || Math.abs(diff) <= R(50) ? null : 'Gave extra change during rush, could not trace',
        summary: isOpen ? undefined : { ...summary, countedCash: expected + diff, difference: diff },
      });
      auditAt(at(s.open), s.user, 'shift.open', `Opened shift with ${formatMoney(s.opening)} in the drawer`, 'shift', s.id);
      if (!isOpen) auditAt(at(s.close), s.user, 'shift.close', `Closed shift: expected ${formatMoney(expected)}, counted ${formatMoney(expected + diff)}${diff ? ` (${diff > 0 ? '+' : ''}${formatMoney(diff)})` : ' — matched'}`, 'shift', s.id);
    }
    if (!isToday) closings.push({ date: day, closedAt: at(22 * 60 + 40) });
  }
  log(`history: ${invoices.length} bills over ${HISTORY_DAYS} days`);

  await chunked(orders, 1500, (p) => q.order.createMany({ data: p }));
  await chunked(orderItems, 2000, (p) => q.orderItem.createMany({ data: p }));
  await chunked(shifts, 500, (p) => q.shift.createMany({ data: p }));
  await chunked(invoices, 1000, (p) => q.invoice.createMany({ data: p }));
  await chunked(invoiceItems, 2000, (p) => q.invoiceItem.createMany({ data: p }));
  await chunked(payments, 2000, (p) => q.payment.createMany({ data: p }));
  await chunked(refunds, 500, (p) => q.refund.createMany({ data: p }));
  await chunked(expenses, 1000, (p) => q.expense.createMany({ data: p }));
  await chunked(shiftTxns, 1000, (p) => q.shiftTransaction.createMany({ data: p }));
  await chunked(invTxns, 2000, (p) => q.inventoryTransaction.createMany({ data: p }));

  // Today's sales so far deduct stock per bill, like the live system does.
  const todays = invoices.filter((i) => (i.businessDate as Date).toISOString().slice(0, 10) === today && i.status !== 'VOID');
  for (const x of Object.values(inv)) {
    await q.inventoryItem.update({ where: { id: x.id }, data: { currentStock: Math.round(x.stock * 1000) / 1000 } });
  }
  if (todays.length) {
    const byInvoice = new Map<string, { menuItemId: string; qty: number }[]>();
    for (const it of invoiceItems) {
      if (!todays.some((t) => t.id === it.invoiceId)) continue;
      const arr = byInvoice.get(it.invoiceId) ?? [];
      arr.push({ menuItemId: it.menuItemId!, qty: it.qty });
      byInvoice.set(it.invoiceId, arr);
    }
    // Replay consumption per bill so today's stock movements look like live ones.
    const recipes = await q.recipeLine.findMany();
    // Stock is already reduced by today's total — add it back, then take it bill by bill.
    const running = new Map(Object.values(inv).map((x) => [x.id, x.stock]));
    const todayTxns: Prisma.InventoryTransactionCreateManyInput[] = [];
    const perItemToday = new Map<string, number>();
    for (const t of todays) for (const l of byInvoice.get(t.id as string) ?? []) for (const r of recipes.filter((r) => r.menuItemId === l.menuItemId)) perItemToday.set(r.inventoryItemId, (perItemToday.get(r.inventoryItemId) ?? 0) + r.quantity * l.qty);
    for (const [id, used] of perItemToday) running.set(id, (running.get(id) ?? 0) + used);
    for (const t of todays) {
      const need = new Map<string, number>();
      for (const l of byInvoice.get(t.id as string) ?? []) for (const r of recipes.filter((r) => r.menuItemId === l.menuItemId)) need.set(r.inventoryItemId, (need.get(r.inventoryItemId) ?? 0) + r.quantity * l.qty);
      for (const [id, qty] of need) {
        const bal = Math.round(((running.get(id) ?? 0) - qty) * 1000) / 1000;
        running.set(id, bal);
        todayTxns.push({ itemId: id, type: 'CONSUMPTION', quantity: -Math.round(qty * 1000) / 1000, balanceAfter: bal, note: 'Sold', reference: t.number, createdAt: t.createdAt as Date, userId: t.cashierId });
      }
    }
    await chunked(todayTxns, 2000, (p) => q.inventoryTransaction.createMany({ data: p }));
  }

  // Price history
  for (const h of PRICE_HISTORY) {
    const row = menu.find((m) => m.def.name === h.item)!;
    const at = new Date(istDayStart(addDays(today, -h.daysAgo)).getTime() + 7 * 3600_000);
    await q.priceChange.create({ data: { menuItemId: row.id, oldPrice: R(h.old), newPrice: row.price, changedById: users.admin, createdAt: at } });
    audits.push({ at, userId: users.admin, userName: 'Ravi Kumar', action: 'menu.price_change', entity: 'menu_item', entityId: row.id, summary: `Changed ${h.item} price ${formatMoney(R(h.old))} → ${formatMoney(row.price)}` });
  }

  // ── Live state for today: open tables, kitchen tickets, a reservation ──
  const hasOpenShift = shifts.some((s) => s.status === 'OPEN');
  if (!hasOpenShift) {
    const id = uuid();
    await q.shift.create({ data: { id, userId: users.cashier, openingCash: R(3000), openedAt: new Date(now.getTime() - 20 * 60_000) } });
    audits.push({ at: new Date(now.getTime() - 20 * 60_000), userId: users.cashier, userName: 'Lakshmi N', action: 'shift.open', summary: 'Opened shift with ₹3,000 in the drawer', entity: 'shift', entityId: id });
  }
  const byName = (n: string) => menu.find((m) => m.def.name === n)!;
  const tableByName = (n: string) => tables.find((t) => t.name === n)!;
  const live: { table: string | null; type: 'DINE_IN' | 'TAKEAWAY'; ago: number; items: [string, number, string?][]; tickets: ('NEW' | 'PREPARING' | 'READY' | 'SERVED')[]; billPrinted?: boolean; guests?: number; customer?: string; note?: string }[] = [
    { table: 'T03', type: 'DINE_IN', ago: 12, items: [['Masala Dosa', 2, 'Less spicy'], ['Coffee', 2]], tickets: ['PREPARING'], guests: 2 },
    { table: 'T04', type: 'DINE_IN', ago: 32, items: [['Meals', 3], ['Masala Dosa', 1], ['Water Bottle', 2], ['Tea', 2], ['Vada', 2]], tickets: ['SERVED'], guests: 4 },
    { table: 'T06', type: 'DINE_IN', ago: 41, items: [['Idli', 2], ['Vada', 2], ['Coffee', 2]], tickets: ['SERVED'], billPrinted: true, guests: 2 },
    { table: 'T09', type: 'DINE_IN', ago: 4, items: [['North Indian Thali', 2], ['Veg Biryani', 1], ['Gobi Manchurian', 1], ['Sweet Lassi', 3]], tickets: ['NEW'], guests: 5, note: 'Family — serve thali first' },
    { table: 'T11', type: 'DINE_IN', ago: 18, items: [['Poori', 1], ['Khara Bath', 1], ['Tea', 2]], tickets: ['READY'], guests: 2 },
    { table: null, type: 'TAKEAWAY', ago: 7, items: [['Masala Dosa', 3, 'Parcel'], ['Vada', 4]], tickets: ['PREPARING'], customer: 'Shankar Hegde' },
  ];
  for (const o of live) {
    const id = uuid();
    const createdAt = new Date(now.getTime() - o.ago * 60_000);
    const cust = o.customer ? customers.find((c) => c.name === o.customer) : null;
    const items = o.items.map(([n, qty, note], i) => {
      const row = byName(n);
      const mods = row.mods.map((g) => {
        const opt = g.options.find((x) => x.def)!;
        return { groupName: g.group, name: opt.name, priceDelta: opt.delta };
      });
      return { id: uuid(), orderId: id, menuItemId: row.id, name: row.def.name, basePrice: row.price, unitPrice: row.price, modifiers: mods, qty, sentQty: qty, note: note ?? null, taxRate: row.taxRate, kitchen: row.def.kitchen !== false && row.categoryName !== 'Tea & Coffee', sortOrder: i, createdAt };
    });
    await q.order.create({
      data: {
        id,
        number: orderNo++,
        type: o.type,
        status: o.tickets.includes('NEW') ? 'NEW' : o.tickets.every((t) => t === 'SERVED') ? 'SERVED' : o.tickets.every((t) => t === 'READY') ? 'READY' : 'PREPARING',
        tableId: o.table ? tableByName(o.table).id : null,
        guests: o.guests ?? null,
        note: o.note ?? null,
        customerId: cust?.id ?? null,
        customerName: cust?.name ?? null,
        customerPhone: cust?.phone ?? null,
        billPrintedAt: o.billPrinted ? new Date(now.getTime() - 17 * 60_000) : null,
        createdById: users.cashier,
        createdAt,
        items: { create: items.map(({ orderId: _o, ...rest }) => rest) },
      },
    });
    const kitchenItems = items.filter((i) => i.kitchen);
    if (kitchenItems.length) {
      const st = o.tickets[0];
      await q.kitchenTicket.create({
        data: {
          id: uuid(),
          orderId: id,
          round: 1,
          status: st,
          note: o.note ?? null,
          createdAt,
          startedAt: st !== 'NEW' ? new Date(createdAt.getTime() + 2 * 60_000) : null,
          readyAt: st === 'READY' || st === 'SERVED' ? new Date(createdAt.getTime() + 11 * 60_000) : null,
          servedAt: st === 'SERVED' ? new Date(createdAt.getTime() + 13 * 60_000) : null,
          items: kitchenItems.map((i) => ({ name: i.name, qty: i.qty, modifiers: i.modifiers.filter((m) => !['Regular', 'Normal', 'Full'].includes(m.name)).map((m) => m.name).join(', ') || null, note: i.note })),
        },
      });
    }
  }
  await q.diningTable.update({ where: { id: tableByName('T07').id }, data: { hold: 'RESERVED' } });
  const resv = [
    { customerName: 'Harish Gowda', phone: '9986342217', date: today, time: '13:30', guests: 6, table: 'T07', status: 'CONFIRMED' as const, notes: 'Birthday lunch — keep a cake knife ready' },
    { customerName: 'Rekha Nayak', phone: '9845360091', date: today, time: '20:00', guests: 4, table: 'T10', status: 'PENDING' as const, notes: null },
    { customerName: 'Ganesh Travels (tour group)', phone: '9845566120', date: addDays(today, 1), time: '08:00', guests: 18, table: null, status: 'CONFIRMED' as const, notes: 'Breakfast for bus group — idli vada, coffee. Advance ₹1,000 paid by UPI.' },
    { customerName: 'Kavya S', phone: '8147920336', date: addDays(today, 2), time: '19:30', guests: 3, table: 'T09', status: 'PENDING' as const, notes: null },
    { customerName: 'Mohan Kumar', phone: '9900312458', date: addDays(today, -1), time: '13:00', guests: 5, table: 'T09', status: 'COMPLETED' as const, notes: null },
  ];
  for (const r of resv) {
    await q.reservation.create({
      data: { customerName: r.customerName, phone: r.phone, date: dateOnly(r.date), time: r.time, guests: r.guests, tableId: r.table ? tableByName(r.table).id : null, status: r.status, notes: r.notes, createdById: users.manager },
    });
  }

  // counters continue after the seeded numbers
  await q.counter.createMany({ data: [{ key: 'order', value: orderNo - 1 }, { key: 'invoice', value: invoiceNo - 1 }] });

  // daily closings for past days
  const { dayTotals } = await import('../server/services/dashboard.service.js');
  for (const c of closings) {
    const t = await dayTotals(c.date);
    await q.dailyClosing.create({ data: { businessDate: dateOnly(c.date), totals: t, closedById: users.manager, closedAt: c.closedAt } });
    audits.push({ at: c.closedAt, userId: users.manager, userName: 'Suresh Gowda', action: 'day.close', summary: `Closed ${formatDateLong(c.date)} — sales ${formatMoney(t.sales)}, ${t.bills} bills`, entity: 'closing', entityId: c.date });
  }
  audits.push({ at: new Date(istDayStart(addDays(today, -HISTORY_DAYS)).getTime() - 3600_000), userId: users.admin, userName: 'Ravi Kumar', action: 'role.permissions', summary: 'Cashier: discount limit 5% → 10%' });
  await chunked(audits, 2000, (p) => q.auditLog.createMany({ data: p }));
  log('open tables, kitchen orders, reservations, closings');
}

// Allow `tsx prisma/seed.ts` directly.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/seed.ts')) {
  const { ensureDatabase } = await import('../server/db/postgres.js');
  await ensureDatabase();
  await seed();
  await db().$disconnect();
}
