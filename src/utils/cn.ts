import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names; a later Tailwind class overrides an earlier conflicting one (w-44 beats w-full). */
export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
