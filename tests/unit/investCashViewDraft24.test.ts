import { describe, expect, it } from 'vitest';
import { buildCashAdjustmentEntry } from '../../src/domain/invest/cashAdjustment';
import { buildCashView, cashPortfolioShares, filterCashRows, percentOneDecimal } from '../../src/domain/invest/cashView';
import type { InvestmentData } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';

// ข้อมูลสมมติตามแบบร่าง 24: เงินสด USD $120.37 + บาท 5,000.00 ที่เรต 32.40 · หุ้น (จากแบบร่าง Holdings 20) มูลค่า $3,850.00
const acc = (id: string, currency: string, name = id): Account => ({ id, name, type: 'asset', currency, kind: 'investment' });
const accounts: Account[] = [acc('cash-usd', 'USD', 'Broker USD'), acc('cash-thb', 'THB', 'Broker THB')];
const data: InvestmentData = { assets: [], trades: [], prices: [], fxRates: [{ accountId: 'cash-usd', date: '2026-11-01', rateMicro: 32_400_000 }] };
const dep = (id: string, acct: string, cur: 'THB' | 'USD', minor: number, direction: 'deposit' | 'withdraw' = 'deposit'): Entry =>
  buildCashAdjustmentEntry({ id, date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', cashAccountId: acct, currency: cur, direction, amountMinor: minor, memo: '' }).entry;
const entries = [dep('e1', 'cash-usd', 'USD', 12_037), dep('e2', 'cash-thb', 'THB', 500_000)];
const TODAY = '2026-11-19';
const view = (es: Entry[] = entries, accs: Account[] = accounts, display: 'USD' | 'THB' = 'USD') => buildCashView(accs, es, data, display, TODAY);

describe('cashPortfolioShares (Share of portfolio · แบบร่าง 24)', () => {
  it('ตัวอย่างมือ: เงินสด 27,469 เซนต์ (12,037 + 15,432) หุ้น 385,000 → พอร์ต 412,469 → USD 292 · THB 374 · รวม 666 bps (2.9% / 3.7% / 6.7%)', () => {
    const v = view();
    expect(v.rows.map((r) => [r.currency, r.displayMinor])).toEqual([['THB', 15_432], ['USD', 12_037]]); // 500,000 สตางค์ ÷ 32.40 = 154.32 ดอลลาร์
    expect(v.totalDisplayMinor).toBe(27_469);
    const s = cashPortfolioShares(v, 385_000);
    const byCur = Object.fromEntries(v.rows.map((r) => [r.currency, s.rows.get(r.currency)]));
    expect(byCur).toEqual({ THB: 374, USD: 292 });
    expect(s.total).toBe(666);
  });
  it('ไม่มีหุ้น (มูลค่า 0): ส่วนแบ่งต่อพอร์ต = ส่วนแบ่งของเงินสด (100% ของพอร์ต)', () => {
    const v = view();
    const s = cashPortfolioShares(v, 0);
    expect(s.total).toBe(10_000);
    expect(s.rows.get('USD')! + s.rows.get('THB')!).toBeGreaterThanOrEqual(9_999);
  });
  it('มูลค่าหุ้นไม่ครบ (null) = ไม่คำนวณ ไม่เดา (R20.7)', () => {
    const s = cashPortfolioShares(view(), null);
    expect(s.total).toBeNull();
    expect([...s.rows.values()]).toEqual([null, null]);
  });
  it('ไม่มีเรต (มุมมองที่ต้องแปลง) = null · เงินสดติดลบ = null · เงินสดรวม 0 แต่พอร์ตมีหุ้น = 0', () => {
    const noRate = buildCashView(accounts, entries, { ...data, fxRates: [] }, 'USD', TODAY);
    expect(cashPortfolioShares(noRate, 385_000).total).toBeNull();
    const neg = view([dep('e1', 'cash-usd', 'USD', 12_037), dep('e3', 'cash-thb', 'THB', 100, 'deposit'), { ...dep('e4', 'cash-thb', 'THB', 5, 'withdraw'), lines: [{ accountId: 'cash-thb', amount: -500_000 }, { accountId: 'inv-cash-adjust-thb', amount: 500_000 }] }]);
    expect(cashPortfolioShares(neg, 385_000).total).toBeNull();
    const zero = view([], accounts);
    const s = cashPortfolioShares(zero, 385_000);
    expect(s.total).toBe(0);
    expect([...s.rows.values()]).toEqual([0, 0]);
  });
  it('ขอบ: พอร์ตรวมไม่เป็นบวก (หุ้นติดลบเป็นไปไม่ได้ แต่ป้องกัน) = null · ปัดครึ่งขึ้น (R8): 1/3 = 3,333 bps', () => {
    expect(cashPortfolioShares(view([]), -1).total).toBeNull();
    const one = buildCashView([acc('cash-usd', 'USD')], [dep('e1', 'cash-usd', 'USD', 100)], data, 'USD', TODAY);
    expect(cashPortfolioShares(one, 200).total).toBe(3_333); // 100 / 300
    const half = buildCashView([acc('cash-usd', 'USD')], [dep('e1', 'cash-usd', 'USD', 1)], data, 'USD', TODAY);
    expect(cashPortfolioShares(half, 1).total).toBe(5_000); // 1 / 2 = 50.00%
  });
});

describe('cashPortfolioShares: กรณีขอบเพิ่ม (ผล money-auditor)', () => {
  const one = (minor: number) => buildCashView([acc('cash-usd', 'USD')], [dep('e1', 'cash-usd', 'USD', minor)], data, 'USD', TODAY);
  it('มูลค่าหุ้นติดลบ = null (ไม่ให้สัดส่วนเกิน 100%)', () => {
    expect(cashPortfolioShares(one(3), -1).total).toBeNull();
    expect(cashPortfolioShares(one(3), -1).rows.get('USD')).toBeNull();
  });
  it('ปัดครึ่งพอดีของ bps: 1 ÷ 4,000 = 2.5 bps → 3 (ปัดขึ้น) · 3 ÷ 4,000 = 7.5 → 8', () => {
    expect(cashPortfolioShares(one(1), 3_999).total).toBe(3);
    expect(cashPortfolioShares(one(3), 3_997).total).toBe(8);
  });
  it('ตัวเลขใหญ่ใกล้ 2^53 คำนวณด้วย BigInt ไม่ล้ม: เงินสด 2^52 + หุ้น 2^52 → 5,000 bps (50.00%)', () => {
    const big = 2 ** 52;
    const v = one(big);
    expect(v.totalDisplayMinor).toBe(big);
    expect(cashPortfolioShares(v, big).total).toBe(5_000);
    expect(cashPortfolioShares(v, Number.MAX_SAFE_INTEGER).total).toBe(3_333); // 2^52 ÷ (2^52 + 2^53 − 1) ≈ 1/3 (ผลรวมเกิน 2^53 แต่ใช้ BigInt)
  });
});

describe('filterCashRows (ค้นหา + Show zero balances)', () => {
  const rows = () => view().rows;
  it('ไม่มีคำค้น: ซ่อนสกุลที่ยอด 0 เป็นค่าเริ่มต้น แสดงเมื่อติ๊ก Show zero balances', () => {
    const zeroThb = view([dep('e1', 'cash-usd', 'USD', 12_037)]);
    expect(filterCashRows(zeroThb.rows, { query: '', showZero: false }).map((r) => r.currency)).toEqual(['USD']);
    expect(filterCashRows(zeroThb.rows, { query: '', showZero: true }).map((r) => r.currency).sort()).toEqual(['THB', 'USD']);
  });
  it('ค้นหาจากรหัสสกุล ชื่อสกุล และชื่อบัญชี ไม่สนตัวพิมพ์ใหญ่เล็ก ตัดช่องว่าง', () => {
    expect(filterCashRows(rows(), { query: ' usd ', showZero: false }).map((r) => r.currency)).toEqual(['USD']);
    expect(filterCashRows(rows(), { query: 'thai', showZero: false }).map((r) => r.currency)).toEqual(['THB']);
    expect(filterCashRows(rows(), { query: 'BROKER THB', showZero: false }).map((r) => r.currency)).toEqual(['THB']);
    expect(filterCashRows(rows(), { query: 'zzz', showZero: false })).toEqual([]);
  });
  it('คำค้นที่ตรงกับสกุลยอด 0 ยังถูกซ่อนถ้าไม่ติ๊ก Show zero balances', () => {
    const v = view([dep('e1', 'cash-usd', 'USD', 12_037)]);
    expect(filterCashRows(v.rows, { query: 'thb', showZero: false })).toEqual([]);
    expect(filterCashRows(v.rows, { query: 'thb', showZero: true }).map((r) => r.currency)).toEqual(['THB']);
  });
});

describe('percentOneDecimal (ข้อความ Share of portfolio)', () => {
  it('ปัดครึ่งขึ้นเป็น 0.1% ด้วยจำนวนเต็ม: 292→2.9% · 374→3.7% · 666→6.7% · 665→6.7% (.5 ปัดขึ้น) · 664→6.6%', () => {
    expect(percentOneDecimal(292)).toBe('2.9%');
    expect(percentOneDecimal(374)).toBe('3.7%');
    expect(percentOneDecimal(666)).toBe('6.7%');
    expect(percentOneDecimal(665)).toBe('6.7%');
    expect(percentOneDecimal(664)).toBe('6.6%');
  });
  it('ขอบ: 0 → 0.0% · 4 → 0.0% · 5 → 0.1% · 10,000 → 100.0% · null → "—" · ติดลบ/ทศนิยมโยน RangeError', () => {
    expect(percentOneDecimal(0)).toBe('0.0%');
    expect(percentOneDecimal(4)).toBe('0.0%');
    expect(percentOneDecimal(5)).toBe('0.1%');
    expect(percentOneDecimal(10_000)).toBe('100.0%');
    expect(percentOneDecimal(null)).toBe('—');
    expect(() => percentOneDecimal(-1)).toThrow(RangeError);
    expect(() => percentOneDecimal(1.5)).toThrow(RangeError);
  });
});
