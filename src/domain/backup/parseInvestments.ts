/**
 * ตรวจข้อมูลลงทุนในไฟล์สำรอง (ฟิลด์ `investments`) · ไม่เชื่อข้อมูล: ตรวจรูปแบบเท่ากับ check ของฐานข้อมูล
 * (migration 20261111000100) และเล่นซ้ำรายการต่อสินทรัพย์ตามกฎ R17 เพื่อจับขายเกินที่ถือก่อนส่งขึ้นฐานข้อมูล
 * ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 */

import { CATEGORY_PROBLEM_TEXT, categoriesProblem, validSector } from '../invest/categories';
import { replayTrades, type Trade } from '../invest/costBasis';
import { replayTradesFx, type TradeFx } from '../invest/costBasisFx';
import { exchangeEntryProblem, exchangeRateProblem } from '../invest/fxExchange';
import {
  ASSET_KINDS,
  FX_DIRECTIONS,
  INSTRUMENT_EXCHANGES,
  MAX_ASSETS,
  MAX_CATEGORIES,
  MAX_FX_EXCHANGES,
  MAX_FX_RATES,
  MAX_PRICES,
  MAX_TRADES,
  TRADE_KINDS,
  type Asset,
  type AssetCategory,
  type AssetPrice,
  type FxDirection,
  type FxExchangeRecord,
  type FxRateRecord,
  type InstrumentCurrency,
  type InvestmentData,
  type TradeKind,
  type TradeRecord,
} from '../invest/types';
import { MAX_UNITS, valueInSatang } from '../invest/units';
import { isSupportedEntryDate, lengthWithin, MAX_ID_LENGTH, MAX_MEMO_LENGTH, MAX_NAME_LENGTH } from '../ledger/limits';
import type { Account, Entry } from '../ledger/types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const UNSAFE_TEXT = /[\p{Cc}‪-‮⁦-⁩]/u;
const UNITS_TEXT = /^[1-9][0-9]{0,18}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
/** เวลาบันทึก ISO มีเขตเวลา (ไม่รับแบบไม่มี Z ที่ตีความตามเครื่อง) ปี 1900-2999 */
const ISO_INSTANT = /^(19|2[0-9])\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/;
const validInstant = (v: unknown): v is string => typeof v === 'string' && ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v));
const short = (v: unknown): string => {
  const s = typeof v === 'string' ? v : String(v);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
};

const isSafeInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= MAX_SAFE;
const validUnits = (v: unknown): v is string => typeof v === 'string' && UNITS_TEXT.test(v) && BigInt(v) <= MAX_UNITS;

export function parseInvestments(
  raw: unknown,
  accounts: readonly Account[],
  entries: readonly Entry[],
  add: (message: string) => void,
): InvestmentData {
  const out: InvestmentData = { assets: [], trades: [], prices: [] };
  if (raw === undefined) return out;
  if (!isObject(raw)) {
    add('investments ต้องเป็นวัตถุ');
    return out;
  }
  const KEYS = ['categories', 'assets', 'trades', 'prices', 'fxRates', 'fxExchanges'] as const;
  for (const key of KEYS) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) add(`investments.${key} ต้องเป็นอาร์เรย์`);
  }
  if (!KEYS.every((k) => raw[k] === undefined || Array.isArray(raw[k]))) return out;
  const rawCategories = (raw.categories ?? []) as unknown[];
  const rawAssets = (raw.assets ?? []) as unknown[];
  const rawTrades = (raw.trades ?? []) as unknown[];
  const rawPrices = (raw.prices ?? []) as unknown[];
  const rawFxRates = (raw.fxRates ?? []) as unknown[];
  const rawFxExchanges = (raw.fxExchanges ?? []) as unknown[];
  if (rawCategories.length > MAX_CATEGORIES) add(`มีหมวดมากเกินไป (${rawCategories.length} เกิน ${MAX_CATEGORIES})`);
  if (rawAssets.length > MAX_ASSETS) add(`มีสินทรัพย์มากเกินไป (${rawAssets.length} เกิน ${MAX_ASSETS})`);
  if (rawTrades.length > MAX_TRADES) add(`มีรายการลงทุนมากเกินไป (${rawTrades.length} เกิน ${MAX_TRADES})`);
  if (rawPrices.length > MAX_PRICES) add(`มีราคามากเกินไป (${rawPrices.length} เกิน ${MAX_PRICES})`);
  if (rawFxRates.length > MAX_FX_RATES) add(`มีอัตราแลกเปลี่ยนมากเกินไป (${rawFxRates.length} เกิน ${MAX_FX_RATES})`);
  if (rawFxExchanges.length > MAX_FX_EXCHANGES) add(`มีรายการแลกเงินมากเกินไป (${rawFxExchanges.length} เกิน ${MAX_FX_EXCHANGES})`);
  if (
    rawCategories.length > MAX_CATEGORIES ||
    rawAssets.length > MAX_ASSETS ||
    rawTrades.length > MAX_TRADES ||
    rawPrices.length > MAX_PRICES ||
    rawFxRates.length > MAX_FX_RATES ||
    rawFxExchanges.length > MAX_FX_EXCHANGES
  ) {
    return out;
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const entryIds = new Set(entries.map((e) => e.id));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const assetCurrencyById = new Map<string, InstrumentCurrency>();

  // ---- หมวด (Categories R2) ----
  const categoryIds = new Set<string>();
  const categories: AssetCategory[] = [];
  let categoriesShapeOk = true;
  rawCategories.forEach((item, i) => {
    const label = `หมวดที่ ${i + 1}`;
    if (!isObject(item)) {
      categoriesShapeOk = false;
      return add(`${label}: ไม่ใช่วัตถุ`);
    }
    const { id, name, targetBps, sortOrder } = item;
    if (typeof id !== 'string' || typeof name !== 'string') {
      categoriesShapeOk = false;
      return add(`${label}: ต้องมี id และ name เป็นข้อความ`);
    }
    if (targetBps !== undefined && targetBps !== null && typeof targetBps !== 'number') {
      categoriesShapeOk = false;
      return add(`${label} (${short(id)}): targetBps ต้องเป็นจำนวนเต็มหรือไม่ใส่`);
    }
    if (sortOrder !== undefined && typeof sortOrder !== 'number') {
      categoriesShapeOk = false;
      return add(`${label} (${short(id)}): sortOrder ต้องเป็นจำนวนเต็มหรือไม่ใส่`);
    }
    categories.push({ id, name, targetBps: typeof targetBps === 'number' ? targetBps : null, sortOrder: typeof sortOrder === 'number' ? sortOrder : i });
  });
  if (categoriesShapeOk) {
    const problem = categoriesProblem(categories);
    if (problem !== null) add(`ข้อมูลหมวดไม่ถูกต้อง: ${CATEGORY_PROBLEM_TEXT[problem].th}`);
    else for (const c of categories) categoryIds.add(c.id);
  }

  // ---- สินทรัพย์ ----
  const assetIds = new Set<string>();
  const assetAccounts = new Set<string>();
  rawAssets.forEach((item, i) => {
    const label = `สินทรัพย์ที่ ${i + 1}`;
    if (!isObject(item)) return add(`${label}: ไม่ใช่วัตถุ`);
    const { id, name, kind, accountId, archived, currency, ticker, exchange, sector, categoryId } = item;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof kind !== 'string' || typeof accountId !== 'string') {
      return add(`${label}: ต้องมี id, name, kind, accountId เป็นข้อความ`);
    }
    if (!lengthWithin(id, 1, MAX_ID_LENGTH) || !lengthWithin(name, 1, MAX_NAME_LENGTH)) {
      return add(`${label} (${short(id)}): รหัสยาว 1-${MAX_ID_LENGTH} ชื่อยาว 1-${MAX_NAME_LENGTH} ตัวอักษร`);
    }
    if (UNSAFE_TEXT.test(id) || UNSAFE_TEXT.test(name)) return add(`${label} (${short(id)}): รหัส/ชื่อมีอักขระควบคุม`);
    if (!(ASSET_KINDS as readonly string[]).includes(kind)) return add(`${label} (${short(id)}): ชนิดสินทรัพย์ไม่ถูกต้อง`);
    if (archived !== undefined && typeof archived !== 'boolean') return add(`${label} (${short(id)}): archived ต้องเป็นจริง/เท็จ`);
    if (currency !== undefined && currency !== 'THB' && currency !== 'USD') return add(`${label} (${short(id)}): สกุลของสินทรัพย์ต้องเป็น THB หรือ USD`);
    const cur: InstrumentCurrency = currency === 'USD' ? 'USD' : 'THB';
    if (ticker !== undefined && (typeof ticker !== 'string' || !lengthWithin(ticker, 1, 20) || UNSAFE_TEXT.test(ticker))) {
      return add(`${label} (${short(id)}): ชื่อย่อหุ้นต้องยาว 1-20 ตัวอักษร ไม่มีอักขระควบคุม`);
    }
    if (exchange !== undefined && (typeof exchange !== 'string' || !INSTRUMENT_EXCHANGES.includes(exchange))) {
      return add(`${label} (${short(id)}): ตลาดต้องเป็นหนึ่งใน ${INSTRUMENT_EXCHANGES.join(', ')}`);
    }
    if (sector !== undefined && !validSector(sector)) {
      return add(`${label} (${short(id)}): sector ต้องยาว 1-60 ตัวอักษร ไม่มีช่องว่างหน้าหลังหรืออักขระควบคุม`);
    }
    if (categoryId !== undefined && (typeof categoryId !== 'string' || !categoryIds.has(categoryId))) {
      return add(`${label} (${short(id)}): categoryId ไม่ตรงกับหมวดในไฟล์`);
    }
    const account = accountById.get(accountId);
    if (!account || account.kind !== 'investment' || account.type !== 'asset' || account.currency !== cur) {
      return add(`${label} (${short(id)}): ต้องผูกกับบัญชีลงทุน${cur === 'USD' ? 'สกุล USD' : 'สกุลบาท'}ที่มีอยู่ในไฟล์ (บัญชี ${short(accountId)})`);
    }
    if (assetIds.has(id)) return add(`สินทรัพย์ซ้ำ: ${short(id)}`);
    if (assetAccounts.has(accountId)) return add(`บัญชีลงทุน ${short(accountId)} ถูกใช้กับหลายสินทรัพย์ (ซ้ำ)`);
    assetIds.add(id);
    assetAccounts.add(accountId);
    assetCurrencyById.set(id, cur);
    const asset: Asset = { id, name, kind: kind as Asset['kind'], accountId };
    if (archived === true) asset.archived = true;
    if (cur === 'USD') asset.currency = 'USD';
    if (typeof ticker === 'string') asset.ticker = ticker;
    if (typeof exchange === 'string') asset.exchange = exchange;
    if (typeof sector === 'string') asset.sector = sector;
    if (typeof categoryId === 'string') asset.categoryId = categoryId;
    out.assets.push(asset);
  });

  // ---- รายการลงทุน ----
  const tradeIds = new Set<string>();
  rawTrades.forEach((item, i) => {
    const label = `รายการลงทุนที่ ${i + 1}`;
    if (!isObject(item)) return add(`${label}: ไม่ใช่วัตถุ`);
    const { id, assetId, kind, date, units, priceMicro, amount, entryId, fxRateMicro } = item;
    const createdAt = item.createdAt;
    const memo = item.memo ?? '';
    const fee = item.fee ?? 0;
    const withholding = item.withholding ?? 0;
    if (typeof id !== 'string' || typeof assetId !== 'string' || typeof kind !== 'string' || typeof date !== 'string') {
      return add(`${label}: ต้องมี id, assetId, kind, date เป็นข้อความ`);
    }
    const tag = `${label} (${short(id)})`;
    if (!lengthWithin(id, 1, MAX_ID_LENGTH) || UNSAFE_TEXT.test(id)) return add(`${tag}: รหัสไม่ถูกต้อง`);
    if (tradeIds.has(id)) return add(`รายการลงทุนซ้ำ: ${short(id)}`);
    if (!assetIds.has(assetId)) return add(`${tag}: ไม่พบสินทรัพย์ ${short(assetId)}`);
    if (!(TRADE_KINDS as readonly string[]).includes(kind)) return add(`${tag}: ชนิดรายการไม่ถูกต้อง`);
    if (!isSupportedEntryDate(date)) return add(`${tag}: วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD ปี 1900-2999)`);
    if (typeof memo !== 'string' || !lengthWithin(memo, 0, MAX_MEMO_LENGTH) || UNSAFE_TEXT.test(memo.replace(/[\r\n\t]/g, ''))) {
      return add(`${tag}: หมายเหตุไม่ถูกต้อง (ไม่เกิน ${MAX_MEMO_LENGTH} ตัวอักษร ไม่มีอักขระควบคุม)`);
    }
    if (createdAt !== undefined && !validInstant(createdAt)) {
      return add(`${tag}: createdAt ต้องเป็นเวลา ISO มีเขตเวลา เช่น 2026-11-05T03:00:00.000Z`);
    }
    if (!isSafeInt(fee, 0)) return add(`${tag}: ค่าธรรมเนียมต้องเป็นสตางค์จำนวนเต็ม ≥ 0`);
    if (!isSafeInt(withholding, 0)) return add(`${tag}: ภาษีหัก ณ ที่จ่ายต้องเป็นสตางค์จำนวนเต็ม ≥ 0`);
    if (units !== undefined && !validUnits(units)) return add(`${tag}: จำนวนหน่วยต้องเป็นข้อความจำนวนเต็มบวก ไม่ขึ้นต้นด้วย 0 ไม่เกิน 2^63−1`);
    if (priceMicro !== undefined && !isSafeInt(priceMicro, 1)) return add(`${tag}: ราคาต่อหน่วยต้องเป็นจำนวนเต็ม micro-baht > 0`);
    if (amount !== undefined && !isSafeInt(amount, 1)) return add(`${tag}: มูลค่าต้องเป็นสตางค์จำนวนเต็ม ≥ 1`);
    if (entryId !== undefined && (typeof entryId !== 'string' || !entryIds.has(entryId))) return add(`${tag}: entryId ไม่ตรงกับรายการในสมุด`);
    const tradeCurrency = assetCurrencyById.get(assetId) ?? 'THB';
    if (fxRateMicro !== undefined && !isSafeInt(fxRateMicro, 1)) return add(`${tag}: อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม micro > 0`);
    if (tradeCurrency === 'USD') {
      if (fxRateMicro === undefined) return add(`${tag}: รายการของสินทรัพย์ USD ต้องมีอัตราแลกเปลี่ยน (fxRateMicro)`);
      if (kind === 'reinvest') return add(`${tag}: ปันผลลงทุนต่อของสินทรัพย์ USD ยังไม่รองรับ`);
      if (entryId === undefined) return add(`${tag}: รายการ USD ต้องผูกกับรายการในสมุด (entryId)`);
    } else if (fxRateMicro !== undefined) {
      return add(`${tag}: รายการของสินทรัพย์สกุลบาทต้องไม่มีอัตราแลกเปลี่ยน`);
    }

    // รูปแบบตามชนิด (ต้องตรงกับ check trades_*_shape ของฐานข้อมูล)
    const k = kind as TradeKind;
    const shapeOk =
      k === 'buy'
        ? units !== undefined && amount !== undefined && withholding === 0
        : k === 'sell'
          ? units !== undefined && priceMicro !== undefined && amount === undefined && withholding === 0
          : k === 'dividend'
            ? units === undefined && priceMicro === undefined && amount !== undefined && fee === 0 && withholding < (amount as number)
            : units !== undefined && amount !== undefined && fee === 0 && withholding === 0;
    if (!shapeOk) return add(`${tag}: ข้อมูลไม่ครบหรือมีฟิลด์เกินสำหรับรายการชนิด ${k}`);

    tradeIds.add(id);
    const trade: TradeRecord = {
      id,
      assetId,
      kind: k,
      date,
      createdAt: typeof createdAt === 'string' ? new Date(createdAt).toISOString() : `${date}T00:00:00.000Z`,
      fee,
      withholding,
      memo,
    };
    if (units !== undefined) trade.units = units as string;
    if (priceMicro !== undefined) trade.priceMicro = priceMicro as number;
    if (amount !== undefined) trade.amount = amount as number;
    if (entryId !== undefined) trade.entryId = entryId as string;
    if (fxRateMicro !== undefined) trade.fxRateMicro = fxRateMicro as number;
    out.trades.push(trade);
  });

  // ---- ราคาที่กรอก ----
  const priceKeys = new Set<string>();
  rawPrices.forEach((item, i) => {
    const label = `ราคาที่ ${i + 1}`;
    if (!isObject(item)) return add(`${label}: ไม่ใช่วัตถุ`);
    const { assetId, date, priceMicro } = item;
    if (typeof assetId !== 'string' || typeof date !== 'string') return add(`${label}: ต้องมี assetId และ date เป็นข้อความ`);
    if (!assetIds.has(assetId)) return add(`${label}: ไม่พบสินทรัพย์ ${short(assetId)}`);
    if (!isSupportedEntryDate(date)) return add(`${label}: วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD ปี 1900-2999)`);
    if (!isSafeInt(priceMicro, 1)) return add(`${label}: ราคาต้องเป็นจำนวนเต็ม micro-baht > 0`);
    const key = `${assetId}\u0000${date}`;
    if (priceKeys.has(key)) return add(`${label}: มีราคาของสินทรัพย์นี้ในวันเดียวกันซ้ำ`);
    priceKeys.add(key);
    out.prices.push({ assetId, date, priceMicro } satisfies AssetPrice);
  });

  // ---- เล่นซ้ำต่อสินทรัพย์: ขายเกินที่ถือ ณ เวลานั้น / ต้นทุนล้น ----
  for (const asset of out.assets) {
    if (asset.currency === 'USD') {
      const ownFx: TradeFx[] = [];
      for (const t of out.trades) {
        if (t.assetId !== asset.id) continue;
        const base = { id: t.id, date: t.date, createdAt: t.createdAt, fxRateMicro: t.fxRateMicro as number };
        if (t.kind === 'buy') ownFx.push({ kind: 'buy', ...base, units: BigInt(t.units as string), amount: t.amount as number, fee: t.fee });
        else if (t.kind === 'sell') ownFx.push({ kind: 'sell', ...base, units: BigInt(t.units as string), priceMicro: t.priceMicro as number, fee: t.fee });
        if (t.kind === 'sell') {
          let gross = 0;
          try {
            gross = valueInSatang(BigInt(t.units as string), t.priceMicro as number);
          } catch {
            add(`รายการลงทุน (${short(t.id)}): มูลค่าที่ขายเกินช่วงที่คำนวณได้`);
            continue;
          }
          if (gross === 0) add(`รายการลงทุน (${short(t.id)}): ขายแล้วได้เงิน 0 เซนต์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้`);
        }
      }
      try {
        replayTradesFx(ownFx);
      } catch (e) {
        add(`สินทรัพย์ USD ${short(asset.id)}: รายการซื้อขายไม่สอดคล้อง (${e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ'}) เช่น ขายเกินจำนวนที่ถือ ณ เวลานั้น หรือต้นทุนบาทปัดเป็น 0`);
      }
      continue;
    }
    const own: Trade[] = [];
    for (const t of out.trades) {
      if (t.assetId !== asset.id) continue;
      if (t.kind === 'buy') own.push({ kind: 'buy', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), amount: t.amount as number, fee: t.fee });
      else if (t.kind === 'reinvest') own.push({ kind: 'buy', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), amount: t.amount as number, fee: 0 });
      else if (t.kind === 'sell') own.push({ kind: 'sell', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), priceMicro: t.priceMicro as number, fee: t.fee });
    }
    for (const t of out.trades) {
      if (t.assetId !== asset.id || t.kind !== 'sell') continue;
      let gross = 0;
      try {
        gross = valueInSatang(BigInt(t.units as string), t.priceMicro as number);
      } catch {
        add(`รายการลงทุน (${short(t.id)}): มูลค่าที่ขายเกินช่วงที่คำนวณได้`);
        continue;
      }
      if (gross === 0) add(`รายการลงทุน (${short(t.id)}): ขายแล้วได้เงิน 0 สตางค์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้`);
    }
    try {
      replayTrades(own);
    } catch (e) {
      add(`สินทรัพย์ ${short(asset.id)}: รายการซื้อขายไม่สอดคล้อง (${e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ'}) เช่น ขายเกินจำนวนที่ถือ ณ เวลานั้น`);
    }
  }

  // ---- อัตราแลกเปลี่ยนที่กรอก (ผูกบัญชีลงทุนสกุล USD · หนึ่งอัตราต่อบัญชีต่อวัน) ----
  const fxRates: FxRateRecord[] = [];
  const fxRateKeys = new Set<string>();
  rawFxRates.forEach((item, i) => {
    const label = `อัตราแลกเปลี่ยนที่ ${i + 1}`;
    if (!isObject(item)) return add(`${label}: ไม่ใช่วัตถุ`);
    const { accountId, date, rateMicro } = item;
    if (typeof accountId !== 'string' || typeof date !== 'string') return add(`${label}: ต้องมี accountId และ date เป็นข้อความ`);
    const account = accountById.get(accountId);
    if (!account || account.kind !== 'investment' || account.type !== 'asset' || account.currency !== 'USD') {
      return add(`${label}: ต้องผูกกับบัญชีลงทุนสกุล USD ที่มีอยู่ในไฟล์ (บัญชี ${short(accountId)})`);
    }
    if (!isSupportedEntryDate(date)) return add(`${label}: วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD ปี 1900-2999)`);
    if (!isSafeInt(rateMicro, 1)) return add(`${label}: อัตราต้องเป็นจำนวนเต็ม micro > 0`);
    const key = `${accountId}\u0000${date}`;
    if (fxRateKeys.has(key)) return add(`${label}: มีอัตราของบัญชีนี้ในวันเดียวกันซ้ำ`);
    fxRateKeys.add(key);
    fxRates.push({ accountId, date, rateMicro } satisfies FxRateRecord);
  });
  if (fxRates.length > 0) out.fxRates = fxRates;

  // ---- การแลกเงิน: จำนวนสองฝั่งเป็นข้อมูลหลัก อัตราต้องคำนวณตรง และ Entry ในสมุดต้องตรงจำนวน ----
  const fxExchanges: FxExchangeRecord[] = [];
  const fxExchangeIds = new Set<string>();
  const fxExchangeEntries = new Set<string>();
  rawFxExchanges.forEach((item, i) => {
    const label = `รายการแลกเงินที่ ${i + 1}`;
    if (!isObject(item)) return add(`${label}: ไม่ใช่วัตถุ`);
    const { id, date, direction, thbSatang, usdCents, rateMicro, entryId, createdAt } = item;
    const memo = item.memo ?? '';
    if (typeof id !== 'string' || typeof date !== 'string' || typeof direction !== 'string' || typeof entryId !== 'string') {
      return add(`${label}: ต้องมี id, date, direction, entryId เป็นข้อความ`);
    }
    const tag = `${label} (${short(id)})`;
    if (!lengthWithin(id, 1, MAX_ID_LENGTH) || UNSAFE_TEXT.test(id)) return add(`${tag}: รหัสไม่ถูกต้อง`);
    if (fxExchangeIds.has(id)) return add(`รายการแลกเงินซ้ำ: ${short(id)}`);
    if (!(FX_DIRECTIONS as readonly string[]).includes(direction)) return add(`${tag}: ทิศทางต้องเป็น thb_to_usd หรือ usd_to_thb`);
    if (!isSupportedEntryDate(date)) return add(`${tag}: วันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD ปี 1900-2999)`);
    if (typeof memo !== 'string' || !lengthWithin(memo, 0, MAX_MEMO_LENGTH) || UNSAFE_TEXT.test(memo.replace(/[\r\n\t]/g, ''))) {
      return add(`${tag}: หมายเหตุไม่ถูกต้อง (ไม่เกิน ${MAX_MEMO_LENGTH} ตัวอักษร ไม่มีอักขระควบคุม)`);
    }
    if (createdAt !== undefined && !validInstant(createdAt)) return add(`${tag}: createdAt ต้องเป็นเวลา ISO มีเขตเวลา`);
    if (!isSafeInt(thbSatang, 1) || !isSafeInt(usdCents, 1) || !isSafeInt(rateMicro, 1)) {
      return add(`${tag}: จำนวนบาท (สตางค์) จำนวน USD (เซนต์) และอัตราต้องเป็นจำนวนเต็ม ≥ 1`);
    }
    const rateIssue = exchangeRateProblem({ thbSatang, usdCents, rateMicro });
    if (rateIssue) return add(`${tag}: ${rateIssue}`);
    const entry = entryById.get(entryId);
    if (!entry) return add(`${tag}: entryId ไม่ตรงกับรายการในสมุด`);
    if (fxExchangeEntries.has(entryId)) return add(`${tag}: รายการในสมุดนี้ถูกใช้กับการแลกเงินอื่นแล้ว`);
    const record: FxExchangeRecord = {
      id,
      date,
      createdAt: typeof createdAt === 'string' ? new Date(createdAt).toISOString() : `${date}T00:00:00.000Z`,
      direction: direction as FxDirection,
      thbSatang,
      usdCents,
      rateMicro,
      memo,
      entryId,
    };
    const entryIssue = exchangeEntryProblem(record, entry, accountById);
    if (entryIssue) return add(`${tag}: ${entryIssue}`);
    fxExchangeIds.add(id);
    fxExchangeEntries.add(entryId);
    fxExchanges.push(record);
  });
  if (fxExchanges.length > 0) out.fxExchanges = fxExchanges;
  if (categories.length > 0 && categoriesShapeOk) out.categories = categories;
  return out;
}
