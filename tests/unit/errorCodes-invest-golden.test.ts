import { describe, expect, it } from 'vitest';
import { applyBuy, applySell, averageCostMicro, replayTrades } from '../../src/domain/invest/costBasis';
import { applyBuyFx, applySellFx, replayTradesFx } from '../../src/domain/invest/costBasisFx';
import { dcaUnits } from '../../src/domain/invest/dca';
import { dcaDueDate, dcaPlanProblem, type DcaPlan } from '../../src/domain/invest/dcaPlan';
import { assertFxRateMicro, convertMinor, dividendInThb, fxRateFromExchange, suggestWithholding } from '../../src/domain/invest/fx';
import { exchangeEntryProblem, exchangeRateProblem } from '../../src/domain/invest/fxExchange';
import { buildTradeEntry, TradeLinkError } from '../../src/domain/invest/ledgerLink';
import { buildFxExchangeEntry, buildUsdTradeEntry, UsdLinkError } from '../../src/domain/invest/ledgerLinkFx';
import { checkAccountKindChange } from '../../src/domain/invest/portfolioMoney';
import { checkTradeAdd, checkTradeDelete } from '../../src/domain/invest/rules';
import { assertPriceMicro, assertUnitsInRange, formatUnits, parsePriceMicro, parseUnits, toSafeSatang, valueInSatang } from '../../src/domain/invest/units';
import type { TradeRecord } from '../../src/domain/invest/types';

// ข้อความไทยเดิมก่อนทำรหัส error (golden): ห้ามแก้ค่าที่คาดหวังในไฟล์นี้ · เทียบผ่านฟังก์ชันจริงทุกตัว
const msgOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('ไม่โยน error');
};

const base = { fee: 0, withholding: 0, memo: '' };
const buy = (id: string, date: string, units = '500000000', amount = 50_000, over: Partial<TradeRecord> = {}): TradeRecord => ({
  id, assetId: 'a1', kind: 'buy', date, createdAt: `${date}T03:00:00.000Z`, units, amount, ...base, ...over,
});
const sell = (id: string, date: string, units = '100000000', priceMicro = 12_000_000, over: Partial<TradeRecord> = {}): TradeRecord => ({
  id, assetId: 'a1', kind: 'sell', date, createdAt: `${date}T04:00:00.000Z`, units, priceMicro, ...base, ...over,
});

describe('golden units', () => {
  it('ข้อความไทยเดิม', () => {
    expect(msgOf(() => parseUnits('abc'))).toBe('อ่านจำนวนหน่วยไม่ได้: "abc"');
    expect(msgOf(() => parsePriceMicro('x'))).toBe('อ่านราคาไม่ได้: "x"');
    expect(msgOf(() => parseUnits('0'))).toBe('จำนวนหน่วยต้องมากกว่า 0 (ละเอียดสุด 8 ตำแหน่ง)');
    expect(msgOf(() => parseUnits('99999999999999999999'))).toBe('จำนวนหน่วยมากเกินช่วงที่รองรับ');
    expect(msgOf(() => assertUnitsInRange(2n ** 63n))).toBe('จำนวนหน่วยมากเกินช่วงที่รองรับ');
    expect(msgOf(() => parsePriceMicro('0'))).toBe('ราคาต้องมากกว่า 0 (ละเอียดสุด 0.000001 บาท)');
    expect(msgOf(() => parsePriceMicro('99999999999999999999'))).toBe('ราคาสูงเกินช่วงที่รองรับ');
    expect(msgOf(() => formatUnits(-1n))).toBe('จำนวนหน่วยติดลบไม่ได้');
    expect(msgOf(() => valueInSatang(-1n, 1))).toBe('จำนวนหน่วยติดลบไม่ได้');
    expect(msgOf(() => assertPriceMicro(0))).toBe('ราคาต่อหน่วยต้องเป็นจำนวนเต็ม micro-baht ที่มากกว่า 0 (ได้รับ 0)');
    expect(msgOf(() => assertPriceMicro(1.5))).toBe('ราคาต่อหน่วยต้องเป็นจำนวนเต็ม micro-baht ที่มากกว่า 0 (ได้รับ 1.5)');
    expect(msgOf(() => toSafeSatang(2n ** 60n))).toBe('ผลลัพธ์เกินช่วงจำนวนเต็มปลอดภัย');
  });
});

describe('golden fx', () => {
  it('ข้อความไทยเดิม', () => {
    expect(msgOf(() => assertFxRateMicro(0))).toBe('อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม micro ที่มากกว่า 0 (ได้รับ 0)');
    expect(msgOf(() => convertMinor(-1, 1))).toBe('จำนวนเงิน ต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ -1)');
    expect(msgOf(() => suggestWithholding(1.5))).toBe('ยอดปันผล ต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ 1.5)');
    expect(msgOf(() => dividendInThb(100, -2, 1))).toBe('ภาษีหัก ณ ที่จ่าย ต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ -2)');
    expect(msgOf(() => fxRateFromExchange(0, 5))).toBe('จำนวนบาทที่จ่ายต้องเป็นสตางค์จำนวนเต็มตั้งแต่ 1');
    expect(msgOf(() => fxRateFromExchange(5, 0))).toBe('จำนวนดอลลาร์ที่ได้ต้องเป็นเซนต์จำนวนเต็มตั้งแต่ 1');
    expect(msgOf(() => suggestWithholding(100, 10_001))).toBe('อัตราภาษีหักต้องอยู่ระหว่าง 0-10,000 bps');
    expect(msgOf(() => dividendInThb(0, 0, 1))).toBe('ยอดปันผลต้องตั้งแต่ 1 เซนต์');
    expect(msgOf(() => dividendInThb(100, 100, 1))).toBe('ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดปันผล');
  });
});

describe('golden costBasis', () => {
  const pos = { units: 100_000_000n, cost: 1000 };
  it('ข้อความไทยเดิม', () => {
    expect(msgOf(() => applyBuy(pos, { units: 0n, amount: 1, fee: 0 }))).toBe('จำนวนหน่วยที่ซื้อต้องมากกว่า 0');
    expect(msgOf(() => applyBuy(pos, { units: 1n, amount: 0, fee: 0 }))).toBe('มูลค่าซื้อ ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ต่ำกว่า 1 (ได้รับ 0)');
    expect(msgOf(() => applyBuy(pos, { units: 1n, amount: 5, fee: -1 }))).toBe('ค่าธรรมเนียม ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ต่ำกว่า 0 (ได้รับ -1)');
    expect(msgOf(() => applySell({ units: 1n, cost: 0 }, { units: 1n, priceMicro: 1, fee: 0 }))).toBe('ตำแหน่งการลงทุนไม่ถูกต้อง');
    expect(msgOf(() => averageCostMicro({ units: -1n, cost: 1 }))).toBe('ตำแหน่งการลงทุนไม่ถูกต้อง');
    expect(msgOf(() => applySell(pos, { units: 0n, priceMicro: 1, fee: 0 }))).toBe('จำนวนหน่วยที่ขายต้องมากกว่า 0');
    expect(msgOf(() => applySell(pos, { units: 200_000_000n, priceMicro: 1, fee: 0 }))).toBe('ขายเกินจำนวนหน่วยที่ถืออยู่');
    expect(msgOf(() => applySell(pos, { units: 1n, priceMicro: 1, fee: -1 }))).toBe('ค่าธรรมเนียม ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ต่ำกว่า 0 (ได้รับ -1)');
    expect(msgOf(() => applySell(pos, { units: 100_000_000n, priceMicro: 1_000_000, fee: 500 }))).toBe('ค่าธรรมเนียมขายเกินเงินที่ขายได้');
    expect(msgOf(() => replayTrades([{ kind: 'sell', id: 's', date: '2026-01-01', createdAt: 'x', units: 1n, priceMicro: 1, fee: 0 }]))).toBe('ขายเกินจำนวนหน่วยที่ถืออยู่');
  });
});

describe('golden costBasisFx', () => {
  const pos = { units: 100_000_000n, costUsd: 1000, costThb: 30_000 };
  it('ข้อความไทยเดิม', () => {
    expect(msgOf(() => applyBuyFx(pos, { units: 0n, amount: 1, fee: 0, fxRateMicro: 1 }))).toBe('จำนวนหน่วยที่ซื้อต้องมากกว่า 0');
    expect(msgOf(() => applyBuyFx(pos, { units: 1n, amount: 0, fee: 0, fxRateMicro: 1 }))).toBe('มูลค่าซื้อ ต้องเป็นจำนวนเต็มที่ไม่ต่ำกว่า 1 (ได้รับ 0)');
    expect(msgOf(() => applyBuyFx(pos, { units: 1n, amount: 1, fee: -1, fxRateMicro: 1 }))).toBe('ค่าธรรมเนียม ต้องเป็นจำนวนเต็มที่ไม่ต่ำกว่า 0 (ได้รับ -1)');
    expect(msgOf(() => applyBuyFx(pos, { units: 1n, amount: 1, fee: 0, fxRateMicro: 1 }))).toBe('ต้นทุนบาทของรายการซื้อปัดเป็น 0 สตางค์ (อัตราต่ำหรือจำนวนเงินน้อยเกินไป) บันทึกไม่ได้');
    expect(msgOf(() => applySellFx({ units: 1n, costUsd: 0, costThb: 0 }, { units: 1n, priceMicro: 1, fee: 0, fxRateMicro: 1 }))).toBe('ตำแหน่งการลงทุนไม่ถูกต้อง');
    expect(msgOf(() => applySellFx(pos, { units: 0n, priceMicro: 1, fee: 0, fxRateMicro: 1 }))).toBe('จำนวนหน่วยที่ขายต้องมากกว่า 0');
    expect(msgOf(() => applySellFx(pos, { units: 200_000_000n, priceMicro: 1, fee: 0, fxRateMicro: 1 }))).toBe('ขายเกินจำนวนหน่วยที่ถืออยู่');
    expect(msgOf(() => applySellFx(pos, { units: 1n, priceMicro: 1, fee: 0, fxRateMicro: 1_000_000 }))).toBe('ขายแล้วได้เงิน 0 เซนต์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้');
    expect(msgOf(() => applySellFx(pos, { units: 100_000_000n, priceMicro: 1_000_000, fee: 5000, fxRateMicro: 1_000_000 }))).toBe('ค่าธรรมเนียมขายเกินเงินที่ขายได้');
    expect(msgOf(() => applySellFx(pos, { units: 1n, priceMicro: 1, fee: -1, fxRateMicro: 1 }))).toBe('ค่าธรรมเนียม ต้องเป็นจำนวนเต็มที่ไม่ต่ำกว่า 0 (ได้รับ -1)');
    expect(msgOf(() => replayTradesFx([{ kind: 'sell', id: 's', date: '2026-01-01', createdAt: 'x', units: 1n, priceMicro: 1, fee: 0, fxRateMicro: 1 }]))).toBe('ขายเกินจำนวนหน่วยที่ถืออยู่');
  });
});

describe('golden dca / dcaPlan', () => {
  const plan: DcaPlan = { id: 'p1', assetId: 'a1', amount: 100, dayOfMonth: 5, startMonth: '2026-11' };
  it('ข้อความไทยเดิม', () => {
    expect(msgOf(() => dcaUnits(0, 1_000_000))).toBe('จำนวนเงินซื้อต้องเป็นสตางค์จำนวนเต็มที่มากกว่า 0 (ได้รับ 0)');
    expect(msgOf(() => dcaUnits(1, Number.MAX_SAFE_INTEGER))).toBe('จำนวนเงินน้อยเกินไปจนได้หน่วยเป็น 0');
    expect(dcaPlanProblem({ ...plan, id: '' })).toBe('รหัสแผนไม่ถูกต้อง');
    expect(dcaPlanProblem({ ...plan, assetId: '' })).toBe('รหัสสินทรัพย์ไม่ถูกต้อง');
    expect(dcaPlanProblem({ ...plan, amount: 0 })).toBe('เงินซื้อต่อรอบต้องเป็นสตางค์จำนวนเต็มอย่างน้อย 1');
    expect(dcaPlanProblem({ ...plan, dayOfMonth: 32 })).toBe('วันที่ของเดือนต้องเป็น 1-31');
    expect(dcaPlanProblem({ ...plan, startMonth: '2026-13' })).toBe('เดือนเริ่มต้องเป็น YYYY-MM');
    expect(dcaPlanProblem({ ...plan, paused: 'x' as unknown as boolean })).toBe('สถานะพักแผนไม่ถูกต้อง');
    expect(msgOf(() => dcaDueDate('0000-13', 5))).toBe('วันที่ไม่ถูกต้อง: 0000-13-05');
  });
});

describe('golden rules', () => {
  it('ข้อความไทยเดิม', () => {
    const existing = [buy('b1', '2026-11-01')];
    expect(checkTradeAdd(existing, buy('b1', '2026-11-02'))).toBe('รหัสรายการซ้ำ');
    expect(checkTradeAdd(existing, sell('s1', '2026-11-10', '1', Number.MAX_SAFE_INTEGER * 2))).toBe('มูลค่าที่ขายเกินช่วงที่คำนวณได้');
    expect(checkTradeAdd(existing, sell('s1', '2026-11-10', '1', 1))).toBe('ขายแล้วได้เงิน 0 สตางค์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้');
    expect(checkTradeAdd(existing, sell('s1', '2026-11-10', '100000000', 12_000_000, { fee: 5000 }))).toBe('ค่าธรรมเนียมขายเกินเงินที่ขายได้');
    const withSell = [buy('b1', '2026-11-01'), sell('s1', '2026-11-10')];
    expect(checkTradeAdd(withSell, buy('b2', '2026-11-05'))).toBe('ต้องลงวันที่หลังรายการขายล่าสุด (2026-11-10) เพราะต้นทุนเฉลี่ยขึ้นกับลำดับ ถ้าต้องการบันทึกย้อนหลัง ให้ลบรายการขายก่อน');
    expect(checkTradeAdd(existing, sell('s2', '2026-11-10', '600000000'))).toBe('ขายเกินจำนวนหน่วยที่ถืออยู่');
    expect(checkTradeDelete(existing, 'zz')).toBe('ไม่พบรายการ');
    const two = [buy('b1', '2026-11-01'), sell('s1', '2026-11-10'), sell('s2', '2026-11-12')];
    expect(checkTradeDelete(two, 's1')).toBe('ลบได้เฉพาะรายการขายล่าสุด (ลบจากล่าสุดย้อนกลับ)');
    expect(checkTradeDelete(withSell, 'b1')).toBe('ลบรายการที่ลงวันที่ ณ หรือก่อนรายการขายล่าสุด (2026-11-10) ไม่ได้ ให้ลบรายการขายก่อน');
  });
});

describe('golden fxExchange / ledgerLink / portfolioMoney', () => {
  const acc = (id: string, currency: string, type: string, kind?: string) => ({ id, currency, type, ...(kind ? { kind } : {}) });
  const accounts = new Map<string, never>(
    [acc('w', 'THB', 'asset'), acc('eb', 'THB', 'equity'), acc('u', 'USD', 'asset', 'investment'), acc('eu', 'USD', 'equity'), acc('x', 'THB', 'liability')].map((a) => [a.id, a as never]),
  );
  const x = { id: 'x1', date: '2026-11-01', createdAt: 't', direction: 'thb_to_usd' as const, thbSatang: 3500, usdCents: 100, rateMicro: 35_000_000, memo: '', entryId: 'e' };
  const line = (accountId: string, amount: number) => ({ accountId, amount });
  const good = [line('w', -3500), line('eb', 3500), line('u', 100), line('eu', -100)];
  const entry = (lines: ReturnType<typeof line>[], date = '2026-11-01') => ({ id: 'e', date, memo: '', source: 'manual', createdAt: 't', lines }) as never;
  it('exchangeEntryProblem', () => {
    expect(exchangeEntryProblem(x, entry(good, '2026-11-02'), accounts)).toBe('วันที่ของการแลกเงินไม่ตรงกับรายการในสมุด');
    expect(exchangeEntryProblem(x, entry(good.slice(0, 3)), accounts)).toBe('รายการในสมุดของการแลกเงินต้องมี 4 บรรทัดพอดี');
    expect(exchangeEntryProblem(x, entry([line('zz', 1), ...good.slice(1)]), accounts)).toBe('รายการในสมุดของการแลกเงินอ้างบัญชีที่ไม่มี');
    expect(exchangeEntryProblem(x, entry([line('x', 1), ...good.slice(1)]), accounts)).toBe('รายการในสมุดของการแลกเงินใช้บัญชีผิดชนิด (ต้องเป็นกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1)');
    expect(exchangeEntryProblem(x, entry([line('w', 1), line('w', 1), line('u', 1), line('eu', 1)]), accounts)).toBe('รายการในสมุดของการแลกเงินต้องมีกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1 บรรทัด');
    expect(exchangeEntryProblem(x, entry([line('w', -1), line('eb', 1), line('u', 100), line('eu', -100)]), accounts)).toBe('จำนวนบาทในสมุดไม่ตรงกับรายการแลกเงิน');
    expect(exchangeEntryProblem(x, entry([line('w', -3500), line('eb', 3500), line('u', 1), line('eu', -1)]), accounts)).toBe('จำนวน USD ในสมุดไม่ตรงกับรายการแลกเงิน');
    expect(exchangeEntryProblem(x, entry(good), accounts)).toBeNull();
  });
  it('exchangeRateProblem', () => {
    expect(exchangeRateProblem({ thbSatang: 3500, usdCents: 100, rateMicro: 1 })).toBe('อัตราแลกเปลี่ยนไม่ตรงกับจำนวนสองฝั่ง (ควรเป็น 35000000 micro)');
    expect(exchangeRateProblem({ thbSatang: 0, usdCents: 100, rateMicro: 1 })).toBe('จำนวนบาทที่จ่ายต้องเป็นสตางค์จำนวนเต็มตั้งแต่ 1');
  });
  const tradeBase = { id: 't', assetId: 'a1', date: '2026-11-01', createdAt: 'c', memo: '', fee: 0, withholding: 0 };
  it('ledgerLink', () => {
    const b = { ...tradeBase, kind: 'buy' as const, units: '1', amount: 10 };
    const input = { trade: b, assetName: 'A', assetAccountId: 'ac', entryId: 'e' };
    expect(msgOf(() => buildTradeEntry(input))).toBe('เลือกกระเป๋าเงินที่ใช้จ่ายหรือรับเงิน');
    expect(msgOf(() => buildTradeEntry({ ...input, trade: { ...tradeBase, kind: 'sell', units: '1', priceMicro: 1 }, walletId: 'w' }))).toBe('ไม่มีผลคำนวณต้นทุนของรายการขาย');
    expect(msgOf(() => buildTradeEntry({ ...input, trade: { ...b, amount: 0 }, walletId: 'w' }))).toBe('รายการนี้ไม่เปลี่ยนยอดเงินใดเลย บันทึกไม่ได้');
    expect(new TradeLinkError('z').name).toBe('TradeLinkError');
  });
  it('ledgerLinkFx', () => {
    const b = { ...tradeBase, kind: 'buy' as const, units: '1', amount: 10 };
    const input = { trade: b, assetName: 'A', assetAccountId: 'ac', cashAccountId: 'c', entryId: 'e' };
    expect(msgOf(() => buildUsdTradeEntry({ ...input, cashAccountId: '' }))).toBe('เลือกบัญชีเงินสด USD ที่ใช้จ่ายหรือรับเงิน');
    expect(msgOf(() => buildUsdTradeEntry({ ...input, trade: { ...tradeBase, kind: 'sell', units: '1', priceMicro: 1 } }))).toBe('ไม่มีผลคำนวณต้นทุนของรายการขาย');
    expect(msgOf(() => buildUsdTradeEntry({ ...input, trade: { ...tradeBase, kind: 'reinvest', units: '1', amount: 1 } }))).toBe('หุ้นสหรัฐยังไม่รองรับปันผลลงทุนต่อ');
    expect(msgOf(() => buildUsdTradeEntry({ ...input, trade: { ...b, amount: 0 } }))).toBe('รายการนี้ไม่เปลี่ยนยอดเงินใดเลย บันทึกไม่ได้');
    expect(msgOf(() => buildFxExchangeEntry({ exchange: x, walletId: '', cashAccountId: 'c', entryId: 'e' }))).toBe('เลือกกระเป๋าเงินบาท');
    expect(msgOf(() => buildFxExchangeEntry({ exchange: x, walletId: 'w', cashAccountId: '', entryId: 'e' }))).toBe('เลือกบัญชีเงินสด USD');
    expect(new UsdLinkError('z').name).toBe('UsdLinkError');
  });
  it('checkAccountKindChange', () => {
    const accs = [acc('w', 'THB', 'asset'), acc('u', 'USD', 'asset', 'investment'), acc('l', 'THB', 'asset')] as never[];
    const ctx = { accounts: accs, investments: { assets: [{ accountId: 'l' }] } as never, bills: [{ walletId: 'w' }] };
    expect(checkAccountKindChange(ctx, 'zz', 'investment')).toBe('ไม่พบบัญชีนี้');
    expect(checkAccountKindChange(ctx, 'u', 'normal')).toBe('เปลี่ยนป้ายได้เฉพาะบัญชีเงินสดสกุลบาท · บัญชี USD เป็นเงินลงทุนเสมอ');
    expect(checkAccountKindChange(ctx, 'l', 'normal')).toBe('บัญชีที่ผูกกับสินทรัพย์ต้องเป็นเงินลงทุนเสมอ เปลี่ยนป้ายไม่ได้');
    expect(checkAccountKindChange(ctx, 'w', 'investment')).toBe('มีบิลที่จ่ายจากกระเป๋านี้อยู่ เปลี่ยนเป็นเงินลงทุนไม่ได้ (เปลี่ยนกระเป๋าของบิลก่อน)');
    expect(checkAccountKindChange(ctx, 'w', 'normal')).toBeNull();
  });
});
