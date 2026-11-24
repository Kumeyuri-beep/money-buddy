import { describe, expect, it } from 'vitest';
import { editedTradeOf, previewTradeEdit, tradeEditProblem } from '../../src/domain/invest/editImpact';
import type { TradeRecord } from '../../src/domain/invest/types';

// ข้อมูลสมมติล้วน (R17: หน่วย × 10^8 · ราคา micro · เงินเป็นสตางค์/เซนต์)
const U = (n: number): string => String(BigInt(n) * 100_000_000n);
const buy = (id: string, date: string, units: number, amount: number, extra: Partial<TradeRecord> = {}): TradeRecord => ({
  id, assetId: 'a1', kind: 'buy', date, createdAt: `${date}T01:00:00.000Z`, units: U(units), amount, fee: 0, withholding: 0, memo: '', ...extra,
});
const sell = (id: string, date: string, units: number, priceMicro: number, extra: Partial<TradeRecord> = {}): TradeRecord => ({
  id, assetId: 'a1', kind: 'sell', date, createdAt: `${date}T02:00:00.000Z`, units: U(units), priceMicro, fee: 0, withholding: 0, memo: '', ...extra,
});

describe('editedTradeOf (ตรงกับ repository.replaceTrade)', () => {
  it('วันที่ไม่เปลี่ยน = คงเวลาบันทึกเดิม (ลำดับในวันนั้นไม่ขยับ)', () => {
    const old = buy('t1', '2026-01-02', 10, 100000);
    const next = { ...buy('t2', '2026-01-02', 10, 110000), createdAt: '2026-11-24T00:00:00.000Z' };
    expect(editedTradeOf(old, next).createdAt).toBe(old.createdAt);
  });
  it('วันที่เปลี่ยน = ใช้เวลาบันทึกใหม่', () => {
    const old = buy('t1', '2026-01-02', 10, 100000);
    const next = { ...buy('t2', '2026-01-03', 10, 110000), createdAt: '2026-11-24T00:00:00.000Z' };
    expect(editedTradeOf(old, next).createdAt).toBe('2026-11-24T00:00:00.000Z');
  });
});

describe('tradeEditProblem (กติกาเดียวกับลบ R17)', () => {
  const all = [buy('b1', '2026-01-02', 10, 100000), sell('s1', '2026-01-10', 4, 150_000_000)];
  it('ซื้อที่วันที่ ณ/ก่อนรายการขายล่าสุด แก้ไม่ได้ พร้อมเหตุผล', () => {
    const p = tradeEditProblem(all, 'b1');
    expect(p?.code).toBe('rules.deleteBeforeLastSell');
  });
  it('ขายล่าสุดแก้ได้', () => {
    expect(tradeEditProblem(all, 's1')).toBeNull();
  });
  it('ขายที่ไม่ใช่ล่าสุดแก้ไม่ได้', () => {
    const more = [...all, sell('s2', '2026-01-20', 1, 150_000_000)];
    expect(tradeEditProblem(more, 's1')?.code).toBe('rules.deleteOnlyLastSell');
  });
  it('ไม่พบรายการ', () => {
    expect(tradeEditProblem(all, 'zzz')?.code).toBe('rules.notFound');
  });
  it('ปันผลเงินสดแก้ได้เสมอแม้อยู่ก่อนรายการขาย', () => {
    const div: TradeRecord = { id: 'd1', assetId: 'a1', kind: 'dividend', date: '2026-01-05', createdAt: '2026-01-05T03:00:00.000Z', amount: 500, fee: 0, withholding: 0, memo: '' };
    expect(tradeEditProblem([...all, div], 'd1')).toBeNull();
  });
});

describe('previewTradeEdit · สินทรัพย์บาท', () => {
  it('แก้ยอดซื้อล่าสุด: ต้นทุนรวมและต้นทุนเฉลี่ยเปลี่ยน กำไรที่ขายแล้วเป็น 0', () => {
    const all = [buy('b1', '2026-01-02', 10, 100000), buy('b2', '2026-02-02', 10, 120000)];
    const r = previewTradeEdit({ trades: all, oldId: 'b2', next: buy('b3', '2026-02-02', 10, 140000), usd: false });
    if (!r.ok) throw new Error('ควรผ่าน');
    expect(r.before).toMatchObject({ units: 20n * 100_000_000n, costMinor: 220000, avgCostMicro: 110_000_000, realizedMinor: 0, costThb: null, realizedThb: null });
    expect(r.after).toMatchObject({ costMinor: 240000, avgCostMicro: 120_000_000, realizedMinor: 0 });
  });
  it('แก้ราคาขายล่าสุด: กำไรที่ขายแล้วเปลี่ยน ต้นทุนเฉลี่ยของที่เหลือไม่เปลี่ยน', () => {
    const all = [buy('b1', '2026-01-02', 10, 100000), sell('s1', '2026-01-10', 4, 150_000_000)];
    const r = previewTradeEdit({ trades: all, oldId: 's1', next: sell('s2', '2026-01-10', 4, 120_000_000), usd: false });
    if (!r.ok) throw new Error('ควรผ่าน');
    // ก่อน: ขาย 600.00 ต้นทุนที่ตัด 400.00 กำไร 200.00 · หลัง: 480.00 − 400.00 = 80.00
    expect(r.before.realizedMinor).toBe(20000);
    expect(r.after.realizedMinor).toBe(8000);
    expect(r.before.avgCostMicro).toBe(100_000_000);
    expect(r.after.avgCostMicro).toBe(100_000_000);
  });
  it('ไม่นับรายการเดิมซ้ำ: ก่อนแก้นับรายการเดิม หลังแก้นับรายการใหม่แทน', () => {
    const all = [buy('b1', '2026-01-02', 10, 100000)];
    const r = previewTradeEdit({ trades: all, oldId: 'b1', next: buy('b9', '2026-01-02', 5, 100000), usd: false });
    if (!r.ok) throw new Error('ควรผ่าน');
    expect(r.before.units).toBe(10n * 100_000_000n);
    expect(r.after.units).toBe(5n * 100_000_000n);
  });
  it('แก้ซื้อที่อยู่ก่อนรายการขาย = ปฏิเสธพร้อมเหตุผล', () => {
    const all = [buy('b1', '2026-01-02', 10, 100000), sell('s1', '2026-01-10', 4, 150_000_000)];
    const r = previewTradeEdit({ trades: all, oldId: 'b1', next: buy('b2', '2026-01-02', 10, 90000), usd: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.code).toBe('rules.deleteBeforeLastSell');
  });
  it('ย้ายวันขายไปก่อนวันซื้อ = ปฏิเสธ (ขายเกินที่ถือ)', () => {
    const all = [buy('b1', '2026-01-02', 10, 100000), sell('s1', '2026-01-10', 4, 150_000_000)];
    const r = previewTradeEdit({ trades: all, oldId: 's1', next: sell('s2', '2026-01-01', 4, 150_000_000), usd: false });
    expect(r.ok).toBe(false);
  });
  it('แก้ขายให้ขายเกินที่ถือ = ปฏิเสธ', () => {
    const all = [buy('b1', '2026-01-02', 10, 100000), sell('s1', '2026-01-10', 4, 150_000_000)];
    const r = previewTradeEdit({ trades: all, oldId: 's1', next: sell('s2', '2026-01-10', 11, 150_000_000), usd: false });
    expect(r.ok).toBe(false);
  });
  it('ปันผลเงินสด: ต้นทุนและกำไรที่ขายแล้วไม่เปลี่ยน', () => {
    const div: TradeRecord = { id: 'd1', assetId: 'a1', kind: 'dividend', date: '2026-01-05', createdAt: '2026-01-05T03:00:00.000Z', amount: 500, fee: 0, withholding: 0, memo: '' };
    const all = [buy('b1', '2026-01-02', 10, 100000), div];
    const r = previewTradeEdit({ trades: all, oldId: 'd1', next: { ...div, id: 'd2', amount: 900 }, usd: false });
    if (!r.ok) throw new Error('ควรผ่าน');
    expect(r.after).toEqual(r.before);
  });
  it('ขอบเขต: ขายหมดตัว ต้นทุนเฉลี่ยเป็น null และต้นทุนรวม 0', () => {
    const all = [buy('b1', '2026-01-02', 10, 100000), sell('s1', '2026-01-10', 4, 150_000_000)];
    const r = previewTradeEdit({ trades: all, oldId: 's1', next: sell('s2', '2026-01-10', 10, 150_000_000), usd: false });
    if (!r.ok) throw new Error('ควรผ่าน');
    expect(r.after).toMatchObject({ units: 0n, costMinor: 0, avgCostMicro: null });
    expect(r.after.realizedMinor).toBe(50000);
  });
});

describe('previewTradeEdit · สินทรัพย์ USD (R20)', () => {
  const ubuy = (id: string, date: string, units: number, cents: number, fx: number): TradeRecord => buy(id, date, units, cents, { fxRateMicro: fx });
  const usell = (id: string, date: string, units: number, priceMicro: number, fx: number): TradeRecord => sell(id, date, units, priceMicro, { fxRateMicro: fx });

  it('แก้อัตราแลกเปลี่ยนของรายการซื้อ: ต้นทุน USD เท่าเดิม ต้นทุนบาทเปลี่ยน', () => {
    const all = [ubuy('b1', '2026-01-02', 10, 100000, 35_000_000)];
    const r = previewTradeEdit({ trades: all, oldId: 'b1', next: ubuy('b2', '2026-01-02', 10, 100000, 36_000_000), usd: true });
    if (!r.ok) throw new Error('ควรผ่าน');
    expect(r.before).toMatchObject({ costMinor: 100000, costThb: 3_500_000, avgCostMicro: 100_000_000 });
    expect(r.after).toMatchObject({ costMinor: 100000, costThb: 3_600_000, avgCostMicro: 100_000_000 });
  });
  it('แก้ราคาขาย: กำไรที่ขายแล้ว USD (ส่วนราคา) และรวมบาทเปลี่ยน', () => {
    const all = [ubuy('b1', '2026-01-02', 10, 100000, 35_000_000), usell('s1', '2026-01-10', 4, 150_000_000, 34_000_000)];
    const r = previewTradeEdit({ trades: all, oldId: 's1', next: usell('s2', '2026-01-10', 4, 120_000_000, 34_000_000), usd: true });
    if (!r.ok) throw new Error('ควรผ่าน');
    // ก่อน: ขาย $600.00 ต้นทุนที่ตัด $400.00 กำไรราคา $200.00 · หลัง: $480.00 − $400.00 = $80.00
    expect(r.before.realizedMinor).toBe(20000);
    expect(r.after.realizedMinor).toBe(8000);
    // บาท: ก่อน 600×34 − 400×35 = 20400 − 14000 = 6400.00 · หลัง 480×34 − 14000 = 16320 − 14000 = 2320.00 (สตางค์)
    expect(r.before.realizedThb).toBe(640000);
    expect(r.after.realizedThb).toBe(232000);
  });
  it('USD ที่ไม่มีอัตรา = ปฏิเสธ (ไม่เดา R20.7)', () => {
    const all = [ubuy('b1', '2026-01-02', 10, 100000, 35_000_000)];
    const noFx = buy('b2', '2026-01-02', 10, 100000);
    const r = previewTradeEdit({ trades: all, oldId: 'b1', next: noFx, usd: true });
    expect(r.ok).toBe(false);
  });
});
