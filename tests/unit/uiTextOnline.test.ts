import { describe, expect, it } from 'vitest';

/** ข้อความบนจอต้องตรงกับระบบจริง: ข้อมูลเก็บในบัญชีออนไลน์ (M2) ไม่ใช่ "ในเครื่อง/ในเบราว์เซอร์" · ผลสำรวจผู้ใช้ใหม่ 13 พ.ย. 2569 */
const files = import.meta.glob('/src/ui/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (n: string): string => files[`/src/ui/${n}`] ?? '';

describe('ข้อความเรื่องที่เก็บข้อมูล', () => {
  it('หน้าเริ่มต้น/แถบโปรไฟล์/หน้าเปิดข้อมูลไม่ได้ ไม่บอกว่าข้อมูลอยู่ในเครื่อง', () => {
    for (const bad of ['เก็บไว้ในเบราว์เซอร์ของคุณเท่านั้น', 'ข้อมูลอยู่ในเครื่องคุณ', 'ปิดโหมดส่วนตัวของเบราว์เซอร์', "'บัญชีในเครื่องนี้'"]) {
      for (const f of ['Setup.tsx', 'Shell.tsx', 'App.tsx']) expect(src(f), `${f} ยังมี "${bad}"`).not.toContain(bad);
    }
    expect(src('Setup.tsx')).toContain('ข้อมูลเก็บในบัญชีออนไลน์ของคุณ แยกจากผู้ใช้คนอื่น');
    expect(src('Shell.tsx')).toContain('ข้อมูลเก็บในบัญชีของคุณ');
    expect(src('App.tsx')).toContain('ตรวจว่าอินเทอร์เน็ตใช้ได้');
  });
  it('หน้าเริ่มต้นอธิบายคำว่า "กระเป๋า" และบอกตรงๆ ว่าเปลี่ยนชื่อทีหลังไม่ได้ (ตอนนี้ยังไม่มีหน้าแก้)', () => {
    const s = src('Setup.tsx');
    expect(s).toContain('กระเป๋า = ที่เก็บเงินแต่ละที่');
    expect(s).toContain('ใส่ 0 ได้');
    expect(s).toContain('ยังเปลี่ยนชื่อกระเป๋าทีหลังไม่ได้');
  });
  it('หน้าลบบัญชีบอกว่าพอร์ตลงทุนถูกลบด้วย และไม่ใช้ศัพท์ session', () => {
    const a = src('AccountView.tsx');
    expect(a).toContain('พอร์ตลงทุนและรายการซื้อขาย');
    expect(a).not.toMatch(/ที่ได้ session ไป/);
  });
});
