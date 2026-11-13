import { describe, expect, it } from 'vitest';

/** ผลสำรวจผู้ใช้ใหม่ 13 พ.ย. 2569: หน้ารายการ/บิล/เปลี่ยนรหัสผ่านอ่านรู้เรื่องบนมือถือ */
const ui = import.meta.glob('/src/ui/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const get = (n: string): string => ui[`/src/ui/${n}`] ?? '';

describe('หน้ารายรับ-รายจ่าย', () => {
  const ledger = get('LedgerView.tsx');
  const css = get('styles.css');
  it('สรุปยอดอยู่บนพื้นทึบ มีเครื่องหมาย +/− หน้ายอด (ไม่พึ่งสีอย่างเดียว) และตัวอย่างค้นหาไม่ใช้ชื่ออังกฤษ', () => {
    expect(ledger).toContain('<section className="solid card ledger-summary"');
    expect(ledger).toContain('+{formatBaht(satang(totals.income))}');
    expect(ledger).toContain('−{formatBaht(satang(totals.expense))}');
    expect(ledger).not.toContain('CashFlow');
  });
  it('ตัวกรองบนมือถือ: ค้นหา+เดือนเต็มแถว (ชื่อเดือนยาวไม่ถูกตัด) ประเภท+กระเป๋าคู่กัน', () => {
    expect(css).toMatch(/\.filters \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 12px; \}/);
    expect(css).toContain('.filters .field:nth-child(-n+2) { grid-column: 1 / -1; }');
  });
});

describe('บิล: รอบเป็นชื่อเดือนไทย ไม่ใช่ 2026-11', () => {
  const bills = get('BillsView.tsx');
  it('ใช้ thaiMonthKeyLabel ทั้งข้อความที่เห็นและข้อความสำหรับโปรแกรมอ่านจอ', () => {
    expect(bills).toContain("import { thaiDayLabel, thaiMonthKeyLabel } from '../app/dates';");
    expect(bills).toContain('รอบ ${thaiMonthKeyLabel(row.bill.lastPaidMonth)}');
    expect(bills).toContain('จ่ายล่าสุดรอบ ${thaiMonthKeyLabel(bill.lastPaidMonth)}');
    expect(bills).not.toMatch(/รอบ \$\{(row\.)?bill\.lastPaidMonth\}/);
  });
});

describe('บังคับเปลี่ยนรหัสผ่านครั้งแรก', () => {
  it('ช่องรหัสเดิมเรียก "รหัสผ่านชั่วคราวที่ได้รับ" · หน้าโปรไฟล์ยังเป็น "รหัสผ่านปัจจุบัน"', () => {
    expect(get('AuthGate.tsx')).toContain('currentLabel="รหัสผ่านชั่วคราวที่ได้รับ"');
    const form = get('ChangePasswordForm.tsx');
    expect(form).toContain("currentLabel = 'รหัสผ่านปัจจุบัน'");
    expect(form).toContain('label={currentLabel}');
  });
});
