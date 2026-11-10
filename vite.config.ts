import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // ไม่ฝังไฟล์ (ฟอนต์/รูป) เป็น data: URI: CSP ของเว็บไม่อนุญาต data: (font-src 'self', img-src 'self') ต้องเป็นไฟล์จริงในโดเมนเอง
  build: { assetsInlineLimit: 0 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    css: { include: [/styles\.css/] },
  },
});
