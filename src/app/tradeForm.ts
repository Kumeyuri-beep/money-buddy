/**
 * ฟอร์มบันทึกรายการลงทุน → TradeRecord (พอร์ตลงทุน P3 · กฎ R9, R11, R17) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 * ตัวเลขเงินอ่านด้วย parseBahtToSatang (ไม่รับค่าติดลบ), หน่วย/ราคาด้วย parseUnits/parsePriceMicro (BigInt ไม่ผ่านทศนิยมลอยตัว)
 * ซื้อ: เงินที่ซื้อ + (หน่วยจากโบรกเกอร์ หรือ ราคา → คำนวณหน่วย ปัดครั้งเดียว) · ต้นทุนที่บันทึก = เงินที่ซื้อ + ค่าธรรมเนียม
 * ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน) เพื่อให้หน้าจอชี้ช่องที่ผิดได้
 */

import { hasCode, type ErrorParams } from '../domain/errors/coded';
import { dcaUnits } from '../domain/invest/dca';
import type { TradeKind, TradeRecord } from '../domain/invest/types';
import { parsePriceMicro, parseUnits } from '../domain/invest/units';
import { isSupportedEntryDate, lengthWithin, MAX_MEMO_LENGTH } from '../domain/ledger/limits';
import { parseBahtToSatang } from '../domain/money/satang';
import { formMsg } from './formMessages';

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
  /** ข้อความไทย (เดิม) */
  message: string;
  /** รหัส + พารามิเตอร์ให้ UI แปลเป็นภาษาอื่น (ไม่มี = error ต้นทางยังไม่มีรหัส) */
  code?: string;
  params?: ErrorParams;
}

export type TradeFormResult = { ok: true; trade: TradeRecord } | { ok: false; errors: TradeFormError[] };

const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/u;
const blank = (s: string): boolean => s.trim() === '';

export const emptyTradeForm = (assetId: string, kind: TradeKind, date: string): TradeForm => ({
  assetId, kind, date, units: '', price: '', amount: '', fee: '', withholding: '', memo: '',
});

export function buildTradeRecord(form: TradeForm, id: string, createdAt: string, today: string): TradeFormResult {
  const errors: TradeFormError[] = [];
  const err = (field: TradeField, code: Parameters<typeof formMsg>[0], params: ErrorParams = {}): void => void errors.push({ field, message: formMsg(code, params), code, params });
  /** error จากตัวอ่านหน่วย/ราคา/สูตร: มีรหัสให้ส่งต่อรหัสและพารามิเตอร์ · ไม่ใช่ Error = ข้อความสำรองของฟอร์ม */
  const errFrom = (field: TradeField, e: unknown, fallback: Parameters<typeof formMsg>[0]): void => {
    if (hasCode(e)) errors.push({ field, message: e.message, code: e.code, params: e.params });
    else if (e instanceof Error) errors.push({ field, message: e.message });
    else err(field, fallback);
  };

  if (!isSupportedEntryDate(form.date)) err('date', 'form.dateInvalid');
  else if (form.date > today) err('date', 'form.dateFuture');
  if (!lengthWithin(form.memo, 0, MAX_MEMO_LENGTH) || UNSAFE.test(form.memo.replace(/[\r\n\t]/g, ''))) {
    err('memo', 'form.memoInvalid', { max: MAX_MEMO_LENGTH });
  }

  const money = (field: TradeField, text: string, what: string, required: boolean, min: number): number | undefined => {
    if (blank(text)) {
      if (required) err(field, 'form.moneyRequired', { what });
      return undefined;
    }
    try {
      const v = parseBahtToSatang(text.replace(/฿/g, ''));
      if (v < min || /^\s*[+-]/.test(text)) {
        err(field, min >= 1 ? 'form.moneyPositive' : 'form.moneyNonNegative', { what });
        return undefined;
      }
      return v;
    } catch {
      err(field, 'form.moneyInvalid', { what });
      return undefined;
    }
  };
  const unitsOf = (text: string, required: boolean): bigint | undefined => {
    if (blank(text)) {
      if (required) err('units', 'form.unitsRequired');
      return undefined;
    }
    try {
      return parseUnits(text);
    } catch (e) {
      errFrom('units', e, 'form.unitsInvalid');
      return undefined;
    }
  };
  const priceOf = (required: boolean): number | undefined => {
    if (blank(form.price)) {
      if (required) err('price', 'form.priceRequired');
      return undefined;
    }
    try {
      return parsePriceMicro(form.price);
    } catch (e) {
      errFrom('price', e, 'form.priceInvalid');
      return undefined;
    }
  };
  const mustBeBlank = (field: TradeField, what: string): void => {
    if (!blank(form[field])) err(field, 'form.mustBeBlank', { what });
  };

  const base = { id, assetId: form.assetId, kind: form.kind, date: form.date, createdAt, memo: form.memo };
  let trade: TradeRecord | null = null;

  if (form.kind === 'buy') {
    const amount = money('amount', form.amount, 'buyAmount', true, 1);
    const fee = money('fee', form.fee, 'fee', false, 0) ?? 0;
    mustBeBlank('withholding', 'withholding');
    const enteredUnits = unitsOf(form.units, false);
    const price = priceOf(false);
    if (enteredUnits === undefined && price === undefined && blank(form.units) && blank(form.price)) {
      err('units', 'form.unitsOrPriceRequired');
    }
    let units = enteredUnits;
    if (units === undefined && price !== undefined && amount !== undefined) {
      try {
        units = dcaUnits(amount, price);
      } catch (e) {
        errFrom('amount', e, 'form.unitsCalcFailed');
      }
    }
    if (errors.length === 0 && amount !== undefined && units !== undefined) {
      trade = { ...base, units: units.toString(), amount, fee, withholding: 0 };
      if (price !== undefined) trade.priceMicro = price;
    }
  } else if (form.kind === 'sell') {
    const units = unitsOf(form.units, true);
    const price = priceOf(true);
    const fee = money('fee', form.fee, 'fee', false, 0) ?? 0;
    mustBeBlank('amount', 'amount');
    mustBeBlank('withholding', 'withholding');
    if (errors.length === 0 && units !== undefined && price !== undefined) {
      trade = { ...base, units: units.toString(), priceMicro: price, fee, withholding: 0 };
    }
  } else if (form.kind === 'dividend') {
    const amount = money('amount', form.amount, 'dividendAmount', true, 1);
    const withholding = money('withholding', form.withholding, 'withholding', false, 0) ?? 0;
    mustBeBlank('units', 'units');
    mustBeBlank('price', 'price');
    mustBeBlank('fee', 'fee');
    if (amount !== undefined && withholding >= amount) err('withholding', 'form.whtTooHigh');
    if (errors.length === 0 && amount !== undefined) trade = { ...base, amount, fee: 0, withholding };
  } else {
    // reinvest: หน่วยที่ได้เพิ่ม + ต้นทุนที่เพิ่ม (ยอดปันผลหลังหักภาษี) ไม่มีเงินสดเข้า-ออก
    const units = unitsOf(form.units, true);
    const amount = money('amount', form.amount, 'costAdded', true, 1);
    mustBeBlank('fee', 'fee');
    mustBeBlank('withholding', 'withholding');
    mustBeBlank('price', 'price');
    if (errors.length === 0 && units !== undefined && amount !== undefined) {
      trade = { ...base, units: units.toString(), amount, fee: 0, withholding: 0 };
    }
  }

  if (errors.length > 0 || trade === null) return { ok: false, errors };
  return { ok: true, trade };
}
