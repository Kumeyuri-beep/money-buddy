import { describe, expect, it } from 'vitest';
import { computeAveraging, type AveragingForm } from '../../src/app/averaging';

const base: AveragingForm = { holdUnits: '', holdCost: '', buyAmount: '1000', price: '10', fee: '' };

describe('computeAveraging: เครื่องคิดเลขถัวเฉลี่ยต้นทุน (ไม่บันทึกอะไร)', () => {
  it('ยังไม่มีของเดิม: ซื้อ 1,000 บาท ที่ราคา 10 → 100 หน่วย ต้นทุนเฉลี่ย 10', () => {
    const r = computeAveraging(base);
    expect(r).toMatchObject({ ok: true, boughtUnits: '100', newUnits: '100', newCost: 100_000, newAvgPrice: '10', oldAvgPrice: null });
  });
  it('ถัวเฉลี่ย: ถือ 100 หน่วย ต้นทุนรวม 1,500 บาท ซื้อเพิ่ม 1,000 บาท ราคา 5 → 300 หน่วย ต้นทุน 2,500 เฉลี่ย 8.333333', () => {
    const r = computeAveraging({ holdUnits: '100', holdCost: '1500', buyAmount: '1000', price: '5', fee: '' });
    expect(r).toMatchObject({ ok: true, boughtUnits: '200', newUnits: '300', newCost: 250_000, newAvgPrice: '8.333333', oldAvgPrice: '15' });
  });
  it('ค่าธรรมเนียมรวมเข้าต้นทุน', () => {
    const r = computeAveraging({ ...base, fee: '5.50' });
    expect(r).toMatchObject({ ok: true, newCost: 100_550, totalPaid: 100_550 });
  });
  it('ราคาเศษ: 1,000 บาท ที่ 333.3333 → 3.0000003 หน่วย ต้นทุนบันทึก 1,000 บาทพอดี', () => {
    const r = computeAveraging({ ...base, price: '333.3333' });
    expect(r).toMatchObject({ ok: true, boughtUnits: '3.0000003', newCost: 100_000 });
  });
  it('ช่องบังคับว่าง/ศูนย์/ลบ/รูปแบบผิด คืนรายการข้อผิดพลาด ไม่โยน', () => {
    for (const bad of [
      { ...base, buyAmount: '' },
      { ...base, buyAmount: '0' },
      { ...base, buyAmount: '-5' },
      { ...base, price: '' },
      { ...base, price: '0' },
      { ...base, price: '1e3' },
      { ...base, fee: '-1' },
      { ...base, holdUnits: '5' }, // ถือหน่วยแต่ไม่ใส่ต้นทุน
      { ...base, holdCost: '100' }, // ต้นทุนแต่ไม่ใส่หน่วย
      { ...base, holdUnits: '-1', holdCost: '10' },
      { ...base, buyAmount: '0.001' }, // ปัดแล้วเป็น 0 สตางค์ (ต้องเป็น 1 สตางค์ขึ้นไป)
    ]) {
      const r = computeAveraging(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    }
  });
  it('เงินน้อยจนได้หน่วยเป็น 0 แจ้งข้อผิดพลาด', () => {
    const r = computeAveraging({ ...base, buyAmount: '0.01', price: '100000000' });
    expect(r.ok).toBe(false);
  });
  it('ตัวเลขใหญ่เกินช่วงปลอดภัยไม่ทำให้พัง', () => {
    const r = computeAveraging({ holdUnits: '1', holdCost: '90071992547409', buyAmount: '90071992547409', price: '1', fee: '' });
    expect(r.ok).toBe(false);
  });
});
