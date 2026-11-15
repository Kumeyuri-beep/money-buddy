import { describe, expect, it } from 'vitest';
import { buildFxExchange, buildUsTradeRecord, emptyFxExchangeForm, emptyUsTradeForm, parseFxRate } from '../../src/app/usForms';

const TODAY = '2026-11-13';
const NOW = '2026-11-13T03:00:00.000Z';

describe('parseFxRate', () => {
  it('รับอัตราถึง 6 ตำแหน่งเป็น micro ไม่ผ่านทศนิยมลอยตัว', () => {
    expect(parseFxRate('35')).toEqual({ ok: true, rateMicro: 35_000_000 });
    expect(parseFxRate('34.567891')).toEqual({ ok: true, rateMicro: 34_567_891 });
    expect(parseFxRate('0.000001')).toEqual({ ok: true, rateMicro: 1 });
  });
  it('ปฏิเสธ: ว่าง ศูนย์ ติดลบ ข้อความ · ทศนิยมเกิน 6 ตำแหน่งปัดครึ่งขึ้นเหมือนตัวอ่านราคา', () => {
    expect(parseFxRate('35.0000005')).toEqual({ ok: true, rateMicro: 35_000_001 });
    for (const bad of ['', '  ', '0', '-35', 'abc']) expect(parseFxRate(bad).ok, bad).toBe(false);
  });
});

describe('buildUsTradeRecord', () => {
  const form = (over: Record<string, string>) => ({ ...emptyUsTradeForm('us1', 'buy', '2026-11-03', '35'), ...over });
  it('ซื้อ: เงินที่ซื้อ + หน่วย + ค่าธรรมเนียม เป็นเซนต์ · แนบอัตรา', () => {
    const r = buildUsTradeRecord(form({ units: '10', amount: '1,000.00', fee: '1' }), 'b1', NOW, TODAY);
    expect(r).toEqual({ ok: true, trade: { id: 'b1', assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: NOW, memo: '', units: '1000000000', amount: 100_000, fee: 100, withholding: 0, fxRateMicro: 35_000_000 } });
  });
  it('ซื้อหุ้นเศษส่วน: กรอกเงินกับราคา ให้ระบบคำนวณหน่วย (ปัดครั้งเดียว)', () => {
    const r = buildUsTradeRecord(form({ amount: '10', price: '300' }), 'b2', NOW, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trade.units).toBe('3333333'); // 10 / 300 = 0.03333333 หุ้น (x 10^8)
  });
  it('ขาย: หน่วย + ราคา micro-USD + ค่าธรรมเนียม', () => {
    const r = buildUsTradeRecord({ ...form({ units: '4', price: '120.5', fee: '1' }), kind: 'sell' }, 's1', NOW, TODAY);
    expect(r).toMatchObject({ ok: true, trade: { kind: 'sell', units: '400000000', priceMicro: 120_500_000, fee: 100, fxRateMicro: 35_000_000 } });
  });
  it('ปันผล: ยอด + ภาษีหัก (ต้องน้อยกว่ายอดปันผล)', () => {
    const ok = buildUsTradeRecord({ ...form({ amount: '50', withholding: '7.5' }), kind: 'dividend' }, 'd1', NOW, TODAY);
    expect(ok).toMatchObject({ ok: true, trade: { kind: 'dividend', amount: 5_000, withholding: 750, fee: 0 } });
    const bad = buildUsTradeRecord({ ...form({ amount: '50', withholding: '50' }), kind: 'dividend' }, 'd2', NOW, TODAY);
    expect(bad.ok).toBe(false);
  });
  it('ไม่มีอัตรา/อัตราผิด → ข้อผิดพลาดที่ช่องอัตรา · ข้อความเงินเป็น "ดอลลาร์" ไม่ใช่ "บาท"', () => {
    const r = buildUsTradeRecord(form({ units: '1', amount: '0', fxRate: '' }), 'x', NOW, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.field).sort()).toEqual(['amount', 'fxRate']);
      expect(r.errors.find((e) => e.field === 'amount')!.message).toContain('ดอลลาร์');
      expect(r.errors.some((e) => e.message.includes('บาท') && e.field !== 'fxRate')).toBe(false);
    }
  });
  it('วันที่ในอนาคตถูกปฏิเสธ', () => {
    const r = buildUsTradeRecord(form({ date: '2026-11-14', units: '1', amount: '10' }), 'x', NOW, TODAY);
    expect(r.ok).toBe(false);
  });
});

describe('buildFxExchange', () => {
  const form = (over: Record<string, string>) => ({ ...emptyFxExchangeForm('2026-11-02'), ...over });
  it('บาท→USD: จำนวนทั้งสองฝั่งเป็นข้อมูลหลัก อัตราคำนวณจากสองจำนวน', () => {
    const r = buildFxExchange(form({ thb: '70,000', usd: '2,000' }), 'fx1', NOW, TODAY);
    expect(r).toEqual({ ok: true, rateMicro: 35_000_000, exchange: { id: 'fx1', date: '2026-11-02', createdAt: NOW, direction: 'thb_to_usd', thbSatang: 7_000_000, usdCents: 200_000, memo: '' } });
  });
  it('USD→บาท และปัดอัตราครึ่งขึ้น (3,505 บาท / 100.00 USD)', () => {
    const r = buildFxExchange(form({ direction: 'usd_to_thb', thb: '3505', usd: '100' }), 'fx2', NOW, TODAY);
    expect(r).toMatchObject({ ok: true, rateMicro: 35_050_000, exchange: { direction: 'usd_to_thb' } });
  });
  it('ปฏิเสธ: ว่าง ศูนย์ ติดลบ วันที่อนาคต อัตราต่ำกว่า 1 micro', () => {
    for (const [over, field] of [[{ thb: '', usd: '10' }, 'thb'], [{ thb: '10', usd: '0' }, 'usd'], [{ thb: '-5', usd: '10' }, 'thb'], [{ thb: '10', usd: '10', date: '2026-11-14' }, 'date']] as const) {
      const r = buildFxExchange(form(over), 'x', NOW, TODAY);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.map((e) => e.field)).toContain(field);
    }
    const tiny = buildFxExchange(form({ thb: '0.01', usd: '100000000' }), 'x', NOW, TODAY);
    expect(tiny.ok).toBe(false);
  });
});
