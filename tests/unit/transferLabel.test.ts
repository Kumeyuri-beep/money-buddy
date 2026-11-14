import { describe, expect, it } from 'vitest';

/** ชื่อแท็บ "ย้ายเงิน" (เจ้าของสั่ง 14 พ.ย. 2569): ไม่เหลือคำว่า "โอนเงิน" ในข้อความที่ผู้ใช้เห็นของหน้าจอและข้อความช่วยเหลือ */
const ui = import.meta.glob(['/src/ui/**/*.tsx', '/src/app/slipParser.ts', '/src/app/entryForm.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('ป้าย "ย้ายเงิน" ทุกจุดในแอป', () => {
  it('ไฟล์หน้าจอ/ข้อความช่วยเหลือไม่มี "โอนเงิน" เป็นป้ายหรือข้อความอีก (คำที่ใช้ในความหมายอื่นเช่น ผู้โอน/ค่าโอน ไม่นับ)', () => {
    const offenders = Object.entries(ui)
      .filter(([, src]) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').includes('โอนเงิน'))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });
  it('แท็บในฟอร์ม ตัวกรองรายการ และฟอร์มเร็วใช้ "ย้ายเงิน"', () => {
    expect(ui['/src/ui/AddEntryDialog.tsx']).toContain("label: 'ย้ายเงิน'");
    expect(ui['/src/ui/LedgerView.tsx']).toContain("transfer: 'ย้ายเงิน'");
    expect(ui['/src/ui/QuickAdd.tsx']).toContain("transfer: 'ย้ายเงิน'");
    expect(ui['/src/ui/overview/RecentEntries.tsx']).toContain("transfer: 'ย้ายเงิน'");
  });
});
