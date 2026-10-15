/**
 * Translation. All screen text goes through t('area.key'). English is
 * complete; Kannada (kn.ts) fills in over time and anything missing falls
 * back to English, so a partial translation never breaks a screen.
 */
import { create } from 'zustand';
import en from './en';
import kn from './kn';

export type Lang = 'en' | 'kn';
type Dict = { [k: string]: string | Dict };

const dictionaries: Record<Lang, Dict> = { en, kn };

const useLang = create<{ lang: Lang }>(() => ({ lang: (localStorageGet('ap.lang') as Lang) || 'en' }));

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function lookup(dict: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

const missing = new Set<string>();

export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = useLang.getState().lang;
  let s = lookup(dictionaries[lang], key) ?? lookup(en, key);
  if (s === undefined) {
    if (import.meta.env.DEV && !missing.has(key)) {
      missing.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    s = key.split('.').pop() ?? key;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  return s;
}

/** Re-renders the component when the language changes. */
export function useT() {
  useLang((s) => s.lang);
  return t;
}

export function setLanguage(lang: Lang) {
  try {
    localStorage.setItem('ap.lang', lang);
  } catch {
    /* private mode */
  }
  document.documentElement.lang = lang;
  useLang.setState({ lang });
}

export const currentLanguage = () => useLang.getState().lang;
