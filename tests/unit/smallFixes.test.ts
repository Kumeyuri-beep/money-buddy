import { describe, expect, it } from 'vitest';

const ui = import.meta.glob('/src/ui/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const get = (n: string): string => ui[`/src/ui/${n}`] ?? '';

describe('จุดเล็กจากผลสำรวจผู้ใช้ใหม่ (13 พ.ย. 2569)', () => {
  it('ปุ่มสำรอง/ล้างข้อมูลย้ายไปหน้าโปรไฟล์แล้ว (เจ้าของตัดสิน 13 พ.ย. 2569): แถบข้างไม่มีปุ่มอันตราย', () => {
    const app = get('App.tsx');
    expect(app).not.toContain('ล้างข้อมูลและเริ่มใหม่</button>');
    expect(app).not.toMatch(/footer={/);
    expect(app).toContain('<AccountView onReset={() => void reset()}');
    const account = get('AccountView.tsx');
    expect(account).toContain('ดาวน์โหลดข้อมูลของฉัน');
    expect(account).toContain('ล้างข้อมูลและเริ่มใหม่');
    expect(account).toContain('onClick={onReset}');
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
