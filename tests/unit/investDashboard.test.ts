import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyInvestments, type Asset, type InvestmentData, type TradeRecord } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { DashboardBody } from '../../src/ui/invest/dashboard/DashboardCards';
import { barPercent, bpsText, buildDashboardView, monthlyDividends, profitSourceRows } from '../../src/ui/invest/dashboard/dashboardView';

/** ข้อมูลทดสอบสมมติ = ตัวอย่างหลัก R24 (เหมือน tests/unit/investMetrics.test.ts) · ห้ามใช้ข้อมูลจริง */
const asset: Asset = { id: 'us1', name: 'หุ้น US1', kind: 'stock', accountId: 'inv-us1', currency: 'USD', ticker: 'US1', exchange: 'NASDAQ' };
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: `${over.date ?? '2026-11-03'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const MAIN: InvestmentData = {
  assets: [asset],
  trades: [
    trade({ id: 'b1', kind: 'buy', date: '2026-11-03', units: '1000000000', amount: 100_000, fee: 100, fxRateMicro: 35_000_000 }),
    trade({ id: 's1', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
};
const TODAY = '2026-11-13';
const accounts: Account[] = [];
const entries: Entry[] = [];

const html = (data: InvestmentData, currency: 'THB' | 'USD', today = TODAY): string =>
  renderToString(createElement(DashboardBody, { view: buildDashboardView(accounts, entries, data, today), currency }));

describe('แดชบอร์ดพอร์ต: view ตรงตัวอย่างหลัก R24', () => {
  const v = buildDashboardView(accounts, entries, MAIN, TODAY);
  it('6 แหล่งรวม 774,113 และแถวตรงชื่อป้ายที่เจ้าของกำหนด', () => {
    const rows = profitSourceRows(v.profit, 'THB')!;
    expect(rows.map((r) => r.value)).toEqual([510_000, 264_000, 0, 172_839, -140_000, -32_726]);
    expect(rows.reduce((n, r) => n + (r.value ?? 0), 0)).toBe(774_113);
    expect(rows[3]!.label).toBe('ปันผล (ก่อนภาษี)');
    expect(rows[5]!.label).toBe('ค่าธรรมเนียมและภาษีที่ถูกหัก');
  });
  it('มุมมอง USD: ค่าเงินเป็น null (แสดง "—") และรวม 27,050 เซนต์', () => {
    const rows = profitSourceRows(v.profit, 'USD')!;
    expect(rows.find((r) => r.key === 'fx')!.value).toBeNull();
    expect(rows.reduce((n, r) => n + (r.value ?? 0), 0)).toBe(27_050);
  });
  it('มูลค่าตลาดของ 6 หุ้นที่ถืออยู่ = $750.00 (฿25,500.00 ที่อัตรา 34.00)', () => {
    expect(v.valueUsd).toBe(75_000);
    expect(v.valueThb).toBe(2_550_000);
    expect(v.holding).toBe(true);
    expect(v.empty).toBe(false);
  });
  it('ปันผลรายเดือน: พ.ย. = ปันผลก่อนภาษี $50.00 / 172,839 สตางค์ เดือนอื่น 0', () => {
    const m = monthlyDividends(MAIN, TODAY);
    expect(m[10]).toEqual({ month: 11, grossThb: 172_839, grossUsd: 5_000 });
    expect(m.filter((x) => x.grossUsd > 0)).toHaveLength(1);
  });
});

describe('แดชบอร์ดพอร์ต: หน้าจอ (เรนเดอร์ฝั่งเซิร์ฟเวอร์)', () => {
  it('มุมมองบาท: เห็น ฿7,741.13 (774,113 สตางค์) และป้ายแหล่งกำไรตามที่กำหนด', () => {
    const h = html(MAIN, 'THB');
    expect(h).toContain('฿7,741.13');
    expect(h).toContain('ปันผล (ก่อนภาษี)');
    expect(h).toContain('ค่าธรรมเนียมและภาษีที่ถูกหัก');
    expect(h).toContain('มูลค่าพอร์ต');
    expect(h).toContain('ใช้ได้เมื่อเปิดราคาอัตโนมัติ'); // กราฟย้อนหลัง/วันนี้ขึ้นลง
  });
  it('ปุ่ม ฿/USD มีผล: มุมมอง USD เห็น $270.50 และ $750.00', () => {
    const h = html(MAIN, 'USD');
    expect(h).toContain('+$270.50');
    expect(h).toContain('$750.00');
    expect(h).not.toContain('฿7,741.13');
  });
  it('IRR ถือไม่ถึง 30 วัน = "ใช้ได้เมื่อถือครบ 30 วัน" (ไม่มีเลขปลอม)', () => {
    expect(html(MAIN, 'THB')).toContain('ใช้ได้เมื่อถือครบ 30 วัน');
  });
  it('ยังไม่มีหุ้น: การ์ดว่างใบเดียว บอกทางไปแท็บ รายการ ไม่มีเลขเงิน', () => {
    const h = html(emptyInvestments(), 'THB');
    expect(h.match(/ยังไม่มีหุ้น/g)).toHaveLength(1);
    expect(h).toContain('รายการ');
    expect(h).not.toContain('฿');
  });
  it('มีข้อมูล: การ์ดเป้าหมายบอกสั้นๆ ว่ายังไม่ได้ตั้งเป้าหมาย', () => {
    expect(html(MAIN, 'THB')).toContain('ยังไม่ได้ตั้งเป้าหมาย');
  });
  it('ไม่มีราคา: มูลค่า/กำไรเป็น "—" พร้อมเหตุผล ไม่ใช้ต้นทุนแทน', () => {
    const noPrice: InvestmentData = { ...MAIN, prices: [] };
    const h = html(noPrice, 'THB');
    expect(h).toContain('ไม่ครบ');
    expect(h).not.toContain('฿7,741.13');
    const v = buildDashboardView(accounts, entries, noPrice, TODAY);
    expect(v.valueThb).toBeNull();
    expect(profitSourceRows(v.profit, 'THB')).toBeNull();
  });
});

describe('ตัวช่วยแสดงผล', () => {
  it('bpsText ด้วยจำนวนเต็ม: 355→3.55% · 350→3.5% · -120→-1.2% · 0→0% · +', () => {
    expect(bpsText(355)).toBe('3.55%');
    expect(bpsText(350)).toBe('3.5%');
    expect(bpsText(-120)).toBe('-1.2%');
    expect(bpsText(0, true)).toBe('0%');
    expect(bpsText(1234, true)).toBe('+12.34%');
    expect(bpsText(5)).toBe('0.05%');
    expect(() => bpsText(1.5)).toThrow();
  });
  it('barPercent: 0 / ตัวหาร 0 / เต็ม / ค่าลบใช้ค่าสัมบูรณ์', () => {
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(100, 100)).toBe(100);
    expect(barPercent(-50, 100)).toBe(50);
    expect(barPercent(1, 3)).toBe(33);
  });
});
