import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '../../src/app/portfolio';
import { buildTradeRecord, type TradeForm } from '../../src/app/tradeForm';
import type { Asset, AssetPrice, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

const TODAY = '2026-11-20';
const blank: TradeForm = { assetId: 'a1', kind: 'buy', date: '2026-11-10', units: '', price: '', amount: '', fee: '', withholding: '', memo: '' };
const build = (over: Partial<TradeForm>) => buildTradeRecord({ ...blank, ...over }, 't1', '2026-11-10T03:00:00.000Z', TODAY);
const fields = (r: ReturnType<typeof build>): string[] => (r.ok ? [] : r.errors.map((e) => e.field));

describe('buildTradeRecord: ฟอร์มซื้อ', () => {
  it('ซื้อ 1,000 บาท ที่ราคา 333.3333 → หน่วยคำนวณให้ (3.0000003) ต้นทุนบันทึก = เงินที่ซื้อ', () => {
    const r = build({ amount: '1,000', price: '333.3333' });
    expect(r.ok && r.trade).toMatchObject({ kind: 'buy', units: '300000030', amount: 100_000, priceMicro: 333_333_300, fee: 0, withholding: 0 });
  });
  it('กรอกหน่วยเองจากโบรกเกอร์ (ไม่ต้องมีราคา) + ค่าธรรมเนียม', () => {
    const r = build({ amount: '500', units: '12.5', fee: '1.5' });
    expect(r.ok && r.trade).toMatchObject({ units: '1250000000', amount: 50_000, fee: 150 });
    expect(r.ok && 'priceMicro' in r.trade).toBe(false);
  });
  it('ต้องมีหน่วยหรือราคาอย่างใดอย่างหนึ่ง · มูลค่าซื้อต้อง ≥ 0.01 บาท', () => {
    expect(fields(build({ amount: '500' }))).toContain('units');
    expect(fields(build({ amount: '', price: '10' }))).toContain('amount');
    expect(fields(build({ amount: '0', price: '10' }))).toContain('amount');
    expect(fields(build({ amount: '0.001', price: '10' }))).toContain('amount');
  });
  it('เงินน้อยจนได้หน่วยเป็น 0 ถูกปฏิเสธ', () => {
    expect(fields(build({ amount: '0.01', price: '100000000' }))).toContain('amount');
  });
  it('ภาษีหัก ณ ที่จ่ายใส่กับการซื้อไม่ได้', () => {
    expect(fields(build({ amount: '500', price: '10', withholding: '5' }))).toContain('withholding');
  });
});

describe('buildTradeRecord: ขาย ปันผล ปันผลลงทุนต่อ', () => {
  it('ขาย: ต้องมีหน่วยและราคา', () => {
    const r = build({ kind: 'sell', units: '1', price: '12', fee: '3' });
    expect(r.ok && r.trade).toMatchObject({ kind: 'sell', units: '100000000', priceMicro: 12_000_000, fee: 300 });
    expect(r.ok && 'amount' in r.trade).toBe(false);
    expect(fields(build({ kind: 'sell', units: '1' }))).toContain('price');
    expect(fields(build({ kind: 'sell', price: '12' }))).toContain('units');
  });
  it('ปันผลเงินสด: ยอดและภาษีหัก (ภาษีต้องน้อยกว่ายอด) ไม่มีหน่วย/ค่าธรรมเนียม', () => {
    const r = build({ kind: 'dividend', amount: '10', withholding: '1' });
    expect(r.ok && r.trade).toMatchObject({ kind: 'dividend', amount: 1000, withholding: 100, fee: 0 });
    expect(r.ok && 'units' in r.trade).toBe(false);
    expect(fields(build({ kind: 'dividend', amount: '10', withholding: '10' }))).toContain('withholding');
    expect(fields(build({ kind: 'dividend', amount: '10', fee: '1' }))).toContain('fee');
    expect(fields(build({ kind: 'dividend', amount: '10', units: '1' }))).toContain('units');
  });
  it('ปันผลลงทุนต่อ: หน่วยและต้นทุนที่เพิ่ม (หลังหักภาษี) · ไม่มีค่าธรรมเนียม', () => {
    const r = build({ kind: 'reinvest', units: '0.01', amount: '9' });
    expect(r.ok && r.trade).toMatchObject({ kind: 'reinvest', units: '1000000', amount: 900, fee: 0 });
    expect(fields(build({ kind: 'reinvest', units: '0.01', amount: '9', fee: '1' }))).toContain('fee');
  });
});

describe('buildTradeRecord: วันที่ หมายเหตุ รูปแบบตัวเลข', () => {
  it('วันที่ในอนาคต/ไม่มีจริง/นอกช่วง ถูกปฏิเสธ', () => {
    for (const d of ['2026-11-21', '2026-02-30', '1899-12-31', '', 'พรุ่งนี้']) {
      expect(fields(build({ amount: '500', price: '10', date: d })), d).toContain('date');
    }
    expect(build({ amount: '500', price: '10', date: TODAY }).ok).toBe(true);
  });
  it('หมายเหตุยาวเกิน 2,000 / อักขระควบคุม ถูกปฏิเสธ', () => {
    expect(fields(build({ amount: '500', price: '10', memo: 'ก'.repeat(2001) }))).toContain('memo');
    expect(fields(build({ amount: '500', price: '10', memo: 'x‮y' }))).toContain('memo');
  });
  it('ตัวเลขผิดรูปแบบ (ลบ, scientific, ตัวคั่นผิด) ถูกปฏิเสธเป็นข้อผิดพลาดรายช่อง ไม่โยน', () => {
    expect(fields(build({ amount: '-5', price: '10' }))).toContain('amount');
    expect(fields(build({ amount: '5', price: '1e3' }))).toContain('price');
    expect(fields(build({ amount: '5', units: '1,5' }))).toContain('units');
    expect(fields(build({ amount: '5', price: '10', fee: '-1' }))).toContain('fee');
  });
});

const asset = (id: string, accountId: string): Asset => ({ id, name: `กอง ${id}`, kind: 'fund', accountId });
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 't', assetId: 'a1', kind: 'buy', date: '2026-11-01', createdAt: '2026-11-01T03:00:00.000Z', units: '1000000000', amount: 10_000, fee: 0, withholding: 0, memo: '', ...over,
});

describe('buildPortfolio: สรุปพอร์ตจากรายการ + ราคาที่กรอก', () => {
  const data = (over: Partial<InvestmentData>): InvestmentData => ({ assets: [], trades: [], prices: [], ...over });

  it('ยังไม่มีสินทรัพย์ = แถวว่าง ผลรวมเป็น 0', () => {
    const p = buildPortfolio(data({}), TODAY);
    expect(p.rows).toEqual([]);
    expect(p.totals).toMatchObject({ cost: 0, value: 0, unrealized: 0, unpriced: 0 });
  });

  it('ถือ 10 หน่วย ต้นทุน 100 บาท ราคาล่าสุด 12 บาท (วันที่ 10 พ.ย.): มูลค่า 120 บาท กำไรที่ยังไม่ขาย 20 บาท', () => {
    const p = buildPortfolio(
      data({ assets: [asset('a1', 'inv1')], trades: [trade({})], prices: [{ assetId: 'a1', date: '2026-11-10', priceMicro: 12_000_000 }] }),
      TODAY,
    );
    const row = p.rows[0]!;
    expect(row.position).toEqual({ units: 1_000_000_000n, cost: 10_000 });
    expect(row.avgCostMicro).toBe(10_000_000);
    expect(row.latestPrice).toEqual({ priceMicro: 12_000_000, date: '2026-11-10' });
    expect(row.market).toEqual({ value: 12_000, cost: 10_000, unrealized: 2_000 });
    expect(row.priceStale).toBe(true); // 10 วัน > 7 วัน
    expect(p.totals).toMatchObject({ cost: 10_000, value: 12_000, unrealized: 2_000, unpriced: 0 });
  });

  it('ใช้ราคาล่าสุดตามวันที่ (ไม่ใช่ลำดับในอาร์เรย์) · ราคาเมื่อ 7 วันก่อนยังไม่เก่า', () => {
    const prices: AssetPrice[] = [
      { assetId: 'a1', date: '2026-11-13', priceMicro: 11_000_000 },
      { assetId: 'a1', date: '2026-11-05', priceMicro: 99_000_000 },
    ];
    const row = buildPortfolio(data({ assets: [asset('a1', 'inv1')], trades: [trade({})], prices }), TODAY).rows[0]!;
    expect(row.latestPrice?.priceMicro).toBe(11_000_000);
    expect(row.priceStale).toBe(false);
  });

  it('ยังไม่กรอกราคา: ไม่มีมูลค่า (ห้ามใช้ต้นทุนแทน) ผลรวมนับเป็น "ยังไม่มีราคา"', () => {
    const p = buildPortfolio(data({ assets: [asset('a1', 'inv1')], trades: [trade({})] }), TODAY);
    expect(p.rows[0]!.market).toBeNull();
    expect(p.totals).toMatchObject({ cost: 10_000, value: 0, unpriced: 1 });
  });

  it('กำไรที่ขายแล้ว และปันผลสุทธิ (หลังหักภาษี) แยกจากกัน · ขายหมดแล้วไม่ถือหน่วย', () => {
    const trades = [
      trade({ id: 'b' }),
      trade({ id: 's', kind: 'sell', date: '2026-11-05', createdAt: '2026-11-05T04:00:00.000Z', units: '1000000000', amount: undefined, priceMicro: 12_000_000, fee: 100 }),
      trade({ id: 'd', kind: 'dividend', date: '2026-11-06', units: undefined, amount: 1000, withholding: 100 }),
    ];
    const row = buildPortfolio(data({ assets: [asset('a1', 'inv1')], trades }), TODAY).rows[0]!;
    expect(row.position).toEqual({ units: 0n, cost: 0 });
    expect(row.realizedGain).toBe(12_000 - 100 - 10_000);
    expect(row.dividendsNet).toBe(900);
    expect(row.avgCostMicro).toBeNull();
  });

  it('รายการของสินทรัพย์ไม่ปนกัน · ผลรวมรวมทุกสินทรัพย์', () => {
    const p = buildPortfolio(
      data({
        assets: [asset('a1', 'inv1'), asset('a2', 'inv2')],
        trades: [trade({}), trade({ id: 't2', assetId: 'a2', amount: 5_000, units: '500000000' })],
        prices: [{ assetId: 'a1', date: TODAY, priceMicro: 10_000_000 }, { assetId: 'a2', date: TODAY, priceMicro: 20_000_000 }],
      }),
      TODAY,
    );
    expect(p.rows.map((r) => r.market?.value)).toEqual([10_000, 10_000]);
    expect(p.totals).toMatchObject({ cost: 15_000, value: 20_000, unrealized: 5_000 });
  });

  it('ข้อมูลรายการไม่สอดคล้อง (ขายเกินที่ถือ) ไม่ทำให้ทั้งหน้าพัง: แถวนั้นแจ้งข้อผิดพลาด แถวอื่นยังแสดง', () => {
    const bad = trade({ id: 'x', assetId: 'a1', kind: 'sell', units: '9999999999', amount: undefined, priceMicro: 1_000_000 });
    const p = buildPortfolio(data({ assets: [asset('a1', 'inv1'), asset('a2', 'inv2')], trades: [bad, trade({ id: 'ok', assetId: 'a2' })] }), TODAY);
    expect(p.rows[0]!.error).toBeTruthy();
    expect(p.rows[1]!.error).toBeUndefined();
    expect(p.totals.cost).toBe(10_000);
  });

it('ราคาที่ลงวันที่ในอนาคต (พิมพ์ปีผิด) ไม่ถูกใช้เป็นราคาล่าสุด', () => {
    const prices: AssetPrice[] = [
      { assetId: 'a1', date: '2026-11-18', priceMicro: 11_000_000 },
      { assetId: 'a1', date: '2999-11-20', priceMicro: 99_000_000 },
    ];
    const row = buildPortfolio(data({ assets: [asset('a1', 'inv1')], trades: [trade({})], prices }), TODAY).rows[0]!;
    expect(row.latestPrice).toEqual({ priceMicro: 11_000_000, date: '2026-11-18' });
  });

  it('สินทรัพย์ปนกัน (มีราคา/ไม่มีราคา): มูลค่าและกำไรรวมเฉพาะที่มีราคา · ต้นทุนรวมทุกตัว · นับ unpriced', () => {
    const p = buildPortfolio(
      data({
        assets: [asset('a1', 'inv1'), asset('a2', 'inv2')],
        trades: [trade({}), trade({ id: 't2', assetId: 'a2' })],
        prices: [{ assetId: 'a1', date: TODAY, priceMicro: 12_000_000 }],
      }),
      TODAY,
    );
    expect(p.totals).toMatchObject({ cost: 20_000, value: 12_000, unrealized: 2_000, unpriced: 1 });
  });

  it('ปันผลลงทุนต่อเพิ่มทั้งหน่วยและต้นทุนในพอร์ต', () => {
    const reinvest = trade({ id: 'r', kind: 'reinvest', date: '2026-11-05', createdAt: '2026-11-05T06:00:00.000Z', units: '100000000', amount: 900 });
    const row = buildPortfolio(data({ assets: [asset('a1', 'inv1')], trades: [trade({}), reinvest] }), TODAY).rows[0]!;
    expect(row.position).toEqual({ units: 1_100_000_000n, cost: 10_900 });
  });

  it('ปันผลรวมล้นช่วงปลอดภัย (ข้อมูลผิดปกติ) ไม่ทำให้ทั้งหน้าพัง: แถวนั้นแจ้งข้อผิดพลาด ยอดรวมของพอร์ตไม่ปนครึ่งๆ กลางๆ', () => {
    const big = (id: string): TradeRecord => ({ id, assetId: 'a1', kind: 'dividend', date: '2026-11-06', createdAt: '2026-11-06T03:00:00.000Z', amount: Number.MAX_SAFE_INTEGER, fee: 0, withholding: 0, memo: '' });
    const p = buildPortfolio(data({ assets: [asset('a1', 'inv1'), asset('a2', 'inv2')], trades: [big('d1'), big('d2'), trade({ id: 'ok', assetId: 'a2' })] }), TODAY);
    expect(p.rows[0]!.error).toBeTruthy();
    expect(p.rows[1]!.error).toBeUndefined();
    expect(p.totals).toMatchObject({ cost: 10_000, dividends: 0 });
  });

  it('เรียงสินทรัพย์ที่เก็บถาวรไว้ท้าย แล้วตามชื่อ', () => {
    const p = buildPortfolio(data({ assets: [{ ...asset('a1', 'inv1'), archived: true }, asset('a2', 'inv2')] }), TODAY);
    expect(p.rows.map((r) => r.asset.id)).toEqual(['a2', 'a1']);
  });
});
