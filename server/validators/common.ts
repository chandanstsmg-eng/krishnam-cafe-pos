import { z } from 'zod';

export const id = z.string().min(1).max(64);
export const paise = z.number().int('Amount must be in whole paise').min(0).max(10_000_000_00);
export const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
export const text = (max = 200) => z.string().trim().max(max);
export const optText = (max = 200) => z.string().trim().max(max).nullish();
export const phone = z
  .string()
  .trim()
  .regex(/^[+\d\s-]{0,16}$/, 'Enter a valid phone number')
  .nullish();
export const payMethod = z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER']);
