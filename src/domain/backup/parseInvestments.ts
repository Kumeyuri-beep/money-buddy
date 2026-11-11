/**
 * ตรวจข้อมูลลงทุนในไฟล์สำรอง (ฟิลด์ `investments`) · ไม่เชื่อข้อมูล: ตรวจรูปแบบเท่ากับ check ของฐานข้อมูล
 * (migration 20261111000100) และเล่นซ้ำรายการต่อสินทรัพย์ตามกฎ R17 เพื่อจับขายเกินที่ถือก่อนส่งขึ้นฐานข้อมูล
 * ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 */

import { replayTrades, type Trade } from '../invest/costBasis';
import {
  ASSET_KINDS,
  MAX_ASSETS,
  MAX_PRICES,
  MAX_TRADES,
  TRADE_KINDS,
  type Asset,
  type AssetPrice,
  type InvestmentData,
  type TradeKind,
  type TradeRecord,
} from '../invest/types';
import { MAX_UNITS } from '../invest/units';
import { isValidIsoDate } from '../ledger/entry';
import { lengthWithin, MAX_ID_LENGTH, MAX_MEMO_LENGTH, MAX_NAME_LENGTH } from '../ledger/limits';
import type { Account, Entry } from '../ledger/types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const UNSAFE_TEXT = /[\p{Cc}‪-‮⁦-⁩]/u;
const UNITS_TEXT = /^[1-9][0-9]{0,18}$/;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
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
  for (const key of ['assets', 'trades', 'prices'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) add(`investments.${key} ต้องเป็นอาร์เรย์`);
  }
  if (!['assets', 'trades', 'prices'].every((k) => raw[k] === undefined || Array.isArray(raw[k]))) return out;
  const rawAssets = (raw.assets ?? []) as unknown[];
  const rawTrades = (raw.trades ?? []) as unknown[];
  const rawPrices = (raw.prices ?? []) as unknown[];
  if (rawAssets.length > MAX_ASSETS) add(`มีสินทรัพย์มากเกินไป (${rawAssets.length} เกิน ${MAX_ASSETS})`);
  if (rawTrades.length > MAX_TRADES) add(`มีรายการลงทุนมากเกินไป (${rawTrades.length} เกิน ${MAX_TRADES})`);
  if (rawPrices.length > MAX_PRICES) add(`มีราคามากเกินไป (${rawPrices.length} เกิน ${MAX_PRICES})`);
  if (rawAssets.length > MAX_ASSETS || rawTrades.length > MAX_TRADES || rawPrices.length > MAX_PRICES) return out;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const entryIds = new Set(entries.map((e) => e.id));

  // ---- สินทรัพย์ ----
  const assetIds = new Set<string>();
  const assetAccounts = new Set<string>();
  rawAssets.forEach((item, i) => {
    const label = `สินทรัพย์ที่ ${i + 1}`;
    if (!isObject(item)) return add(`${label}: ไม่ใช่วัตถุ`);
    const { id, name, kind, accountId, archived } = item;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof kind !== 'string' || typeof accountId !== 'string') {
      return add(`${label}: ต้องมี id, name, kind, accountId เป็นข้อความ`);
    }
    if (!lengthWithin(id, 1, MAX_ID_LENGTH) || !lengthWithin(name, 1, MAX_NAME_LENGTH)) {
      return add(`${label} (${short(id)}): รหัสยาว 1-${MAX_ID_LENGTH} ชื่อยาว 1-${MAX_NAME_LENGTH} ตัวอักษร`);
    }
    if (UNSAFE_TEXT.test(id) || UNSAFE_TEXT.test(name)) return add(`${label} (${short(id)}): รหัส/ชื่อมีอักขระควบคุม`);
    if (!(ASSET_KINDS as readonly string[]).includes(kind)) return add(`${label} (${short(id)}): ชนิดสินทรัพย์ไม่ถูกต้อง`);
    if (archived !== undefined && typeof archived !== 'boolean') return add(`${label} (${short(id)}): archived ต้องเป็นจริง/เท็จ`);
    const account = accountById.get(accountId);
    if (!account || account.kind !== 'investment' || account.type !== 'asset' || account.currency !== 'THB') {
      return add(`${label} (${short(id)}): ต้องผูกกับบัญชีลงทุนสกุลบาทที่มีอยู่ในไฟล์ (บัญชี ${short(accountId)})`);
    }
    if (assetIds.has(id)) return add(`สินทรัพย์ซ้ำ: ${short(id)}`);
    if (assetAccounts.has(accountId)) return add(`บัญชีลงทุน ${short(accountId)} ถูกใช้กับหลายสินทรัพย์ (ซ้ำ)`);
    assetIds.add(id);
    assetAccounts.add(accountId);
    const asset: Asset = { id, name, kind: kind as Asset['kind'], accountId };
    if (archived === true) asset.archived = true;
    out.assets.push(asset);
  });

  // ---- รายการลงทุน ----
  const tradeIds = new Set<string>();
  rawTrades.forEach((item, i) => {
    const label = `รายการลงทุนที่ ${i + 1}`;
    if (!isObject(item)) return add(`${label}: ไม่ใช่วัตถุ`);
    const { id, assetId, kind, date, units, priceMicro, amount, entryId } = item;
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
    if (!isValidIsoDate(date)) return add(`${tag}: วันที่ไม่ถูกต้อง`);
    if (typeof memo !== 'string' || memo.length > MAX_MEMO_LENGTH || UNSAFE_TEXT.test(memo.replace(/[\r\n\t]/g, ''))) {
      return add(`${tag}: หมายเหตุไม่ถูกต้อง (ไม่เกิน ${MAX_MEMO_LENGTH} ตัวอักษร ไม่มีอักขระควบคุม)`);
    }
    if (createdAt !== undefined && (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt)))) {
      return add(`${tag}: createdAt ไม่ถูกต้อง`);
    }
    if (!isSafeInt(fee, 0)) return add(`${tag}: ค่าธรรมเนียมต้องเป็นสตางค์จำนวนเต็ม ≥ 0`);
    if (!isSafeInt(withholding, 0)) return add(`${tag}: ภาษีหัก ณ ที่จ่ายต้องเป็นสตางค์จำนวนเต็ม ≥ 0`);
    if (units !== undefined && !validUnits(units)) return add(`${tag}: จำนวนหน่วยต้องเป็นข้อความจำนวนเต็มบวก ไม่ขึ้นต้นด้วย 0 ไม่เกิน 2^63−1`);
    if (priceMicro !== undefined && !isSafeInt(priceMicro, 1)) return add(`${tag}: ราคาต่อหน่วยต้องเป็นจำนวนเต็ม micro-baht > 0`);
    if (amount !== undefined && !isSafeInt(amount, 1)) return add(`${tag}: มูลค่าต้องเป็นสตางค์จำนวนเต็ม ≥ 1`);
    if (entryId !== undefined && (typeof entryId !== 'string' || !entryIds.has(entryId))) return add(`${tag}: entryId ไม่ตรงกับรายการในสมุด`);

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
    if (!isValidIsoDate(date)) return add(`${label}: วันที่ไม่ถูกต้อง`);
    if (!isSafeInt(priceMicro, 1)) return add(`${label}: ราคาต้องเป็นจำนวนเต็ม micro-baht > 0`);
    const key = `${assetId}\u0000${date}`;
    if (priceKeys.has(key)) return add(`${label}: มีราคาของสินทรัพย์นี้ในวันเดียวกันซ้ำ`);
    priceKeys.add(key);
    out.prices.push({ assetId, date, priceMicro } satisfies AssetPrice);
  });

  // ---- เล่นซ้ำต่อสินทรัพย์: ขายเกินที่ถือ ณ เวลานั้น / ต้นทุนล้น ----
  for (const asset of out.assets) {
    const own: Trade[] = [];
    for (const t of out.trades) {
      if (t.assetId !== asset.id) continue;
      if (t.kind === 'buy') own.push({ kind: 'buy', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), amount: t.amount as number, fee: t.fee });
      else if (t.kind === 'reinvest') own.push({ kind: 'buy', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), amount: t.amount as number, fee: 0 });
      else if (t.kind === 'sell') own.push({ kind: 'sell', id: t.id, date: t.date, createdAt: t.createdAt, units: BigInt(t.units as string), priceMicro: t.priceMicro as number, fee: t.fee });
    }
    try {
      replayTrades(own);
    } catch (e) {
      add(`สินทรัพย์ ${short(asset.id)}: รายการซื้อขายไม่สอดคล้อง (${e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ'}) เช่น ขายเกินจำนวนที่ถือ ณ เวลานั้น`);
    }
  }
  return out;
}
