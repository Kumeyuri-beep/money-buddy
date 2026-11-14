import { describe, expect, it } from 'vitest';

/** WCAG AA ของทั้งสองโหมด คำนวณจากค่า token จริงใน styles.css (โหมดสว่าง เฟส 2 · 14 พ.ย. 2569) */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

type RGBA = { r: number; g: number; b: number; a: number };

function tokensOf(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()] as const));
}
const rootBlocks = [...css.matchAll(/(?<![\w[-]):root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');
const dark = new Map<string, string>();
for (const b of rootBlocks) for (const [k, v] of tokensOf(b)) dark.set(k, v);
const lightBlock = /:root\[data-theme='light'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
const light = new Map([...dark, ...tokensOf(lightBlock)]);

function parse(v: string): RGBA {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v.trim());
  if (!m) throw new Error('อ่านสีไม่ได้: ' + v);
  return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4] };
}
const over = (top: RGBA, base: RGBA): RGBA => ({
  r: top.r * top.a + base.r * (1 - top.a),
  g: top.g * top.a + base.g * (1 - top.a),
  b: top.b * top.a + base.b * (1 - top.a),
  a: 1,
});
const lum = (c: RGBA): number => {
  const f = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const ratio = (a: RGBA, b: RGBA): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

function surfaces(t: Map<string, string>): Record<string, RGBA> {
  const get = (k: string): RGBA => parse(t.get(k)!);
  const bg = get('--bg');
  // พื้นใต้กระจกที่แย่สุด (พื้นหลังออโรรา · 14 พ.ย. 2569): ก้อนแสงทุกก้อนซ้อนกันที่ความเข้มสูงสุด (ความเข้มจาก --glow-*-op) เลือกทั้งแบบสว่างสุดและมืดสุด
  // เพราะตัวหนังสือสว่าง (โหมดมืด) แพ้พื้นสว่าง · ตัวหนังสือเข้ม (โหมดสว่าง) แพ้พื้นมืด · พื้นหลังขยับได้ จึงต้องรับประกันกรณีเลวร้ายที่สุดเสมอ ไม่ใช่แค่ภาพนิ่ง
  const keys = ['violet', 'teal', 'gold', 'pink'];
  const blobs = keys.map((k) => ({ ...get(`--glow-${k}-color`), a: Number(t.get(`--glow-${k}-op`)) }));
  const stack = (list: RGBA[]): RGBA => list.reduce((base, top) => over(top, base), bg);
  const singles = blobs.map((b) => stack([b]));
  const allOver = stack(blobs);
  const candidates = [...singles, allOver];
  const worstBg = [...candidates].sort((x, y) => lum(x) - lum(y))[0]!; // มืดสุด
  const brightBg = [...candidates].sort((x, y) => lum(y) - lum(x))[0]!; // สว่างสุด
  const glassA = (base: RGBA): RGBA => over(get('--glass-grad-a'), over(get('--glass-under'), base));
  const glassB = (base: RGBA): RGBA => over(get('--glass-grad-b'), over(get('--glass-under'), base));
  return {
    bg,
    solid: over(get('--glass-lite-under'), bg),
    solidWorst: over(get('--glass-lite-under'), worstBg),
    surfaceSolid: get('--surface-solid'),
    dialog: get('--surface-dialog'),
    glass: glassA(bg),
    glassWorst: glassA(worstBg),
    glassB: glassB(bg),
    glassBWorst: glassB(worstBg),
    glassBright: glassA(brightBg),
    glassBBright: glassB(brightBg),
    alert: get('--alert-bg'),
    notice: get('--surface-notice-solid'),
    field: over(get('--shade-25'), over(get('--glass-lite-under'), bg)),
  };
}

const MODES: [string, Map<string, string>][] = [
  ['มืด', dark],
  ['สว่าง', light],
];

describe('contrast WCAG AA ทั้งสองโหมด (คำนวณจาก token จริง)', () => {
  for (const [name, t] of MODES) {
    describe(`โหมด${name}`, () => {
      const s = surfaces(t);
      const textOn = (k: string, surface: RGBA): RGBA => over(parse(t.get(k)!), surface);
      const surfaceList: [string, RGBA][] = [
        ['พื้นหน้า', s.bg!],
        ['การ์ดทึบ', s.solid!],
        ['การ์ดทึบบนก้อนแสงเข้ม', s.solidWorst!],
        ['พื้นทึบเต็ม (surface-solid)', s.surfaceSolid!],
        ['กระจก', s.glass!],
        ['กระจกบนก้อนแสงเข้ม', s.glassWorst!],
        ['กระจก (มุมจาง)', s.glassB!],
        ['กระจก (มุมจางบนก้อนแสงเข้ม)', s.glassBWorst!],
        ['กระจกบนก้อนแสงสว่างสุด', s.glassBright!],
        ['กระจก (มุมจาง) บนก้อนแสงสว่างสุด', s.glassBBright!],
        ['dialog', s.dialog!],
      ];

      it('ตัวหนังสือหลัก (--text) ≥ 4.5:1 บนพื้นผิวทุกแบบ', () => {
        for (const [label, surf] of surfaceList) expect(ratio(textOn('--text', surf), surf), label).toBeGreaterThanOrEqual(4.5);
      });
      it('ตัวหนังสือรอง (--muted) ≥ 4.5:1 บนพื้นผิวทุกแบบ', () => {
        for (const [label, surf] of surfaceList) expect(ratio(textOn('--muted', surf), surf), label).toBeGreaterThanOrEqual(4.5);
      });
      it('ตัวหนังสือเข้ม/อ่อนอื่นที่ใช้จริง (text-strong, text-92/84/80) ≥ 4.5:1 บนพื้นผิวทุกแบบ', () => {
        for (const k of ['--text-strong', '--text-92', '--text-84', '--text-80']) {
          for (const [label, surf] of surfaceList) expect(ratio(textOn(k, surf), surf), `${k} บน ${label}`).toBeGreaterThanOrEqual(4.5);
        }
      });
      it('สีเน้น (--gold) ที่ใช้เป็นตัวหนังสือ ≥ 4.5:1 บนพื้นผิวทุกแบบ', () => {
        for (const [label, surf] of surfaceList) expect(ratio(parse(t.get('--gold')!), surf), label).toBeGreaterThanOrEqual(4.5);
      });
      it('ปุ่มหลัก: ตัวหนังสือบนทอง (--on-gold บน --gold) และบนไล่เฉดแบรนด์ ≥ 4.5:1', () => {
        const onGold = parse(t.get('--on-gold')!);
        expect(ratio(onGold, parse(t.get('--gold')!))).toBeGreaterThanOrEqual(4.5);
        for (const k of ['--gold-grad-hi', '--gold-grad-lo', '--gold-grad-hi-hover', '--gold-grad-lo-hover']) expect(ratio(onGold, parse(t.get(k)!)), k).toBeGreaterThanOrEqual(4.5);
      });
      it('สีสถานะ (รายรับ/รายจ่าย/โอน/เตือน) เป็นตัวหนังสือ ≥ 4.5:1 บนการ์ดทึบ พื้นเต็ม dialog และพื้นเตือน', () => {
        const solids: [string, RGBA][] = [
          ['การ์ดทึบ', s.solid!],
          ['การ์ดทึบบนก้อนแสงเข้ม', s.solidWorst!],
          ['พื้นทึบเต็ม', s.surfaceSolid!],
          ['dialog', s.dialog!],
        ];
        for (const k of ['--income', '--expense', '--transfer', '--warn']) {
          for (const [label, surf] of solids) expect(ratio(parse(t.get(k)!), surf), `${k} บน ${label}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(ratio(parse(t.get('--expense')!), s.alert!), 'expense บนแถบเตือน').toBeGreaterThanOrEqual(4.5);
        expect(ratio(parse(t.get('--text')!), s.alert!), 'text บนแถบเตือน').toBeGreaterThanOrEqual(4.5);
        expect(ratio(parse(t.get('--text')!), s.notice!), 'text บนกล่องแจ้ง').toBeGreaterThanOrEqual(4.5);
        expect(ratio(parse(t.get('--gold')!), s.notice!), 'gold บนกล่องแจ้ง').toBeGreaterThanOrEqual(4.5);
      });
      it('ขอบช่องกรอก (--control-border) ≥ 3:1 เทียบพื้น (WCAG 1.4.11)', () => {
        const list: [string, RGBA][] = [
          ['พื้นช่องกรอก', s.field!],
          ['การ์ดทึบ', s.solid!],
          ['dialog', s.dialog!],
        ];
        for (const [label, surf] of list) expect(ratio(over(parse(t.get('--control-border')!), surf), surf), label).toBeGreaterThanOrEqual(3);
      });
      it('ตัวหนังสือในช่องกรอก (--text บนพื้นช่อง) และ placeholder (--text-60) ≥ 4.5:1', () => {
        expect(ratio(textOn('--text', s.field!), s.field!)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(textOn('--text-60', s.field!), s.field!)).toBeGreaterThanOrEqual(4.5);
      });
      it('สีกราฟ (--chart-*) ≥ 3:1 เทียบการ์ดทึบและพื้นเต็ม (วัตถุกราฟิก WCAG 1.4.11)', () => {
        const charts = [...t.keys()].filter((key) => key.startsWith('--chart-'));
        expect(charts.length).toBeGreaterThanOrEqual(13);
        for (const k of charts) {
          for (const [label, surf] of [['การ์ดทึบ', s.solid!], ['พื้นทึบเต็ม', s.surfaceSolid!]] as [string, RGBA][]) {
            expect(ratio(parse(t.get(k)!), surf), `${k} บน ${label}`).toBeGreaterThanOrEqual(3);
          }
        }
      });
      it('ตัวหนังสือบนปุ่มมาตรฐาน/แถบเมนู (text/muted บน ov-8, ov-15, ov-16 ทับการ์ดทึบ) ≥ 4.5:1', () => {
        for (const k of ['--ov-8', '--ov-15', '--ov-16']) {
          const surf = over(parse(t.get(k)!), s.solid!);
          expect(ratio(textOn('--text', surf), surf), k).toBeGreaterThanOrEqual(4.5);
          expect(ratio(textOn('--muted', surf), surf), k + ' muted').toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }
});

describe('โครงสร้างโหมดสว่าง', () => {
  it('ทับครบทุก token ที่โหมดมืดประกาศ (ไม่มีตัวไหนหลุดเป็นสีมืดบนพื้นสว่าง)', () => {
    const lightOnly = tokensOf(lightBlock);
    const missing = [...dark.keys()].filter((k) => !lightOnly.has(k) && !['--glass-radius', '--solid-radius'].includes(k));
    expect(missing).toEqual([]);
  });
  it('บล็อกตามเครื่อง (prefers-color-scheme: light) เนื้อหาเหมือนบล็อก data-theme="light" ทุกบรรทัด', () => {
    const media = /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme='dark'\]\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const norm = (str: string): string => [...tokensOf(str)].map(([k, v]) => `${k}:${v}`).sort().join('|');
    expect(norm(media).length).toBeGreaterThan(500);
    expect(norm(media)).toBe(norm(lightBlock));
  });
  it('โหมดสว่างตั้ง color-scheme: light ให้ช่องกรอก/แถบเลื่อนของเบราว์เซอร์', () => {
    expect(tokensOf(lightBlock).get('--cs')).toBe('light');
    expect(dark.get('--cs')).toBe('dark');
  });
});

describe('การ์ดแชร์ (รูปที่ส่งออก) ตามธีม', () => {
  for (const [name, t] of MODES) {
    it(`โหมด${name}: ตัวหนังสือบนพื้นการ์ด ≥ 4.5:1 · แถบสัดส่วน ≥ 3:1 เทียบพื้นการ์ด`, () => {
      const tops = [parse(t.get('--card-bg-top')!), parse(t.get('--card-bg-bottom')!)];
      for (const bg of tops) {
        for (const k of ['--card-title', '--card-subtitle', '--card-label', '--card-note', '--card-brand']) {
          expect(ratio(parse(t.get(k)!), bg), `${k} บนพื้นการ์ด`).toBeGreaterThanOrEqual(4.5);
        }
        for (const key of [...t.keys()].filter((x) => /^--chart-slice/.test(x))) {
          expect(ratio(parse(t.get(key)!), bg), `${key} บนพื้นการ์ด`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }
});

describe('ชั้นเงาแวววาว (glass-sheen) ที่วาดทับตัวหนังสือบนกระจก และปุ่มปิดการใช้งาน', () => {
  for (const [name, t] of MODES) {
    it(`โหมด${name}: ตัวหนังสือที่ถูกฟิล์มแวววาวทับ ≥ 4.5:1 บนกระจกทุกมุม · ตัวหนังสือปุ่มปิดการใช้งาน ≥ 4.5:1`, () => {
      const s = surfaces(t);
      const sheen = parse(t.get('--glass-sheen')!);
      for (const k of ['--text', '--muted']) {
        for (const [label, surf] of [['กระจก', s.glass!], ['กระจกบนก้อนแสงเข้ม', s.glassWorst!], ['กระจกมุมจาง', s.glassB!], ['กระจกมุมจางบนก้อนแสงเข้ม', s.glassBWorst!]] as [string, RGBA][]) {
          const surfWithSheen = over(sheen, surf);
          const textWithSheen = over(sheen, over(parse(t.get(k)!), surf));
          expect(ratio(textWithSheen, surfWithSheen), `${k} ใต้ฟิล์มบน ${label}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      if (name === 'สว่าง') {
        const surf = over(parse(t.get('--ov-10')!), s.solid!);
        expect(ratio(over(parse(t.get('--text-60')!), surf), surf), 'ปุ่มปิดการใช้งาน').toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
