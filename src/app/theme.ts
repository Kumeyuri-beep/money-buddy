/**
 * ธีมสี (โหมดสว่าง เฟส 3 · 14 พ.ย. 2569): ตามเครื่อง / มืด / สว่าง
 * เก็บ 2 ที่: ค่าตั้งค่าในบัญชี (คีย์ theme · ตามผู้ใช้ไปทุกเครื่อง) และ localStorage (mb.theme · ให้หน้าแรกและหน้าล็อกอินถูกสีตั้งแต่ก่อนวาดภาพ)
 * ไม่มีสูตรเงิน · ไฟล์ public/theme-init.js ทำงานเดียวกันก่อนโหลดแอป (เทสต์ล็อกให้ตรงกัน)
 */

export type ThemeChoice = 'system' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'mb.theme';
/** สีแถบบนมือถือ (meta theme-color) ตรงกับสีพื้น --bg ของแต่ละโหมด */
export const THEME_COLORS: Record<ResolvedTheme, string> = { dark: '#07080d', light: '#eef1f8' };

export function parseThemeChoice(raw: unknown): ThemeChoice {
  return raw === 'dark' || raw === 'light' ? raw : 'system';
}

export function resolveTheme(choice: ThemeChoice, systemPrefersLight: boolean): ResolvedTheme {
  return choice === 'system' ? (systemPrefersLight ? 'light' : 'dark') : choice;
}

/** ค่าที่เขียนลงค่าตั้งค่า: ตามเครื่อง = ลบคีย์ (null) */
export function themeSettingPatch(choice: ThemeChoice): { theme: 'dark' | 'light' | null } {
  return { theme: choice === 'system' ? null : choice };
}

export function readStoredTheme(storage?: Pick<Storage, 'getItem'>): ThemeChoice {
  try {
    return parseThemeChoice((storage ?? window.localStorage).getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function storeTheme(choice: ThemeChoice, storage?: Pick<Storage, 'setItem' | 'removeItem'>): void {
  try {
    const s = storage ?? window.localStorage;
    if (choice === 'system') s.removeItem(THEME_STORAGE_KEY);
    else s.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* เก็บในเครื่องไม่ได้ (โหมดส่วนตัว/ปิดการเก็บ) ก็ใช้ค่าในบัญชีต่อได้ */
  }
}

export function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
}

/** ใช้ธีมกับหน้าเว็บ: ตั้ง data-theme (ตามเครื่อง = ไม่ตั้ง ให้ CSS ตาม prefers-color-scheme) และสีแถบมือถือ */
export function applyTheme(choice: ThemeChoice, doc: Document = document): ResolvedTheme {
  const root = doc.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const resolved = resolveTheme(choice, systemPrefersLight());
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
  return resolved;
}
