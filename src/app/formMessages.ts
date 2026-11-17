/**
 * แม่แบบข้อความ error ของฟอร์มลงทุน (tradeForm, usForms) · ไทย = ข้อความเดิมทุกตัวอักษร · อังกฤษใช้ในโหมด /invest
 * `what` = รหัสชื่อช่อง (ไม่ใช่ข้อความ) เพื่อให้แต่ละภาษาเลือกคำเรียกของตัวเอง · `ccy` = 'THB' | 'USD' (ฟอร์มหุ้นสหรัฐส่ง USD)
 * ฟังก์ชันล้วน ไม่คำนวณเงิน
 */

import { defineMessages, type ErrorParams } from '../domain/errors/coded';

const LABEL_TH: Record<string, string> = {
  buyAmount: 'เงินที่ซื้อ',
  fee: 'ค่าธรรมเนียม',
  dividendAmount: 'ยอดปันผล',
  withholding: 'ภาษีหัก ณ ที่จ่าย',
  costAdded: 'ต้นทุนที่เพิ่ม (ปันผลหลังหักภาษี)',
  amount: 'จำนวนเงิน',
  units: 'จำนวนหน่วย',
  price: 'ราคา',
  thb: 'จำนวนเงินบาท',
  usd: 'จำนวนดอลลาร์',
};
const LABEL_EN: Record<string, string> = {
  buyAmount: 'amount invested',
  fee: 'fee',
  dividendAmount: 'dividend amount',
  withholding: 'withholding tax',
  costAdded: 'cost added (dividend after tax)',
  amount: 'amount',
  units: 'units',
  price: 'price',
  thb: 'THB amount',
  usd: 'USD amount',
};
const th = (p: ErrorParams): string => LABEL_TH[String(p.what)] ?? String(p.what);
const en = (p: ErrorParams): string => LABEL_EN[String(p.what)] ?? String(p.what);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const ccy = (p: ErrorParams): string => (p.ccy === 'USD' ? 'USD' : 'THB');

export const formMsg = defineMessages({
  'form.dateInvalid': { th: () => 'วันที่ไม่ถูกต้อง (YYYY-MM-DD ปี 1900-2999)', en: () => 'Invalid date. Use YYYY-MM-DD, years 1900-2999.' },
  'form.dateFuture': { th: () => 'บันทึกวันที่ในอนาคตไม่ได้', en: () => 'Cannot record a future date.' },
  'form.memoInvalid': {
    th: (p) => `หมายเหตุยาวไม่เกิน ${p.max} ตัวอักษร และห้ามมีอักขระควบคุม`,
    en: (p) => `Note can be at most ${p.max} characters and cannot contain control characters.`,
  },
  'form.memoTooLong': { th: (p) => `หมายเหตุยาวไม่เกิน ${p.max} ตัวอักษร`, en: (p) => `Note can be at most ${p.max} characters.` },
  'form.moneyRequired': { th: (p) => `กรอก${th(p)}`, en: (p) => `Enter the ${en(p)}.` },
  'form.moneyPositive': {
    th: (p) => `${th(p)}ต้องมากกว่า 0 (อย่างน้อย 0.01 บาท)`,
    en: (p) => `${cap(en(p))} must be greater than 0 (at least 0.01 ${ccy(p)}).`,
  },
  'form.moneyNonNegative': { th: (p) => `${th(p)}ต้องไม่ติดลบ`, en: (p) => `${cap(en(p))} cannot be negative.` },
  'form.moneyInvalid': { th: (p) => `${th(p)}ไม่ถูกต้อง`, en: (p) => `${cap(en(p))} is not valid.` },
  'form.unitsRequired': { th: () => 'กรอกจำนวนหน่วย', en: () => 'Enter the number of units.' },
  'form.unitsInvalid': { th: () => 'จำนวนหน่วยไม่ถูกต้อง', en: () => 'The number of units is not valid.' },
  'form.priceRequired': { th: () => 'กรอกราคาต่อหน่วย', en: () => 'Enter the price per unit.' },
  'form.priceInvalid': { th: () => 'ราคาไม่ถูกต้อง', en: () => 'The price is not valid.' },
  'form.unitsOrPriceRequired': {
    th: () => 'กรอกจำนวนหน่วย หรือกรอกราคาต่อหน่วยให้ระบบคำนวณหน่วยให้',
    en: () => 'Enter the number of units, or enter the price per unit and the units will be calculated for you.',
  },
  'form.unitsCalcFailed': { th: () => 'คำนวณหน่วยไม่ได้', en: () => 'Could not calculate the units.' },
  'form.mustBeBlank': { th: (p) => `${th(p)}ใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)`, en: (p) => `${cap(en(p))} does not apply to this type of transaction. Leave it blank.` },
  'form.whtTooHigh': { th: () => 'ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดปันผล', en: () => 'Withholding tax must be less than the dividend amount.' },
  'form.fxRateRequired': { th: () => 'กรอกอัตราแลกเปลี่ยน (บาทต่อ 1 ดอลลาร์)', en: () => 'Enter the exchange rate (THB per 1 USD).' },
  'form.fxRateInvalid': {
    th: () => 'อัตราแลกเปลี่ยนไม่ถูกต้อง (ต้องมากกว่า 0 ละเอียดสุด 6 ตำแหน่ง)',
    en: () => 'The exchange rate is not valid. It must be greater than 0, with at most 6 decimal places.',
  },
  'form.fxMinorRequired': { th: (p) => `กรอก${th(p)}`, en: (p) => `Enter the ${en(p)}.` },
  'form.fxMinorPositive': { th: (p) => `${th(p)}ต้องมากกว่า 0`, en: (p) => `${cap(en(p))} must be greater than 0.` },
  'form.fxMinorMin': { th: (p) => `${th(p)}ต้องมากกว่า 0 (อย่างน้อย 0.01)`, en: (p) => `${cap(en(p))} must be greater than 0 (at least 0.01).` },
  'form.fxMinorInvalid': { th: (p) => `${th(p)}ไม่ถูกต้อง`, en: (p) => `${cap(en(p))} is not valid.` },
  'form.fxRateCalcFailed': { th: () => 'คำนวณอัตราไม่ได้', en: () => 'Could not calculate the exchange rate.' },
  'usp.valueTooLarge': {
    th: () => 'ตัวเลขใหญ่เกินช่วงที่รองรับ จึงคำนวณมูลค่าไม่ได้',
    en: () => 'The numbers are too large to support, so the value cannot be calculated.',
  },
  'usp.calcFailed': { th: () => 'คำนวณไม่ได้', en: () => 'Could not calculate.' },
});
