import { describe, expect, it } from 'vitest';
import { CARD_DARK, CHART_DARK, cardColor, cardVarName, chartColor, chartVarName, type CardColorKey, type ChartColorKey } from '../../src/ui/chartColors';

/** โหมดสว่าง เฟส 1 (14 พ.ย. 2569): สีทั้งหมดต้องมาจาก design tokens (ตัวแปร CSS) · โหมดมืดเหมือนเดิม */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** บล็อก :root { … } ทั้งหมด (ที่ประกาศ token) */
// บล็อกที่ประกาศ token ได้: :root (มืด) · :root[data-theme='light'] · :root:not([data-theme='dark']) ในบล็อกตามเครื่อง
const TOKEN_BLOCK = /:root(?:\[[^\]]*\]|:not\([^)]*\))?\s*\{[^}]*\}/g;
const rootBlocks = [...css.matchAll(/:root(?:\[[^\]]*\]|:not\([^)]*\))?\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
const defined = new Set(rootBlocks.flatMap((b) => [...b.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!)));
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

describe('design tokens ใน styles.css', () => {
  it('ไม่มีค่าสีตรงๆ นอกบล็อก :root (สีทุกตัวต้องเป็น var(--token))', () => {
    const outside = css
      .replace(/@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\([^)]*\)\s*\{[^}]*\}\s*\}/g, '')
      .replace(TOKEN_BLOCK, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = outside.split('\n').filter((l) => COLOR.test(l));
    expect(lines.map((l) => l.trim().slice(0, 100))).toEqual([]);
  });
  it('ทุก var(--x) ที่ใช้มีประกาศไว้ใน :root', () => {
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!));
    // --fx-x/--fx-y: ค่าที่ src/ui/liquidGlass.ts เขียนตอนรันต่อการ์ด (มีค่าสำรองใน var(...) ทุกที่ที่ใช้) · --c/--o: ตัวแปรเฉพาะก้อนแสงออโรราแต่ละก้อน · --glass-blur/--glass-sat: ตัวเลขความเบลอ ตั้งที่ html (ไม่ใช่สี ไม่ต่างกันตามโหมด) · --s: ตัวคูณขยายของไอคอน dock ที่ src/ui/Dock.tsx เขียนตอนรัน (มีค่าสำรองทุกที่) · --dock-hue/--dock-ink: สีพาสเทลต่อไอคอน ตั้งในคลาส dock-c-* จากโทเคน --dock-hue-*/--dock-ink-*
    const missing = [...used].filter((n) => !defined.has(n) && n !== '--fx-x' && n !== '--fx-y' && n !== '--c' && n !== '--o' && n !== '--glass-blur' && n !== '--glass-sat' && n !== '--s' && n !== '--dock-hue' && n !== '--dock-ink');
    expect(missing).toEqual([]);
  });
  it('มี token ชุดหลักครบ (พื้น ตัวหนังสือ ฟิล์มโปร่ง เงามืด ก้อนแสง สีกราฟ)', () => {
    for (const name of ['--bg', '--text', '--muted', '--gold', '--surface-solid', '--surface-dialog', '--on-gold', '--ov-10', '--ov-14', '--shade-25', '--glow-violet-color', '--scrim-dialog', '--chart-income']) {
      expect(defined.has(name), name).toBe(true);
    }
  });
});

describe('สีกราฟและการ์ดแชร์ (chartColors)', () => {
  const cssValue = (name: string): string | undefined => {
    const m = new RegExp(name.replace(/-/g, String.raw`\-`) + String.raw`\s*:\s*([^;]+);`).exec(css);
    return m?.[1]?.trim().toLowerCase();
  };
  it('ค่าใน CSS (--chart-*) ตรงกับค่าโหมดมืดใน CHART_DARK ทุกตัว (ไม่มีวันเพี้ยนจากกัน)', () => {
    for (const key of Object.keys(CHART_DARK) as ChartColorKey[]) expect(cssValue(chartVarName(key)), key).toBe(CHART_DARK[key].toLowerCase());
  });
  it('ค่าใน CSS (--card-*) ตรงกับค่าโหมดมืดใน CARD_DARK ทุกตัว', () => {
    for (const key of Object.keys(CARD_DARK) as CardColorKey[]) expect(cssValue(cardVarName(key)), key).toBe(CARD_DARK[key].toLowerCase());
  });
  it('ไม่มีเบราว์เซอร์ (เทสต์/เซิร์ฟเวอร์) = คืนค่าโหมดมืด', () => {
    for (const key of Object.keys(CHART_DARK) as ChartColorKey[]) expect(chartColor(key)).toBe(CHART_DARK[key]);
    for (const key of Object.keys(CARD_DARK) as CardColorKey[]) expect(cardColor(key)).toBe(CARD_DARK[key]);
  });
  it('ชื่อตัวแปรจากชื่อสี', () => {
    expect(chartVarName('catBill')).toBe('--chart-cat-bill');
    expect(chartVarName('fb1')).toBe('--chart-fb1');
    expect(chartVarName('sliceOther')).toBe('--chart-slice-other');
    expect(cardVarName('bgTop')).toBe('--card-bg-top');
  });
});

describe('ซอร์ส TS ไม่มีค่าสีตรงๆ (ยกเว้นไฟล์ค่าสำรองที่ตั้งใจ)', () => {
  it('มีสีตรงๆ เฉพาะ chartColors.ts (ค่าสำรองโหมดมืด) และ theme.ts (สีแถบมือถือ) และ harness สำหรับนักพัฒนา', () => {
    const allowed = ['/src/ui/chartColors.ts', '/src/app/theme.ts']; // theme.ts: สีแถบมือถือ (meta theme-color) ไม่ใช่สีในหน้าจอ
    const offenders = Object.entries(sources)
      .filter(([p]) => !allowed.includes(p) && !p.startsWith('/src/dev/'))
      .filter(([, text]) => /['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });
  it('การ์ดแชร์และแถบสัดส่วนอ่านสีจากธีมที่ใช้อยู่ผ่าน cardColor/chartColor', () => {
    const src = sources['/src/ui/shareCardCanvas.ts'] ?? '';
    expect(src).toContain("cardColor('bgTop')");
    expect(src).toContain("chartColor('sliceOther')");
  });
});
