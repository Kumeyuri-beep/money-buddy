import { describe, expect, it } from 'vitest';
import { checkInvestImport, investImportState } from '../../src/app/investImport';
import type { InvestmentData } from '../../src/domain/invest/types';
import { rowToAsset, rowToCategory, rowToFxExchange, rowToFxRate, rowToPrice, rowToTrade } from '../../src/storage/supabaseRepository';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';

/** ข้อมูลสมมติทั้งหมด */
const file: InvestmentData = {
  assets: [
    { id: 's1', name: 'กองทุนสมมติ ก', kind: 'fund', accountId: 'i1', categoryId: 'c1' },
    { id: 's2', name: 'กองทุนสมมติ ข', kind: 'fund', accountId: 'i2' },
  ],
  trades: [{ id: 't1', assetId: 's1', kind: 'buy', date: '2026-10-31', createdAt: '2026-10-31T03:00:00.000Z', units: '100000000', amount: 1, fee: 0, withholding: 0, memo: '', entryId: 'e1' }],
  prices: [{ assetId: 's1', date: '2026-10-31', priceMicro: 1 }],
  fxRates: [{ accountId: 'u1', date: '2026-10-31', rateMicro: 35_000_000 }],
  fxExchanges: [{ id: 'x1', date: '2026-10-31', createdAt: '2026-10-31T03:00:00.000Z', direction: 'thb_to_usd', thbSatang: 3500, usdCents: 100, rateMicro: 35_000_000, memo: '', entryId: 'e2' }],
  categories: [{ id: 'c1', name: 'หมวดสมมติ', targetBps: null, sortOrder: 0 }],
};
const empty: InvestmentData = { assets: [], trades: [], prices: [] };
const clone = (): InvestmentData => structuredClone(file);

describe('investImportState: เทียบข้อมูลลงทุนในไฟล์กับออนไลน์', () => {
  it('ออนไลน์ว่าง = ยังไม่เข้า', () => {
    expect(investImportState(file, empty)).toBe('not_imported');
  });
  it('ออนไลน์มีแต่หมวดเดิม (ไม่ใช่ของไฟล์) = ยังไม่เข้า', () => {
    expect(investImportState(file, { ...empty, categories: [{ id: 'old', name: 'หมวดเก่า', targetBps: null, sortOrder: 0 }] })).toBe('not_imported');
  });
  it('ตรงทุกฟิลด์ แม้ลำดับแถวและลำดับคีย์ต่างกัน = ตรง', () => {
    const online = clone();
    online.assets.reverse();
    online.assets[0] = { accountId: 'i2', kind: 'fund', name: 'กองทุนสมมติ ข', id: 's2' };
    expect(investImportState(file, online)).toBe('match');
  });
  it('ไฟล์ไม่มีข้อมูลลงทุนและออนไลน์ว่าง = ตรง (รวมกรณีไม่มีฟิลด์ investments)', () => {
    expect(investImportState(undefined, empty)).toBe('match');
    expect(investImportState(empty, empty)).toBe('match');
  });
  it('ไฟล์ไม่มีข้อมูลลงทุนแต่หมวดเดิมยังอยู่ = ยังไม่เข้า (ยังไม่ได้ลบ)', () => {
    expect(investImportState(undefined, { ...empty, categories: file.categories })).toBe('not_imported');
  });
  it('ไฟล์มีแต่หมวด และออนไลน์มีหมวดเดียวกัน = ตรง', () => {
    const only = { ...empty, categories: file.categories };
    expect(investImportState(only, structuredClone(only))).toBe('match');
  });

  const changes: [string, (d: InvestmentData) => void][] = [
    ['ยอดรายการต่าง 1 สตางค์', (d) => { d.trades[0]!.amount = 2; }],
    ['จำนวนหน่วยต่าง', (d) => { d.trades[0]!.units = '100000001'; }],
    ['ราคาต่าง 1 micro', (d) => { d.prices[0]!.priceMicro = 2; }],
    ['อัตราแลกเปลี่ยนต่าง', (d) => { d.fxRates![0]!.rateMicro += 1; }],
    ['จำนวนเงินแลกต่าง', (d) => { d.fxExchanges![0]!.usdCents += 1; }],
    ['สินทรัพย์ขาด', (d) => { d.assets.pop(); }],
    ['สินทรัพย์เกิน', (d) => { d.assets.push({ id: 's3', name: 'เกิน', kind: 'fund', accountId: 'i3' }); }],
    ['หมวดของสินทรัพย์ต่าง', (d) => { delete d.assets[0]!.categoryId; }],
    ['หมวดหายทั้งชุด', (d) => { delete d.categories; }],
    ['การแลกเงินหายทั้งชุด', (d) => { delete d.fxExchanges; }],
    ['เป้าหมวดต่าง', (d) => { d.categories![0]!.targetBps = 10_000; }],
  ];
  for (const [label, change] of changes) {
    it(`มีข้อมูลแต่ไม่ตรง (${label}) = ต่าง`, () => {
      const online = clone();
      change(online);
      expect(investImportState(file, online)).toBe('different');
    });
  }
  it('ออนไลน์มีสินทรัพย์ แต่ไฟล์ไม่มีข้อมูลลงทุน = ต่าง', () => {
    expect(investImportState(undefined, file)).toBe('different');
  });
});

describe('checkInvestImport: อ่านออนไลน์แล้วเทียบ', () => {
  const repoReading = (...reads: (InvestmentData | Error)[]) => {
    let n = 0;
    const repo = {
      confirmSameAccount: () => Promise.resolve(),
      loadInvestments: () => {
        const r = reads[Math.min(n++, reads.length - 1)]!;
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      },
    } as unknown as LedgerRepository;
    return { repo, count: () => n };
  };
  it('ยังไม่เข้า/ตรง: อ่านครั้งเดียว', async () => {
    for (const [online, state] of [[empty, 'not_imported'], [file, 'match']] as const) {
      const r = repoReading(online);
      expect(await checkInvestImport(file, r.repo)).toBe(state);
      expect(r.count()).toBe(1);
    }
  });
  it('อ่านครั้งแรกต่าง (คร่อมช่วงบันทึก) อ่านซ้ำแล้วตรง = ตรง', async () => {
    const half = { ...clone(), trades: [] };
    const r = repoReading(half, file);
    expect(await checkInvestImport(file, r.repo)).toBe('match');
    expect(r.count()).toBe(2);
  });
  it('ต่างสองครั้ง = ต่าง ไม่อ่านวนต่อ', async () => {
    const r = repoReading({ ...clone(), trades: [] });
    expect(await checkInvestImport(file, r.repo)).toBe('different');
    expect(r.count()).toBe(2);
  });
  it('อ่านไม่ได้ = ส่งข้อผิดพลาดต่อ (ไม่เดาว่ายังไม่เข้า)', async () => {
    await expect(checkInvestImport(file, repoReading(new Error('offline')).repo)).rejects.toThrow('offline');
  });
});

describe('ไปกลับ: ค่าที่อ่านจากแถวฐานข้อมูลต้องเทียบกับไฟล์ได้ "ตรง"', () => {
  it('created_at แบบ +00:00 คอลัมน์ว่างเป็น null จำนวนใหญ่สุดเป็นข้อความ', () => {
    const big = clone();
    big.trades[0]!.amount = Number.MAX_SAFE_INTEGER;
    big.trades[0]!.units = '9223372036854775807';
    const online: InvestmentData = {
      assets: big.assets.map((a) => rowToAsset({ id: a.id, name: a.name, kind: a.kind, account_id: a.accountId, archived: false, instrument_currency: 'THB', ticker: null, exchange: null, sector: null, category_id: a.categoryId ?? null })),
      trades: [rowToTrade({ id: 't1', asset_id: 's1', kind: 'buy', date: '2026-10-31', created_at: '2026-10-31T03:00:00+00:00', units: '9223372036854775807', price_micro: null, amount: String(Number.MAX_SAFE_INTEGER), fee: '0', withholding: 0, memo: '', entry_id: 'e1', fx_rate_micro: null })],
      prices: [rowToPrice({ asset_id: 's1', date: '2026-10-31', price_micro: '1' })],
      fxRates: [rowToFxRate({ account_id: 'u1', date: '2026-10-31', rate_micro: '35000000' })],
      fxExchanges: [rowToFxExchange({ id: 'x1', date: '2026-10-31', created_at: '2026-10-31T03:00:00+00:00', direction: 'thb_to_usd', thb_satang: '3500', usd_cents: '100', rate_micro: '35000000', memo: '', entry_id: 'e2' })],
      categories: [rowToCategory({ id: 'c1', name: 'หมวดสมมติ', target_bps: null, sort_order: 0 })],
    };
    expect(investImportState(big, online)).toBe('match');
  });
});

describe('checkInvestImport ยืนยันบัญชีหลังอ่าน', () => {
  it('บัญชีเปลี่ยน = ไม่คืนสถานะ (ผลที่เทียบกับบัญชีอื่นใช้ไม่ได้)', async () => {
    const order: string[] = [];
    const repo = {
      loadInvestments: () => (order.push('read'), Promise.resolve(empty)),
      confirmSameAccount: () => (order.push('confirm'), Promise.reject(new Error('เปลี่ยน'))),
    } as unknown as LedgerRepository;
    await expect(checkInvestImport(file, repo)).rejects.toThrow('เปลี่ยน');
    expect(order).toEqual(['read', 'confirm']);
  });
});
