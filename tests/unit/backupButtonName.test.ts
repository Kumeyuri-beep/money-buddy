import { describe, expect, it } from 'vitest';

const ui = import.meta.glob('/src/ui/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('ข้อความที่อ้างปุ่มสำรองข้อมูล', () => {
  it('ไม่อ้างชื่อ "สำรองข้อมูล" ในเครื่องหมายคำพูด (ปุ่มจริงชื่อ "ดาวน์โหลดข้อมูลของฉัน")', () => {
    const wrong = Object.entries(ui)
      .filter(([, text]) => text.includes('"สำรองข้อมูล"'))
      .map(([path]) => path);
    expect(Object.keys(ui).length).toBeGreaterThan(20);
    expect(wrong).toEqual([]);
    for (const file of ['App', 'Integrity', 'BillsView']) expect(ui[`/src/ui/${file}.tsx`], file).toContain('"ดาวน์โหลดข้อมูลของฉัน"');
  });
});

describe('ข้อความเรื่องสำเนาก่อนอัปเกรดตรงกับพฤติกรรม', () => {
  // บัญชีออนไลน์: ล้างข้อมูลเรียกเฉพาะฐานข้อมูลออนไลน์ ไม่แตะสำเนาในเบราว์เซอร์
  it('ไม่อ้างว่าการล้างข้อมูลลบสำเนา', () => {
    expect(ui['/src/ui/App.tsx']).not.toContain('และสำเนาก่อนอัปเกรด');
    expect(ui['/src/ui/BillsView.tsx']).not.toContain('จะลบสำเนานี้ด้วย');
    expect(ui['/src/ui/BillsView.tsx']).toContain('"ล้างข้อมูลและเริ่มใหม่" ไม่ลบสำเนานี้');
  });
});
