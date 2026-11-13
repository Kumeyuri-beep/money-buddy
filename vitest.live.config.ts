import { defineConfig } from 'vitest/config';

/**
 * ชุดทดสอบกับ Supabase "จริง" (รันในเครื่องเจ้าของเท่านั้น: npm run admin:live-contract)
 * ใช้ key ผู้ดูแลจาก admin.env เพื่อสร้าง/ลบผู้ใช้ทดสอบ livetest-xxxxxxxx เท่านั้น · ไม่รันใน CI และไม่อยู่ใน npm test
 */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.ts'],
    globalSetup: ['tests/live/globalSetup.ts'],
    environment: 'node',
    // ห่อ fetch บันทึกคำขอที่ช้า/ล้มลง .live-logs/live-requests.log (ดู tests/live/traceFetch.ts)
    setupFiles: ['tests/live/traceFetch.ts'],
    // log เต็มลง .live-logs/ ทุกครั้ง (ชื่อข้อ ผล เวลาต่อข้อ ข้อความ error) · ดู tests/live/logReporter.ts
    reporters: ['default', './tests/live/logReporter.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
