/**
 * ข้อมูลสมมติของหน้า Rebalancing (?investDemo=rebal · rebal-empty · rebal-baht) สำหรับ harness/Playwright เท่านั้น · ไม่ต่อฐานข้อมูล ไม่ถูกรวมใน build จริง
 * ชุดตัวเลขเดียวกับตัวอย่างคำนวณมือ R29 (tests/fixtures/r29-examples.json): AAA/BBB = Tech 50% · CCC = Health 30% · DDD = Funds 20% · ข้อมูลสมมติทั้งหมด ห้ามใช้ข้อมูลจริง
 */
import type { Asset, AssetCategory, InvestmentData, TradeRecord } from '../domain/invest/types';
import type { LedgerRepository } from '../storage/ledgerRepository';
import { localLedgerRepository } from '../ui/RepositoryContext';

const HOLDINGS = [
  { id: 'AAA', cat: 'Tech', price: 100_000_000, units: '600000000' },
  { id: 'BBB', cat: 'Tech', price: 50_000_000, units: '400000000' },
  { id: 'CCC', cat: 'Health', price: 60_000_000, units: '500000000' },
  { id: 'DDD', cat: 'Funds', price: 25_000_000, units: '200000000' },
];
const CATEGORIES: AssetCategory[] = [
  { id: 'Tech', name: 'Tech', targetBps: 5_000, sortOrder: 0 },
  { id: 'Health', name: 'Health', targetBps: 3_000, sortOrder: 1 },
  { id: 'Funds', name: 'Funds', targetBps: 2_000, sortOrder: 2 },
];

export type RebalanceDemoKind = 'rebal' | 'rebal-empty' | 'rebal-baht';

export function demoRebalanceData(kind: RebalanceDemoKind): InvestmentData {
  const assets: Asset[] = HOLDINGS.map((h) => ({ id: h.id, name: `${h.id} Corp`, kind: 'stock', accountId: `inv-${h.id}`, currency: 'USD', ticker: h.id, ...(kind === 'rebal-empty' ? {} : { categoryId: h.cat }) }));
  const trades: TradeRecord[] = HOLDINGS.map((h) => ({
    id: `buy-${h.id}`, assetId: h.id, kind: 'buy', date: '2026-01-15', createdAt: '2026-01-15T03:00:00.000Z',
    units: h.units, priceMicro: h.price, amount: 1_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 34_000_000,
  }));
  if (kind === 'rebal-baht') {
    assets.push({ id: 'THF', name: 'Thai Fund', kind: 'fund', accountId: 'inv-THF', ticker: 'THF', categoryId: 'Funds' });
    trades.push({ id: 'buy-THF', assetId: 'THF', kind: 'buy', date: '2026-01-15', createdAt: '2026-01-15T03:00:00.000Z', units: '100000000', amount: 10_000, fee: 0, withholding: 0, memo: '' });
  }
  return {
    assets,
    trades,
    prices: HOLDINGS.map((h) => ({ assetId: h.id, date: '2026-11-12', priceMicro: h.price })),
    fxRates: [{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 32_400_000 }],
    categories: kind === 'rebal-empty' ? [] : CATEGORIES.map((c) => ({ ...c })),
  } as InvestmentData;
}

export function rebalanceDemoRepository(kind: RebalanceDemoKind): LedgerRepository {
  return { ...localLedgerRepository(), loadInvestments: () => Promise.resolve(demoRebalanceData(kind)) };
}
