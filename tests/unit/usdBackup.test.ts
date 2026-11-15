import { describe, expect, it } from 'vitest';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { fxRateFromExchange } from '../../src/domain/invest/fx';
import type { InvestmentData } from '../../src/domain/invest/types';
import { checkUsdInvestmentIntegrity, negativeUsdCash, usdCashBalances } from '../../src/domain/invest/usdIntegrity';
import { createEntry } from '../../src/domain/ledger/entry';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { investmentsToJson, rowToAsset, rowToFxExchange, rowToFxRate, rowToTrade } from '../../src/storage/supabaseRepository';

const TODAY = '2026-11-10';

// ข้อมูลสมมติ (ไม่ใช่ข้อมูลจริง): แลก 70,000.00 บาท = 2,000.00 USD (อัตรา 35.000000) แล้วซื้อ 10 หุ้น $1,000.00 ค่าธรรมเนียม $1.00
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
  { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'fx-suspense-thb', type: 'equity', name: 'พักบาท', currency: 'THB' },
  { id: 'fx-suspense-usd', type: 'equity', name: 'พัก USD', currency: 'USD' },
  { id: 'usd-cash', type: 'asset', name: 'เงินสด USD', currency: 'USD', kind: 'investment' },
  { id: 'inv-us', type: 'asset', name: 'หุ้นสหรัฐ ก', currency: 'USD', kind: 'investment' },
  { id: 'inv-th', type: 'asset', name: 'กองทุนไทย', currency: 'THB', kind: 'investment' },
];
const line = (accountId: string, amount: number) => ({ accountId, amount });
const entries: Entry[] = [
  createEntry(accounts, { id: 'sys', date: '2026-11-01', memo: 'o', source: 'system', lines: [line('w1', 10_000_000), line('open', -10_000_000)] }),
  createEntry(accounts, {
    id: 'fx1-e',
    date: '2026-11-02',
    memo: 'แลก',
    source: 'manual',
    lines: [line('w1', -7_000_000), line('fx-suspense-thb', 7_000_000), line('usd-cash', 200_000), line('fx-suspense-usd', -200_000)],
  }),
  createEntry(accounts, { id: 'b1-e', date: '2026-11-03', memo: 'ซื้อ', source: 'manual', lines: [line('inv-us', 100_100), line('usd-cash', -100_100)] }),
];

const usdAsset = (over: Record<string, unknown> = {}) => ({ id: 'us1', name: 'หุ้นสหรัฐ ก', kind: 'stock', accountId: 'inv-us', currency: 'USD', ticker: 'ABC', exchange: 'NASDAQ', ...over });
const usdBuy = (over: Record<string, unknown> = {}) => ({
  id: 't-buy', assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 100, withholding: 0, memo: '', entryId: 'b1-e', fxRateMicro: 35_000_000, ...over,
});
const rate = (over: Record<string, unknown> = {}) => ({ accountId: 'usd-cash', date: '2026-11-02', rateMicro: 35_000_000, ...over });
const exch = (over: Record<string, unknown> = {}) => ({
  id: 'fx1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', direction: 'thb_to_usd', thbSatang: 7_000_000, usdCents: 200_000, rateMicro: 35_000_000, memo: 'แลก', entryId: 'fx1-e', ...over,
});
const inv = (over: Record<string, unknown> = {}) => ({ assets: [usdAsset()], trades: [usdBuy()], prices: [], fxRates: [rate()], fxExchanges: [exch()], ...over });
const file = (investments: unknown, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ schemaVersion: 2, exportedAt: '2026-11-10T00:00:00.000Z', accounts, entries, bills: [], settings: {}, investments, ...over });
const parsed = (investments: unknown, over: Record<string, unknown> = {}) => {
  const r = parseBackup(file(investments, over), TODAY);
  if (!r.ok) throw new Error(r.problems.join('\n'));
  return r.data.investments as InvestmentData;
};
const problemsOf = (investments: unknown): string => {
  const r = parseBackup(file(investments), TODAY);
  if (r.ok) throw new Error('ควรถูกปฏิเสธ');
  return r.problems.join(' | ');
};

describe('ไฟล์สำรอง: ข้อมูล USD (A3-1)', () => {
  it('ไฟล์ที่มีข้อมูล USD ครบผ่าน ได้ข้อมูลครบทุกฟิลด์', () => {
    const d = parsed(inv());
    expect(d.assets).toEqual([{ id: 'us1', name: 'หุ้นสหรัฐ ก', kind: 'stock', accountId: 'inv-us', currency: 'USD', ticker: 'ABC', exchange: 'NASDAQ' }]);
    expect(d.trades).toEqual([
      { id: 't-buy', assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 100, withholding: 0, memo: '', entryId: 'b1-e', fxRateMicro: 35_000_000 },
    ]);
    expect(d.fxRates).toEqual([{ accountId: 'usd-cash', date: '2026-11-02', rateMicro: 35_000_000 }]);
    expect(d.fxExchanges).toEqual([
      { id: 'fx1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', direction: 'thb_to_usd', thbSatang: 7_000_000, usdCents: 200_000, rateMicro: 35_000_000, memo: 'แลก', entryId: 'fx1-e' },
    ]);
  });

  it('ส่งออกแล้วนำเข้ากลับ: ข้อมูลตรงทุกเซนต์/สตางค์/อัตรา (JSON ไป-กลับ ไม่ผ่านทศนิยม)', () => {
    const original = parsed(inv());
    const text = JSON.stringify(investmentsToJson(original));
    const back = parsed(JSON.parse(text));
    expect(back).toEqual(original);
    expect(JSON.stringify(investmentsToJson(back))).toBe(text); // ส่งออกซ้ำได้ไฟล์เดิมเป๊ะ
  });

  it('ไฟล์ที่มีแต่การแลกเงิน/อัตรา (ยังไม่มีสินทรัพย์ USD) ก็ผ่านและส่งออก-นำเข้าได้', () => {
    const only = { assets: [], trades: [], prices: [], fxRates: [rate()], fxExchanges: [exch()] };
    const original = parsed(only);
    expect(parsed(JSON.parse(JSON.stringify(investmentsToJson(original))))).toEqual(original);
  });

  it('ข้อมูลบาทเดิม: ไม่มีฟิลด์ USD ในไฟล์ที่ส่งออกเลย · ไฟล์เก่านำเข้าได้เหมือนเดิม', () => {
    const thb = {
      assets: [{ id: 'a1', name: 'กองทุนไทย', kind: 'fund', accountId: 'inv-th' }],
      trades: [{ id: 't1', assetId: 'a1', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '500000000', priceMicro: 10_000_000, amount: 50_000, fee: 5, withholding: 0, memo: '' }],
      prices: [{ assetId: 'a1', date: '2026-11-10', priceMicro: 11_000_000 }],
    };
    const d = parsed(thb);
    const text = JSON.stringify(investmentsToJson(d));
    for (const word of ['currency', 'ticker', 'exchange', 'fxRate', 'fxExchanges', 'fxRates']) expect(text).not.toContain(word);
    expect(parsed(JSON.parse(text))).toEqual(d);
    expect(d.fxRates).toBeUndefined();
    expect(d.fxExchanges).toBeUndefined();
  });

  const bad: Array<[string, () => unknown, RegExp]> = [
    ['สินทรัพย์ USD ผูกบัญชีบาท', () => inv({ assets: [usdAsset({ accountId: 'inv-th' })] }), /บัญชีลงทุนสกุล USD/],
    ['สินทรัพย์บาทผูกบัญชี USD', () => inv({ assets: [usdAsset({ currency: undefined })] }), /บัญชีลงทุนสกุลบาท/],
    ['สกุลไม่รองรับ', () => inv({ assets: [usdAsset({ currency: 'EUR' })] }), /THB หรือ USD/],
    ['ตลาดนอกรายการ', () => inv({ assets: [usdAsset({ exchange: 'LSE' })] }), /ตลาดต้องเป็น/],
    ['ชื่อย่อหุ้นยาวเกิน', () => inv({ assets: [usdAsset({ ticker: 'A'.repeat(21) })] }), /ชื่อย่อหุ้น/],
    ['รายการ USD ไม่มีอัตรา', () => inv({ trades: [usdBuy({ fxRateMicro: undefined })] }), /ต้องมีอัตราแลกเปลี่ยน/],
    ['รายการ USD อัตรา 0', () => inv({ trades: [usdBuy({ fxRateMicro: 0 })] }), /อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม/],
    ['รายการ USD ไม่ผูกสมุด', () => inv({ trades: [usdBuy({ entryId: undefined })] }), /ผูกกับรายการในสมุด/],
    ['ปันผลลงทุนต่อของ USD', () => inv({ trades: [usdBuy(), { id: 't-re', assetId: 'us1', kind: 'reinvest', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '1000000', amount: 100, fee: 0, withholding: 0, memo: '', entryId: 'b1-e', fxRateMicro: 35_000_000 }] }), /ยังไม่รองรับ/],
    ['ขาย USD เกินที่ถือ', () => inv({ trades: [usdBuy(), { id: 't-sell', assetId: 'us1', kind: 'sell', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '2000000000', priceMicro: 100_000_000, fee: 0, withholding: 0, memo: '', entryId: 'b1-e', fxRateMicro: 35_000_000 }] }), /ไม่สอดคล้อง/],
    ['ซื้อ USD ที่ต้นทุนบาทปัดเป็น 0', () => inv({ trades: [usdBuy({ amount: 1, fee: 0, fxRateMicro: 400_000 })] }), /ไม่สอดคล้อง/],
    ['รายการบาทมีอัตรา', () => inv({ assets: [{ id: 'a1', name: 'x', kind: 'fund', accountId: 'inv-th' }], trades: [{ id: 't1', assetId: 'a1', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '100000000', amount: 100, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000 }] }), /ต้องไม่มีอัตรา/],
    ['อัตราผูกกระเป๋าบาท', () => inv({ fxRates: [rate({ accountId: 'w1' })] }), /บัญชีลงทุนสกุล USD/],
    ['อัตราซ้ำวันเดียวกัน', () => inv({ fxRates: [rate(), rate({ rateMicro: 36_000_000 })] }), /ซ้ำ/],
    ['อัตราแลกเงินไม่ตรงสองจำนวน', () => inv({ fxExchanges: [exch({ rateMicro: 35_000_001 })] }), /อัตราแลกเปลี่ยนไม่ตรง/],
    ['จำนวน USD ไม่ตรง Entry', () => inv({ fxExchanges: [exch({ usdCents: 200_001, rateMicro: fxRateFromExchange(7_000_000, 200_001) })] }), /จำนวน USD ในสมุดไม่ตรง/],
    ['จำนวนบาทไม่ตรง Entry', () => inv({ fxExchanges: [exch({ thbSatang: 7_000_001, rateMicro: fxRateFromExchange(7_000_001, 200_000) })] }), /จำนวนบาทในสมุดไม่ตรง/],
    ['ทิศทางสลับกับเครื่องหมายใน Entry', () => inv({ fxExchanges: [exch({ direction: 'usd_to_thb' })] }), /ไม่ตรง/],
    ['วันที่ไม่ตรง Entry', () => inv({ fxExchanges: [exch({ date: '2026-11-04' })] }), /วันที่ของการแลกเงินไม่ตรง/],
    ['Entry ไม่มีในสมุด', () => inv({ fxExchanges: [exch({ entryId: 'nope' })] }), /ไม่ตรงกับรายการในสมุด/],
    ['ใช้ Entry เดียวกับสองการแลก', () => inv({ fxExchanges: [exch(), exch({ id: 'fx2' })] }), /ถูกใช้กับการแลกเงินอื่นแล้ว/],
    ['รหัสแลกเงินซ้ำ', () => inv({ fxExchanges: [exch(), exch({ entryId: 'b1-e' })] }), /ซ้ำ/],
    ['ทิศทางไม่รู้จัก', () => inv({ fxExchanges: [exch({ direction: 'sideways' })] }), /ทิศทางต้องเป็น/],
    ['จำนวน 0', () => inv({ fxExchanges: [exch({ usdCents: 0 })] }), /ต้องเป็นจำนวนเต็ม ≥ 1/],
    ['fxRates ไม่ใช่อาร์เรย์', () => inv({ fxRates: {} }), /fxRates ต้องเป็นอาร์เรย์/],
  ];
  for (const [name, make, expected] of bad) {
    it(`ปฏิเสธ: ${name}`, () => {
      expect(problemsOf(make())).toMatch(expected);
    });
  }
});

describe('แปลงแถวฐานข้อมูล ↔ ข้อมูลลงทุน (USD)', () => {
  it('สินทรัพย์: คอลัมน์ใหม่ → ฟิลด์ใหม่ · แถวที่ไม่มีคอลัมน์ใหม่ (ข้อมูลเดิม) ได้ผลเหมือนเดิม', () => {
    expect(rowToAsset({ id: 'us1', name: 'x', kind: 'stock', account_id: 'inv-us', archived: false, instrument_currency: 'USD', ticker: 'ABC', exchange: 'NASDAQ' })).toEqual({
      id: 'us1', name: 'x', kind: 'stock', accountId: 'inv-us', currency: 'USD', ticker: 'ABC', exchange: 'NASDAQ',
    });
    expect(rowToAsset({ id: 'a1', name: 'x', kind: 'fund', account_id: 'inv1', archived: false })).toEqual({ id: 'a1', name: 'x', kind: 'fund', accountId: 'inv1' });
    expect(rowToAsset({ id: 'a1', name: 'x', kind: 'fund', account_id: 'inv1', archived: false, instrument_currency: 'THB', ticker: null, exchange: null })).toEqual({ id: 'a1', name: 'x', kind: 'fund', accountId: 'inv1' });
    expect(() => rowToAsset({ id: 'a1', name: 'x', kind: 'fund', account_id: 'inv1', archived: false, instrument_currency: 'EUR' })).toThrow(/สกุลของสินทรัพย์/);
  });
  it('รายการ/อัตรา/การแลกเงิน: ตัวเลขที่ฐานข้อมูลส่งเป็นข้อความหรือ number ได้ค่าเดียวกัน', () => {
    const base = { id: 't', asset_id: 'us1', kind: 'buy', date: '2026-11-03', created_at: '2026-11-03T03:00:00+00:00', units: '1000000000', price_micro: 100000000, amount: '100000', fee: 100, withholding: 0, memo: '', entry_id: 'b1-e' };
    expect(rowToTrade({ ...base, fx_rate_micro: '35000000' }).fxRateMicro).toBe(35_000_000);
    expect(rowToTrade({ ...base, fx_rate_micro: null }).fxRateMicro).toBeUndefined();
    expect(rowToTrade(base).fxRateMicro).toBeUndefined();
    expect(rowToFxRate({ account_id: 'usd-cash', date: '2026-11-02', rate_micro: '35000000' })).toEqual({ accountId: 'usd-cash', date: '2026-11-02', rateMicro: 35_000_000 });
    expect(rowToFxExchange({ id: 'fx1', date: '2026-11-02', created_at: '2026-11-02T03:00:00+00:00', direction: 'thb_to_usd', thb_satang: '7000000', usd_cents: 200000, rate_micro: 35000000, memo: 'แลก', entry_id: 'fx1-e' })).toEqual(
      parsed(inv()).fxExchanges?.[0],
    );
    expect(() => rowToFxExchange({ id: 'fx1', date: '2026-11-02', created_at: '2026-11-02T03:00:00+00:00', direction: 'x', thb_satang: 1, usd_cents: 1, rate_micro: 1, memo: '', entry_id: 'e' })).toThrow(/ทิศทาง/);
  });
});

describe('Integrity ต้นทุน USD และเงินสด USD ติดลบ (R17, R20.8)', () => {
  const data = parsed(inv());
  it('ข้อมูลถูกต้อง: ไม่พบปัญหา · runIntegrityCheck ที่ใส่ข้อมูลลงทุนก็ผ่าน และที่ไม่ใส่ทำงานเหมือนเดิม', () => {
    expect(checkUsdInvestmentIntegrity(accounts, entries, data)).toEqual([]);
    expect(runIntegrityCheck(accounts, entries, data).ok).toBe(true);
    expect(runIntegrityCheck(accounts, entries).ok).toBe(true);
    expect(checkUsdInvestmentIntegrity(accounts, entries, undefined)).toEqual([]);
  });
  it('ต้นทุน USD ในสมุดไม่ตรงกับที่เล่นซ้ำ → รายงาน invest-usd-cost พร้อมตัวเลขเซนต์', () => {
    const tampered = entries.map((e) => (e.id === 'b1-e' ? createEntry(accounts, { id: 'b1-e', date: e.date, memo: e.memo, source: 'manual', lines: [line('inv-us', 90_100), line('usd-cash', -90_100)] }) : e));
    const issues = checkUsdInvestmentIntegrity(accounts, tampered, data);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'invest-usd-cost', accountId: 'inv-us' });
    expect(issues[0]?.message).toContain('90100');
    expect(issues[0]?.message).toContain('100100');
    expect(runIntegrityCheck(accounts, tampered, data).ok).toBe(false);
  });
  it('การแลกเงินไม่ตรง Entry หรืออัตราผิด → รายงาน invest-fx-exchange', () => {
    const tampered = entries.map((e) =>
      e.id === 'fx1-e'
        ? createEntry(accounts, { id: 'fx1-e', date: e.date, memo: e.memo, source: 'manual', lines: [line('w1', -7_000_000), line('fx-suspense-thb', 7_000_000), line('usd-cash', 300_000), line('fx-suspense-usd', -300_000)] })
        : e,
    );
    expect(checkUsdInvestmentIntegrity(accounts, tampered, data).map((i) => i.code)).toEqual(['invest-fx-exchange']);
    const x0 = data.fxExchanges?.[0];
    if (!x0) throw new Error('ต้องมีการแลกเงินในข้อมูลทดสอบ');
    const badRate: InvestmentData = { ...data, fxExchanges: [{ ...x0, rateMicro: 35_000_001 }] };
    expect(checkUsdInvestmentIntegrity(accounts, entries, badRate).map((i) => i.code)).toEqual(['invest-fx-exchange']);
    const missing: InvestmentData = { ...data, fxExchanges: [{ ...x0, entryId: 'nope' }] };
    expect(checkUsdInvestmentIntegrity(accounts, entries, missing)[0]?.message).toContain('ไม่พบรายการในสมุด');
  });
  it('รายการ USD ไม่มีอัตราหรือเล่นซ้ำไม่ได้ → รายงานปัญหาแทนที่จะล้มทั้งตัวตรวจ', () => {
    const noRate: InvestmentData = { ...data, trades: data.trades.map((t) => ({ ...t, fxRateMicro: undefined })) };
    expect(checkUsdInvestmentIntegrity(accounts, entries, noRate)[0]).toMatchObject({ code: 'invest-usd-trade' });
    const oversold: InvestmentData = { ...data, trades: [...data.trades, { id: 'ts', assetId: 'us1', kind: 'sell', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '2000000000', priceMicro: 100_000_000, fee: 0, withholding: 0, memo: '', entryId: 'b1-e', fxRateMicro: 35_000_000 }] };
    expect(checkUsdInvestmentIntegrity(accounts, entries, oversold)[0]).toMatchObject({ code: 'invest-usd-cost' });
  });
  it('เงินสด USD: ยอดคงเหลือเป็นเซนต์ ไม่รวมบัญชีต้นทุนของสินทรัพย์ · ติดลบ = รายงาน', () => {
    expect(usdCashBalances(accounts, entries, data)).toEqual([{ accountId: 'usd-cash', name: 'เงินสด USD', cents: 99_900 }]);
    expect(negativeUsdCash(accounts, entries, data)).toEqual([]);
    const drained = [...entries, createEntry(accounts, { id: 'b2-e', date: '2026-11-04', memo: 'ซื้อเพิ่ม', source: 'manual', lines: [line('inv-us', 200_000), line('usd-cash', -200_000)] })];
    expect(negativeUsdCash(accounts, drained, data)).toEqual([{ accountId: 'usd-cash', name: 'เงินสด USD', cents: -100_100 }]);
    const exactlyZero = [...entries, createEntry(accounts, { id: 'b3-e', date: '2026-11-04', memo: 'ซื้อ', source: 'manual', lines: [line('inv-us', 99_900), line('usd-cash', -99_900)] })];
    expect(negativeUsdCash(accounts, exactlyZero, data)).toEqual([]); // 0 ไม่ใช่ติดลบ
    expect(negativeUsdCash(accounts, entries, undefined)).toEqual([]);
  });
});
