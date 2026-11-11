/**
 * ฟอร์มบันทึกรายการลงทุน → TradeRecord (พอร์ตลงทุน P3 · กฎ R9, R11, R17) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 * ตัวเลขเงินอ่านด้วย parseBahtToSatang (ไม่รับค่าติดลบ), หน่วย/ราคาด้วย parseUnits/parsePriceMicro (BigInt ไม่ผ่านทศนิยมลอยตัว)
 * ซื้อ: เงินที่ซื้อ + (หน่วยจากโบรกเกอร์ หรือ ราคา → คำนวณหน่วย ปัดครั้งเดียว) · ต้นทุนที่บันทึก = เงินที่ซื้อ + ค่าธรรมเนียม
 * ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน) เพื่อให้หน้าจอชี้ช่องที่ผิดได้
 */

import { dcaUnits } from '../domain/invest/dca';
import type { TradeKind, TradeRecord } from '../domain/invest/types';
import { parsePriceMicro, parseUnits } from '../domain/invest/units';
import { isSupportedEntryDate, lengthWithin, MAX_MEMO_LENGTH } from '../domain/ledger/limits';
import { parseBahtToSatang } from '../domain/money/satang';

export interface TradeForm {
  assetId: string;
  kind: TradeKind;
  /** YYYY-MM-DD */
  date: string;
  units: string;
  /** ราคาต่อหน่วย (บาท) */
  price: string;
  /** ซื้อ = เงินที่ซื้อ · ปันผล = ยอดปันผล · ปันผลลงทุนต่อ = ต้นทุนที่เพิ่ม (หลังหักภาษี) (บาท) */
  amount: string;
  fee: string;
  withholding: string;
  memo: string;
}

export type TradeField = keyof TradeForm;

export interface TradeFormError {
  field: TradeField;
  message: string;
}

export type TradeFormResult = { ok: true; trade: TradeRecord } | { ok: false; errors: TradeFormError[] };

const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/u;
const blank = (s: string): boolean => s.trim() === '';

export const emptyTradeForm = (assetId: string, kind: TradeKind, date: string): TradeForm => ({
  assetId, kind, date, units: '', price: '', amount: '', fee: '', withholding: '', memo: '',
});

export function buildTradeRecord(form: TradeForm, id: string, createdAt: string, today: string): TradeFormResult {
  const errors: TradeFormError[] = [];
  const err = (field: TradeField, message: string): void => void errors.push({ field, message });

  if (!isSupportedEntryDate(form.date)) err('date', 'วันที่ไม่ถูกต้อง (YYYY-MM-DD ปี 1900-2999)');
  else if (form.date > today) err('date', 'บันทึกวันที่ในอนาคตไม่ได้');
  if (!lengthWithin(form.memo, 0, MAX_MEMO_LENGTH) || UNSAFE.test(form.memo.replace(/[\r\n\t]/g, ''))) {
    err('memo', `หมายเหตุยาวไม่เกิน ${MAX_MEMO_LENGTH} ตัวอักษร และห้ามมีอักขระควบคุม`);
  }

  const money = (field: TradeField, text: string, label: string, required: boolean, min: number): number | undefined => {
    if (blank(text)) {
      if (required) err(field, `กรอก${label}`);
      return undefined;
    }
    try {
      const v = parseBahtToSatang(text.replace(/฿/g, ''));
      if (v < min || /^\s*[+-]/.test(text)) {
        err(field, min >= 1 ? `${label}ต้องมากกว่า 0 (อย่างน้อย 0.01 บาท)` : `${label}ต้องไม่ติดลบ`);
        return undefined;
      }
      return v;
    } catch {
      err(field, `${label}ไม่ถูกต้อง`);
      return undefined;
    }
  };
  const unitsOf = (text: string, required: boolean): bigint | undefined => {
    if (blank(text)) {
      if (required) err('units', 'กรอกจำนวนหน่วย');
      return undefined;
    }
    try {
      return parseUnits(text);
    } catch (e) {
      err('units', e instanceof Error ? e.message : 'จำนวนหน่วยไม่ถูกต้อง');
      return undefined;
    }
  };
  const priceOf = (required: boolean): number | undefined => {
    if (blank(form.price)) {
      if (required) err('price', 'กรอกราคาต่อหน่วย');
      return undefined;
    }
    try {
      return parsePriceMicro(form.price);
    } catch (e) {
      err('price', e instanceof Error ? e.message : 'ราคาไม่ถูกต้อง');
      return undefined;
    }
  };
  const mustBeBlank = (field: TradeField, label: string): void => {
    if (!blank(form[field])) err(field, `${label}ใช้กับรายการชนิดนี้ไม่ได้ (เว้นว่าง)`);
  };

  const base = { id, assetId: form.assetId, kind: form.kind, date: form.date, createdAt, memo: form.memo };
  let trade: TradeRecord | null = null;

  if (form.kind === 'buy') {
    const amount = money('amount', form.amount, 'เงินที่ซื้อ', true, 1);
    const fee = money('fee', form.fee, 'ค่าธรรมเนียม', false, 0) ?? 0;
    mustBeBlank('withholding', 'ภาษีหัก ณ ที่จ่าย');
    const enteredUnits = unitsOf(form.units, false);
    const price = priceOf(false);
    if (enteredUnits === undefined && price === undefined && blank(form.units) && blank(form.price)) {
      err('units', 'กรอกจำนวนหน่วย หรือกรอกราคาต่อหน่วยให้ระบบคำนวณหน่วยให้');
    }
    let units = enteredUnits;
    if (units === undefined && price !== undefined && amount !== undefined) {
      try {
        units = dcaUnits(amount, price);
      } catch (e) {
        err('amount', e instanceof Error ? e.message : 'คำนวณหน่วยไม่ได้');
      }
    }
    if (errors.length === 0 && amount !== undefined && units !== undefined) {
      trade = { ...base, units: units.toString(), amount, fee, withholding: 0 };
      if (price !== undefined) trade.priceMicro = price;
    }
  } else if (form.kind === 'sell') {
    const units = unitsOf(form.units, true);
    const price = priceOf(true);
    const fee = money('fee', form.fee, 'ค่าธรรมเนียม', false, 0) ?? 0;
    mustBeBlank('amount', 'จำนวนเงิน');
    mustBeBlank('withholding', 'ภาษีหัก ณ ที่จ่าย');
    if (errors.length === 0 && units !== undefined && price !== undefined) {
      trade = { ...base, units: units.toString(), priceMicro: price, fee, withholding: 0 };
    }
  } else if (form.kind === 'dividend') {
    const amount = money('amount', form.amount, 'ยอดปันผล', true, 1);
    const withholding = money('withholding', form.withholding, 'ภาษีหัก ณ ที่จ่าย', false, 0) ?? 0;
    mustBeBlank('units', 'จำนวนหน่วย');
    mustBeBlank('price', 'ราคา');
    mustBeBlank('fee', 'ค่าธรรมเนียม');
    if (amount !== undefined && withholding >= amount) err('withholding', 'ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดปันผล');
    if (errors.length === 0 && amount !== undefined) trade = { ...base, amount, fee: 0, withholding };
  } else {
    // reinvest: หน่วยที่ได้เพิ่ม + ต้นทุนที่เพิ่ม (ยอดปันผลหลังหักภาษี) ไม่มีเงินสดเข้า-ออก
    const units = unitsOf(form.units, true);
    const amount = money('amount', form.amount, 'ต้นทุนที่เพิ่ม (ปันผลหลังหักภาษี)', true, 1);
    mustBeBlank('fee', 'ค่าธรรมเนียม');
    mustBeBlank('withholding', 'ภาษีหัก ณ ที่จ่าย');
    mustBeBlank('price', 'ราคา');
    if (errors.length === 0 && units !== undefined && amount !== undefined) {
      trade = { ...base, units: units.toString(), amount, fee: 0, withholding: 0 };
    }
  }

  if (errors.length > 0 || trade === null) return { ok: false, errors };
  return { ok: true, trade };
}
