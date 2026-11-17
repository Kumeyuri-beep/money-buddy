import { describe, expect, it } from 'vitest';
import { buildTradeRecord, emptyTradeForm, type TradeForm } from '../../src/app/tradeForm';
import { buildFxExchange, buildUsTradeRecord, emptyFxExchangeForm, emptyUsTradeForm, parseFxRate, type FxExchangeForm, type UsTradeForm } from '../../src/app/usForms';

// golden: ข้อความไทยที่ต้องเหมือนเดิมทุกตัวอักษร (คัดลอกจากโค้ดก่อนเพิ่มรหัส)
const TODAY = '2026-11-13';
const NOW = '2026-11-13T03:00:00.000Z';
const tf = (kind: TradeForm['kind'], over: Partial<TradeForm>): TradeForm => ({ ...emptyTradeForm('a1', kind, '2026-11-03'), ...over });
const errs = (f: TradeForm) => {
  const r = buildTradeRecord(f, 'x', NOW, TODAY);
  return r.ok ? [] : r.errors.map((e) => `${e.field}: ${e.message}`);
};
const usErrs = (f: UsTradeForm) => {
  const r = buildUsTradeRecord(f, 'x', NOW, TODAY);
  return r.ok ? [] : r.errors.map((e) => `${e.field}: ${e.message}`);
};
const exErrs = (f: FxExchangeForm) => {
  const r = buildFxExchange(f, 'x', NOW, TODAY);
  return r.ok ? [] : r.errors.map((e) => `${e.field}: ${e.message}`);
};

describe('golden ข้อความไทย tradeForm', () => {
  it('วันที่/หมายเหตุ', () => {
    expect(errs(tf('dividend', { date: '2026-13-40', amount: '10' }))).toEqual(['date: วันที่ไม่ถูกต้อง (YYYY-MM-DD ปี 1900-2999)']);
    expect(errs(tf('dividend', { date: '2026-11-14', amount: '10' }))).toEqual(['date: บันทึกวันที่ในอนาคตไม่ได้']);
    expect(errs(tf('dividend', { amount: '10', memo: 'a'.repeat(2001) }))).toEqual(['memo: หมายเหตุยาวไม่เกิน 2000 ตัวอักษร และห้ามมีอักขระควบคุม']);
  });
  it('ซื้อ: ว่าง/รูปแบบเงิน/หน่วย/ราคา', () => {
    expect(errs(tf('buy', {}))).toEqual(['amount: กรอกเงินที่ซื้อ', 'units: กรอกจำนวนหน่วย หรือกรอกราคาต่อหน่วยให้ระบบคำนวณหน่วยให้']);
    expect(errs(tf('buy', { amount: '0', units: '1' }))).toEqual(['amount: เงินที่ซื้อต้องมากกว่า 0 (อย่างน้อย 0.01 บาท)']);
    expect(errs(tf('buy', { amount: '-5', units: '1' }))).toEqual(['amount: เงินที่ซื้อต้องมากกว่า 0 (อย่างน้อย 0.01 บาท)']);
    expect(errs(tf('buy', { amount: 'abc', units: '1' }))).toEqual(['amount: เงินที่ซื้อไม่ถูกต้อง']);
    expect(errs(tf('buy', { amount: '10', units: '1', fee: '-1' }))).toEqual(['fee: ค่าธรรมเนียมต้องไม่ติดลบ']);
    expect(errs(tf('buy', { amount: '10', units: '1', fee: 'x' }))).toEqual(['fee: ค่าธรรมเนียมไม่ถูกต้อง']);
    expect(errs(tf('buy', { amount: '10', units: '1', withholding: '1' }))).toEqual(['withholding: ภาษีหัก ณ ที่จ่ายใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)']);
    expect(errs(tf('buy', { amount: '10', units: 'abc' }))).toEqual(['units: อ่านจำนวนหน่วยไม่ได้: "abc"']);
    expect(errs(tf('buy', { amount: '10', units: '0' }))).toEqual(['units: จำนวนหน่วยต้องมากกว่า 0 (ละเอียดสุด 8 ตำแหน่ง)']);
    expect(errs(tf('buy', { amount: '10', units: '99999999999999999999' }))).toEqual(['units: จำนวนหน่วยมากเกินช่วงที่รองรับ']);
    expect(errs(tf('buy', { amount: '10', price: '0' }))).toEqual(['price: ราคาต้องมากกว่า 0 (ละเอียดสุด 0.000001 บาท)']);
    expect(errs(tf('buy', { amount: '10', price: 'abc' }))).toEqual(['price: อ่านราคาไม่ได้: "abc"']);
    expect(errs(tf('buy', { amount: '0.01', price: '99999999' }))).toEqual(['amount: จำนวนเงินน้อยเกินไปจนได้หน่วยเป็น 0']);
  });
  it('ขาย/ปันผล/ลงทุนต่อ', () => {
    expect(errs(tf('sell', {}))).toEqual(['units: กรอกจำนวนหน่วย', 'price: กรอกราคาต่อหน่วย']);
    expect(errs(tf('sell', { units: '1', price: '1', amount: '5' }))).toEqual(['amount: จำนวนเงินใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)']);
    expect(errs(tf('dividend', { amount: '', units: '1', price: '1', fee: '1' }))).toEqual([
      'amount: กรอกยอดปันผล', 'units: จำนวนหน่วยใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)', 'price: ราคาใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)', 'fee: ค่าธรรมเนียมใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)',
    ]);
    expect(errs(tf('dividend', { amount: '10', withholding: '10' }))).toEqual(['withholding: ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดปันผล']);
    expect(errs(tf('dividend', { amount: '10', withholding: '-1' }))).toEqual(['withholding: ภาษีหัก ณ ที่จ่ายต้องไม่ติดลบ']);
    expect(errs(tf('reinvest', { fee: '1', withholding: '1', price: '1' }))).toEqual([
      'units: กรอกจำนวนหน่วย', 'amount: กรอกต้นทุนที่เพิ่ม (ปันผลหลังหักภาษี)', 'fee: ค่าธรรมเนียมใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)',
      'withholding: ภาษีหัก ณ ที่จ่ายใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)', 'price: ราคาใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)',
    ]);
    expect(errs(tf('reinvest', { units: '1', amount: '0' }))).toEqual(['amount: ต้นทุนที่เพิ่ม (ปันผลหลังหักภาษี)ต้องมากกว่า 0 (อย่างน้อย 0.01 บาท)']);
  });
});

describe('golden ข้อความไทย usForms', () => {
  const uf = (kind: UsTradeForm['kind'], over: Partial<UsTradeForm>): UsTradeForm => ({ ...emptyUsTradeForm('u1', kind, '2026-11-03', '35'), ...over });
  it('ข้อความเงินเป็นดอลลาร์ + อัตรา', () => {
    expect(usErrs(uf('buy', { amount: '0', units: '1' }))).toEqual(['amount: เงินที่ซื้อต้องมากกว่า 0 (อย่างน้อย 0.01 ดอลลาร์)']);
    expect(usErrs(uf('buy', { amount: '10', units: '1', fxRate: '' }))).toEqual(['fxRate: กรอกอัตราแลกเปลี่ยน (บาทต่อ 1 ดอลลาร์)']);
    expect(usErrs(uf('buy', { amount: '10', units: '1', fxRate: 'abc' }))).toEqual(['fxRate: อัตราแลกเปลี่ยนไม่ถูกต้อง (ต้องมากกว่า 0 ละเอียดสุด 6 ตำแหน่ง)']);
    expect(usErrs(uf('sell', { units: '1' }))).toEqual(['price: กรอกราคาต่อหน่วย']);
    expect(usErrs(uf('dividend', { amount: '10', withholding: '10' }))).toEqual(['withholding: ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดปันผล']);
    expect(usErrs(uf('buy', { amount: '10', price: '0' }))).toEqual(['price: ราคาต้องมากกว่า 0 (ละเอียดสุด 0.000001 ดอลลาร์)']);
  });
  it('parseFxRate', () => {
    expect(parseFxRate('')).toMatchObject({ ok: false, message: 'กรอกอัตราแลกเปลี่ยน (บาทต่อ 1 ดอลลาร์)' });
    expect(parseFxRate('0')).toMatchObject({ ok: false, message: 'อัตราแลกเปลี่ยนไม่ถูกต้อง (ต้องมากกว่า 0 ละเอียดสุด 6 ตำแหน่ง)' });
  });
  it('แลกเงิน', () => {
    const f = (over: Partial<FxExchangeForm>): FxExchangeForm => ({ ...emptyFxExchangeForm('2026-11-03'), ...over });
    expect(exErrs(f({}))).toEqual(['thb: กรอกจำนวนเงินบาท', 'usd: กรอกจำนวนดอลลาร์']);
    expect(exErrs(f({ thb: '-1', usd: '+1' }))).toEqual(['thb: จำนวนเงินบาทต้องมากกว่า 0', 'usd: จำนวนดอลลาร์ต้องมากกว่า 0']);
    expect(exErrs(f({ thb: '0', usd: 'x' }))).toEqual(['thb: จำนวนเงินบาทต้องมากกว่า 0 (อย่างน้อย 0.01)', 'usd: จำนวนดอลลาร์ไม่ถูกต้อง']);
    expect(exErrs(f({ date: '2026-11-14', thb: '1', usd: '1', memo: 'a'.repeat(2001) }))).toEqual(['date: บันทึกวันที่ในอนาคตไม่ได้', 'memo: หมายเหตุยาวไม่เกิน 2000 ตัวอักษร']);
    expect(exErrs(f({ date: 'x', thb: '1', usd: '1' }))).toEqual(['date: วันที่ไม่ถูกต้อง (YYYY-MM-DD ปี 1900-2999)']);
  });
});
