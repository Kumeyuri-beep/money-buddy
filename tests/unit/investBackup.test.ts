import { describe, expect, it } from 'vitest';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { createEntry } from '../../src/domain/ledger/entry';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { MAX_ASSETS, MAX_PRICES, MAX_TRADES } from '../../src/domain/invest/types';
import { rowToAsset, rowToPrice, rowToTrade } from '../../src/storage/supabaseRepository';

const TODAY = '2026-11-10';
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
  { id: 'inv1', type: 'asset', name: 'กองทุน ก', currency: 'THB', kind: 'investment' },
  { id: 'inv2', type: 'asset', name: 'หุ้น ข', currency: 'THB', kind: 'investment' },
  { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
];
const entries: Entry[] = [
  createEntry(accounts, { id: 'sys', date: '2026-11-01', memo: 'o', source: 'system', lines: [{ accountId: 'w1', amount: 100_000 }, { accountId: 'open', amount: -100_000 }] }),
  createEntry(accounts, { id: 'e-buy1', date: '2026-11-05', memo: 'ซื้อ', source: 'manual', lines: [{ accountId: 'inv1', amount: 50_000 }, { accountId: 'w1', amount: -50_000 }] }),
];

const asset = (over: Record<string, unknown> = {}) => ({ id: 'a1', name: 'กองทุน ก', kind: 'fund', accountId: 'inv1', ...over });
const buy = (over: Record<string, unknown> = {}) => ({
  id: 't1', assetId: 'a1', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '500000000', priceMicro: 10_000_000, amount: 50_000, fee: 5, withholding: 0, memo: '', entryId: 'e-buy1', ...over,
});
const inv = (over: Record<string, unknown> = {}) => ({ assets: [asset()], trades: [buy()], prices: [{ assetId: 'a1', date: '2026-11-10', priceMicro: 11_000_000 }], ...over });
const file = (investments?: unknown, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ schemaVersion: 2, exportedAt: '2026-11-10T00:00:00.000Z', accounts, entries, bills: [], settings: {}, ...(investments === undefined ? {} : { investments }), ...over });
const problemsOf = (text: string): string => {
  const r = parseBackup(text, TODAY);
  if (r.ok) throw new Error('ควรถูกปฏิเสธ');
  return r.problems.join(' | ');
};

describe('ไฟล์สำรอง: ข้อมูลลงทุน (investments)', () => {
  it('ไม่มีฟิลด์ investments = ไฟล์เดิมผ่านเหมือนเดิม (ไม่มีข้อมูลลงทุน)', () => {
    const r = parseBackup(file(), TODAY);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.data.investments ?? { assets: [], trades: [], prices: [] }).toEqual({ assets: [], trades: [], prices: [] });
  });

  it('ไฟล์ที่มีข้อมูลลงทุนผ่าน ได้ข้อมูลครบและสรุปจำนวน', () => {
    const r = parseBackup(file(inv()), TODAY);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.data.investments?.assets).toEqual([{ id: 'a1', name: 'กองทุน ก', kind: 'fund', accountId: 'inv1' }]);
    expect(r.data.investments?.trades[0]).toMatchObject({ id: 't1', kind: 'buy', units: '500000000', entryId: 'e-buy1' });
    expect(r.data.investments?.prices).toHaveLength(1);
    expect(r.summary).toMatchObject({ assets: 1, trades: 1 });
  });

  it('ครบทุกชนิดรายการ: ขาย ปันผล ปันผลลงทุนต่อ', () => {
    const trades = [
      buy({ entryId: undefined }),
      { id: 't2', assetId: 'a1', kind: 'sell', date: '2026-11-20', createdAt: '2026-11-20T03:00:00.000Z', units: '100000000', priceMicro: 12_000_000, fee: 3, withholding: 0, memo: '' },
      { id: 't3', assetId: 'a1', kind: 'dividend', date: '2026-11-25', createdAt: '2026-11-25T03:00:00.000Z', amount: 1000, fee: 0, withholding: 100, memo: '' },
      { id: 't4', assetId: 'a1', kind: 'reinvest', date: '2026-11-26', createdAt: '2026-11-26T03:00:00.000Z', units: '1000000', amount: 900, fee: 0, withholding: 0, memo: '' },
    ];
    expect(parseBackup(file(inv({ trades, prices: [] })), TODAY).ok).toBe(true);
  });

  it('สินทรัพย์ต้องผูกบัญชีลงทุนที่มีอยู่จริง (ไม่ใช่กระเป๋าเงินสด/บัญชีที่ไม่มี) และหนึ่งบัญชีต่อหนึ่งสินทรัพย์', () => {
    expect(problemsOf(file(inv({ assets: [asset({ accountId: 'w1' })] })))).toContain('บัญชีลงทุน');
    expect(problemsOf(file(inv({ assets: [asset({ accountId: 'nope' })] })))).toContain('บัญชีลงทุน');
    expect(problemsOf(file(inv({ assets: [asset(), asset({ id: 'a2' })] })))).toContain('ซ้ำ');
  });

  it('สินทรัพย์ซ้ำ/ชนิดแปลก/ชื่อว่าง/ยาวเกิน/มีอักขระควบคุม ถูกปฏิเสธ', () => {
    for (const bad of [
      [asset(), asset({ accountId: 'inv2' })],
      [asset({ kind: 'crypto' })],
      [asset({ name: '' })],
      [asset({ name: 'ก'.repeat(201) })],
      [asset({ name: 'x‮y' })],
      [asset({ id: '' })],
      [asset({ archived: 'no' })],
    ]) {
      expect(parseBackup(file(inv({ assets: bad, trades: [], prices: [] })), TODAY).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('รูปแบบรายการผิดตามชนิด ถูกปฏิเสธ (ตรงกับ check ของฐานข้อมูล)', () => {
    const bad = [
      buy({ amount: undefined }), // ซื้อไม่มีมูลค่า
      buy({ amount: 0 }),
      buy({ units: undefined }),
      buy({ fee: -1 }),
      buy({ withholding: 5 }),
      { ...buy({ entryId: undefined }), kind: 'sell', amount: 100, priceMicro: 1 }, // ขายมี amount
      { ...buy({ entryId: undefined }), kind: 'sell', amount: undefined, priceMicro: undefined }, // ขายไม่มีราคา
      { id: 'd1', assetId: 'a1', kind: 'dividend', date: '2026-11-25', createdAt: '2026-11-25T00:00:00Z', amount: 1000, fee: 0, withholding: 1000, memo: '' },
      { id: 'd2', assetId: 'a1', kind: 'dividend', date: '2026-11-25', createdAt: '2026-11-25T00:00:00Z', amount: 1000, fee: 5, withholding: 0, memo: '' },
      { id: 'r1', assetId: 'a1', kind: 'reinvest', date: '2026-11-25', createdAt: '2026-11-25T00:00:00Z', units: '100', amount: 100, fee: 5, withholding: 0, memo: '' },
      buy({ kind: 'weird' }),
      buy({ assetId: 'nope' }),
      buy({ date: '2026-02-30' }),
      buy({ entryId: 'nope' }),
      buy({ memo: 'ก'.repeat(2001) }),
      buy({ amount: 1.5 }),
      buy({ amount: Number.MAX_SAFE_INTEGER + 1 }),
      buy({ priceMicro: 0 }),
    ];
    for (const t of bad) {
      expect(parseBackup(file(inv({ trades: [t], prices: [] })), TODAY).ok, JSON.stringify(t)).toBe(false);
    }
  });

  it('จำนวนหน่วย: ต้องเป็นข้อความจำนวนเต็มบวกไม่ขึ้นต้นด้วย 0 ไม่เกิน 2^63−1', () => {
    expect(parseBackup(file(inv({ trades: [buy({ units: '9223372036854775807', entryId: undefined })], prices: [] })), TODAY).ok).toBe(true);
    for (const u of ['9223372036854775808', '0', '012', '-5', '1.5', '1e3', '', ' 5', 5, null, '9999999999999999999']) {
      expect(parseBackup(file(inv({ trades: [buy({ units: u, entryId: undefined })], prices: [] })), TODAY).ok, String(u)).toBe(false);
    }
  });

  it('ขายเกินที่ถือ ณ เวลานั้น / ขายก่อนซื้อ ถูกปฏิเสธ (เล่นซ้ำรายการ)', () => {
    const sell = { id: 's1', assetId: 'a1', kind: 'sell', date: '2026-11-04', createdAt: '2026-11-04T00:00:00Z', units: '100', priceMicro: 1_000_000, fee: 0, withholding: 0, memo: '' };
    expect(problemsOf(file(inv({ trades: [buy({ entryId: undefined }), sell], prices: [] })))).toContain('ถือ');
    const over = { ...sell, id: 's2', date: '2026-11-30', units: '600000000' };
    expect(parseBackup(file(inv({ trades: [buy({ entryId: undefined }), over], prices: [] })), TODAY).ok).toBe(false);
  });

  it('ราคา: สินทรัพย์ต้องมีจริง · ราคา > 0 · หนึ่งราคาต่อสินทรัพย์ต่อวัน', () => {
    const p = (o: Record<string, unknown>) => parseBackup(file(inv({ prices: [{ assetId: 'a1', date: '2026-11-10', priceMicro: 1, ...o }] })), TODAY).ok;
    expect(p({})).toBe(true);
    expect(p({ assetId: 'nope' })).toBe(false);
    expect(p({ priceMicro: 0 })).toBe(false);
    expect(p({ priceMicro: 1.5 })).toBe(false);
    expect(p({ date: 'x' })).toBe(false);
    const dup = [{ assetId: 'a1', date: '2026-11-10', priceMicro: 1 }, { assetId: 'a1', date: '2026-11-10', priceMicro: 2 }];
    expect(parseBackup(file(inv({ prices: dup })), TODAY).ok).toBe(false);
  });

  it('รหัสรายการซ้ำ ถูกปฏิเสธ', () => {
    expect(parseBackup(file(inv({ trades: [buy(), buy()], prices: [] })), TODAY).ok).toBe(false);
  });

  it('เกินเพดานจำนวนแถว (สินทรัพย์ 200 / รายการ 10,000 / ราคา 10,000) ถูกปฏิเสธ', () => {
    const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
    expect(parseBackup(file(inv({ assets: many(MAX_ASSETS + 1, (i) => asset({ id: `a${i}`, accountId: `x${i}` })), trades: [], prices: [] })), TODAY).ok).toBe(false);
    expect(parseBackup(file(inv({ trades: many(MAX_TRADES + 1, (i) => buy({ id: `t${i}`, entryId: undefined })), prices: [] })), TODAY).ok).toBe(false);
    expect(parseBackup(file(inv({ trades: [], prices: many(MAX_PRICES + 1, (i) => ({ assetId: 'a1', date: '2026-11-10', priceMicro: i + 1 })) })), TODAY).ok).toBe(false);
  });

  it('รูปแบบผิด: investments ไม่ใช่วัตถุ / ฟิลด์ย่อยไม่ใช่อาร์เรย์ / แถวไม่ใช่วัตถุ', () => {
    expect(parseBackup(file('x'), TODAY).ok).toBe(false);
    expect(parseBackup(file([]), TODAY).ok).toBe(false);
    expect(parseBackup(file({ assets: 'x' }), TODAY).ok).toBe(false);
    expect(parseBackup(file({ assets: [1] }), TODAY).ok).toBe(false);
  });

  it('มีข้อมูลลงทุนแต่บัญชีลงทุนไม่ได้อยู่ในไฟล์ถูกปฏิเสธ (ไม่ทำให้บัญชีกลายเป็นเงินสดเงียบๆ)', () => {
    const noKind = accounts.map((a) => ({ id: a.id, type: a.type, name: a.name, currency: a.currency }));
    expect(problemsOf(file(inv(), { accounts: noKind }))).toContain('บัญชีลงทุน');
  });
});

describe('แปลงแถวฐานข้อมูล: สินทรัพย์ รายการ ราคา', () => {
  it('rowToAsset: archived เฉพาะเมื่อจริง · kind แปลกถูกปฏิเสธ', () => {
    expect(rowToAsset({ id: 'a1', name: 'x', kind: 'fund', account_id: 'inv1', archived: false })).toEqual({ id: 'a1', name: 'x', kind: 'fund', accountId: 'inv1' });
    expect(rowToAsset({ id: 'a1', name: 'x', kind: 'stock', account_id: 'inv1', archived: true }).archived).toBe(true);
    expect(() => rowToAsset({ id: 'a1', name: 'x', kind: 'crypto', account_id: 'inv1', archived: false })).toThrow();
  });
  it('rowToTrade: units เป็นข้อความตามเดิม (ไม่ผ่าน number) · ฟิลด์ว่างไม่ถูกใส่', () => {
    const row = { id: 't1', asset_id: 'a1', kind: 'buy', date: '2026-11-05', created_at: '2026-11-05T03:00:00+00:00', units: '9223372036854775807', price_micro: null, amount: 100, fee: 0, withholding: 0, memo: '', entry_id: null };
    const t = rowToTrade(row);
    expect(t.units).toBe('9223372036854775807');
    expect('priceMicro' in t).toBe(false);
    expect('entryId' in t).toBe(false);
    expect(t.createdAt).toBe('2026-11-05T03:00:00.000Z');
  });
  it('rowToTrade: ตัวเลขเงินที่ไม่ใช่จำนวนเต็มปลอดภัยถูกปฏิเสธ', () => {
    const row = { id: 't1', asset_id: 'a1', kind: 'buy', date: '2026-11-05', created_at: '2026-11-05T03:00:00Z', units: '1', price_micro: null, amount: 1.5, fee: 0, withholding: 0, memo: '', entry_id: null };
    expect(() => rowToTrade(row as never)).toThrow();
  });
  it('rowToPrice', () => {
    expect(rowToPrice({ asset_id: 'a1', date: '2026-11-10', price_micro: 11_000_000 })).toEqual({ assetId: 'a1', date: '2026-11-10', priceMicro: 11_000_000 });
  });
});
