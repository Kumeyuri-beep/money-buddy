/**
 * ตรวจสุขภาพข้อมูล USD ในสมุด (กฎ R17 Integrity · R20.8 ข้อ 5) และเงินสด USD ติดลบ · ฟังก์ชันล้วน ไม่แก้ข้อมูล
 *   - ต้นทุน USD ของบัญชีสินทรัพย์ในสมุด (ผลรวมบรรทัด) ต้องเท่ากับ Cusd ที่เล่นซ้ำรายการ 2 ถัง
 *   - อัตราของรายการแลกเงินต้องตรงกับจำนวนสองฝั่ง และ Entry ในสมุดต้องตรงจำนวน
 *   - เงินสด USD (บัญชีลงทุนสกุล USD ที่ไม่ผูกสินทรัพย์) ยอดติดลบ = เตือน (ฐานข้อมูลไม่ตรวจ ให้หน้าจอเตือน)
 */

import type { IntegrityIssue } from '../ledger/integrity';
import type { Account, Entry } from '../ledger/types';
import { replayTradesFx, type TradeFx } from './costBasisFx';
import { exchangeEntryProblem, exchangeRateProblem } from './fxExchange';
import { assetCurrency, type InvestmentData } from './types';

/** ยอดคงเหลือของบัญชี (ผลรวมบรรทัดทั้งสมุด · เซนต์สำหรับ USD) */
function balances(entries: readonly Entry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.amount);
  return out;
}

export interface UsdCashBalance {
  accountId: string;
  name: string;
  /** เซนต์ (ติดลบได้) */
  cents: number;
}

/** บัญชีเงินสด USD = บัญชีลงทุน (kind investment) สกุล USD ชนิดสินทรัพย์ ที่ไม่ผูกกับสินทรัพย์ใดเป็นบัญชีต้นทุน */
export function usdCashBalances(accounts: readonly Account[], entries: readonly Entry[], investments: InvestmentData | undefined): UsdCashBalance[] {
  const assetAccounts = new Set((investments?.assets ?? []).map((a) => a.accountId));
  const sums = balances(entries);
  return accounts
    .filter((a) => a.kind === 'investment' && a.type === 'asset' && a.currency === 'USD' && !assetAccounts.has(a.id))
    .map((a) => ({ accountId: a.id, name: a.name, cents: sums.get(a.id) ?? 0 }));
}

/** บัญชีเงินสด USD ที่ยอดติดลบ (ให้หน้าจอแสดงคำเตือน) · ว่าง = ไม่มีบัญชีติดลบ */
export function negativeUsdCash(accounts: readonly Account[], entries: readonly Entry[], investments: InvestmentData | undefined): UsdCashBalance[] {
  return usdCashBalances(accounts, entries, investments).filter((b) => b.cents < 0);
}

export function checkUsdInvestmentIntegrity(accounts: readonly Account[], entries: readonly Entry[], investments: InvestmentData | undefined): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  if (!investments) return issues;
  const sums = balances(entries);
  const accountById = new Map(accounts.map((a) => [a.id, a] as const));
  const entryById = new Map(entries.map((e) => [e.id, e] as const));

  for (const asset of investments.assets) {
    if (assetCurrency(asset) !== 'USD') continue;
    const trades: TradeFx[] = [];
    let replayable = true;
    for (const t of investments.trades) {
      if (t.assetId !== asset.id) continue;
      if (t.fxRateMicro === undefined) {
        issues.push({ code: 'invest-usd-trade', accountId: asset.accountId, message: `รายการลงทุน ${t.id} ของสินทรัพย์ USD ไม่มีอัตราแลกเปลี่ยน` });
        replayable = false;
        continue;
      }
      const base = { id: t.id, date: t.date, createdAt: t.createdAt, fxRateMicro: t.fxRateMicro };
      if (t.kind === 'buy') trades.push({ kind: 'buy', ...base, units: BigInt(t.units ?? '0'), amount: t.amount ?? 0, fee: t.fee });
      else if (t.kind === 'sell') trades.push({ kind: 'sell', ...base, units: BigInt(t.units ?? '0'), priceMicro: t.priceMicro ?? 0, fee: t.fee });
      else if (t.kind === 'reinvest') {
        issues.push({ code: 'invest-usd-trade', accountId: asset.accountId, message: `รายการลงทุน ${t.id}: ปันผลลงทุนต่อของสินทรัพย์ USD ยังไม่รองรับ` });
        replayable = false;
      }
    }
    if (!replayable) continue;
    let costUsd: number;
    try {
      costUsd = replayTradesFx(trades).position.costUsd;
    } catch (e) {
      issues.push({ code: 'invest-usd-cost', accountId: asset.accountId, message: `สินทรัพย์ USD ${asset.name}: เล่นซ้ำรายการซื้อขายไม่ได้ (${e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ'})` });
      continue;
    }
    const ledger = sums.get(asset.accountId) ?? 0;
    if (ledger !== costUsd) {
      issues.push({
        code: 'invest-usd-cost',
        accountId: asset.accountId,
        message: `ต้นทุน USD ของ ${asset.name} ในสมุด (${ledger} เซนต์) ไม่ตรงกับต้นทุนที่เล่นซ้ำจากรายการซื้อขาย (${costUsd} เซนต์)`,
      });
    }
  }

  for (const x of investments.fxExchanges ?? []) {
    const rate = exchangeRateProblem(x);
    if (rate) issues.push({ code: 'invest-fx-exchange', entryId: x.entryId, message: `การแลกเงิน ${x.id}: ${rate}` });
    const entry = entryById.get(x.entryId);
    if (!entry) {
      issues.push({ code: 'invest-fx-exchange', entryId: x.entryId, message: `การแลกเงิน ${x.id}: ไม่พบรายการในสมุด` });
      continue;
    }
    const problem = exchangeEntryProblem(x, entry, accountById);
    if (problem) issues.push({ code: 'invest-fx-exchange', entryId: x.entryId, message: `การแลกเงิน ${x.id}: ${problem}` });
  }
  return issues;
}
