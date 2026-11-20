import { describe, expect, it } from 'vitest';
import { buildCashAdjustmentEntry, CASH_ADJUST_ACCOUNT_IDS } from '../../src/domain/invest/cashAdjustment';
import { usdCashBalances } from '../../src/domain/invest/usdIntegrity';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { buildAnalysisModel } from '../../src/ui/invest/analysis/analysisModel';
import { buildDashboardView } from '../../src/ui/invest/dashboard/dashboardView';

// R25.3-R25.4 ขอบเขตผลตอบแทน (เจ้าของอนุมัติ 20 พ.ย. 2569): ฝาก/ถอนเงินสดด้วย record_cash_adjustment ต้องไม่เปลี่ยน
// Modified Dietz รายเดือน, ผลทั้งปี (เชื่อมทบ/TWR) และ IRR แม้แต่ bps เดียว · ข้อมูลสมมติทั้งหมด
const asset = (id: string, ticker: string): Asset => ({ id, name: `Demo ${ticker}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-01-02', createdAt: `${over.date ?? '2026-01-02'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const DATA: InvestmentData = {
  assets: [asset('us1', 'AAA'), asset('us2', 'BBB')],
  trades: [
    trade({ id: 'b1' }),
    trade({ id: 'b2', assetId: 'us2', date: '2026-02-03', amount: 50_000, units: '500000000' }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-02-12', units: undefined, priceMicro: undefined, amount: 5_000, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [
    { assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 },
    { assetId: 'us1', date: '2026-02-28', priceMicro: 121_000_000 },
    { assetId: 'us2', date: '2026-02-28', priceMicro: 100_000_000 },
  ],
  fxRates: [{ accountId: 'usd-cash', date: '2026-01-01', rateMicro: 35_000_000 }],
};
const TODAY = '2026-02-28';

const cash: Account = { id: 'cash-usd', type: 'asset', name: 'Demo USD cash', currency: 'USD', kind: 'investment' };
const adjust: Account = { id: CASH_ADJUST_ACCOUNT_IDS.USD, type: 'equity', name: 'Cash adjustment USD', currency: 'USD' };
const adj = (id: string, date: string, direction: 'deposit' | 'withdraw', amountMinor: number): Entry =>
  buildCashAdjustmentEntry({ id, date, createdAt: `${date}T03:00:00.000Z`, cashAccountId: cash.id, currency: 'USD', direction, amountMinor, memo: '' }).entry;

describe('ผลตอบแทน (R25.3-R25.4) ไม่รวมเงินสด: ฝาก/ถอนเงินสดแล้วต้องได้ค่าเดิมทุกตัว', () => {
  const noCash = { accounts: [] as Account[], entries: [] as Entry[] };
  const manyAdjustments: Entry[] = [
    adj('c1', '2026-01-05', 'deposit', 3_000_000), // ฝาก $30,000.00 ก่อนซื้อ
    adj('c2', '2026-01-20', 'withdraw', 100_000),
    adj('c3', '2026-02-10', 'deposit', 7_777),
    adj('c4', '2026-02-27', 'withdraw', 1),
  ];
  const withCash = { accounts: [cash, adjust], entries: manyAdjustments };

  it('เงื่อนไขตั้งต้น: การฝาก/ถอนเปลี่ยนเงินสดจริง (ไม่ใช่เทสต์ที่ไม่ได้ทดสอบอะไร)', () => {
    const before = usdCashBalances(noCash.accounts, noCash.entries, DATA);
    const after = usdCashBalances(withCash.accounts, withCash.entries, DATA);
    expect(before).toEqual([]);
    expect(after.map((c) => c.cents)).toEqual([3_000_000 - 100_000 + 7_777 - 1]);
  });

  it('ตารางผลตอบแทนรายเดือน/ทั้งปี (แท็บวิเคราะห์ ผ่านสมุดบัญชีจริง) เท่าเดิมไม่ว่ามีเงินสดหรือไม่', () => {
    const a = buildAnalysisModel(noCash.accounts, noCash.entries, DATA, TODAY).monthly;
    const b = buildAnalysisModel(withCash.accounts, withCash.entries, DATA, TODAY).monthly;
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(a[0]!.total).not.toBeNull();
    // ตัวอย่างมือ R25.4: ม.ค. 1,069 bps แม้มีการฝากเงินสด $30,000 วันที่ 5 ม.ค.
    expect(b[0]!.cells[0]).toEqual({ kind: 'ok', bps: 1_069 });
  });

  it('IRR บนแดชบอร์ด (ผ่านสมุดบัญชีจริง) เท่าเดิมไม่ว่ามีเงินสดหรือไม่', () => {
    const a = buildDashboardView(noCash.accounts, noCash.entries, DATA, TODAY).irr;
    const b = buildDashboardView(withCash.accounts, withCash.entries, DATA, TODAY).irr;
    expect(a.kind).toBe('ok');
    expect(b).toEqual(a);
  });

  it('ฝากก้อนใหญ่มาก (ขอบ: ใกล้เพดานปลอดภัย) ก็ไม่เปลี่ยนผลตอบแทน', () => {
    const big = { accounts: [cash, adjust], entries: [adj('big', '2026-01-03', 'deposit', 1_000_000_000_000)] };
    expect(buildAnalysisModel(big.accounts, big.entries, DATA, TODAY).monthly).toEqual(buildAnalysisModel([], [], DATA, TODAY).monthly);
    expect(buildDashboardView(big.accounts, big.entries, DATA, TODAY).irr).toEqual(buildDashboardView([], [], DATA, TODAY).irr);
  });
});
