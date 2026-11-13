import { describe, expect, it } from 'vitest';

/** เทสต์หน้าจอ Playwright (เจ้าของสั่ง 14 พ.ย. 2569): ต้องไม่ต่อฐานข้อมูลจริง ครอบทุกหน้าและความกว้างที่สั่ง และอยู่ใน CI */
const raw = (glob: Record<string, string>): string => Object.values(glob)[0] ?? '';
const config = raw(import.meta.glob('/playwright.config.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const spec = raw(import.meta.glob('/tests/e2e/layout.spec.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const ci = raw(import.meta.glob('/.github/workflows/ci.yml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const pkg = JSON.parse(raw(import.meta.glob('/package.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)) as { scripts: Record<string, string>; devDependencies: Record<string, string> };

describe('Playwright e2e', () => {
  it('ไม่ต่อฐานข้อมูลจริง: เซิร์ฟเวอร์ทดสอบตั้ง Supabase env เป็นค่าว่าง · สเปคบล็อกทุกคำขอที่ไม่ใช่ localhost และล้มถ้ามีคำขอออกนอก', () => {
    expect(config).toMatch(/VITE_SUPABASE_URL:\s*''/);
    expect(config).toMatch(/VITE_SUPABASE_ANON_KEY:\s*''/);
    expect(spec).toContain(String.raw`route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort())`);
    expect(spec).toContain("expect(seen.external, 'คำขอออกนอกเครื่อง (ห้าม)').toEqual([])");
  });
  it('ครอบ 360 / 390 / 1280 และทุกหน้า (ภาพรวม รายการ บิล พอร์ต ถัวเฉลี่ย เกษียณ ภาษี โปรไฟล์) + เมนู pop up', () => {
    for (const w of ['width: 360', 'width: 390', 'width: 1280']) expect(spec, w).toContain(w);
    for (const id of ['today', 'ledger', 'bills', 'portfolio', 'averaging', 'retirement', 'tax', 'account']) expect(spec, id).toContain(`id: '${id}'`);
    expect(spec).toContain('เมนู pop up');
  });
  it('ตรวจครบ 3 อย่างที่สั่ง: ไม่ล้นจอ · ปุ่มไม่ถูกบัง · ไม่มี error ใน console', () => {
    expect(spec).toContain('await overflowing(page)');
    expect(spec).toContain('await obscured(page)');
    expect(spec).toContain("expect(seen.errors, 'error ใน console').toEqual([])");
  });
  it('ไม่ซ่อนความไม่นิ่งด้วย retry', () => {
    expect(config).toMatch(/retries:\s*0/);
  });
  it('มีสคริปต์ npm run e2e และ @playwright/test เป็น devDependency (ไม่ใช่ dependency ของแอป)', () => {
    expect(pkg.scripts.e2e).toBe('playwright test');
    expect(pkg.devDependencies['@playwright/test']).toBeTruthy();
  });
  it('CI: job e2e แยกจาก test · ไม่ใช้ secrets · มีเพดานเวลา', () => {
    expect(ci).toMatch(/^\s{2}e2e:/m);
    expect(ci).toContain('npm run e2e');
    expect(ci).toMatch(/timeout-minutes:\s*\d+/);
    expect(ci).not.toContain('secrets.');
  });
});
