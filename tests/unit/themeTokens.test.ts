import { describe, expect, it } from 'vitest';
import { CHART_DARK, chartColor, chartVarName, type ChartColorKey } from '../../src/ui/chartColors';

/** โหมดสว่าง เฟส 1 (14 พ.ย. 2569): สีทั้งหมดต้องมาจาก design tokens (ตัวแปร CSS) · โหมดมืดเหมือนเดิม */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** บล็อก :root { … } ทั้งหมด (ที่ประกาศ token) */
const rootBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
const defined = new Set(rootBlocks.flatMap((b) => [...b.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!)));
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

describe('design tokens ใน styles.css', () => {
  it('ไม่มีค่าสีตรงๆ นอกบล็อก :root (สีทุกตัวต้องเป็น var(--token))', () => {
    const outside = css.replace(/:root\s*\{[^}]*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = outside.split('\n').filter((l) => COLOR.test(l));
    expect(lines.map((l) => l.trim().slice(0, 100))).toEqual([]);
  });
  it('ทุก var(--x) ที่ใช้มีประกาศไว้ใน :root', () => {
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!));
    const missing = [...used].filter((n) => !defined.has(n));
    expect(missing).toEqual([]);
  });
  it('มี token ชุดหลักครบ (พื้น ตัวหนังสือ ฟิล์มโปร่ง เงามืด ก้อนแสง สีกราฟ)', () => {
    for (const name of ['--bg', '--text', '--muted', '--gold', '--surface-solid', '--surface-dialog', '--on-gold', '--ov-10', '--ov-14', '--shade-25', '--glow-violet-color', '--scrim-dialog', '--chart-income']) {
      expect(defined.has(name), name).toBe(true);
    }
  });
});

describe('สีกราฟ (chartColors)', () => {
  it('ค่าใน CSS (--chart-*) ตรงกับค่าโหมดมืดใน CHART_DARK ทุกตัว (ไม่มีวันเพี้ยนจากกัน)', () => {
    for (const key of Object.keys(CHART_DARK) as ChartColorKey[]) {
      const m = new RegExp(chartVarName(key).replace(/[-]/g, '\-') + '\s*:\s*([^;]+);').exec(css);
      expect(m?.[1]?.trim().toLowerCase(), key).toBe(CHART_DARK[key].toLowerCase());
    }
  });
  it('ไม่มีเบราว์เซอร์ (เทสต์/เซิร์ฟเวอร์) = คืนค่าโหมดมืด', () => {
    for (const key of Object.keys(CHART_DARK) as ChartColorKey[]) expect(chartColor(key)).toBe(CHART_DARK[key]);
  });
  it('ชื่อตัวแปรจากชื่อสี', () => {
    expect(chartVarName('catBill')).toBe('--chart-cat-bill');
    expect(chartVarName('fb1')).toBe('--chart-fb1');
    expect(chartVarName('income')).toBe('--chart-income');
  });
});

describe('ซอร์ส TS ไม่มีค่าสีตรงๆ (ยกเว้นไฟล์พาเล็ตที่ตั้งใจ)', () => {
  it('มีสีตรงๆ เฉพาะ chartColors.ts (ค่าสำรอง) และ shareCardCanvas.ts (พาเล็ตการ์ดแชร์) และ harness สำหรับนักพัฒนา', () => {
    const allowed = ['/src/ui/chartColors.ts', '/src/ui/shareCardCanvas.ts'];
    const offenders = Object.entries(sources)
      .filter(([p]) => !allowed.includes(p) && !p.startsWith('/src/dev/'))
      .filter(([, text]) => /['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });
  it('การ์ดแชร์ใช้พาเล็ตกลาง SHARE_CARD_PALETTE (ไม่มีสีฝังในฟังก์ชันวาด)', () => {
    const src = sources['/src/ui/shareCardCanvas.ts'] ?? '';
    const afterPalette = src.slice(src.indexOf('export function drawShareCard'));
    expect(afterPalette).not.toMatch(/['"`]#[0-9a-fA-F]{3,8}['"`]/);
    expect(afterPalette).toContain('SHARE_CARD_PALETTE.bgTop');
  });
});
