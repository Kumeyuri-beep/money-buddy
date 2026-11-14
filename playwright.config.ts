import { defineConfig } from '@playwright/test';

/**
 * เทสต์หน้าจออัตโนมัติ (เจ้าของสั่ง 14 พ.ย. 2569): ความกว้าง 360 / 390 / 1280 ทุกหน้าหลัก
 * ใช้ harness บน dev server (src/dev/harness.tsx): ข้อมูลสมมติใน IndexedDB ของเบราว์เซอร์ ข้ามการล็อกอิน ไม่ต่อฐานข้อมูลจริง
 * (เทสต์บล็อกคำขอออกนอก localhost ทุกชนิด และล้มถ้ามีความพยายามเรียกออกนอก) · รัน: npm run e2e
 */
export default defineConfig({
  testDir: 'tests/e2e',
  // ภาพเทียบก่อน/หลัง (tests/e2e/visual.spec.ts · รันเมื่อ VISUAL=1) เก็บใน .visual/<ธีม>/ ไม่เข้า git
  snapshotPathTemplate: `.visual/${process.env.VISUAL_THEME === 'light' ? 'light' : 'dark'}/{arg}{ext}`,
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0, // ไม่ซ่อนความไม่นิ่งด้วย retry
  reporter: process.env.CI ? [['list']] : [['list']],
  use: { baseURL: 'http://localhost:5199', browserName: 'chromium', locale: 'th-TH', timezoneId: 'Asia/Bangkok', trace: 'off' },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199/harness.html',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    // ไม่ให้แอปสร้างตัวต่อ Supabase เลย (ค่าว่างชนะค่าใน .env ของเครื่องผู้พัฒนา) → ผลเหมือนกันทั้งในเครื่องและใน CI และไม่มีทางต่อฐานข้อมูลจริง
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
});
