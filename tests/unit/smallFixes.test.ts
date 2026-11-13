import { describe, expect, it } from 'vitest';

const ui = import.meta.glob('/src/ui/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const get = (n: string): string => ui[`/src/ui/${n}`] ?? '';

describe('จุดเล็กจากผลสำรวจผู้ใช้ใหม่ (13 พ.ย. 2569)', () => {
  it('ปุ่ม "สำรองข้อมูล" ที่แถบข้างบอกผลเมื่อพลาด (ไม่เงียบ) และเมื่อสำเร็จ', () => {
    const app = get('App.tsx');
    expect(app).toContain('onClick={() => void backupNow()}');
    expect(app).toContain("friendlyError(e, 'สำรองข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง')");
    expect(app).toContain("message: 'ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว'");
    expect(app).not.toContain('onClick={() => void downloadBackup()}');
  });
  it('คำอธิบายปุ่มสแกนสลิปไม่บอกผู้ใช้มือถือให้ "กด Ctrl+V" นำหน้า', () => {
    const header = get('Header.tsx');
    expect(header).toContain('เลือกรูปสลิปจากเครื่อง (บนคอมพิวเตอร์ยังวางรูปด้วย Ctrl+V');
    expect(header).not.toContain('เลือกรูปสลิป หรือกด Ctrl+V');
  });
  it('ลิงก์ในรายการล่าสุดใช้ชื่อเดียวกับเมนู (รายรับ-รายจ่าย) ไม่ใช่ "สมุดบัญชี"', () => {
    expect(get('overview/RecentEntries.tsx')).toContain('ดูรายรับ-รายจ่ายทั้งหมด');
    expect(get('overview/RecentEntries.tsx')).not.toContain('ดูสมุดบัญชี');
  });
});
