import { describe, expect, it } from 'vitest';
import { hasCode, messageFor, registeredCodes } from '../../src/domain/errors/coded';
import { investMsg } from '../../src/domain/invest/errorCodes';
import { applySell } from '../../src/domain/invest/costBasis';
import { dcaUnits } from '../../src/domain/invest/dca';
import { dcaPlanProblemCoded } from '../../src/domain/invest/dcaPlan';
import { dividendInThb } from '../../src/domain/invest/fx';
import { exchangeRateProblemCoded } from '../../src/domain/invest/fxExchange';
import { checkTradeAddCoded, checkTradeDeleteCoded } from '../../src/domain/invest/rules';
import { parseUnits } from '../../src/domain/invest/units';
import { buildPortfolio } from '../../src/app/portfolio';
import type { TradeRecord } from '../../src/domain/invest/types';

type Row = [code: string, params: Record<string, string | number>, th: string, enHas: string[]];

// th = ข้อความไทยเดิมก่อนทำรหัส (คัดลอกจากโค้ดเดิม) · enHas = ค่า params ที่ต้องปรากฏในอังกฤษ
const TABLE: Row[] = [
  ['units.unreadable', { kind: 'units', input: 'abc' }, 'อ่านจำนวนหน่วยไม่ได้: "abc"', ['abc']],
  ['units.unreadable', { kind: 'price', input: 'x1' }, 'อ่านราคาไม่ได้: "x1"', ['x1']],
  ['units.zero', {}, 'จำนวนหน่วยต้องมากกว่า 0 (ละเอียดสุด 8 ตำแหน่ง)', ['8']],
  ['units.tooMany', {}, 'จำนวนหน่วยมากเกินช่วงที่รองรับ', []],
  ['units.priceZero', {}, 'ราคาต้องมากกว่า 0 (ละเอียดสุด 0.000001 บาท)', ['0.000001']],
  ['units.priceTooHigh', {}, 'ราคาสูงเกินช่วงที่รองรับ', []],
  ['units.negative', {}, 'จำนวนหน่วยติดลบไม่ได้', []],
  ['units.priceMicroInvalid', { got: '1.5' }, 'ราคาต่อหน่วยต้องเป็นจำนวนเต็ม micro-baht ที่มากกว่า 0 (ได้รับ 1.5)', ['1.5']],
  ['units.resultOutOfRange', {}, 'ผลลัพธ์เกินช่วงจำนวนเต็มปลอดภัย', []],
  ['fx.rateInvalid', { got: '0' }, 'อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม micro ที่มากกว่า 0 (ได้รับ 0)', ['0']],
  ['fx.minorInvalid', { name: 'amount', got: '-1' }, 'จำนวนเงิน ต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ -1)', ['-1']],
  ['fx.minorInvalid', { name: 'dividend', got: '1.5' }, 'ยอดปันผล ต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ 1.5)', ['1.5']],
  ['fx.minorInvalid', { name: 'withholding', got: '-2' }, 'ภาษีหัก ณ ที่จ่าย ต้องเป็นจำนวนเต็มหน่วยย่อยที่ไม่ติดลบ (ได้รับ -2)', ['-2']],
  ['fx.exchangeBahtInvalid', {}, 'จำนวนบาทที่จ่ายต้องเป็นสตางค์จำนวนเต็มตั้งแต่ 1', []],
  ['fx.exchangeUsdInvalid', {}, 'จำนวนดอลลาร์ที่ได้ต้องเป็นเซนต์จำนวนเต็มตั้งแต่ 1', []],
  ['fx.whtBpsRange', {}, 'อัตราภาษีหักต้องอยู่ระหว่าง 0-10,000 bps', ['10,000']],
  ['fx.dividendMin', {}, 'ยอดปันผลต้องตั้งแต่ 1 เซนต์', []],
  ['fx.whtNotBelowDividend', {}, 'ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดปันผล', []],
  ['trade.satangInt', { name: 'buyValue', min: 1, got: '0' }, 'มูลค่าซื้อ ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ต่ำกว่า 1 (ได้รับ 0)', ['1', '0']],
  ['trade.satangInt', { name: 'fee', min: 0, got: '-1' }, 'ค่าธรรมเนียม ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ต่ำกว่า 0 (ได้รับ -1)', ['-1']],
  ['trade.minorInt', { name: 'buyValue', min: 1, got: '0' }, 'มูลค่าซื้อ ต้องเป็นจำนวนเต็มที่ไม่ต่ำกว่า 1 (ได้รับ 0)', ['1', '0']],
  ['trade.minorInt', { name: 'fee', min: 0, got: '-1' }, 'ค่าธรรมเนียม ต้องเป็นจำนวนเต็มที่ไม่ต่ำกว่า 0 (ได้รับ -1)', ['-1']],
  ['trade.buyUnitsPositive', {}, 'จำนวนหน่วยที่ซื้อต้องมากกว่า 0', []],
  ['trade.sellUnitsPositive', {}, 'จำนวนหน่วยที่ขายต้องมากกว่า 0', []],
  ['trade.positionInvalid', {}, 'ตำแหน่งการลงทุนไม่ถูกต้อง', []],
  ['trade.sellExceedsHeld', {}, 'ขายเกินจำนวนหน่วยที่ถืออยู่', []],
  ['trade.sellFeeExceedsGross', {}, 'ค่าธรรมเนียมขายเกินเงินที่ขายได้', []],
  ['trade.costImbalance', {}, 'ต้นทุนไม่สมดุลหลังเล่นซ้ำรายการ', []],
  ['trade.buyBahtCostZero', {}, 'ต้นทุนบาทของรายการซื้อปัดเป็น 0 สตางค์ (อัตราต่ำหรือจำนวนเงินน้อยเกินไป) บันทึกไม่ได้', ['0 satang']],
  ['trade.sellUsdZero', {}, 'ขายแล้วได้เงิน 0 เซนต์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้', ['0 cents']],
  ['trade.sellSatangZero', {}, 'ขายแล้วได้เงิน 0 สตางค์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้', ['0 satang']],
  ['dca.amountInvalid', { got: '0' }, 'จำนวนเงินซื้อต้องเป็นสตางค์จำนวนเต็มที่มากกว่า 0 (ได้รับ 0)', ['0']],
  ['dca.unitsZero', {}, 'จำนวนเงินน้อยเกินไปจนได้หน่วยเป็น 0', []],
  ['dcaplan.id', {}, 'รหัสแผนไม่ถูกต้อง', []],
  ['dcaplan.assetId', {}, 'รหัสสินทรัพย์ไม่ถูกต้อง', []],
  ['dcaplan.amount', {}, 'เงินซื้อต่อรอบต้องเป็นสตางค์จำนวนเต็มอย่างน้อย 1', []],
  ['dcaplan.day', {}, 'วันที่ของเดือนต้องเป็น 1-31', ['1-31']],
  ['dcaplan.startMonth', {}, 'เดือนเริ่มต้องเป็น YYYY-MM', ['YYYY-MM']],
  ['dcaplan.paused', {}, 'สถานะพักแผนไม่ถูกต้อง', []],
  ['dcaplan.dateInvalid', { iso: '2026-02-31' }, 'วันที่ไม่ถูกต้อง: 2026-02-31', ['2026-02-31']],
  ['rules.replayFallback', {}, 'รายการซื้อขายไม่สอดคล้อง', []],
  ['rules.duplicateId', {}, 'รหัสรายการซ้ำ', []],
  ['rules.sellValueOverflow', {}, 'มูลค่าที่ขายเกินช่วงที่คำนวณได้', []],
  ['rules.dateAfterLastSell', { date: '2026-11-10' }, 'ต้องลงวันที่หลังรายการขายล่าสุด (2026-11-10) เพราะต้นทุนเฉลี่ยขึ้นกับลำดับ ถ้าต้องการบันทึกย้อนหลัง ให้ลบรายการขายก่อน', ['2026-11-10']],
  ['rules.notFound', {}, 'ไม่พบรายการ', []],
  ['rules.deleteOnlyLastSell', {}, 'ลบได้เฉพาะรายการขายล่าสุด (ลบจากล่าสุดย้อนกลับ)', []],
  ['rules.deleteBeforeLastSell', { date: '2026-11-10' }, 'ลบรายการที่ลงวันที่ ณ หรือก่อนรายการขายล่าสุด (2026-11-10) ไม่ได้ ให้ลบรายการขายก่อน', ['2026-11-10']],
  ['fxx.dateMismatch', {}, 'วันที่ของการแลกเงินไม่ตรงกับรายการในสมุด', []],
  ['fxx.lines4', {}, 'รายการในสมุดของการแลกเงินต้องมี 4 บรรทัดพอดี', ['4']],
  ['fxx.accountMissing', {}, 'รายการในสมุดของการแลกเงินอ้างบัญชีที่ไม่มี', []],
  ['fxx.accountWrongType', {}, 'รายการในสมุดของการแลกเงินใช้บัญชีผิดชนิด (ต้องเป็นกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1)', []],
  ['fxx.accountCount', {}, 'รายการในสมุดของการแลกเงินต้องมีกระเป๋าบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละ 1 บรรทัด', []],
  ['fxx.thbMismatch', {}, 'จำนวนบาทในสมุดไม่ตรงกับรายการแลกเงิน', []],
  ['fxx.usdMismatch', {}, 'จำนวน USD ในสมุดไม่ตรงกับรายการแลกเงิน', []],
  ['fxx.rateUncomputable', {}, 'คำนวณอัตราไม่ได้', []],
  ['fxx.rateMismatch', { expected: 35000000 }, 'อัตราแลกเปลี่ยนไม่ตรงกับจำนวนสองฝั่ง (ควรเป็น 35000000 micro)', ['35000000']],
  ['link.pickWallet', {}, 'เลือกกระเป๋าเงินที่ใช้จ่ายหรือรับเงิน', []],
  ['link.noSellResult', {}, 'ไม่มีผลคำนวณต้นทุนของรายการขาย', []],
  ['link.noChange', {}, 'รายการนี้ไม่เปลี่ยนยอดเงินใดเลย บันทึกไม่ได้', []],
  ['link.pickUsdCash', {}, 'เลือกบัญชีเงินสด USD ที่ใช้จ่ายหรือรับเงิน', []],
  ['link.usdNoReinvest', {}, 'หุ้นสหรัฐยังไม่รองรับปันผลลงทุนต่อ', []],
  ['link.pickThbWallet', {}, 'เลือกกระเป๋าเงินบาท', []],
  ['link.pickUsdCashShort', {}, 'เลือกบัญชีเงินสด USD', []],
  ['link.pickCashAccount', {}, 'เลือกบัญชีเงินสดของพอร์ต', []],
  ['link.cashAmountInvalid', {}, 'จำนวนเงินต้องเป็นจำนวนเต็มหน่วยย่อย (สตางค์/เซนต์) ตั้งแต่ 1', []],
  ['link.cashDateInvalid', {}, 'วันที่ไม่ถูกต้อง', []],
  ['portfolio.inconsistent', {}, 'ข้อมูลรายการไม่สอดคล้อง', []],
  ['portfolio.valueOverflow', {}, 'ตัวเลขใหญ่เกินช่วงที่รองรับ จึงคำนวณมูลค่าไม่ได้', []],
  ['portfolio.calcFailed', {}, 'คำนวณไม่ได้', []],
  ['acct.notFound', {}, 'ไม่พบบัญชีนี้', []],
  ['acct.thbCashOnly', {}, 'เปลี่ยนป้ายได้เฉพาะบัญชีเงินสดสกุลบาท · บัญชี USD เป็นเงินลงทุนเสมอ', []],
  ['acct.linkedToAsset', {}, 'บัญชีที่ผูกกับสินทรัพย์ต้องเป็นเงินลงทุนเสมอ เปลี่ยนป้ายไม่ได้', []],
  ['acct.hasBills', {}, 'มีบิลที่จ่ายจากกระเป๋านี้อยู่ เปลี่ยนเป็นเงินลงทุนไม่ได้ (เปลี่ยนกระเป๋าของบิลก่อน)', []],
];

const THAI = /[฀-๿]/;

describe('รหัส error ของ domain/invest', () => {
  it('ทุกรหัสที่ลงทะเบียนมีแถวในตารางทดสอบ', () => {
    const mine = registeredCodes().filter((c) => /^(units|fx|trade|dca|dcaplan|rules|fxx|link|portfolio|acct)\./.test(c));
    expect(new Set(TABLE.map((r) => r[0]))).toEqual(new Set(mine));
  });
  for (const [code, params, th, enHas] of TABLE) {
    it(`${code} ${JSON.stringify(params)}: ไทย = golden · อังกฤษไม่มีตัวอักษรไทยและมีค่า params`, () => {
      expect(messageFor(code, params, 'th')).toBe(th);
      const en = messageFor(code, params, 'en') as string;
      expect(en).not.toMatch(THAI);
      expect(en.length).toBeGreaterThan(5);
      for (const v of enHas) expect(en).toContain(v);
      for (const [k, v] of Object.entries(params)) if (k !== 'name' && k !== 'kind') expect(en).toContain(String(v));
    });
  }
});

describe('error ที่โยน/คืนพก code และ params (ชนิดเดิม ข้อความไทยเดิม)', () => {
  const caught = (fn: () => unknown): unknown => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error('ไม่โยน');
  };
  it('parseUnits: SyntaxError พร้อมรหัส', () => {
    const e = caught(() => parseUnits('abc'));
    expect(e).toBeInstanceOf(SyntaxError);
    expect(hasCode(e) && e.code).toBe('units.unreadable');
    expect(hasCode(e) && e.params).toEqual({ kind: 'units', input: 'abc' });
  });
  it('dcaUnits / dividendInThb / applySell: RangeError พร้อมรหัสและตัวเลข', () => {
    const a = caught(() => dcaUnits(0, 1_000_000));
    expect(a).toBeInstanceOf(RangeError);
    expect(hasCode(a) && a.params).toEqual({ got: '0' });
    const b = caught(() => dividendInThb(100, 100, 1));
    expect(hasCode(b) && b.code).toBe('fx.whtNotBelowDividend');
    const c = caught(() => applySell({ units: 1n, cost: 5 }, { units: 2n, priceMicro: 1, fee: 0 }));
    expect(hasCode(c) && c.code).toBe('trade.sellExceedsHeld');
  });
  const base = { fee: 0, withholding: 0, memo: '' };
  const buy = (id: string, date: string): TradeRecord => ({ id, assetId: 'a1', kind: 'buy', date, createdAt: `${date}T03:00:00.000Z`, units: '500000000', amount: 50_000, ...base });
  const sell = (id: string, date: string, units = '100000000'): TradeRecord => ({ id, assetId: 'a1', kind: 'sell', date, createdAt: `${date}T04:00:00.000Z`, units, priceMicro: 12_000_000, ...base });
  it('checkTradeAddCoded / checkTradeDeleteCoded: code + params + message ไทย', () => {
    const withSell = [buy('b1', '2026-11-01'), sell('s1', '2026-11-10')];
    expect(checkTradeAddCoded(withSell, buy('b2', '2026-11-05'))).toMatchObject({ code: 'rules.dateAfterLastSell', params: { date: '2026-11-10' } });
    expect(checkTradeDeleteCoded(withSell, 'b1')).toMatchObject({ code: 'rules.deleteBeforeLastSell', params: { date: '2026-11-10' } });
    // ข้อความจาก replay ส่งรหัสต่อ
    expect(checkTradeAddCoded([buy('b1', '2026-11-01')], sell('s2', '2026-11-10', '600000000'))).toMatchObject({ code: 'trade.sellExceedsHeld' });
    expect(checkTradeAddCoded([buy('b1', '2026-11-01')], sell('s2', '2026-11-10'))).toBeNull();
  });
  it('dcaPlanProblemCoded / exchangeRateProblemCoded', () => {
    expect(dcaPlanProblemCoded({ id: '', assetId: 'a', amount: 1, dayOfMonth: 1, startMonth: '2026-11' })).toMatchObject({ code: 'dcaplan.id', message: 'รหัสแผนไม่ถูกต้อง' });
    expect(exchangeRateProblemCoded({ thbSatang: 3500, usdCents: 100, rateMicro: 1 })).toMatchObject({ code: 'fxx.rateMismatch', params: { expected: 35000000 } });
    expect(exchangeRateProblemCoded({ thbSatang: 0, usdCents: 100, rateMicro: 1 })).toMatchObject({ code: 'fx.exchangeBahtInvalid' });
  });
  it('buildPortfolio: แถวที่ข้อมูลไม่สอดคล้องพก errorCode/errorParams ต่อให้ UI', () => {
    const asset = { id: 'a1', name: 'A', kind: 'fund', accountId: 'acc' };
    const data = { assets: [asset], trades: [sell('s1', '2026-11-10')], prices: [] };
    const { rows } = buildPortfolio(data as never, '2026-11-20');
    expect(rows[0]?.error).toBe('ขายเกินจำนวนหน่วยที่ถืออยู่');
    expect(rows[0]?.errorCode).toBe('trade.sellExceedsHeld');
  });
  it('investMsg ตรงกับ messageFor', () => {
    expect(investMsg('rules.notFound', {}, 'en')).toBe(messageFor('rules.notFound', {}, 'en'));
  });
});
