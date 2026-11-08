import { describe, expect, it } from 'vitest';

/**
 * กันความลับและการสมัครเองหลุดเข้าโค้ดเว็บ (แผน M2 ข้อ 4.5-4.6) · ค้นจากซอร์สจริงด้วย import.meta.glob (ไม่ต้องใช้ key)
 * ส่วนตรวจ dist/ และสคริปต์ผู้ดูแลอยู่ใน B2
 */
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const config = import.meta.glob('/vite.config.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('โค้ดเว็บ (src/)', () => {
  it('มีไฟล์ให้ตรวจ (กัน glob ว่างแล้วเทสต์ผ่านเปล่าๆ)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });
  it('ไม่มี key ระดับผู้ดูแล หรือชื่อตัวแปรของมัน', () => {
    const bad = /service_role|SERVICE_ROLE|SUPABASE_SECRET|SECRET_KEY|c2VydmljZV9yb2xl/;
    const hits = Object.entries(sources).filter(([, t]) => bad.test(t)).map(([p]) => p);
    expect(hits).toEqual([]);
  });
  it('ไม่มีค่า key จริง (รูปแบบ sb_secret_ ตามด้วยอักขระ key ยาว หรือ JWT)', () => {
    const real = /sb_secret_[A-Za-z0-9_-]{20,}|sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
    const hits = Object.entries(sources).filter(([, t]) => real.test(t)).map(([p]) => p);
    expect(hits).toEqual([]);
  });
  it('เว็บไม่เรียกฟังก์ชันสมัคร/สร้างผู้ใช้ (เจ้าของสร้างบัญชีให้เท่านั้น)', () => {
    const bad = /\.signUp\s*\(|auth\.admin|createUser\s*\(|signInAnonymously|signInWithOtp|signInWithOAuth|resetPasswordForEmail/;
    const hits = Object.entries(sources).filter(([, t]) => bad.test(t)).map(([p]) => p);
    expect(hits).toEqual([]);
  });
  it('ใช้ตัวแปร VITE_ เฉพาะ URL กับ anon key ของ Supabase', () => {
    const names = new Set<string>();
    for (const t of Object.values(sources)) {
      for (const m of t.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) names.add(m[1] ?? '');
    }
    expect([...names].sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
  });
});

describe('vite.config.ts', () => {
  it('ไม่เปิดช่องให้ตัวแปรที่ไม่ใช่ VITE_ ถูกฝังลงเว็บ', () => {
    const text = Object.values(config)[0] ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/envPrefix|loadEnv\s*\(|process\.env/);
  });
});
