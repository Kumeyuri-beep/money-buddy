import { describe, expect, it } from 'vitest';
import { checkTradeAdd, checkTradeDelete, replayRecords } from '../../src/domain/invest/rules';
import type { TradeRecord } from '../../src/domain/invest/types';

const base = { fee: 0, withholding: 0, memo: '' };
const buy = (id: string, date: string, units = '500000000', amount = 50_000, over: Partial<TradeRecord> = {}): TradeRecord => ({
  id, assetId: 'a1', kind: 'buy', date, createdAt: `${date}T03:00:00.000Z`, units, amount, ...base, ...over,
});
const sell = (id: string, date: string, units = '100000000', priceMicro = 12_000_000, over: Partial<TradeRecord> = {}): TradeRecord => ({
  id, assetId: 'a1', kind: 'sell', date, createdAt: `${date}T04:00:00.000Z`, units, priceMicro, ...base, ...over,
});
const div = (id: string, date: string): TradeRecord => ({ id, assetId: 'a1', kind: 'dividend', date, createdAt: `${date}T05:00:00.000Z`, amount: 1000, ...base });
const reinvest = (id: string, date: string): TradeRecord => ({ id, assetId: 'a1', kind: 'reinvest', date, createdAt: `${date}T06:00:00.000Z`, units: '1000000', amount: 900, ...base });

describe('replayRecords: เล่นซ้ำรายการลงทุน (ซื้อ ปันผลลงทุนต่อ ขาย · ปันผลเงินสดไม่กระทบตำแหน่ง)', () => {
  it('ซื้อ 5 หน่วย ปันผลลงทุนต่อ 0.01 หน่วย ขาย 1 หน่วย', () => {
    const r = replayRecords([buy('b1', '2026-11-01'), reinvest('r1', '2026-11-05'), div('d1', '2026-11-06'), sell('s1', '2026-11-10')]);
    expect(r.position.units).toBe(500_000_000n + 1_000_000n - 100_000_000n);
    expect(r.totalCost).toBe(50_900);
    expect(r.realizedGain).toBe(1_200 - Math.round((50_900 * 100_000_000) / 501_000_000));
  });
  it('ปันผลเงินสดอย่างเดียวไม่ทำให้มีตำแหน่ง', () => {
    expect(replayRecords([div('d1', '2026-11-06')]).position).toEqual({ units: 0n, cost: 0 });
  });
});

describe('checkTradeAdd', () => {
  it('ซื้อ/ขาย/ปันผลลงทุนต่อ ตามลำดับเวลาปกติผ่าน', () => {
    const existing = [buy('b1', '2026-11-01')];
    expect(checkTradeAdd(existing, sell('s1', '2026-11-10'))).toBeNull();
    expect(checkTradeAdd(existing, reinvest('r1', '2026-11-05'))).toBeNull();
    expect(checkTradeAdd(existing, div('d1', '2026-11-05'))).toBeNull();
  });
  it('ขายเกินที่ถือ / ขายก่อนซื้อ ถูกปฏิเสธ', () => {
    const existing = [buy('b1', '2026-11-01')];
    expect(checkTradeAdd(existing, sell('s1', '2026-11-10', '600000000'))).toContain('ถือ');
    expect(checkTradeAdd([], sell('s2', '2026-11-10'))).toContain('ถือ');
  });
  it('ขายที่ได้เงิน 0 สตางค์ / ค่าธรรมเนียมเกินเงินขาย ถูกปฏิเสธ', () => {
    const existing = [buy('b1', '2026-11-01')];
    expect(checkTradeAdd(existing, sell('s1', '2026-11-10', '1', 1))).toContain('0 สตางค์');
    expect(checkTradeAdd(existing, sell('s2', '2026-11-10', '100000000', 12_000_000, { fee: 99_999 }))).toContain('ค่าธรรมเนียม');
  });
  it('วันที่ ณ หรือก่อนรายการขายล่าสุด: เพิ่มซื้อ/ขาย/ปันผลลงทุนต่อไม่ได้ (ต้องลบรายการขายก่อน) · ปันผลเงินสดเพิ่มได้', () => {
    const existing = [buy('b1', '2026-11-01'), sell('s1', '2026-11-10')];
    expect(checkTradeAdd(existing, buy('b2', '2026-11-05'))).toContain('รายการขาย');
    expect(checkTradeAdd(existing, buy('b3', '2026-11-10'))).toContain('รายการขาย');
    expect(checkTradeAdd(existing, reinvest('r1', '2026-11-09'))).toContain('รายการขาย');
    expect(checkTradeAdd(existing, sell('s2', '2026-11-09'))).toContain('รายการขาย');
    expect(checkTradeAdd(existing, div('d1', '2026-11-05'))).toBeNull();
    expect(checkTradeAdd(existing, buy('b4', '2026-11-11'))).toBeNull();
    expect(checkTradeAdd(existing, sell('s3', '2026-11-11', '100000000'))).toBeNull();
  });
  it('รหัสซ้ำถูกปฏิเสธ', () => {
    expect(checkTradeAdd([buy('b1', '2026-11-01')], buy('b1', '2026-11-02'))).toContain('ซ้ำ');
  });
});

describe('checkTradeDelete', () => {
  const trades = [buy('b1', '2026-11-01'), sell('s1', '2026-11-10'), buy('b2', '2026-11-20'), sell('s2', '2026-11-25'), div('d1', '2026-11-05')];
  it('ลบรายการขายได้เฉพาะรายการขายล่าสุด', () => {
    expect(checkTradeDelete(trades, 's2')).toBeNull();
    expect(checkTradeDelete(trades, 's1')).toContain('ล่าสุด');
  });
  it('ลบรายการซื้อ/ปันผลลงทุนต่อได้เฉพาะที่ลงวันที่หลังรายการขายล่าสุดทั้งหมด', () => {
    expect(checkTradeDelete(trades, 'b1')).toContain('รายการขาย');
    expect(checkTradeDelete(trades, 'b2')).toContain('รายการขาย');
    expect(checkTradeDelete([buy('b1', '2026-11-01'), sell('s1', '2026-11-10'), buy('b9', '2026-11-12')], 'b9')).toBeNull();
  });
  it('ปันผลเงินสดลบได้เสมอ · ไม่พบรหัสถูกปฏิเสธ', () => {
    expect(checkTradeDelete(trades, 'd1')).toBeNull();
    expect(checkTradeDelete(trades, 'nope')).toContain('ไม่พบ');
  });
  it('ลบรายการซื้อที่ไม่มีรายการขายเลย ได้', () => {
    expect(checkTradeDelete([buy('b1', '2026-11-01')], 'b1')).toBeNull();
  });
});
