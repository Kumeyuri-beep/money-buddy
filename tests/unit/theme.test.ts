import { describe, expect, it } from 'vitest';
import themeInit from '../../public/theme-init.js?raw';
import indexHtml from '../../index.html?raw';
import { planSettingsPatch } from '../../src/domain/bills/settingsPatch';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import { THEME_COLORS, THEME_STORAGE_KEY, applyTheme, parseThemeChoice, readStoredTheme, resolveTheme, storeTheme, themeSettingPatch } from '../../src/app/theme';

describe('ธีม: ฟังก์ชันล้วน', () => {
  it('parseThemeChoice: ค่าแปลก/ว่าง = ตามเครื่อง', () => {
    expect(parseThemeChoice('dark')).toBe('dark');
    expect(parseThemeChoice('light')).toBe('light');
    for (const bad of [undefined, null, '', 'system', 'DARK', 1, {}]) expect(parseThemeChoice(bad)).toBe('system');
  });
  it('resolveTheme: ตามเครื่องใช้ค่าเครื่อง · เลือกเองชนะค่าเครื่อง', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });
  it('themeSettingPatch: ตามเครื่อง = ลบคีย์', () => {
    expect(themeSettingPatch('system')).toEqual({ theme: null });
    expect(themeSettingPatch('dark')).toEqual({ theme: 'dark' });
    expect(themeSettingPatch('light')).toEqual({ theme: 'light' });
  });
});

describe('ธีม: เก็บในเครื่อง', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };
  it('เก็บแล้วอ่านกลับ · ตามเครื่อง = ลบคีย์', () => {
    const s = memory();
    storeTheme('light', s);
    expect(s.m.get(THEME_STORAGE_KEY)).toBe('light');
    expect(readStoredTheme(s)).toBe('light');
    storeTheme('system', s);
    expect(s.m.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readStoredTheme(s)).toBe('system');
  });
  it('เก็บ/อ่านไม่ได้ (โหมดส่วนตัว) ไม่ throw', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredTheme(broken)).toBe('system');
    expect(() => storeTheme('dark', broken)).not.toThrow();
  });
});

describe('applyTheme', () => {
  const fakeDoc = () => {
    const attrs = new Map<string, string>();
    const meta = new Map<string, string>();
    const doc = {
      documentElement: { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) },
      querySelector: () => ({ setAttribute: (k: string, v: string) => void meta.set(k, v) }),
    } as unknown as Document;
    return { doc, attrs, meta };
  };
  it('เลือกมืด/สว่าง: ตั้ง data-theme และสีแถบมือถือตรงกับโหมด', () => {
    const a = fakeDoc();
    expect(applyTheme('light', a.doc)).toBe('light');
    expect(a.attrs.get('data-theme')).toBe('light');
    expect(a.meta.get('content')).toBe(THEME_COLORS.light);
    const b = fakeDoc();
    expect(applyTheme('dark', b.doc)).toBe('dark');
    expect(b.attrs.get('data-theme')).toBe('dark');
    expect(b.meta.get('content')).toBe(THEME_COLORS.dark);
  });
  it('ตามเครื่อง: เอา data-theme ออก (ไม่มี matchMedia ในเทสต์ = มืด)', () => {
    const a = fakeDoc();
    a.attrs.set('data-theme', 'light');
    expect(applyTheme('system', a.doc)).toBe('dark');
    expect(a.attrs.has('data-theme')).toBe(false);
  });
});

describe('สคริปต์ก่อนวาดหน้า (public/theme-init.js) ตรงกับ src/app/theme.ts', () => {
  it('ใช้คีย์ localStorage และสีแถบเดียวกัน', () => {
    expect(themeInit).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(themeInit).toContain(`'${THEME_COLORS.dark}'`);
    expect(themeInit).toContain(`'${THEME_COLORS.light}'`);
  });
  it('index.html โหลดสคริปต์แบบไฟล์ (CSP ห้ามสคริปต์ในหน้า) ก่อนโหลดแอป และ meta theme-color มาก่อนสคริปต์', () => {
    const script = indexHtml.indexOf('<script src="/theme-init.js"></script>');
    expect(script).toBeGreaterThan(-1);
    expect(indexHtml.indexOf('name="theme-color"')).toBeLessThan(script);
    expect(script).toBeLessThan(indexHtml.indexOf('/src/main.tsx'));
    expect(indexHtml).toContain(`content="${THEME_COLORS.dark}"`);
    expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});

describe('ค่าตั้งค่า theme', () => {
  it('ตรวจ/ทำความสะอาด: รับเฉพาะ dark|light', () => {
    expect(settingsProblem({ theme: 'dark' })).toBeNull();
    expect(settingsProblem({ theme: 'blue' as never })).toMatch(/ธีม/);
    expect(sanitizeSettings({ theme: 'light' })).toEqual({ theme: 'light' });
    expect(sanitizeSettings({ theme: 'blue' })).toEqual({});
  });
  it('patch: ตั้ง/ลบ theme ได้ และค่าผิดถูกปฏิเสธ ไม่ลบของเดิมเงียบๆ', () => {
    const set = planSettingsPatch({ theme: 'light' });
    expect(set.ok && set.plan.set).toEqual({ theme: 'light' });
    const del = planSettingsPatch({ theme: null });
    expect(del.ok && del.plan.remove).toEqual(['theme']);
    expect(planSettingsPatch({ theme: 'blue' as never }).ok).toBe(false);
  });
});
