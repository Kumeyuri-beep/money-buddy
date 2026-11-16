import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';
import { InvestContext, type InvestContextValue } from '../../src/ui/invest/InvestContext';
import { AnalysisTab } from '../../src/ui/invest/AnalysisTab';
import { buildAnalysisModel } from '../../src/ui/invest/analysis/analysisModel';
import { naReasonText, percentBps, signedPercentBps } from '../../src/ui/invest/analysis/format';

const asset = (id: string, ticker: string): Asset => ({ id, name: `หุ้น ${ticker}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-01-02', createdAt: `${over.date ?? '2026-01-02'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
// ตัวอย่างหลักของ R25.4: ซื้อ 10 หุ้น $100 วันที่ 2 ม.ค. ที่ 35.00 · ราคาปลาย ม.ค. $110 ปลาย ก.พ. $121 → ม.ค. 1,069 / ก.พ. 1,000 / ทั้งปี 2,176 bps
const DIETZ: InvestmentData = {
  assets: [asset('us1', 'AAA'), asset('us2', 'BBB')],
  trades: [
    trade({ id: 'b1' }),
    trade({ id: 'b2', assetId: 'us2', date: '2026-02-03', amount: 50_000, units: '500000000', fxRateMicro: 35_000_000 }),
  ],
  prices: [
    { assetId: 'us1', date: '2026-01-31', priceMicro: 110_000_000 },
    { assetId: 'us1', date: '2026-02-28', priceMicro: 121_000_000 },
    { assetId: 'us2', date: '2026-02-28', priceMicro: 100_000_000 },
  ],
  fxRates: [{ accountId: 'usd-cash', date: '2026-01-01', rateMicro: 35_000_000 }],
};
const SINGLE: InvestmentData = { ...DIETZ, assets: [asset('us1', 'AAA')], trades: [trade({ id: 'b1' })], prices: DIETZ.prices.filter((p) => p.assetId === 'us1') };

describe('format ของแท็บวิเคราะห์ (จำนวนเต็มล้วน)', () => {
  it('bps เป็นเปอร์เซ็นต์: 1,069 = 10.69% · -38 = -0.38% · 0 = 0.00% · 5 = 0.05%', () => {
    expect(percentBps(1_069)).toBe('10.69%');
    expect(percentBps(-38)).toBe('-0.38%');
    expect(percentBps(0)).toBe('0.00%');
    expect(percentBps(5)).toBe('0.05%');
    expect(percentBps(123_456)).toBe('1,234.56%');
  });
  it('มีเครื่องหมาย +/- เมื่อไม่ใช่ศูนย์ (ไม่พึ่งสีอย่างเดียว)', () => {
    expect(signedPercentBps(2_176)).toBe('+21.76%');
    expect(signedPercentBps(-1_000)).toBe('-10.00%');
    expect(signedPercentBps(0)).toBe('0.00%');
  });
  it('ค่าไม่ใช่จำนวนเต็ม = RangeError · เหตุผล null อ่านออก', () => {
    expect(() => percentBps(1.5)).toThrow(RangeError);
    expect(naReasonText('missing')).toContain('ราคา');
    expect(naReasonText('zero-base')).toContain('ตั้งต้น');
  });
});

describe('โมเดลแท็บวิเคราะห์ (ประกอบจากฟังก์ชัน domain ไม่มีสูตรเงินใหม่)', () => {
  it('ตารางผลตอบแทนรายเดือนตรงตัวอย่างหลัก R25.4: ม.ค. 1,069 · ก.พ. 1,000 · ทั้งปี 2,176 (10.69% / 10.00% / 21.76%)', () => {
    const m = buildAnalysisModel([], [], SINGLE, '2026-02-28');
    expect(m.monthly).toHaveLength(1);
    const y = m.monthly[0]!;
    expect(y.year).toBe('2026');
    expect(y.cells).toHaveLength(12);
    expect(y.cells[0]).toEqual({ kind: 'ok', bps: 1_069 });
    expect(y.cells[1]).toEqual({ kind: 'ok', bps: 1_000 });
    expect(y.cells[2]).toEqual({ kind: 'none' }); // เดือนที่ยังไม่ถึงหรือไม่มีหุ้น
    expect(y.total).toBe(2_176);
    expect(percentBps(y.total as number)).toBe('21.76%');
  });
  it('เดือนที่ไม่มีราคา = null พร้อมเหตุผล และทั้งปีเป็น null · ไม่เดา', () => {
    const m = buildAnalysisModel([], [], { ...SINGLE, prices: [] }, '2026-02-28');
    expect(m.monthly[0]!.cells[0]).toEqual({ kind: 'na', reason: 'missing' });
    expect(m.monthly[0]!.total).toBeNull();
  });
  it('สัดส่วนต่อหุ้นรวมเป็น 10,000 bps (R17) และหุ้นที่ไม่มีราคาไม่มีสัดส่วน', () => {
    const m = buildAnalysisModel([], [], DIETZ, '2026-02-28');
    const shares = m.rows.map((r) => r.shareBps);
    expect(shares.every((s) => s !== null)).toBe(true);
    expect((shares as number[]).reduce((a, b) => a + b, 0)).toBe(10_000);
    const noPrice = buildAnalysisModel([], [], { ...DIETZ, prices: DIETZ.prices.filter((p) => p.assetId === 'us1') }, '2026-02-28');
    expect(noPrice.rows.find((r) => r.row.assetId === 'us2')!.shareBps).toBeNull();
    expect(noPrice.us.totals.complete).toBe(false);
  });
  it('ไม่มีหุ้น = hasStocks false และทุกส่วนว่าง', () => {
    const m = buildAnalysisModel([], [], { assets: [], trades: [], prices: [] }, '2026-02-28');
    expect(m.hasStocks).toBe(false);
    expect(m.rows).toEqual([]);
    expect(m.monthly).toEqual([]);
  });
  it('ปันผลเทียบเงินลงทุน: yield ต้องมีราคาและอัตรา · ไม่มี = null', () => {
    const d = { ...SINGLE, trades: [...SINGLE.trades, trade({ id: 'dv', kind: 'dividend' as const, date: '2026-02-10', amount: 1_000, fxRateMicro: 35_000_000 })] };
    const m = buildAnalysisModel([], [], d, '2026-02-28');
    expect(m.dividend.grossUsd).toBe(1_000);
    expect(m.dividend.yieldBps).not.toBeNull();
    expect(buildAnalysisModel([], [], { ...d, prices: [] }, '2026-02-28').dividend.yieldBps).toBeNull();
  });
});

function ctx(data: InvestmentData | null, currency: 'THB' | 'USD' = 'THB'): InvestContextValue {
  return { today: '2026-02-28', accounts: [], entries: [], wallets: [], data, loadError: '', reload: async () => undefined, onLedgerChanged: () => undefined, currency, setCurrency: () => undefined };
}
const render = (data: InvestmentData | null, currency: 'THB' | 'USD' = 'THB'): string =>
  renderToStaticMarkup(createElement(InvestContext.Provider, { value: ctx(data, currency) }, createElement(AnalysisTab)));

describe('หน้าจอแท็บวิเคราะห์ (เรนเดอร์ฝั่งเซิร์ฟเวอร์ ไม่แตะเครือข่าย)', () => {
  it('ไม่มีหุ้น: ทุกการ์ดมี empty state ไม่มีตัวเลขปลอม', () => {
    const html = render({ assets: [], trades: [], prices: [] });
    expect(html).toContain('วิเคราะห์พอร์ต');
    expect(html).toContain('ยังไม่มีหุ้นสหรัฐ');
    expect(html).not.toMatch(/฿\d/);
  });
  it('มีหุ้น: ตารางถือครอง + ผลตอบแทนรายเดือน 10.69% / 10.00% / 21.76% + คอลัมน์ "วันนี้"', () => {
    const html = render(SINGLE);
    expect(html).toContain('AAA');
    expect(html).toContain('+10.69%');
    expect(html).toContain('+10.00%');
    expect(html).toContain('+21.76%');
    expect(html).toContain('ขึ้นลงวันนี้');
    expect(html).toContain('สัดส่วนสกุลเงิน');
  });
  it('แสดงตามสกุลที่เลือก (USD $1,210.00 · THB ฿42,350.00 ที่ 35.00)', () => {
    expect(render(SINGLE, 'USD')).toContain('$1,210.00');
    expect(render(SINGLE, 'THB')).toContain('฿42,350.00');
  });
  it('ไม่มีราคา: ไม่ใช้ต้นทุนแทนมูลค่า และมีคำเตือนไม่ครบ', () => {
    const html = render({ ...SINGLE, prices: [] });
    expect(html).toContain('ไม่ครบ');
    expect(html).not.toContain('฿42,350.00');
  });
  it('ข้อมูลยังโหลดไม่เสร็จ (null) ไม่พัง', () => {
    expect(render(null)).toContain('กำลังโหลด');
  });
});
