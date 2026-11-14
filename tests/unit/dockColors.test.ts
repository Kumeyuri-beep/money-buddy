import { describe, expect, it } from 'vitest';

/** สีพาสเทลของไอคอน dock (15 พ.ย. 2569): เป็น design tokens ทั้ง 2 โหมด · อ่านชัด WCAG AA (ไอคอน/ขีด ≥3:1 · ไอคอนบนพื้นพาสเทลเต็ม ≥4.5:1) */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const TONES = ['today', 'ledger', 'bills', 'portfolio', 'averaging', 'retirement', 'tax'] as const;
const PASTEL = { today: '#FFC9A8', ledger: '#A8D8FF', bills: '#CDB8FF', portfolio: '#A8EBCF', averaging: '#F7E59A', retirement: '#FFB8D2', tax: '#A8EEF0' } as const;

const block = (re: RegExp): string => css.match(re)?.[1] ?? '';
const dark = [...css.matchAll(/^:root \{([^}]*)\}/gm)].map((m) => m[1] ?? '').join('\n');
const light = block(/:root\[data-theme='light'\] \{([^}]*)\}/);
const lightMedia = block(/@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme='dark'\]\) \{([^}]*)\}/);
const tok = (b: string, name: string): string => b.match(new RegExp(`--${name}:\s*([^;]+);`))?.[1]?.trim() ?? '';

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lum = ([r, g, b]: [number, number, number]): number => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: [number, number, number], b: [number, number, number]): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const mix = (fg: [number, number, number], bg: [number, number, number], a: number): [number, number, number] => [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a)) as [number, number, number];

describe('สีพาสเทลของ dock', () => {
  it('ตามที่เจ้าของกำหนด: พื้น/สีไอคอนโหมดมืดเป็นพาสเทลตามรหัส', () => {
    for (const t of TONES) {
      expect(tok(dark, `dock-hue-${t}`).toLowerCase(), t).toBe(PASTEL[t].toLowerCase());
      expect(tok(dark, `dock-ink-${t}`).toLowerCase(), t).toBe(PASTEL[t].toLowerCase());
      expect(tok(light, `dock-hue-${t}`).toLowerCase(), t).toBe(PASTEL[t].toLowerCase()); // พื้นเต็มของหน้าที่เปิดอยู่เป็นพาสเทลทั้งสองโหมด
    }
  });
  it('โหมดสว่างในบล็อกตามเครื่องเหมือนบล็อก data-theme=light ทุกตัว', () => {
    for (const t of TONES) for (const k of ['hue', 'ink']) expect(tok(lightMedia, `dock-${k}-${t}`), `${k}-${t}`).toBe(tok(light, `dock-${k}-${t}`));
    expect(tok(lightMedia, 'dock-on-hue')).toBe(tok(light, 'dock-on-hue'));
  });
  for (const [mode, b, surface] of [['มืด', dark, '#171a26'], ['สว่าง', light, '#ffffff']] as const) {
    it(`โหมด${mode}: ไอคอนตอนปกติ/ขีดข้างหน้าที่เปิดอยู่ อ่านชัดบนพื้น dock (≥3:1 รวมพื้นสีจาง 18% ของตัวเอง)`, () => {
      expect(tok(css.includes(surface) ? (mode === 'มืด' ? dark : light) : '', 'surface-fallback').toLowerCase()).toBe(surface);
      for (const t of TONES) {
        const ink = rgb(tok(b, `dock-ink-${t}`));
        const hue = rgb(tok(b, `dock-hue-${t}`));
        const base = rgb(surface);
        expect(ratio(ink, base), `${t} บนพื้น dock`).toBeGreaterThanOrEqual(3);
        expect(ratio(ink, mix(hue, base, 0.18)), `${t} บนพื้นจาง`).toBeGreaterThanOrEqual(3);
        expect(ratio(ink, mix(hue, base, 0.3)), `${t} บนพื้นตอนเมาส์ชี้`).toBeGreaterThanOrEqual(3);
      }
    });
    it(`โหมด${mode}: ข้อความ "ออกจากระบบ" (--expense) บนพื้นเมนู (--surface-solid) ≥4.5:1`, () => {
      expect(ratio(rgb(tok(b, 'expense')), rgb(tok(b, 'surface-solid')))).toBeGreaterThanOrEqual(4.5);
    });
    it(`โหมด${mode}: ไอคอนสีเข้มบนพื้นพาสเทลเต็ม (หน้าที่เปิดอยู่) ≥4.5:1`, () => {
      const on = rgb(tok(b, 'dock-on-hue'));
      for (const t of TONES) expect(ratio(on, rgb(tok(b, `dock-hue-${t}`))), t).toBeGreaterThanOrEqual(4.5);
    });
  }
});
