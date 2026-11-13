import { describe, expect, it } from 'vitest';

/** "เพิ่มลงหน้าจอโฮม" (เจ้าของสั่ง 13 พ.ย. 2569): manifest + ไอคอน + theme color · ห้ามมี service worker ที่แคชข้อมูลการเงิน · CSP ไม่หลวม */
const raws = import.meta.glob(['/index.html', '/vercel.json', '/package.json', '/public/manifest.webmanifest', '/src/ui/styles.css', '/src/**/*.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const publicScripts = import.meta.glob('/public/**/*.{js,mjs}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const pngs = import.meta.glob('/public/*.png', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;
const read = (p: string): string => raws['/' + p] ?? '';
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string; short_name: string; lang: string; start_url: string; scope: string; display: string; background_color: string; theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};
const indexHtml = read('index.html');
const vercel = JSON.parse(read('vercel.json')) as { headers: { headers: { key: string; value: string }[] }[] };
const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? '';

/** อ่านส่วนหัว PNG จากไฟล์จริง (vite คืนเป็น data URI) */
function pngInfo(path: string): { width: number; height: number; bitDepth: number; colorType: number } {
  const uri = pngs['/' + path];
  expect(uri, path + ' ต้องมีไฟล์').toBeTruthy();
  const bin = atob(String(uri).split(',')[1] ?? '');
  const b = (i: number): number => bin.charCodeAt(i);
  const u32 = (i: number): number => ((b(i) << 24) | (b(i + 1) << 16) | (b(i + 2) << 8) | b(i + 3)) >>> 0;
  expect([0, 1, 2, 3, 4, 5, 6, 7].map(b), path).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bin.slice(12, 16), path).toBe('IHDR');
  return { width: u32(16), height: u32(20), bitDepth: b(24), colorType: b(25) };
}

describe('web app manifest', () => {
  it('ชื่อแอป Money Buddy · ภาษาไทย · เปิดแบบแอป (standalone) · ขอบเขตทั้งเว็บ', () => {
    expect(manifest.name).toBe('Money Buddy');
    expect(manifest.short_name).toBe('Money Buddy');
    expect(manifest.lang).toBe('th');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });
  it('สีพื้นและสีแถบตรงกับ --bg ของดีไซน์ (#07080d) และ index.html ใช้สีเดียวกัน', () => {
    const bg = /--bg:\s*(#[0-9a-fA-F]{6})/.exec(read('src/ui/styles.css'))?.[1]?.toLowerCase();
    expect(bg).toBe('#07080d');
    expect(manifest.background_color).toBe(bg);
    expect(manifest.theme_color).toBe(bg);
    expect(indexHtml).toContain(`<meta name="theme-color" content="${bg}" />`);
  });
  it('ไอคอน 192 + 512 (any) และ 512 (maskable) · ไฟล์มีจริง เป็น PNG ขนาดตรงกับที่ประกาศ', () => {
    const bySize = (purpose: string) => manifest.icons.filter((i) => (i.purpose ?? 'any') === purpose).map((i) => i.sizes).sort();
    expect(bySize('any')).toEqual(['192x192', '512x512']);
    expect(bySize('maskable')).toEqual(['512x512']);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/'), icon.src).toBe(true);
      const info = pngInfo('public' + icon.src);
      expect(`${info.width}x${info.height}`, icon.src).toBe(icon.sizes);
    }
  });
  it('apple-touch-icon 180x180 เป็น PNG ทึบ (ไม่มีช่องโปร่งใส: iPhone จะเติมพื้นดำให้ถ้าโปร่งใส)', () => {
    const info = pngInfo('public/apple-touch-icon.png');
    expect(info).toMatchObject({ width: 180, height: 180, bitDepth: 8, colorType: 2 });
  });
});

describe('index.html', () => {
  it('ลิงก์ manifest, apple-touch-icon, ชื่อแอปบนหน้าจอโฮม และโหมดเปิดแบบแอป', () => {
    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-title" content="Money Buddy" />');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(indexHtml).toContain('<meta name="mobile-web-app-capable" content="yes" />');
  });
  it('ไฟล์ที่ index.html ชี้ถึงมีอยู่จริงใน public/', () => {
    expect(read('public/manifest.webmanifest').length).toBeGreaterThan(50);
    for (const name of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) expect(pngs['/public/' + name], name).toBeTruthy();
  });
});

describe('ไม่มี service worker (ห้ามแคชข้อมูลการเงิน)', () => {
  it('ไม่มีการลงทะเบียน service worker ในซอร์ส (ts/tsx/js/mjs) และ index.html', () => {
    const files = Object.keys(raws).filter((k) => k.startsWith('/src/') && /\.(ts|tsx)$/.test(k));
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) expect(raws[file], file).not.toMatch(/serviceWorker|workbox|registerSW/);
    expect(indexHtml).not.toMatch(/serviceWorker/);
  });
  it('ไม่มีไฟล์ service worker/workbox ใน public/ ทุกระดับโฟลเดอร์ (ชื่อไฟล์ และการเรียก serviceWorker.register ในเนื้อหา)', () => {
    const scripts = Object.entries(publicScripts);
    expect(scripts.length).toBeGreaterThan(0); // มีไฟล์ของตัวอ่านสลิป (ยืนยันว่า glob เห็นไฟล์จริง)
    for (const [path, text] of scripts) {
      expect(path, path).not.toMatch(/(^|\/)(sw|service-?worker|workbox)[^/]*\.m?js$/i);
      expect(text, path).not.toMatch(/serviceWorker\s*\.\s*register|importScripts\([^)]*workbox|workbox-/);
    }
  });
  it('ไม่มีปลั๊กอิน PWA ใน dependencies', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    expect(names.filter((n) => /workbox|vite-plugin-pwa|next-pwa|sw-precache/i.test(n))).toEqual([]);
  });
});

describe('CSP ยังไม่หลวมหลังเพิ่ม manifest', () => {
  it("เพิ่มเฉพาะ manifest-src 'self' · default-src 'none' และคำสั่งอื่นเดิมครบ", () => {
    const parts = csp.split(';').map((p) => p.trim()).filter(Boolean);
    expect(parts).toContain("manifest-src 'self'");
    expect(parts).toContain("default-src 'none'");
    expect(parts).toContain("img-src 'self'");
    expect(parts).toContain("connect-src 'self' https://otndefvbosbunonmmuwn.supabase.co");
    expect(parts).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(parts).toContain("worker-src 'self'");
    expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'|\*|data:|blob:|http:/);
  });
});
