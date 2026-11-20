/**
 * มุมมองหน้า Cash ของโหมด /invest (R16 · R20 · R23 · R26) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล · ไม่สร้าง Entry (สร้างด้วย buildCashAdjustmentEntry)
 *   - ยอดเงินสดต่อสกุล = ผลรวมบรรทัดของบัญชีลงทุนที่ไม่ผูกสินทรัพย์ (อ่านจากสมุดทุกครั้ง ไม่เก็บยอดซ้ำ · R16)
 *   - แปลงเป็นสกุลที่แสดงด้วย displayCurrency.ts (R26): ไม่มีเรต = null ("Needs rate") ห้ามเดา
 *   - Set balance to: คำนวณส่วนต่างเป็นฝาก/ถอนจำนวนเต็มหน่วยย่อยด้วย BigInt
 *   - เงินสดติดลบ = คำเตือนบนการ์ด (ฐานข้อมูลห้ามเฉพาะการถอนแบบปรับยอด · ทางอื่นติดลบได้)
 */

import { roundHalfUpBig } from '../money/round';
import { parseBahtToSatang } from '../money/satang';
import type { CodedProblem } from '../errors/problem';
import type { Account, Entry } from '../ledger/types';
import { CASH_ADJUST_ACCOUNT_IDS } from './cashAdjustment';
import { sumDisplayed, toDisplayMinor, type DisplayCurrency } from './displayCurrency';
import { problem } from './errorCodes';
import { classifyPortfolioTransfer, latestFxRate } from './portfolioMoney';
import type { InstrumentCurrency, InvestmentData } from './types';

export const CASH_CURRENCIES: readonly InstrumentCurrency[] = ['THB', 'USD'];

export interface CashAccountBalance {
  accountId: string;
  name: string;
  currency: InstrumentCurrency;
  /** สตางค์/เซนต์ ติดลบได้ */
  minor: number;
  archived: boolean;
}

/** ยอดรวมของบัญชีทั้งสมุด (BigInt แล้วค่อยกลับเป็นจำนวนเต็มปลอดภัย: ยอดที่เกินช่วงโยน RangeError ไม่ปัดเงียบ) */
function ledgerSums(entries: readonly Entry[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const e of entries) for (const l of e.lines) out.set(l.accountId, (out.get(l.accountId) ?? 0n) + BigInt(l.amount));
  return out;
}

function toSafe(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('ยอดเกินช่วงจำนวนเต็มปลอดภัย');
  return Number(v) || 0; // ไม่ให้เป็น -0
}

const isCurrency = (c: string): c is InstrumentCurrency => c === 'THB' || c === 'USD';

/**
 * บัญชีเงินสดของพอร์ต = บัญชีลงทุน (kind investment) ชนิดสินทรัพย์ สกุล THB/USD ที่ไม่ผูกสินทรัพย์ใดเป็นบัญชีต้นทุน
 * บัญชีที่เก็บถาวรแล้วแสดงเฉพาะเมื่อยังมียอด (ไม่ซ่อนเงินที่ยังอยู่)
 */
export function cashAccountBalances(accounts: readonly Account[], entries: readonly Entry[], investments: InvestmentData | undefined, asOf?: string): CashAccountBalance[] {
  const assetAccounts = new Set((investments?.assets ?? []).map((a) => a.accountId));
  // ยอด ณ วัน asOf: นับเฉพาะรายการวันที่ <= asOf เหมือน Holdings (usPortfolio) เพื่อให้สองหน้าตรงกัน
  const sums = ledgerSums(asOf === undefined ? entries : entries.filter((e) => e.date <= asOf));
  const out: CashAccountBalance[] = [];
  for (const a of accounts) {
    if (a.kind !== 'investment' || a.type !== 'asset' || !isCurrency(a.currency) || assetAccounts.has(a.id)) continue;
    const minor = toSafe(sums.get(a.id) ?? 0n);
    if (a.archived === true && minor === 0) continue;
    out.push({ accountId: a.id, name: a.name, currency: a.currency, minor, archived: a.archived === true });
  }
  return out;
}

export interface CashCurrencyRow {
  currency: InstrumentCurrency;
  accounts: CashAccountBalance[];
  /** ผลรวมสกุลต้นทาง (สตางค์/เซนต์) */
  minor: number;
  /** แปลงเป็นสกุลที่แสดง · null = ไม่มีเรต (Needs rate) */
  displayMinor: number | null;
  /** สัดส่วนของเงินสดทั้งหมด หน่วย basis point (10000 = 100%) · null = คำนวณไม่ได้ (ไม่มีเรต / ยอดรวมไม่เป็นบวก / มีสกุลติดลบ) */
  shareBps: number | null;
}

export interface CashWarning {
  accountId: string;
  name: string;
  currency: InstrumentCurrency;
  minor: number;
}

export interface CashView {
  rows: CashCurrencyRow[];
  /** ผลรวมในสกุลที่แสดง (ผลบวกของค่าที่แปลงแล้วต่อสกุล · R26) · null = มีสกุลที่ไม่มีเรต */
  totalDisplayMinor: number | null;
  rate: { date: string; rateMicro: number } | null;
  /** บัญชีที่ยอดติดลบ (แสดงคำเตือน) */
  warnings: CashWarning[];
  /** ไม่มีบัญชีเงินสดเลย */
  noAccounts: boolean;
  /** มีบัญชี แต่ทุกสกุลยอด 0 */
  allZero: boolean;
}

export function buildCashView(
  accounts: readonly Account[],
  entries: readonly Entry[],
  investments: InvestmentData | undefined,
  display: DisplayCurrency,
  today: string,
): CashView {
  const all = cashAccountBalances(accounts, entries, investments, today);
  const rate = latestFxRate(investments?.fxRates ?? [], today);
  const rows: CashCurrencyRow[] = [];
  for (const currency of CASH_CURRENCIES) {
    const accs = all.filter((a) => a.currency === currency);
    if (accs.length === 0) continue;
    const minor = toSafe(accs.reduce((s, a) => s + BigInt(a.minor), 0n));
    rows.push({ currency, accounts: accs, minor, displayMinor: toDisplayMinor(currency, minor, display, rate?.rateMicro ?? null), shareBps: null });
  }
  const totalDisplayMinor = sumDisplayed(rows.map((r) => r.displayMinor));
  const anyNegative = rows.some((r) => (r.displayMinor ?? 0) < 0);
  if (totalDisplayMinor !== null && totalDisplayMinor > 0 && !anyNegative) {
    for (const r of rows) r.shareBps = Number(roundHalfUpBig(BigInt(r.displayMinor ?? 0) * 10_000n, BigInt(totalDisplayMinor)));
  }
  const warnings = all.filter((a) => a.minor < 0).map(({ accountId, name, currency, minor }) => ({ accountId, name, currency, minor }));
  return { rows, totalDisplayMinor, rate, warnings, noAccounts: all.length === 0, allZero: all.length > 0 && all.every((a) => a.minor === 0) };
}

// ---------- Change balance ----------

export type CashChangeMode = 'deposit' | 'withdraw' | 'set';

export type CashChangePlan = { kind: 'none' } | { kind: 'change'; direction: 'deposit' | 'withdraw'; amountMinor: number };

/**
 * อ่านข้อความจำนวนเงิน → หน่วยย่อยจำนวนเต็ม · ตัดช่องว่าง คอมมา และสัญลักษณ์สกุล (฿ $) ก่อน แล้วค่อยตรวจ: ไม่รับเครื่องหมายใดๆ (ลบ/บวก) รูปแบบ e/x ใช้ไม่ได้
 * ทศนิยมเกิน 2 ตำแหน่งปัดครึ่งขึ้น · ระบุ currency = สัญลักษณ์ของสกุลอื่นถูกปฏิเสธ · อ่านไม่ได้ = null
 */
export function parseCashMinor(text: string, currency?: InstrumentCurrency): number | null {
  const compact = text.replace(/[\s,]/g, '');
  const hasBaht = compact.includes('฿');
  const hasDollar = compact.includes('$');
  if (hasBaht && hasDollar) return null;
  if (currency === 'USD' && hasBaht) return null;
  if (currency === 'THB' && hasDollar) return null;
  const digits = compact.replace(/[฿$]/g, '');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(digits)) return null;
  try {
    return parseBahtToSatang(digits);
  } catch {
    return null;
  }
}

/**
 * แผนการเปลี่ยนยอด (ส่วนต่างของ Set balance คำนวณด้วย BigInt จำนวนเต็มหน่วยย่อย)
 *   deposit/withdraw: จำนวนตั้งแต่ 1 · set: เป้า ≥ 0 ส่วนต่าง 0 = { kind: 'none' } (ไม่บันทึก) · ผลต่างเกินช่วงปลอดภัยปฏิเสธ
 * ไม่ตรวจว่าถอนเกินยอด (ฐานข้อมูลตรวจซ้ำและปฏิเสธ)
 */
export function planCashChange(input: { mode: CashChangeMode; text: string; currentMinor: number; currency?: InstrumentCurrency }): { ok: true; plan: CashChangePlan } | { ok: false; problem: CodedProblem } {
  const bad = { ok: false as const, problem: problem('link.cashAmountInvalid') };
  if (!Number.isSafeInteger(input.currentMinor)) return bad;
  const value = parseCashMinor(input.text, input.currency);
  if (value === null || value < 0) return bad;
  if (input.mode !== 'set') {
    if (value < 1) return bad;
    return { ok: true, plan: { kind: 'change', direction: input.mode, amountMinor: value } };
  }
  const delta = BigInt(value) - BigInt(input.currentMinor);
  if (delta === 0n) return { ok: true, plan: { kind: 'none' } };
  const abs = delta < 0n ? -delta : delta;
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return bad;
  return { ok: true, plan: { kind: 'change', direction: delta > 0n ? 'deposit' : 'withdraw', amountMinor: Number(abs) } };
}

// ---------- รายการเงินเข้า/ออก ----------

export type CashMovementKind = 'deposit' | 'withdrawal' | 'transfer-in' | 'transfer-out' | 'exchange';

export interface CashMovement {
  entryId: string;
  date: string;
  kind: CashMovementKind;
  /** หมายเหตุของผู้ใช้ (ปรับยอด: ตัดหัวข้อที่ระบบใส่ให้ออก) */
  note: string;
  /** ผลรวมบรรทัดของบัญชีเงินสดต่อสกุล (มีเครื่องหมาย · บวก = เงินเข้าพอร์ต) */
  legs: { currency: InstrumentCurrency; minor: number }[];
}

/**
 * รายการเงินเข้า/ออกพอร์ตล่าสุด (ใหม่ก่อน): ปรับยอดเงินสด (มีบรรทัดบัญชีพัก) · โอนบาทเข้า/ออกพอร์ต · แลกเงิน
 * รายการซื้อขายหุ้น/ปันผลอยู่หน้า Transactions จึงไม่นับที่นี่ · ไม่มี Entry ที่ตรงเงื่อนไขเลย = ว่าง
 */
export function recentCashMovements(accounts: readonly Account[], entries: readonly Entry[], investments: InvestmentData | undefined, limit = 20): CashMovement[] {
  // ใช้ชุดบัญชีลงทุนไม่ผูกสินทรัพย์ทั้งหมด (รวมที่เก็บถาวร) เพื่อให้ประวัติยังเห็นได้
  const assetAccounts = new Set((investments?.assets ?? []).map((a) => a.accountId));
  const isCashAccount = (a: Account | undefined): a is Account =>
    a !== undefined && a.kind === 'investment' && a.type === 'asset' && isCurrency(a.currency) && !assetAccounts.has(a.id);
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const adjustIds = new Set<string>(Object.values(CASH_ADJUST_ACCOUNT_IDS));
  const exchangeEntryIds = new Set((investments?.fxExchanges ?? []).map((x) => x.entryId));
  const tradeEntryIds = new Set((investments?.trades ?? []).map((t) => t.entryId).filter((id): id is string => id !== undefined));
  const out: (CashMovement & { createdAt: string })[] = [];
  for (const e of entries) {
    const legs = new Map<InstrumentCurrency, bigint>();
    for (const l of e.lines) {
      const a = byId.get(l.accountId);
      if (!isCashAccount(a)) continue;
      const c = a.currency as InstrumentCurrency;
      legs.set(c, (legs.get(c) ?? 0n) + BigInt(l.amount));
    }
    if (legs.size === 0) continue;
    let kind: CashMovementKind | null = null;
    if (exchangeEntryIds.has(e.id)) kind = 'exchange';
    else if (tradeEntryIds.has(e.id)) kind = null;
    else if (e.lines.some((l) => adjustIds.has(l.accountId))) kind = [...legs.values()][0]! >= 0n ? 'deposit' : 'withdrawal';
    else {
      const t = classifyPortfolioTransfer(e, byId, assetAccounts, tradeEntryIds);
      kind = t === 'to-portfolio' ? 'transfer-in' : t === 'from-portfolio' ? 'transfer-out' : null;
    }
    if (kind === null) continue;
    out.push({
      entryId: e.id,
      date: e.date,
      kind,
      note: kind === 'deposit' || kind === 'withdrawal' ? e.memo.split(' · ').slice(1).join(' · ') : e.memo,
      legs: CASH_CURRENCIES.filter((c) => legs.has(c)).map((c) => ({ currency: c, minor: toSafe(legs.get(c)!) })),
      createdAt: e.createdAt ?? '',
    });
  }
  out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.entryId < b.entryId ? 1 : -1));
  return out.slice(0, Math.max(0, limit)).map(({ createdAt: _c, ...m }) => m);
}
