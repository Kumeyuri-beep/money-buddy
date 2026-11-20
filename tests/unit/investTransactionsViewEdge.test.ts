import { describe, expect, it } from 'vitest';
import { CASH_ADJUST_ACCOUNT_IDS } from '../../src/domain/invest/cashAdjustment';
import { buildTransactionsView, totalsOf } from '../../src/domain/invest/transactionsView';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';

// ข้อมูลสมมติทั้งหมด · ขอบระดับแถวของ buildTransactionsView (R20.4 R24 R26)
const USD_A: Asset = { id: 'a1', name: 'Demo Alpha', kind: 'stock', accountId: 'inv-a1', currency: 'USD', ticker: 'DEMA', exchange: 'NASDAQ' };
const FUND: Asset = { id: 'f1', name: 'Demo Fund', kind: 'fund', accountId: 'inv-f1' };
const trade = (p: Partial<TradeRecord> & Pick<TradeRecord, 'id' | 'assetId' | 'kind' | 'date'>): TradeRecord => ({ createdAt: `${p.date}T03:00:00.000Z`, fee: 0, withholding: 0, memo: '', ...p });
const U = (n: number): string => String(n * 100_000_000);
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'Wallet', currency: 'THB' },
  { id: 'brk', type: 'asset', name: 'Broker THB', currency: 'THB', kind: 'investment' },
  { id: 'usd-cash', type: 'asset', name: 'USD cash', currency: 'USD', kind: 'investment' },
];
const base = (over: Partial<InvestmentData> = {}): InvestmentData => ({
  assets: [USD_A],
  trades: [],
  prices: [],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-10', rateMicro: 32_500_000 }],
  ...over,
});
const build = (data: InvestmentData, currency: 'USD' | 'THB' = 'USD', entries: Entry[] = []) => buildTransactionsView({ data, accounts, entries, currency, today: '2026-11-19' });

describe('ปันผลสุทธิ THB ตรง R20.4 / ตัวอย่าง R24 และกันแถวพัง', () => {
  const div = (over: Partial<TradeRecord>) => trade({ id: 'dv', assetId: 'a1', kind: 'dividend', date: '2026-08-01', amount: 5_000, withholding: 750, fxRateMicro: 34_567_891, ...over });

  it('R24: D=5000 W=750 เรต 34.567891 → gross 172,839 − wht 25,926 = 146,913 (เหมือน dividendInThb ของ Dashboard/Holdings)', () => {
    const r = build(base({ trades: [div({})] }), 'THB').rows[0]!;
    expect(r.value?.minor).toBe(172_839);
    expect(r.dividendNet).toEqual({ minor: 146_913, currency: 'THB' });
    expect(r.feeTax?.minor).toBe(25_926);
    expect(totalsOf([r]).dividendNet).toBe(146_913);
  });
  it('USD view: D − W ตรงๆ', () => {
    expect(build(base({ trades: [div({})] }), 'USD').rows[0]!.dividendNet).toEqual({ minor: 4_250, currency: 'USD' });
  });
  it('ภาษี >= ปันผล (ผิดกติกา R20.4) = แถวนั้น failed ไม่ทำทั้งหน้าพัง · แถวอื่นยังคำนวณได้', () => {
    const bad = div({ id: 'bad', withholding: 5_000 });
    const ok = trade({ id: 'ok', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(1), amount: 100, fxRateMicro: 32_000_000 });
    const v = build(base({ trades: [bad, ok] }), 'THB');
    expect(v.rows.find((r) => r.sourceId === 'bad')).toMatchObject({ failed: true, dividendNet: null, needsRate: false });
    expect(v.rows.find((r) => r.sourceId === 'ok')).toMatchObject({ failed: false, value: { minor: 3_200, currency: 'THB' } });
    const t = totalsOf(v.rows);
    expect(t.dividendNet).toBeNull();
    expect(t.buy).toBe(3_200);
    expect(t.incomplete).toBe(true);
  });
});

describe('ขอบระดับแถว: เรต 0/ติดลบ · ใกล้ 2^53 · -0', () => {
  const buy = (over: Partial<TradeRecord>) => trade({ id: 'b', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(1), amount: 100, fee: 1, ...over });
  it('เรตของรายการเป็น 0 หรือติดลบ = แถว failed (ไม่ใช่ Needs rate) ไม่ throw', () => {
    for (const rate of [0, -1]) {
      const r = build(base({ trades: [buy({ fxRateMicro: rate })] }), 'THB').rows[0]!;
      expect(r).toMatchObject({ failed: true, needsRate: false, value: null, feeTax: null, price: null });
      expect(totalsOf([r]).buy).toBeNull();
      expect(totalsOf([r]).incomplete).toBe(true);
    }
  });
  it('มุมมอง USD ไม่ใช้เรต: เรตเสียของรายการไม่กระทบ', () => {
    expect(build(base({ trades: [buy({ fxRateMicro: 0 })] }), 'USD').rows[0]).toMatchObject({ failed: false, value: { minor: 100, currency: 'USD' } });
  });
  it('จำนวนเงินใกล้ 2^53 × เรต = RangeError ต่อแถว (แถวอื่นปกติ)', () => {
    const big = buy({ id: 'big', amount: Number.MAX_SAFE_INTEGER, fxRateMicro: 99_000_000 });
    const ok = buy({ id: 'ok', fxRateMicro: 32_000_000 });
    const v = build(base({ trades: [big, ok] }), 'THB');
    expect(v.rows.find((r) => r.sourceId === 'big')).toMatchObject({ failed: true, value: null });
    expect(v.rows.find((r) => r.sourceId === 'ok')).toMatchObject({ failed: false, value: { minor: 3_200, currency: 'THB' } });
  });
  it('เรตล่าสุดเสีย (0) กับแถวเงินสด = failed ไม่ใช่ Needs rate', () => {
    const e: Entry = { id: 'dep', date: '2026-04-01', memo: '', source: 'manual', lines: [{ accountId: 'usd-cash', amount: 100 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -100 }] };
    const r = build(base({ fxRates: [{ accountId: 'usd-cash', date: '2026-11-10', rateMicro: 0 }] }), 'THB', [e]).rows[0]!;
    expect(r).toMatchObject({ failed: true, needsRate: false, value: null });
  });
  it('-0 ในข้อมูลต้นทางไม่หลุดเป็น -0 ในผล', () => {
    const data = base({ trades: [buy({ amount: -0, fee: -0, fxRateMicro: 32_000_000 })] });
    const u = build(data, 'USD').rows[0]!;
    expect(Object.is(u.value?.minor, 0)).toBe(true);
    expect(Object.is(u.feeTax?.minor, 0)).toBe(true);
    expect(Object.is(build(data, 'THB').rows[0]!.value?.minor, 0)).toBe(true);
  });
});

describe('ทิศทางเงิน (เครื่องหมายคอลัมน์ Value ตามแบบร่าง 21)', () => {
  it('Buy/Cash withdrawal/Transfer from = out · Sell/Dividend/Cash deposit/Transfer to = in · ปันผลลงทุนต่อ = null · แลกเงินตามฝั่งที่แสดง', () => {
    const data = base({
      assets: [USD_A, FUND],
      trades: [
        trade({ id: 'b', assetId: 'a1', kind: 'buy', date: '2026-03-10', units: U(1), amount: 100, fxRateMicro: 32_000_000 }),
        trade({ id: 's', assetId: 'a1', kind: 'sell', date: '2026-03-11', units: U(1), priceMicro: 1_000_000, fxRateMicro: 32_000_000 }),
        trade({ id: 'd', assetId: 'a1', kind: 'dividend', date: '2026-03-12', amount: 100, fxRateMicro: 32_000_000 }),
        trade({ id: 'r', assetId: 'f1', kind: 'reinvest', date: '2026-03-13', units: U(1), amount: 100 }),
      ],
      fxExchanges: [
        { id: 'x1', date: '2026-03-14', createdAt: '2026-03-14T00:00:00.000Z', direction: 'thb_to_usd', thbSatang: 3_300, usdCents: 100, rateMicro: 33_000_000, memo: '', entryId: 'ex1' },
        { id: 'x2', date: '2026-03-15', createdAt: '2026-03-15T00:00:00.000Z', direction: 'usd_to_thb', thbSatang: 3_300, usdCents: 100, rateMicro: 33_000_000, memo: '', entryId: 'ex2' },
      ],
    });
    const entries: Entry[] = [
      { id: 'tin', date: '2026-02-01', memo: '', source: 'manual', lines: [{ accountId: 'brk', amount: 500 }, { accountId: 'w1', amount: -500 }] },
      { id: 'tout', date: '2026-02-02', memo: '', source: 'manual', lines: [{ accountId: 'w1', amount: 500 }, { accountId: 'brk', amount: -500 }] },
      { id: 'dep', date: '2026-02-03', memo: '', source: 'manual', lines: [{ accountId: 'usd-cash', amount: 7_000 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: -7_000 }] },
      { id: 'wd', date: '2026-02-04', memo: '', source: 'manual', lines: [{ accountId: 'usd-cash', amount: -7_000 }, { accountId: CASH_ADJUST_ACCOUNT_IDS.USD, amount: 7_000 }] },
    ];
    const dir = (cur: 'USD' | 'THB') => Object.fromEntries(build(data, cur, entries).rows.map((r) => [r.sourceId, r.direction]));
    expect(dir('THB')).toMatchObject({ b: 'out', s: 'in', d: 'in', r: null, tin: 'in', tout: 'out', dep: 'in', wd: 'out', x1: 'out', x2: 'in' });
    expect(dir('USD')).toMatchObject({ x1: 'in', x2: 'out' });
  });
});

describe('เรตล่าสุดเก่า (R26: เกิน 30 วันเตือน)', () => {
  it('days/stale จากวันที่ของเรตถึงวันนี้', () => {
    const at = (date: string) => build(base({ fxRates: [{ accountId: 'usd-cash', date, rateMicro: 32_500_000 }] })).fx;
    expect(at('2026-11-10')).toMatchObject({ days: 9, stale: false });
    expect(at('2026-10-20')).toMatchObject({ days: 30, stale: false });
    expect(at('2026-10-19')).toMatchObject({ days: 31, stale: true });
    expect(build(base({ fxRates: [] })).fx).toBeNull();
  });
});
