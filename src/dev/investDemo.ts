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

/**
 * ข้อมูลสมมติแบบมีประวัติราคารายเดือน (สำหรับทดสอบหน้า Report · เปิดด้วย ?investDemo=report) · ราคาสิ้นเดือนม.ค.-ต.ค. เป็นค่าสมมติที่แกว่งเล็กน้อย
 * มีการขายหนึ่งครั้งเดือนมิ.ย. และเรตแลกเปลี่ยนรายเดือน · ข้อมูลสมมติทั้งหมด ห้ามใช้ข้อมูลจริง
 */
export function demoInvestmentsWithHistory(): InvestmentData {
  const base = demoInvestments();
  const monthEnds = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31'];
  const wiggle = [0, 3, -2, 5, 1, 4, -1, 6, 2, 7];
  const prices = monthEnds.flatMap((date, i) => STOCKS.map((s, j) => ({ assetId: s.id, date, priceMicro: (s.cost + wiggle[i]! + j) * 1_000_000 })));
  const fxRates = monthEnds.map((date, i) => ({ accountId: 'usd-cash', date, rateMicro: 34_000_000 - i * 150_000 }));
  const sell = { id: 'sell-d1', assetId: 'd1', kind: 'sell', date: '2026-06-10', createdAt: '2026-06-10T03:00:00.000Z', units: String(5 * 100_000_000), priceMicro: 104_000_000, fee: 100, withholding: 0, memo: '', fxRateMicro: 33_600_000 } as TradeRecord;
  return { ...base, trades: [...base.trades, sell], prices: [...prices, ...base.prices], fxRates: [...fxRates, ...(base.fxRates ?? [])] } as InvestmentData;
}

/** ข้อมูลสมมติที่ปันผลหนึ่งรายการไม่มีเรต (?investDemo=norate · ทดสอบธง Needs rate / Incomplete · R26) */
export function demoInvestmentsNoRate(): InvestmentData {
  const d = demoInvestments();
  return { ...d, trades: d.trades.map((t) => { if (t.id !== 'div-d1') return t; const { fxRateMicro: _drop, ...rest } = t; return rest as TradeRecord; }) };
}

/**
 * ข้อมูลสมมติของหน้า Cash (?investDemo=cash · ?investDemo=cashneg ที่ USD ติดลบ) · บัญชีเงินสดลงทุน USD/บาท + รายการในสมุดที่ลงด้วย Entry จริงของ buildCashAdjustmentEntry
 * ข้อมูลสมมติทั้งหมด ห้ามใช้ข้อมูลจริง
 */
import { buildCashAdjustmentEntry } from '../domain/invest/cashAdjustment';
import type { Account, Entry } from '../domain/ledger/types';

export function demoCashLedger(negative: boolean): { accounts: Account[]; entries: Entry[] } {
  const accounts: Account[] = [
    { id: 'cash-demo-usd', name: 'Broker USD', type: 'asset', currency: 'USD', kind: 'investment' },
    { id: 'cash-demo-thb', name: 'Broker THB', type: 'asset', currency: 'THB', kind: 'investment' },
    { id: 'inv-cash-adjust-usd', name: 'Cash adjustment USD', type: 'equity', currency: 'USD' },
    { id: 'inv-cash-adjust-thb', name: 'Cash adjustment THB', type: 'equity', currency: 'THB' },
  ];
  const adj = (id: string, date: string, cashAccountId: string, currency: 'USD' | 'THB', direction: 'deposit' | 'withdraw', amountMinor: number, memo = ''): Entry =>
    buildCashAdjustmentEntry({ id, date, createdAt: `${date}T03:00:00.000Z`, cashAccountId, currency, direction, amountMinor, memo }).entry as Entry;
  const entries: Entry[] = [
    adj('cd1', '2026-11-02', 'cash-demo-usd', 'USD', 'deposit', negative ? 10_000 : 12_037, 'Statement top-up'),
    adj('cd2', '2026-11-03', 'cash-demo-thb', 'THB', 'deposit', 500_000),
  ];
  if (!negative) entries.push(adj('cd3', '2026-11-05', 'cash-demo-usd', 'USD', 'withdraw', 2_000));
  if (negative) entries.push({ id: 'cd-neg', date: '2026-11-06', memo: 'Demo purchase without a deposit', source: 'manual', createdAt: '2026-11-06T03:00:00.000Z', lines: [{ accountId: 'cash-demo-usd', amount: -12_500 }, { accountId: 'inv-cash-adjust-usd', amount: 12_500 }] } as Entry);
  return { accounts, entries };
}
