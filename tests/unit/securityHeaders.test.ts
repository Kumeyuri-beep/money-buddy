import { describe, expect, it } from 'vitest';

const vercelRaw = Object.values(import.meta.glob('/vercel.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const indexHtml = Object.values(import.meta.glob('/index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface VercelConfig {
  buildCommand: string;
  headers: { source: string; headers: { key: string; value: string }[] }[];
}
const config = JSON.parse(vercelRaw) as VercelConfig;
const headerOf = (key: string): string => config.headers.flatMap((h) => h.headers).find((h) => h.key === key)?.value ?? '';

function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

/** นโยบาย CSP (M2-F) · เจ้าของสั่ง 9 พ.ย. 2569 ให้ทำก่อนเชิญผู้ใช้จริง (กัน XSS ซึ่งเป็นทางขโมย session ใน localStorage) */
describe('ส่วนหัวความปลอดภัยใน vercel.json', () => {
  const csp = directives(headerOf('Content-Security-Policy'));

  it('ยังล็อก build command และใช้กับทุกเส้นทาง', () => {
    expect(config.buildCommand).toBe('npm run build');
    expect(config.headers.some((h) => h.source === '/(.*)')).toBe(true);
  });

  it('เริ่มจากปฏิเสธทั้งหมด และไม่เปิดช่องรันสคริปต์ตามอำเภอใจ', () => {
    expect(csp.get('default-src')).toEqual(["'none'"]);
    const script = csp.get('script-src') ?? [];
    expect(script).toContain("'self'");
    expect(script).toContain("'wasm-unsafe-eval'"); // ตัวอ่านสลิป (WebAssembly) เท่านั้น
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'data:', 'http:', 'https:']) expect(script, bad).not.toContain(bad);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('ติดต่อออกนอกเฉพาะ Supabase ของโปรเจกต์นี้ (ไม่ใช้ wildcard) · ฟอนต์โหลดจากโดเมนเองเท่านั้น', () => {
    const connect = csp.get('connect-src') ?? [];
    expect(connect).toEqual(["'self'", 'https://otndefvbosbunonmmuwn.supabase.co']);
    for (const [name, values] of csp) {
      for (const v of values) {
        expect(v, `${name} ${v}`).not.toBe('*');
        expect(v, `${name} ${v}`).not.toMatch(/^http:/);
        expect(v, `${name} ${v}`).not.toMatch(/\*\./);
      }
    }
    expect(csp.get('font-src')).toEqual(["'self'"]);
    // รัดแล้ว (หลังเจ้าของลอง Preview): ไม่มีรูป data:/blob: ไม่มี worker จาก Blob ไม่มีฟอร์มที่ส่งแบบเบราว์เซอร์เอง · manifest เปิดเฉพาะโดเมนเอง (เจ้าของสั่ง 13 พ.ย. 2569 เพิ่มลงหน้าจอโฮม: default-src 'none' จะบล็อก manifest ถ้าไม่ระบุ)
    expect(csp.get('img-src')).toEqual(["'self'"]);
    expect(csp.get('worker-src')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'none'"]);
    expect(csp.get('manifest-src')).toEqual(["'self'"]);
    expect(csp.get('style-src')).toEqual(["'self'"]);
  });

  it('ฟอนต์ self-host: ไม่มีการเรียก Google Fonts ทั้งใน index.html, CSP และซอร์ส · โหลดฟอนต์จากแพ็กเกจในโปรเจกต์', () => {
    expect(indexHtml).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(headerOf('Content-Security-Policy')).not.toMatch(/googleapis|gstatic/);
    const main = sources['/src/main.tsx'] ?? '';
    for (const weight of [400, 500, 600, 700]) {
      expect(main, String(weight)).toContain(`@fontsource/ibm-plex-sans-thai/${weight}.css`);
    }
    // ไฟล์รวมมี unicode-range (ชุดไทยกับละตินไม่ทับกัน) · ห้ามนำเข้าไฟล์แยกชุดที่ไม่มี unicode-range
    expect(main).not.toMatch(/ibm-plex-sans-thai\/(thai|latin)(-ext)?-\d{3}\.css/);
  });

  it('ส่วนหัวอื่นครบ', () => {
    expect(headerOf('X-Content-Type-Options')).toBe('nosniff');
    expect(headerOf('X-Frame-Options')).toBe('DENY');
    expect(headerOf('Referrer-Policy')).toBe('no-referrer');
    expect(headerOf('Cross-Origin-Opener-Policy')).toBe('same-origin');
    // ห้ามใส่ COEP require-corp: จะบล็อกฟอนต์ของ Google
    expect(headerOf('Cross-Origin-Embedder-Policy')).toBe('');
    expect(headerOf('Permissions-Policy')).toMatch(/camera=\(\)/);
  });
});

describe('โค้ดต้นทางสอดคล้องกับ CSP', () => {
  it('index.html ไม่มีสคริปต์/สไตล์/ตัวจัดการเหตุการณ์แบบอินไลน์', () => {
    expect(indexHtml.length).toBeGreaterThan(100);
    expect(indexHtml).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i);
    expect(indexHtml).not.toMatch(/\son[a-z]+\s*=/i);
    expect(indexHtml).not.toMatch(/<style[\s>]/i);
    expect(indexHtml).not.toMatch(/\sstyle\s*=/i);
  });

  it('index.html ไม่เรียกโดเมนภายนอกเลย (ฟอนต์ self-host) · ถ้าอนาคตมี ทุกโดเมนต้องได้รับอนุญาตใน CSP', () => {
    const csp = directives(headerOf('Content-Security-Policy'));
    const allowed = [...csp.values()].flat();
    const origins = new Set((indexHtml.match(/https:\/\/[a-z0-9.-]+/gi) ?? []).map((o) => o.toLowerCase()));
    expect([...origins]).toEqual([]);
    for (const origin of origins) expect(allowed, origin).toContain(origin);
  });

  it('ตัวอ่านสลิปโหลด worker จากไฟล์ในโดเมนเอง (workerBlobURL: false) ให้ตรงกับ worker-src \'self\'', () => {
    const text = sources['/src/ocr/readSlip.ts'] ?? '';
    expect(text).toMatch(/workerBlobURL:\s*false/);
    expect(text).toContain("workerPath: ocrUrl('worker.min.js')");
  });

  it('ทุกฟอร์มจัดการ onSubmit เอง (form-action none จะบล็อกการส่งแบบเบราว์เซอร์)', () => {
    for (const [path, text] of Object.entries(sources)) {
      const forms = (text.match(/<form\b/g) ?? []).length;
      if (forms === 0) continue;
      expect((text.match(/<form\b[^>]*onSubmit/gs) ?? []).length, path).toBe(forms);
      expect(text, path).not.toMatch(/<form\b[^>]*\saction\s*=/s);
    }
  });

  it('ไม่มี <img>, url() หรือรูป data:/blob: ในโค้ดและ CSS (img-src \'self\')', () => {
    for (const [path, text] of Object.entries(sources)) {
      expect(text, path).not.toMatch(/<img\b|new Image\(|url\(\s*['"]?data:/);
    }
  });

  it('โค้ดไม่ใช้ eval / new Function / innerHTML / dangerouslySetInnerHTML / setAttribute style', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    for (const [path, text] of Object.entries(sources)) {
      expect(text, path).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\s*\(/);
      expect(text, path).not.toMatch(/setAttribute\(\s*['"]style['"]/);
    }
  });

  it('ไม่มีการเรียกเครือข่ายไปโดเมนอื่นที่ CSP ไม่อนุญาต (fetch/XMLHttpRequest/WebSocket/EventSource ใช้เฉพาะ URL ของ Supabase หรือไฟล์ในโดเมนเอง)', () => {
    for (const [path, text] of Object.entries(sources)) {
      for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) {
        const host = m[0].toLowerCase();
        // อนุญาตเฉพาะที่ปรากฏเป็นข้อความอธิบาย/เอกสาร ไม่ใช่ปลายทางเรียก: ต้องไม่อยู่ใน fetch( / new WebSocket( / .src =
        const near = text.slice(Math.max(0, m.index - 40), m.index);
        expect(near, `${path} ${host}`).not.toMatch(/fetch\(\s*['"`]$|WebSocket\(\s*['"`]$|XMLHttpRequest|\.src\s*=\s*['"`]$/);
      }
    }
  });
});
