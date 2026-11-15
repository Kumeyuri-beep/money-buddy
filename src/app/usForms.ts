/**
 * ฟอร์มหุ้นสหรัฐและแลกเงิน → record (A3-2 · R20) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 * ตัวเลข USD อ่านด้วยตัวอ่านเดียวกับเงินบาท (ทศนิยม 2 ตำแหน่ง = เซนต์ · ไม่ผ่านทศนิยมลอยตัว) จึงใช้ buildTradeRecord ซ้ำ
 * อัตราแลกเปลี่ยน (บาทต่อ 1 USD) อ่านด้วย parsePriceMicro ละเอียดสุด 6 ตำแหน่ง · ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน)
 */

import { assertFxRateMicro, fxRateFromExchange } from '../domain/invest/fx';
import type { FxDirection, FxExchangeRecord, TradeRecord } from '../domain/invest/types';
import { parsePriceMicro } from '../domain/invest/units';
import { isSupportedEntryDate, lengthWithin, MAX_MEMO_LENGTH } from '../domain/ledger/limits';
import { parseBahtToSatang } from '../domain/money/satang';
import { buildTradeRecord, emptyTradeForm, type TradeField, type TradeForm } from './tradeForm';

export type UsTradeKind = 'buy' | 'sell' | 'dividend';

export interface UsTradeForm extends Omit<TradeForm, 'kind'> {
  kind: UsTradeKind;
  /** อัตราแลกเปลี่ยน บาทต่อ 1 USD ณ วันรายการ */
  fxRate: string;
}

export type UsTradeField = TradeField | 'fxRate';
export interface UsFormError<F extends string> {
  field: F;
  message: string;
}
export type UsTradeFormResult = { ok: true; trade: TradeRecord } | { ok: false; errors: UsFormError<UsTradeField>[] };

export const emptyUsTradeForm = (assetId: string, kind: UsTradeKind, date: string, fxRate = ''): UsTradeForm => ({
  ...emptyTradeForm(assetId, kind, date), kind, fxRate,
});

const blank = (s: string): boolean => s.trim() === '';
/** ข้อความของตัวอ่านเงินบาทเขียนว่า "บาท" ฟอร์มนี้เป็น USD */
const usdWording = (m: string): string => m.replace(/บาท/g, 'ดอลลาร์');

/** อัตราแลกเปลี่ยน (ข้อความ) → micro · ผิด = null พร้อมข้อความ */
export function parseFxRate(text: string): { ok: true; rateMicro: number } | { ok: false; message: string } {
  if (blank(text)) return { ok: false, message: 'กรอกอัตราแลกเปลี่ยน (บาทต่อ 1 ดอลลาร์)' };
  try {
    const rateMicro = parsePriceMicro(text);
    assertFxRateMicro(rateMicro);
    return { ok: true, rateMicro };
  } catch {
    return { ok: false, message: 'อัตราแลกเปลี่ยนไม่ถูกต้อง (ต้องมากกว่า 0 ละเอียดสุด 6 ตำแหน่ง)' };
  }
}

export function buildUsTradeRecord(form: UsTradeForm, id: string, createdAt: string, today: string): UsTradeFormResult {
  const errors: UsFormError<UsTradeField>[] = [];
  const base = buildTradeRecord({ ...form }, id, createdAt, today);
  if (!base.ok) for (const e of base.errors) errors.push({ field: e.field, message: usdWording(e.message) });
  const fx = parseFxRate(form.fxRate);
  if (!fx.ok) errors.push({ field: 'fxRate', message: fx.message });
  if (errors.length > 0 || !base.ok || !fx.ok) return { ok: false, errors };
  return { ok: true, trade: { ...base.trade, fxRateMicro: fx.rateMicro } };
}

export interface FxExchangeForm {
  date: string;
  direction: FxDirection;
  /** จำนวนบาท (จ่ายออกเมื่อ บาท→USD · ได้รับเมื่อ USD→บาท) */
  thb: string;
  /** จำนวนดอลลาร์ */
  usd: string;
  memo: string;
}
export type FxExchangeField = keyof FxExchangeForm;
export type FxExchangeFormResult =
  | { ok: true; exchange: Omit<FxExchangeRecord, 'rateMicro' | 'entryId'>; rateMicro: number }
  | { ok: false; errors: UsFormError<FxExchangeField>[] };

export const emptyFxExchangeForm = (date: string): FxExchangeForm => ({ date, direction: 'thb_to_usd', thb: '', usd: '', memo: '' });

export function buildFxExchange(form: FxExchangeForm, id: string, createdAt: string, today: string): FxExchangeFormResult {
  const errors: UsFormError<FxExchangeField>[] = [];
  const err = (field: FxExchangeField, message: string): void => void errors.push({ field, message });
  if (!isSupportedEntryDate(form.date)) err('date', 'วันที่ไม่ถูกต้อง (YYYY-MM-DD ปี 1900-2999)');
  else if (form.date > today) err('date', 'บันทึกวันที่ในอนาคตไม่ได้');
  if (!lengthWithin(form.memo, 0, MAX_MEMO_LENGTH)) err('memo', `หมายเหตุยาวไม่เกิน ${MAX_MEMO_LENGTH} ตัวอักษร`);
  const minor = (field: 'thb' | 'usd', text: string, label: string): number | undefined => {
    if (blank(text)) return void err(field, `กรอก${label}`);
    if (/^\s*[+-]/.test(text)) return void err(field, `${label}ต้องมากกว่า 0`);
    try {
      const v = parseBahtToSatang(text.replace(/\$/g, ''));
      if (v < 1) return void err(field, `${label}ต้องมากกว่า 0 (อย่างน้อย 0.01)`);
      return v;
    } catch {
      return void err(field, `${label}ไม่ถูกต้อง`);
    }
  };
  const thbSatang = minor('thb', form.thb, 'จำนวนเงินบาท');
  const usdCents = minor('usd', form.usd, 'จำนวนดอลลาร์');
  let rateMicro = 0;
  if (thbSatang !== undefined && usdCents !== undefined) {
    try {
      rateMicro = fxRateFromExchange(thbSatang, usdCents);
    } catch (e) {
      err('usd', e instanceof Error ? e.message : 'คำนวณอัตราไม่ได้');
    }
  }
  if (errors.length > 0 || thbSatang === undefined || usdCents === undefined) return { ok: false, errors };
  return { ok: true, rateMicro, exchange: { id, date: form.date, createdAt, direction: form.direction, thbSatang, usdCents, memo: form.memo } };
}
