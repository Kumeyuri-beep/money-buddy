import { describe, expect, it } from 'vitest';
import { BillFormError, billFromForm, billToForm, settingsFromForm, settingsToForm } from '../../src/app/billForm';

const form = (over = {}) => ({ name: 'ค่าเน็ต', amount: '599', dueDay: '5', walletId: '', categoryId: '', ...over });

describe('billFromForm (R2: แปลงข้อความเป็นสตางค์ที่ขอบฟอร์ม)', () => {
  it('แปลงยอดเป็นสตางค์ และวัน/ชื่อถูกตัดช่องว่าง', () => {
    const b = billFromForm(form({ name: '  ค่าเน็ต ', amount: '599.50', dueDay: ' 31 ' }), 'bill-1');
    expect(b).toEqual({ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_950, dueDay: 31 });
  });
  it('กระเป๋า/หมวดที่เลือกถูกใส่ ที่ว่างไม่ถูกใส่เป็นสตริงว่าง', () => {
    const b = billFromForm(form({ walletId: 'wallet-1', categoryId: 'expense-1' }), 'b');
    expect(b.walletId).toBe('wallet-1');
    expect(b.categoryId).toBe('expense-1');
    expect('walletId' in billFromForm(form(), 'b')).toBe(false);
  });
  it('ยอดน้อยมาก 0.01 ผ่าน, 0 / ติดลบ / ว่าง / ไม่ใช่ตัวเลข / ใหญ่เกิน ถูกปฏิเสธด้วยข้อความไทย', () => {
    expect(billFromForm(form({ amount: '0.01' }), 'b').amount).toBe(1);
    for (const amount of ['0', '0.00', '-5', '', 'abc', '1e3', '99999999999999999999']) {
      expect(() => billFromForm(form({ amount }), 'b')).toThrow(BillFormError);
    }
  });
  it('วันครบกำหนด 1 และ 31 ผ่าน, 0 / 32 / 1.5 / ว่าง / ตัวอักษร ถูกปฏิเสธ', () => {
    expect(billFromForm(form({ dueDay: '1' }), 'b').dueDay).toBe(1);
    for (const dueDay of ['0', '32', '1.5', '', 'x', '-1']) {
      expect(() => billFromForm(form({ dueDay }), 'b')).toThrow(BillFormError);
    }
  });
  it('ชื่อว่างถูกปฏิเสธ', () => {
    expect(() => billFromForm(form({ name: '   ' }), 'b')).toThrow(BillFormError);
  });
  it('billToForm แปลงกลับเป็นข้อความ (ยอดเป็นบาท)', () => {
    const f = billToForm({ id: 'b', name: 'น้ำ', amount: 12_345, dueDay: 7, walletId: 'w' });
    expect(f).toEqual({ name: 'น้ำ', amount: '123.45', dueDay: '7', walletId: 'w', categoryId: '' });
  });
});

describe('settingsFromForm', () => {
  it('ว่าง = ไม่ตั้ง, ค่าถูกต้องแปลงเป็นสตางค์', () => {
    expect(settingsFromForm({ payDay: '', monthlySavingsGoal: '', monthlyBudget: '' })).toEqual({});
    expect(settingsFromForm({ payDay: '25', monthlySavingsGoal: '5,000', monthlyBudget: '20000.50' })).toEqual({
      payDay: 25,
      monthlySavingsGoal: 500_000,
      monthlyBudget: 2_000_050,
    });
  });
  it('เป้าออม 0 ตั้งได้ (ไม่ออม) แต่ติดลบ/ตัวอักษร/วันเงินเดือน 0 และ 32 ถูกปฏิเสธ', () => {
    expect(settingsFromForm({ payDay: '', monthlySavingsGoal: '0', monthlyBudget: '' })).toEqual({ monthlySavingsGoal: 0 });
    for (const bad of [
      { payDay: '0', monthlySavingsGoal: '', monthlyBudget: '' },
      { payDay: '32', monthlySavingsGoal: '', monthlyBudget: '' },
      { payDay: '', monthlySavingsGoal: '-1', monthlyBudget: '' },
      { payDay: '', monthlySavingsGoal: 'abc', monthlyBudget: '' },
      { payDay: '', monthlySavingsGoal: '', monthlyBudget: '-0.01' },
    ]) {
      expect(() => settingsFromForm(bad)).toThrow(BillFormError);
    }
  });
  it('settingsToForm แปลงกลับ', () => {
    expect(settingsToForm({ payDay: 25, monthlySavingsGoal: 500_000 })).toEqual({
      payDay: '25',
      monthlySavingsGoal: '5,000.00',
      monthlyBudget: '',
    });
    expect(settingsToForm({})).toEqual({ payDay: '', monthlySavingsGoal: '', monthlyBudget: '' });
  });
});

describe('ขอบเขตเพิ่มเติม (R14) จากผลตรวจ money-auditor', () => {
  const f = (amount: string) => ({ name: 'บิล', amount, dueDay: '5', walletId: '', categoryId: '' });
  it('ปัดครึ่งออกจากศูนย์: .5 = 50 สตางค์, 0.005 = 1 สตางค์ ผ่าน; 0.004 = 0 ถูกปฏิเสธ', () => {
    expect(billFromForm(f('.5'), 'b').amount).toBe(50);
    expect(billFromForm(f('0.005'), 'b').amount).toBe(1);
    expect(() => billFromForm(f('0.004'), 'b')).toThrow(BillFormError);
  });
  it('+5 และ 1,234 ผ่าน', () => {
    expect(billFromForm(f('+5'), 'b').amount).toBe(500);
    expect(billFromForm(f('1,234'), 'b').amount).toBe(123_400);
  });
  it('ชิดขอบ: 90071992547409.91 ผ่าน, ...92 ใหญ่เกิน', () => {
    expect(billFromForm(f('90071992547409.91'), 'b').amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => billFromForm(f('90071992547409.92'), 'b')).toThrow(/ใหญ่เกินไป/);
  });
  it('เป้าออม -0 / -0.001 ได้ 0 ไม่ใช่ -0', () => {
    for (const v of ['-0', '-0.001']) {
      const s = settingsFromForm({ payDay: '', monthlySavingsGoal: v, monthlyBudget: '' });
      expect(Object.is(s.monthlySavingsGoal, 0)).toBe(true);
    }
  });
});
