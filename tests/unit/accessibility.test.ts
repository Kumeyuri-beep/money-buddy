import { describe, expect, it } from 'vitest';

/**
 * ตรวจ accessibility ที่ตรวจจากซอร์สได้ (ผลตรวจ design-critic 13 พ.ย. 2569): โครงหน้า โฟกัส toast และ contrast ที่คำนวณจริงจากค่าสีใน CSS
 * ส่วนที่ต้องลองจริงกับโปรแกรมอ่านจอ/คีย์บอร์ดยังอยู่ใน HANDOFF
 */
const files = import.meta.glob('/src/ui/*.{tsx,ts,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (name: string): string => files[`/src/ui/${name}`] ?? '';
const css = src('styles.css');
const indexHtml = Object.values(import.meta.glob('/index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

describe('โครงหน้า: skip link, landmark, ชื่อหน้า, โฟกัสเมื่อเปลี่ยนหน้า', () => {
  const shell = src('Shell.tsx');
  const app = src('App.tsx');
  it('มี skip link เป็นลูกแรกของ .page ชี้ไป #main และ main เป็น landmark ที่โฟกัสด้วยสคริปต์ได้', () => {
    expect(shell.indexOf('className="skip-link"')).toBeGreaterThan(shell.indexOf('<div className="page">'));
    expect(shell.indexOf('className="skip-link"')).toBeLessThan(shell.indexOf('glow glow-violet'));
    expect(shell).toContain('href="#main"');
    expect(shell).toContain('<main id="main" className="content" tabIndex={-1}>');
    expect(css).toContain('.skip-link:focus');
    expect(css).toMatch(/\.skip-link \{[^}]*left: -9999px/);
  });
  it('เปลี่ยนหน้า: ตั้ง document.title ทุกหน้า และย้ายโฟกัสไปหัวข้อหน้า (รอบแรกไม่ย้าย รอเมนูมือถือคืนโฟกัสก่อน)', () => {
    expect(app).toContain('document.title = `${VIEW_TITLE[view]} - Money Buddy`');
    for (const id of ['today', 'ledger', 'bills', 'account', 'averaging', 'portfolio', 'retirement', 'tax']) expect(app).toMatch(new RegExp(`${id}: '`));
    expect(app).toContain("document.querySelector<HTMLElement>('main h2.page-title')");
    expect(app).toContain('firstView.current');
    expect(app).toMatch(/window\.setTimeout\(\(\) => \{[\s\S]*target\.focus\(\{ preventScroll: true \}\);[\s\S]*\}, 60\)/);
    expect(css).toContain('.content:focus:not(:focus-visible), .page-title:focus:not(:focus-visible) { outline: none; }');
    expect(app).toContain('target.focus({ preventScroll: true })');
    expect(src('Today.tsx')).toContain('<h2 className="page-title sr-only">ภาพรวม</h2>');
    expect(shell).toContain("document.getElementById('main')?.focus()");
  });
  it('index.html: lang=th และมี title', () => {
    expect(indexHtml).toMatch(/<html[^>]*lang="th"/);
    expect(indexHtml).toMatch(/<title>[^<]+<\/title>/);
  });
});

describe('dialog คืนโฟกัสให้ปุ่มที่เปิด (ทุก dialog)', () => {
  for (const name of ['AddEntryDialog.tsx', 'BillDialog.tsx', 'PayBillDialog.tsx', 'PasswordPrompt.tsx']) {
    it(`${name}: จำ opener แล้วคืนโฟกัสตอน cleanup และใช้ showModal`, () => {
      const s = src(name);
      expect(s).toContain('document.activeElement instanceof HTMLElement');
      expect(s).toContain('return () => restoreFocus(opener);');
      expect(s).toContain("import { restoreFocus } from './focus';");
      expect(s).toContain('showModal()');
    });
  }
});

describe('Toast: ข้อผิดพลาดเป็น alert, หยุดนับเวลาเมื่อ hover/โฟกัส, อยู่นานพอ (WCAG 2.2.1)', () => {
  const toast = src('Toast.tsx');
  const app = src('App.tsx');
  it("Toast: role ตาม tone และมี onHold ทั้งเมาส์และโฟกัส", () => {
    expect(toast).toContain("role={tone === 'error' ? 'alert' : 'status'}");
    for (const ev of ['onMouseEnter', 'onMouseLeave', 'onFocus', 'onBlur']) expect(toast).toContain(ev);
  });
  it('App: ข้อความผิดพลาดมี tone=error · เวลาไม่ต่ำกว่า 20 วินาที (ผิดพลาด 30) · ไม่นับเวลาตอน held', () => {
    expect(app).toContain('const TOAST_MS = 20_000;');
    expect(app).toContain('const TOAST_ERROR_MS = 30_000;');
    expect((app.match(/tone: 'error'/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(app).toContain('if (toastHeld) return;');
    expect(app).toContain('key={toastSeq}'); // toast ใหม่ติดตั้งใหม่ ไม่ค้าง held และ role ไม่เปลี่ยนบน node เดิม
    expect(app).toMatch(/useEffect\(\(\) => \{\s*setToastHeld\(false\);\s*setToastSeq/);
    expect(app).toContain('onHold={setToastHeld}');
  });
});

// ---- contrast จริงจากค่าสีใน CSS (WCAG 2.x relative luminance)
type Rgb = [number, number, number];
const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const blend = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha))) as Rgb;
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`ไม่พบ token --${name}`);
  return m[1]!.trim();
};
const colorOf = (name: string, over: Rgb): Rgb => {
  const v = token(name);
  if (v.startsWith('#')) return hex(v);
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(v);
  if (!m) throw new Error(`รูปแบบสีไม่รู้จัก: ${v}`);
  return blend([Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4]), over);
};

describe('contrast จากค่าสีจริงใน styles.css (WCAG AA)', () => {
  // พื้นแย่สุดที่ข้อความวางอยู่: พื้นหลักเข้มสุด, พื้นทึบสำรอง (ลดความโปร่งใส), กระจกที่สว่างสุดตาม design-critic
  const backgrounds: [string, Rgb][] = [
    ['--bg', hex(token('bg'))],
    ['--surface-fallback', hex(token('surface-fallback'))],
    ['กระจกสว่างสุด #1a1c2a', hex('#1a1c2a')],
  ];
  it('ข้อความทุกสีผ่าน 4.5:1 บนทุกพื้น', () => {
    for (const [bgName, bg] of backgrounds) {
      for (const t of ['text', 'muted', 'gold', 'income', 'expense', 'transfer', 'warn']) {
        const r = ratio(colorOf(t, bg), bg);
        expect(r, `--${t} บน ${bgName} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('ข้อความบนปุ่มหลัก (#1a1505 บนทอง) ผ่าน 4.5:1', () => {
    expect(ratio(hex('#1a1505'), hex(token('gold')))).toBeGreaterThanOrEqual(4.5);
  });
  it('ขอบของช่องกรอก (--control-border) ต่างจากพื้นอย่างน้อย 3:1 (WCAG 1.4.11) บนทุกพื้น', () => {
    for (const [bgName, bg] of backgrounds) {
      const r = ratio(colorOf('control-border', bg), bg);
      expect(r, `ขอบช่องบน ${bgName} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });
  it('ขอบเดิม (alpha 0.18) ไม่ผ่าน 3:1 จริง (ยืนยันว่าการแก้มีเหตุผล ไม่ใช่แก้เกินจำเป็น)', () => {
    const old: Rgb = [255, 255, 255];
    for (const [, bg] of backgrounds) expect(ratio(blend(old, 0.18, bg), bg)).toBeLessThan(3);
  });
  it('ตัวควบคุมฟอร์มทุกชนิดใช้ --control-border ไม่ใช่ขอบจาง', () => {
    for (const sel of ['.field input {', '.field select {', ".field input[type='search']", '.quick-input input {', '.quick-field select {', '.tax-link select {', '.seg {']) {
      const line = css.split('\n').find((l) => l.startsWith(sel));
      expect(line, sel).toBeDefined();
      expect(line, sel).toContain('border: 1px solid var(--control-border)');
    }
  });
});

describe('restoreFocus: คืนโฟกัสให้ปุ่มเปิด ถ้าปุ่มหาย/ไม่มีปุ่ม ไปที่ #main', () => {
  const focusSrc = src('focus.ts');
  it('เงื่อนไขครบ: opener ต้องไม่ใช่ body และยังอยู่ใน DOM (isConnected) ไม่งั้นโฟกัส #main', () => {
    expect(focusSrc).toContain('opener !== document.body');
    expect(focusSrc).toContain('opener.isConnected');
    expect(focusSrc).toContain("document.getElementById('main')?.focus()");
  });
});
