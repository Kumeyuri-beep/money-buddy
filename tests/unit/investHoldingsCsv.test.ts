import { describe, expect, it } from 'vitest';
import { buildHoldingsCsv, holdingsCsvFilename } from '../../src/domain/invest/holdingsCsv';
import { buildHoldingsView, DEFAULT_HOLDINGS_QUERY, filterAndSort, totalsOf, type ColumnId } from '../../src/domain/invest/holdingsView';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

// ข้อมูลสมมติของกฎ R24 (เหมือน tests/unit/investHoldingsView.test.ts) · ห้ามข้อมูลจริง
const asset = (id: string, ticker = id.toUpperCase(), name = `หุ้น ${ticker}`): Asset => ({ id, name, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker, exchange: 'NASDAQ' });
let seq = 0;
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: `t${++seq}`, assetId: 'us1', kind: 'buy', date: '2026-11-03', createdAt: `${over.date ?? '2026-11-03'}T03:00:00.000Z`, units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const MAIN: InvestmentData = {
  assets: [asset('us1')],
  trades: [
    trade({ id: 'b1', kind: 'buy', date: '2026-11-03', units: '1000000000', amount: 100_000, fee: 100, fxRateMicro: 35_000_000 }),
    trade({ id: 's1', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
    trade({ id: 'd1', kind: 'dividend', date: '2026-11-12', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
  ],
  prices: [{ assetId: 'us1', date: '2026-11-12', priceMicro: 125_000_000 }],
  fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }],
};
const TODAY = '2026-11-13';
const labelOf = (c: ColumnId): string => c;

function csv(d: InvestmentData, cur: 'USD' | 'THB', tab: 'holdings' | 'general' | 'dividends' | 'returns', showSold = false): string[] {
  const view = buildHoldingsView(d, TODAY, cur);
  const rows = filterAndSort(view.rows, { ...DEFAULT_HOLDINGS_QUERY, showSold });
  const text = buildHoldingsCsv({ rows, tab, currency: cur, totals: totalsOf(rows, cur), labelOf });
  expect(text.startsWith('﻿')).toBe(true); // BOM ให้ Excel เปิดได้
  expect(text.endsWith('\r\n')).toBe(true);
  return text.slice(1).split('\r\n').slice(0, -1);
}

describe('ส่งออก CSV ของ Holdings (ตัวเลขเป็นทศนิยมจากหน่วยย่อย ไม่ผ่าน float)', () => {
  it('USD แท็บ holdings: แถวหุ้น + แถวรวม ตรงตัวเลขตาราง (ต้นทุน 600.60 · มูลค่า 750.00 · ปันผลสุทธิ 42.50 · กำไร 270.50)', () => {
    const lines = csv(MAIN, 'USD', 'holdings');
    expect(lines[0]).toBe('Currency,USD');
    expect(lines[1]).toBe('Ticker,Name,shares,costBasis (USD),currentValue (USD),dividends (USD),dividendYield (%),totalProfit (USD),Total profit (%),Note');
    expect(lines[2]!.startsWith('US1,หุ้น US1,6,600.60,750.00,42.50,')).toBe(true);
    expect(lines[2]).toContain(',270.50,');
    expect(lines).toHaveLength(4);
    expect(lines[3]!.startsWith('Total,1 holding,,600.60,750.00,42.50,,270.50,')).toBe(true);
  });

  it('THB แท็บ returns: 6 แหล่งตรงตัวอย่างมือ R24 (5,100.00 / 2,640.00 / 0.00 / 1,728.39 / −1,400.00 / −327.26 รวม 7,741.13)', () => {
    const lines = csv(MAIN, 'THB', 'returns');
    expect(lines[0]).toBe('Currency,THB');
    expect(lines[2]).toBe('US1,หุ้น US1,5100.00,2640.00,0.00,1728.39,-1400.00,-327.26,7741.13,');
    expect(lines[3]).toBe('Total,1 holding,5100.00,2640.00,0.00,1728.39,-1400.00,-327.26,7741.13,');
  });

  it('USD แท็บ returns: แหล่งค่าเงินเป็นช่องว่าง (R24 ไม่มีแหล่งค่าเงินใน USD) ไม่ใช่ 0', () => {
    const lines = csv(MAIN, 'USD', 'returns');
    expect(lines[2]).toBe('US1,หุ้น US1,150.00,80.00,0.00,50.00,,-9.50,270.50,');
  });

  it('ไม่มีราคา = ช่องว่าง + หมายเหตุ "No price" และแถวรวมบอกว่าไม่ครบ (ห้ามเป็น 0 · R20.7)', () => {
    const lines = csv({ ...MAIN, prices: [] }, 'USD', 'holdings');
    expect(lines[2]).toContain('No price');
    expect(lines[2]!.split(',')[4]).toBe(''); // currentValue
    expect(lines[3]).toContain('Incomplete');
    expect(lines[3]!.split(',')[4]).toBe('');
  });

  it('ขายหมดแสดงเมื่อเลือก Show sold พร้อมหมายเหตุ Sold · เปิดปกติไม่ปรากฏ', () => {
    const sold: InvestmentData = { ...MAIN, assets: [asset('us1'), asset('us2')], trades: [...MAIN.trades, trade({ id: 'x1', assetId: 'us2', amount: 10_000, units: '100000000' }), trade({ id: 'x2', assetId: 'us2', kind: 'sell', date: '2026-11-05', units: '100000000', priceMicro: 110_000_000, amount: undefined })], prices: [...MAIN.prices] };
    expect(csv(sold, 'USD', 'holdings').some((l) => l.startsWith('US2,'))).toBe(false);
    const withSold = csv(sold, 'USD', 'holdings', true);
    expect(withSold.find((l) => l.startsWith('US2,'))).toContain('Sold');
    expect(withSold).toHaveLength(5); // สกุล + หัว + 2 หุ้น + รวม
  });

  it('กัน CSV/formula injection ในชื่อ/ชื่อย่อ และครอบเครื่องหมายคำพูดเมื่อมีจุลภาค', () => {
    const evil: InvestmentData = { ...MAIN, assets: [asset('us1', '=CMD', '@Evil, "Corp"')] };
    const line = csv(evil, 'USD', 'holdings')[2]!;
    expect(line.startsWith(`'=CMD,"'@Evil, ""Corp""",`)).toBe(true);
  });

  it('ไม่มีแถวเลย = มีหัวกับแถวรวม 0 holdings (ไม่ล้ม)', () => {
    const lines = csv({ ...MAIN, assets: [], trades: [], prices: [] }, 'USD', 'holdings');
    expect(lines).toHaveLength(3);
    expect(lines[2]!.startsWith('Total,0 holdings,')).toBe(true);
  });

  it('ชื่อไฟล์บอกแท็บ สกุล และวัน', () => {
    expect(holdingsCsvFilename('USD', 'returns', '2026-11-13')).toBe('holdings-returns-USD-2026-11-13.csv');
  });
});
