/**
 * ฟอร์มหุ้นสหรัฐและแลกเงิน → record (A3-2 · R20) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 * ตัวเลข USD อ่านด้วยตัวอ่านเดียวกับเงินบาท (ทศนิยม 2 ตำแหน่ง = เซนต์ · ไม่ผ่านทศนิยมลอยตัว) จึงใช้ buildTradeRecord ซ้ำ
 * อัตราแลกเปลี่ยน (บาทต่อ 1 USD) อ่านด้วย parsePriceMicro ละเอียดสุด 6 ตำแหน่ง · ข้อผิดพลาดคืนเป็นรายช่อง (ไม่โยน)
 */

import { hasCode, type ErrorParams } from '../domain/errors/coded';
import { assertFxRateMicro, fxRateFromExchange } from '../domain/invest/fx';
import type { FxDirection, FxExchangeRecord, TradeRecord } from '../domain/invest/types';
import { parsePriceMicro } from '../domain/invest/units';
import { isSupportedEntryDate, lengthWithin, MAX_MEMO_LENGTH } from '../domain/ledger/limits';
import { parseBahtToSatang } from '../domain/money/satang';
import { formMsg } from './formMessages';
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
  /** ข้อความไทย (เดิม) */
  message: string;
  /** รหัส + พารามิเตอร์ให้ UI แปลเป็นภาษาอื่น (ไม่มี = error ต้นทางยังไม่มีรหัส) */
  code?: string;
  params?: ErrorParams;
}
type FormCode = Parameters<typeof formMsg>[0];
export type UsTradeFormResult = { ok: true; trade: TradeRecord } | { ok: false; errors: UsFormError<UsTradeField>[] };

export const emptyUsTradeForm = (assetId: string, kind: UsTradeKind, date: string, fxRate = ''): UsTradeForm => ({
  ...emptyTradeForm(assetId, kind, date), kind, fxRate,
});

const blank = (s: string): boolean => s.trim() === '';
/** ข้อความของตัวอ่านเงินบาทเขียนว่า "บาท" ฟอร์มนี้เป็น USD */
const usdWording = (m: string): string => m.replace(/บาท/g, 'ดอลลาร์');

/** อัตราแลกเปลี่ยน (ข้อความ) → micro · ผิด = null พร้อมข้อความ */
export function parseFxRate(text: string): { ok: true; rateMicro: number } | { ok: false; message: string; code: string; params: ErrorParams } {
  if (blank(text)) return { ok: false, message: formMsg('form.fxRateRequired'), code: 'form.fxRateRequired', params: {} };
  try {
    const rateMicro = parsePriceMicro(text);
    assertFxRateMicro(rateMicro);
    return { ok: true, rateMicro };
  } catch {
    return { ok: false, message: formMsg('form.fxRateInvalid'), code: 'form.fxRateInvalid', params: {} };
  }
}

export function buildUsTradeRecord(form: UsTradeForm, id: string, createdAt: string, today: string): UsTradeFormResult {
  const errors: UsFormError<UsTradeField>[] = [];
  const base = buildTradeRecord({ ...form }, id, createdAt, today);
  if (!base.ok) for (const e of base.errors) errors.push({ field: e.field, message: usdWording(e.message), ...(e.code !== undefined ? { code: e.code, params: { ...e.params, ccy: 'USD' } } : {}) });
  const fx = parseFxRate(form.fxRate);
  if (!fx.ok) errors.push({ field: 'fxRate', message: fx.message, code: fx.code, params: fx.params });
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
  const err = (field: FxExchangeField, code: FormCode, params: ErrorParams = {}): void => void errors.push({ field, message: formMsg(code, params), code, params });
  if (!isSupportedEntryDate(form.date)) err('date', 'form.dateInvalid');
  else if (form.date > today) err('date', 'form.dateFuture');
  if (!lengthWithin(form.memo, 0, MAX_MEMO_LENGTH)) err('memo', 'form.memoTooLong', { max: MAX_MEMO_LENGTH });
  const minor = (field: 'thb' | 'usd', text: string, what: string): number | undefined => {
    if (blank(text)) return void err(field, 'form.fxMinorRequired', { what });
    if (/^\s*[+-]/.test(text)) return void err(field, 'form.fxMinorPositive', { what });
    try {
      const v = parseBahtToSatang(text.replace(/\$/g, ''));
      if (v < 1) return void err(field, 'form.fxMinorMin', { what });
      return v;
    } catch {
      return void err(field, 'form.fxMinorInvalid', { what });
    }
  };
  const thbSatang = minor('thb', form.thb, 'thb');
  const usdCents = minor('usd', form.usd, 'usd');
  let rateMicro = 0;
  if (thbSatang !== undefined && usdCents !== undefined) {
    try {
      rateMicro = fxRateFromExchange(thbSatang, usdCents);
    } catch (e) {
      if (hasCode(e)) errors.push({ field: 'usd', message: e.message, code: e.code, params: e.params });
      else if (e instanceof Error) errors.push({ field: 'usd', message: e.message });
      else err('usd', 'form.fxRateCalcFailed');
    }
  }
  if (errors.length > 0 || thbSatang === undefined || usdCents === undefined) return { ok: false, errors };
  return { ok: true, rateMicro, exchange: { id, date: form.date, createdAt, direction: form.direction, thbSatang, usdCents, memo: form.memo } };
}
