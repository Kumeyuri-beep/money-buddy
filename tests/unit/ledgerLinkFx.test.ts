import { describe, expect, it } from 'vitest';
import { applyBuyFx, applySellFx, emptyPositionFx } from '../../src/domain/invest/costBasisFx';
import { exchangeEntryProblem } from '../../src/domain/invest/fxExchange';
import { fxRateFromExchange } from '../../src/domain/invest/fx';
import { FX_SUSPENSE_ACCOUNT_IDS, USD_RESULT_ACCOUNT_IDS, UsdLinkError, buildFxExchangeEntry, buildUsdTradeEntry } from '../../src/domain/invest/ledgerLinkFx';
import type { FxExchangeRecord, TradeRecord } from '../../src/domain/invest/types';
import { createEntry } from '../../src/domain/ledger/entry';
import type { Account } from '../../src/domain/ledger/types';

// ข้อมูลสมมติ (ไม่ใช่ข้อมูลจริง) ตรงกับตัวอย่างในเทสต์ SQL: ซื้อ 10 หุ้น $1,000.00 + ค่าธรรมเนียม $1.00 ที่ 35.000000 แล้วขาย 4 หุ้น ที่ $120.00 ค่าธรรมเนียม $1.00 ที่ 33.000000
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
  { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: FX_SUSPENSE_ACCOUNT_IDS.thb, type: 'equity', name: 'พักบาท', currency: 'THB' },
  { id: FX_SUSPENSE_ACCOUNT_IDS.usd, type: 'equity', name: 'พัก USD', currency: 'USD' },
  { id: 'usd-cash', type: 'asset', name: 'เงินสด USD', currency: 'USD', kind: 'investment' },
  { id: 'inv-us', type: 'asset', name: 'หุ้นสหรัฐ ก', currency: 'USD', kind: 'investment' },
  { id: USD_RESULT_ACCOUNT_IDS.gain, type: 'income', name: 'กำไร USD', currency: 'USD' },
  { id: USD_RESULT_ACCOUNT_IDS.loss, type: 'expense', name: 'ขาดทุน USD', currency: 'USD' },
  { id: USD_RESULT_ACCOUNT_IDS.dividend, type: 'income', name: 'ปันผล USD', currency: 'USD' },
  { id: USD_RESULT_ACCOUNT_IDS.withholding, type: 'expense', name: 'ภาษีหัก USD', currency: 'USD' },
];

const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 't', assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});

const sum = (lines: readonly { amount: number }[]): number => lines.reduce((n, l) => n + l.amount, 0);

describe('buildUsdTradeEntry (R20.5)', () => {
  it('ซื้อ: บัญชีหุ้น +(A+F) · เงินสด USD −(A+F) · ผ่านด่านสมุด', () => {
    const t = trade({ units: '1000000000', amount: 100_000, fee: 100 });
    const r = buildUsdTradeEntry({ trade: t, assetName: 'ABC', assetAccountId: 'inv-us', cashAccountId: 'usd-cash', entryId: 'b1-e' });
    expect(r.entry.lines).toEqual([{ accountId: 'inv-us', amount: 100_100 }, { accountId: 'usd-cash', amount: -100_100 }]);
    expect(r.resultAccountIds).toEqual([]);
    expect(() => createEntry(accounts, { id: r.entry.id, date: r.entry.date, memo: r.entry.memo, lines: r.entry.lines })).not.toThrow();
  });

  it('ขาย: ตรงตัวอย่างฐานข้อมูล (เงินสด +47,900 · หุ้น −40,040 · กำไร −7,860)', () => {
    let pos = applyBuyFx(emptyPositionFx(), { units: 1_000_000_000n, amount: 100_000, fee: 100, fxRateMicro: 35_000_000 });
    const sell = applySellFx(pos, { units: 400_000_000n, priceMicro: 120_000_000, fee: 100, fxRateMicro: 33_000_000 });
    pos = sell.position;
    const t = trade({ id: 's1', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 120_000_000, fee: 100, fxRateMicro: 33_000_000 });
    const r = buildUsdTradeEntry({ trade: t, assetName: 'ABC', assetAccountId: 'inv-us', cashAccountId: 'usd-cash', entryId: 's1-e', sell });
    expect(r.entry.lines).toEqual([
      { accountId: 'usd-cash', amount: 47_900 },
      { accountId: 'inv-us', amount: -40_040 },
      { accountId: USD_RESULT_ACCOUNT_IDS.gain, amount: -7_860 },
    ]);
    expect(r.resultAccountIds).toEqual([USD_RESULT_ACCOUNT_IDS.gain]);
    expect(sum(r.entry.lines)).toBe(0);
    expect(() => createEntry(accounts, { id: r.entry.id, date: r.entry.date, memo: r.entry.memo, lines: r.entry.lines })).not.toThrow();
  });

  it('ขายขาดทุนราคา: ใช้บัญชีขาดทุน USD (ยอดบวก) และผลรวมเป็น 0', () => {
    const pos = applyBuyFx(emptyPositionFx(), { units: 1_000_000_000n, amount: 100_000, fee: 0, fxRateMicro: 35_000_000 });
    const sell = applySellFx(pos, { units: 1_000_000_000n, priceMicro: 80_000_000, fee: 0, fxRateMicro: 34_000_000 });
    const t = trade({ id: 's2', kind: 'sell', date: '2026-11-11', units: '1000000000', priceMicro: 80_000_000, fxRateMicro: 34_000_000 });
    const r = buildUsdTradeEntry({ trade: t, assetName: 'ABC', assetAccountId: 'inv-us', cashAccountId: 'usd-cash', entryId: 's2-e', sell });
    expect(r.entry.lines).toEqual([
      { accountId: 'usd-cash', amount: 80_000 },
      { accountId: 'inv-us', amount: -100_000 },
      { accountId: USD_RESULT_ACCOUNT_IDS.loss, amount: 20_000 },
    ]);
    expect(r.resultAccountIds).toEqual([USD_RESULT_ACCOUNT_IDS.loss]);
    expect(sum(r.entry.lines)).toBe(0);
  });

  it('ขายเท่าทุน (กำไรราคา 0): ไม่มีบรรทัดกำไร/ขาดทุน (ห้ามบรรทัดยอด 0)', () => {
    const pos = applyBuyFx(emptyPositionFx(), { units: 1_000_000_000n, amount: 100_000, fee: 0, fxRateMicro: 35_000_000 });
    const sell = applySellFx(pos, { units: 1_000_000_000n, priceMicro: 100_000_000, fee: 0, fxRateMicro: 35_000_000 });
    const t = trade({ id: 's3', kind: 'sell', units: '1000000000', priceMicro: 100_000_000 });
    const r = buildUsdTradeEntry({ trade: t, assetName: 'ABC', assetAccountId: 'inv-us', cashAccountId: 'usd-cash', entryId: 's3-e', sell });
    expect(r.entry.lines).toHaveLength(2);
    expect(r.resultAccountIds).toEqual([]);
  });

  it('ปันผล: เงินสด +(D−W) · ภาษีหัก +W · ปันผล −D', () => {
    const t = trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', amount: 5_000, withholding: 750, fxRateMicro: 34_567_891 });
    const r = buildUsdTradeEntry({ trade: t, assetName: 'ABC', assetAccountId: 'inv-us', cashAccountId: 'usd-cash', entryId: 'd1-e' });
    expect(r.entry.lines).toEqual([
      { accountId: 'usd-cash', amount: 4_250 },
      { accountId: USD_RESULT_ACCOUNT_IDS.withholding, amount: 750 },
      { accountId: USD_RESULT_ACCOUNT_IDS.dividend, amount: -5_000 },
    ]);
    expect(r.resultAccountIds).toEqual([USD_RESULT_ACCOUNT_IDS.dividend, USD_RESULT_ACCOUNT_IDS.withholding]);
  });

  it('ปันผลไม่มีภาษีหัก: ไม่ใช้บัญชีภาษีหัก', () => {
    const t = trade({ id: 'd2', kind: 'dividend', amount: 5_000, withholding: 0 });
    const r = buildUsdTradeEntry({ trade: t, assetName: 'ABC', assetAccountId: 'inv-us', cashAccountId: 'usd-cash', entryId: 'd2-e' });
    expect(r.entry.lines).toEqual([{ accountId: 'usd-cash', amount: 5_000 }, { accountId: USD_RESULT_ACCOUNT_IDS.dividend, amount: -5_000 }]);
    expect(r.resultAccountIds).toEqual([USD_RESULT_ACCOUNT_IDS.dividend]);
  });

  it('ปฏิเสธ: ไม่เลือกเงินสด USD · ขายไม่มีผลคำนวณ · ปันผลลงทุนต่อ · รายการที่ไม่เปลี่ยนยอด', () => {
    const base = { assetName: 'ABC', assetAccountId: 'inv-us', entryId: 'x' };
    expect(() => buildUsdTradeEntry({ ...base, trade: trade({ amount: 1_000 }), cashAccountId: '' })).toThrow(UsdLinkError);
    expect(() => buildUsdTradeEntry({ ...base, trade: trade({ kind: 'sell', units: '1' }), cashAccountId: 'usd-cash' })).toThrow('ไม่มีผลคำนวณ');
    expect(() => buildUsdTradeEntry({ ...base, trade: trade({ kind: 'reinvest', amount: 100 }), cashAccountId: 'usd-cash' })).toThrow('ปันผลลงทุนต่อ');
    expect(() => buildUsdTradeEntry({ ...base, trade: trade({ amount: 0, fee: 0 }), cashAccountId: 'usd-cash' })).toThrow('ไม่เปลี่ยนยอด');
  });

  it('memo รวมชื่อสินทรัพย์และหมายเหตุผู้ใช้', () => {
    const t = trade({ amount: 1_000, memo: ' ซื้อเพิ่ม ' });
    const r = buildUsdTradeEntry({ trade: t, assetName: 'ABC', assetAccountId: 'inv-us', cashAccountId: 'usd-cash', entryId: 'm' });
    expect(r.entry.memo).toBe('ซื้อ ABC · ซื้อเพิ่ม');
  });
});

describe('buildFxExchangeEntry (R20.2)', () => {
  const ex = (over: Partial<FxExchangeRecord> = {}): FxExchangeRecord => ({
    id: 'fx1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', direction: 'thb_to_usd', thbSatang: 7_000_000, usdCents: 200_000, rateMicro: fxRateFromExchange(7_000_000, 200_000), memo: '', entryId: 'fx1-e', ...over,
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  it('บาท→USD: ตรงกับที่ตัวตรวจ exchangeEntryProblem ยอมรับ และผ่านด่านสมุดข้ามสกุล', () => {
    const r = buildFxExchangeEntry({ exchange: ex(), walletId: 'w1', cashAccountId: 'usd-cash', entryId: 'fx1-e' });
    expect(r.entry.lines).toEqual([
      { accountId: 'w1', amount: -7_000_000 },
      { accountId: FX_SUSPENSE_ACCOUNT_IDS.thb, amount: 7_000_000 },
      { accountId: 'usd-cash', amount: 200_000 },
      { accountId: FX_SUSPENSE_ACCOUNT_IDS.usd, amount: -200_000 },
    ]);
    expect(r.suspenseAccountIds).toEqual([FX_SUSPENSE_ACCOUNT_IDS.thb, FX_SUSPENSE_ACCOUNT_IDS.usd]);
    expect(exchangeEntryProblem(ex(), r.entry, accountById)).toBeNull();
    expect(() => createEntry(accounts, { id: r.entry.id, date: r.entry.date, memo: r.entry.memo, lines: r.entry.lines })).not.toThrow();
  });

  it('USD→บาท: เครื่องหมายตรงข้ามทั้งหมด และตัวตรวจยอมรับ', () => {
    const x = ex({ direction: 'usd_to_thb', thbSatang: 3_500_000, usdCents: 100_000, rateMicro: fxRateFromExchange(3_500_000, 100_000) });
    const r = buildFxExchangeEntry({ exchange: x, walletId: 'w1', cashAccountId: 'usd-cash', entryId: 'fx1-e' });
    expect(r.entry.lines.map((l) => l.amount)).toEqual([3_500_000, -3_500_000, -100_000, 100_000]);
    expect(exchangeEntryProblem(x, r.entry, accountById)).toBeNull();
    expect(r.entry.memo).toBe('แลกเงิน USD → บาท');
  });

  it('ตัวตรวจฝั่งนำเข้ายังยอมรับเมื่อกระเป๋าบาทถูกเปลี่ยนป้ายเป็นเงินลงทุน (R23)', () => {
    const relabeled = new Map(accountById);
    relabeled.set('w1', { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB', kind: 'investment' });
    const r = buildFxExchangeEntry({ exchange: ex(), walletId: 'w1', cashAccountId: 'usd-cash', entryId: 'fx1-e' });
    expect(exchangeEntryProblem(ex(), r.entry, relabeled)).toBeNull();
  });

  it('ปฏิเสธเมื่อไม่เลือกกระเป๋าบาทหรือเงินสด USD', () => {
    expect(() => buildFxExchangeEntry({ exchange: ex(), walletId: '', cashAccountId: 'usd-cash', entryId: 'x' })).toThrow(UsdLinkError);
    expect(() => buildFxExchangeEntry({ exchange: ex(), walletId: 'w1', cashAccountId: '', entryId: 'x' })).toThrow(UsdLinkError);
  });
});
