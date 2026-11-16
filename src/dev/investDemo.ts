/**
 * ข้อมูลลงทุน "สมมติ" สำหรับ harness เท่านั้น (เปิดด้วย /harness.html?seed=1&investDemo=1) ใช้ถ่ายภาพหน้าจอและทดสอบหน้าแดชบอร์ด /invest ตอนมีข้อมูล
 * ชื่อบริษัท/ตัวเลขทั้งหมดเป็นของสมมติ (ชื่อย่อ DEMO) ห้ามใช้ข้อมูลจริง · ไม่ถูกรวมใน build จริง (อยู่ใต้ src/dev ที่ index.html ไม่ import)
 */
import type { Asset, InvestmentData, TradeRecord } from '../domain/invest/types';

const STOCKS: { id: string; ticker: string; name: string; units: number; cost: number; price: number }[] = [
  { id: 'd1', ticker: 'DEMA', name: 'Demo Alpha Tech', units: 30, cost: 100, price: 130 },
  { id: 'd2', ticker: 'DEMB', name: 'Demo Beta Health', units: 40, cost: 80, price: 61 },
  { id: 'd3', ticker: 'DEMC', name: 'Demo Gamma Media', units: 20, cost: 90, price: 98 },
  { id: 'd4', ticker: 'DEMD', name: 'Demo Delta Foods', units: 25, cost: 60, price: 59 },
  { id: 'd5', ticker: 'DEME', name: 'Demo Echo Realty', units: 18, cost: 50, price: 51 },
  { id: 'd6', ticker: 'DEMF', name: 'Demo Foxtrot Income ETF', units: 15, cost: 40, price: 41 },
];

export function demoInvestments(): InvestmentData {
  const assets: Asset[] = STOCKS.map((s) => ({ id: s.id, name: s.name, kind: 'stock', accountId: `inv-${s.id}`, currency: 'USD', ticker: s.ticker, exchange: 'NASDAQ' }));
  const trades: TradeRecord[] = [];
  for (const s of STOCKS) {
    trades.push({
      id: `buy-${s.id}`, assetId: s.id, kind: 'buy', date: '2026-01-15', createdAt: '2026-01-15T03:00:00.000Z',
      units: String(s.units * 100_000_000), priceMicro: s.cost * 1_000_000, amount: s.units * s.cost * 100, fee: 100, withholding: 0, memo: '', fxRateMicro: 34_000_000,
    });
  }
  trades.push({ id: 'div-d1', assetId: 'd1', kind: 'dividend', date: '2026-08-20', createdAt: '2026-08-20T03:00:00.000Z', amount: 6_000, fee: 0, withholding: 900, memo: '', fxRateMicro: 33_500_000 } as TradeRecord);
  return {
    assets,
    trades,
    prices: STOCKS.map((s) => ({ assetId: s.id, date: '2026-11-12', priceMicro: s.price * 1_000_000 })),
    fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 32_400_000 }],
  } as InvestmentData;
}
