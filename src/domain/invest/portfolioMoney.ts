/**
 * แยกเงินใช้จ่ายออกจากเงินลงทุน (กฎ R23) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย/ฐานข้อมูล · ไม่สร้าง Entry/Line (ค่าแสดงผลเท่านั้น R16)
 *   - classifyPortfolioTransfer: Entry นี้เป็น "โอนเข้า/ออกพอร์ต" ไหม (สินทรัพย์ ↔ สินทรัพย์ สกุลบาท ระหว่างบัญชีใช้จ่ายกับบัญชีลงทุน)
 *   - checkAccountKindChange: เปลี่ยนป้าย kind (normal ↔ investment) ของบัญชีเงินสดได้ไหม (ตรงกับ set_account_kind ฝั่งฐานข้อมูล)
 *   - wealthSummary: "ความมั่งคั่งรวม (ราคาตลาด)" = เงินใช้จ่าย + เงินลงทุน แยก 2 กลุ่ม พร้อมธง "ไม่ครบ"/"เก่า" (ไม่ใช้ราคาทุนแทนเงียบๆ ตาม R18/R23)
 */

import { naturalBalance } from '../ledger/balance';
import type { Account, Entry } from '../ledger/types';
import type { CodedProblem } from '../errors/problem';
import { safeAdd } from '../money/safe';
import { replayTrades } from './costBasis';
import { replayTradesFx, type TradeFx } from './costBasisFx';
import { splitTradesByRate } from './tradesFx';
import { problem } from './errorCodes';
import { convertMinor } from './fx';
import { toReplayTrades } from './rules';
import { assetCurrency, type Asset, type FxRateRecord, type InvestmentData } from './types';
import { valueInSatang } from './units';

export type PortfolioTransferKind = 'to-portfolio' | 'from-portfolio';

const isThbAsset = (a: Account | undefined): a is Account => a !== undefined && a.type === 'asset' && a.currency === 'THB';

/**
 * โอนเข้า/ออกพอร์ต = Entry 2 บรรทัด ทั้งคู่เป็นบัญชีสินทรัพย์สกุลบาท โดยฝั่งหนึ่งเป็นบัญชีใช้จ่าย (kind normal) อีกฝั่งเป็นบัญชีลงทุน (kind investment) ที่ **ไม่ผูกสินทรัพย์**
 * to-portfolio = เงินออกจากบัญชีใช้จ่ายเข้าบัญชีลงทุน · from-portfolio = ตรงกันข้าม · ไม่ใช่ = null
 * Entry ที่ผูกกับรายการซื้อขาย/แลกเงิน (tradeEntryIds) ไม่ใช่การโอน (เป็นรายการลงทุน อยู่ในแท็บพอร์ต) · รายการแบบนี้ไม่มีบรรทัดรายรับ/รายจ่ายอยู่แล้ว จึงไม่เข้ากราฟหมวด (R4)
 */
export function classifyPortfolioTransfer(
  entry: Entry,
  accountById: ReadonlyMap<string, Account>,
  assetAccountIds: ReadonlySet<string>,
  tradeEntryIds: ReadonlySet<string> = new Set(),
): PortfolioTransferKind | null {
  if (tradeEntryIds.has(entry.id) || entry.lines.length !== 2) return null;
  const [a, b] = entry.lines;
  if (!a || !b || a.amount === 0 || a.amount !== -b.amount) return null;
  const accA = accountById.get(a.accountId);
  const accB = accountById.get(b.accountId);
  if (!isThbAsset(accA) || !isThbAsset(accB)) return null;
  const invA = accA.kind === 'investment';
  const invB = accB.kind === 'investment';
  if (invA === invB) return null; // ทั้งคู่ใช้จ่าย (โอนธรรมดา) หรือทั้งคู่ลงทุน
  const invAccount = invA ? accA : accB;
  if (assetAccountIds.has(invAccount.id)) return null; // บัญชีต้นทุนของสินทรัพย์ ไม่ใช่เงินสดที่พักไว้
  const invLine = invA ? a : b;
  return invLine.amount > 0 ? 'to-portfolio' : 'from-portfolio';
}

export interface AccountKindChangeContext {
  accounts: readonly Account[];
  investments?: InvestmentData | undefined;
  bills?: readonly { walletId?: string | undefined; archived?: boolean | undefined }[] | undefined;
}

/** ตรวจก่อนเปลี่ยนป้าย (ฐานข้อมูลตรวจซ้ำใน set_account_kind) · null = เปลี่ยนได้ · ข้อความ = เหตุผลที่เปลี่ยนไม่ได้ */
export function checkAccountKindChangeCoded(ctx: AccountKindChangeContext, accountId: string, next: 'normal' | 'investment'): CodedProblem | null {
  const account = ctx.accounts.find((a) => a.id === accountId);
  if (!account) return problem('acct.notFound');
  if (account.type !== 'asset' || account.currency !== 'THB') return problem('acct.thbCashOnly');
  if ((ctx.investments?.assets ?? []).some((a) => a.accountId === accountId)) return problem('acct.linkedToAsset');
  if (next === 'investment' && (ctx.bills ?? []).some((b) => b.walletId === accountId && b.archived !== true)) {
    return problem('acct.hasBills');
  }
  return null;
}

/** เหมือน checkAccountKindChangeCoded แต่คืนเฉพาะข้อความไทยเดิม (สัญญาเดิม) */
export function checkAccountKindChange(ctx: AccountKindChangeContext, accountId: string, next: 'normal' | 'investment'): string | null {
  return checkAccountKindChangeCoded(ctx, accountId, next)?.message ?? null;
}

/** ราคา/อัตราเก่ากว่า 30 วัน (นับวันตามปฏิทินระหว่างวันที่ของข้อมูลกับ asOf) ต้องเตือน (R18/R20.7/R23) */
export const WEALTH_STALE_DAYS = 30;

function daysBetween(from: string, to: string): number {
  const f = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const t = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return (t - f) / 86_400_000;
}

/**
 * อัตราแลกเปลี่ยนล่าสุดที่ผู้ใช้กรอก ณ วัน asOf (R20.7): วันที่ล่าสุดก่อนหรือเท่า asOf · วันเดียวกันหลายบัญชี USD ให้รหัสบัญชีมากสุดชนะ (กติกาเดียวกันทุกหน้าจอ ตัวเลขจึงตรงกัน)
 * ไม่มี = null (ไม่เดา)
 */
export function latestFxRate(rates: readonly FxRateRecord[], asOf: string): { date: string; rateMicro: number } | null {
  let best: FxRateRecord | null = null;
  for (const r of rates) {
    if (r.date > asOf) continue;
    if (best === null || r.date > best.date || (r.date === best.date && r.accountId > best.accountId)) best = r;
  }
  return best ? { date: best.date, rateMicro: best.rateMicro } : null;
}

export type WealthMissing = { kind: 'price'; assetId: string } | { kind: 'fx' } | { kind: 'rate'; tradeIds: string[] };
export type WealthStale = { kind: 'price'; assetId: string; date: string; days: number } | { kind: 'fx'; date: string; days: number };

export interface WealthSummary {
  /** เงินใช้จ่าย (สตางค์): Σ สินทรัพย์ − Σ หนี้ ของบัญชีสกุลบาทที่ไม่ใช่บัญชีลงทุน */
  spendingThb: number;
  /** เงินลงทุน (สตางค์) ตามมูลค่าตลาดเฉพาะส่วนที่คำนวณได้ (ส่วนที่ไม่มีราคา/อัตราไม่นับ และมีรายการใน missing) */
  investmentThb: number;
  totalThb: number;
  /** true = มูลค่ารวมไม่ครบ (มีสินทรัพย์ที่ไม่มีราคา หรือมี USD แต่ไม่มีอัตรา) ต้องแสดงคู่กับตัวเลข */
  incomplete: boolean;
  missing: WealthMissing[];
  stale: WealthStale[];
}

/** ความมั่งคั่งรวม (ราคาตลาด) ณ วัน asOf · ใช้ข้อมูลถึงวันนั้นเท่านั้น · ไม่แก้ข้อมูล ไม่ลงสมุด */
export function wealthSummary(accounts: readonly Account[], entries: readonly Entry[], investments: InvestmentData | undefined, asOf: string): WealthSummary {
  const upTo = entries.filter((e) => e.date <= asOf);
  const inv = investments ?? { assets: [], trades: [], prices: [] };
  const assetAccountIds = new Set(inv.assets.map((a) => a.accountId));
  const missing: WealthMissing[] = [];
  const stale: WealthStale[] = [];

  // ---- เงินใช้จ่าย: บาทที่ไม่ใช่บัญชีลงทุน (สินทรัพย์ − หนี้) ----
  let spending = 0;
  let investment = 0;
  for (const a of accounts) {
    if (a.currency !== 'THB') continue;
    if (a.type === 'asset' && a.kind !== 'investment') spending = safeAdd(spending, naturalBalance(a, upTo));
    else if (a.type === 'liability') spending = safeAdd(spending, -naturalBalance(a, upTo));
    else if (a.type === 'asset' && a.kind === 'investment' && !assetAccountIds.has(a.id)) investment = safeAdd(investment, naturalBalance(a, upTo)); // เงินสดที่พักกับโบรกเกอร์ (บาท)
  }

  // ---- อัตราล่าสุดที่กรอก (R20.7) ----
  const fx = latestFxRate(inv.fxRates ?? [], asOf) ?? undefined;
  let fxNeeded = false;
  const toThb = (cents: number): number | undefined => (fx ? convertMinor(cents, fx.rateMicro) : undefined);

  // ---- เงินสด USD ----
  for (const a of accounts) {
    if (a.currency !== 'USD' || a.type !== 'asset' || a.kind !== 'investment' || assetAccountIds.has(a.id)) continue;
    const cents = naturalBalance(a, upTo);
    if (cents === 0) continue;
    fxNeeded = true;
    const v = cents > 0 ? toThb(cents) : fx ? -convertMinor(-cents, fx.rateMicro) : undefined;
    if (v !== undefined) investment = safeAdd(investment, v);
  }

  // ---- สินทรัพย์: จำนวนหน่วยที่ถือ × ราคาล่าสุดที่กรอก ----
  const latestPrice = (asset: Asset): { date: string; priceMicro: number } | undefined => {
    let best: { date: string; priceMicro: number } | undefined;
    for (const p of inv.prices) if (p.assetId === asset.id && p.date <= asOf && (!best || p.date > best.date)) best = { date: p.date, priceMicro: p.priceMicro };
    return best;
  };
  for (const asset of inv.assets) {
    const own = inv.trades.filter((t) => t.assetId === asset.id && t.date <= asOf);
    let units: bigint;
    if (assetCurrency(asset) === 'USD') {
      // รายการที่ไม่มีเรตไม่ถูกเล่นซ้ำ หน่วยที่ถืออาจผิด: ไม่นับมูลค่าสินทรัพย์นี้ และแจ้งว่าไม่ครบ ไม่ข้ามเงียบ (R26)
      const noRate = splitTradesByRate(own).missingRate;
      if (noRate.length > 0) {
        missing.push({ kind: 'rate', tradeIds: noRate.map((t) => t.id) });
        continue;
      }
      const fxTrades: TradeFx[] = [];
      for (const t of own) {
        if (t.fxRateMicro === undefined) continue;
        const base = { id: t.id, date: t.date, createdAt: t.createdAt, fxRateMicro: t.fxRateMicro };
        if (t.kind === 'buy') fxTrades.push({ kind: 'buy', ...base, units: BigInt(t.units ?? '0'), amount: t.amount ?? 0, fee: t.fee });
        else if (t.kind === 'sell') fxTrades.push({ kind: 'sell', ...base, units: BigInt(t.units ?? '0'), priceMicro: t.priceMicro ?? 0, fee: t.fee });
      }
      units = replayTradesFx(fxTrades).position.units;
    } else {
      units = replayTrades(toReplayTrades(own)).position.units;
    }
    if (units === 0n) continue;
    const price = latestPrice(asset);
    if (!price) {
      missing.push({ kind: 'price', assetId: asset.id });
      continue;
    }
    const days = daysBetween(price.date, asOf);
    if (days > WEALTH_STALE_DAYS) stale.push({ kind: 'price', assetId: asset.id, date: price.date, days });
    const value = valueInSatang(units, price.priceMicro); // หน่วยย่อยของสกุลสินทรัพย์ (สตางค์หรือเซนต์)
    if (assetCurrency(asset) === 'USD') {
      fxNeeded = true;
      const v = toThb(value);
      if (v !== undefined) investment = safeAdd(investment, v);
    } else {
      investment = safeAdd(investment, value);
    }
  }

  if (fxNeeded) {
    if (!fx) missing.push({ kind: 'fx' });
    else {
      const days = daysBetween(fx.date, asOf);
      if (days > WEALTH_STALE_DAYS) stale.push({ kind: 'fx', date: fx.date, days });
    }
  }
  return { spendingThb: spending, investmentThb: investment, totalThb: safeAdd(spending, investment), incomplete: missing.length > 0, missing, stale };
}
