import { describe, expect, it } from 'vitest';
import { parseInvestments } from '../../src/domain/backup/parseInvestments';
import { categoriesProblem, validSector } from '../../src/domain/invest/categories';
import { isEmptyInvestments, MAX_CATEGORIES, type AssetCategory, type InvestmentData } from '../../src/domain/invest/types';
import type { Account } from '../../src/domain/ledger/types';
import { categoryToJson, investmentsToJson, rowToAsset, rowToCategory } from '../../src/storage/supabaseRepository';

// ข้อมูลสมมติ · R2 Categories (เป้าเป็น bps · รวม 10,000)
const cat = (id: string, name: string, targetBps: number | null, sortOrder = 0): AssetCategory => ({ id, name, targetBps, sortOrder });
const THREE = [cat('c1', 'Tech', 5000, 1), cat('c2', 'Health', 3000, 2), cat('c3', 'Funds', 2000, 3)];

describe('categoriesProblem (กฎเดียวกับฐานข้อมูล)', () => {
  it('ชุดที่ถูกต้อง: เป้ารวม 10,000 · ไม่ตั้งเป้าเลยก็ได้ · ไม่มีหมวดก็ได้', () => {
    expect(categoriesProblem(THREE)).toBeNull();
    expect(categoriesProblem(THREE.map((c) => ({ ...c, targetBps: null })))).toBeNull();
    expect(categoriesProblem([])).toBeNull();
    expect(categoriesProblem([cat('a', 'Only', 10_000)])).toBeNull();
  });
  it('เป้ารวมไม่ครบ 100% = targetTotal (99.99% และ 100.01%) · ตั้งเป้าบางหมวด = targetTotal', () => {
    expect(categoriesProblem([cat('a', 'A', 5000), cat('b', 'B', 4999)])).toBe('targetTotal');
    expect(categoriesProblem([cat('a', 'A', 5000), cat('b', 'B', 5001)])).toBe('targetTotal');
    expect(categoriesProblem([cat('a', 'A', 5000), cat('b', 'B', null)])).toBe('targetTotal');
  });
  it('เป้าไม่ใช่จำนวนเต็ม/ติดลบ/เกิน 10,000 = target · ลำดับนอกช่วง = sort', () => {
    expect(categoriesProblem([cat('a', 'A', 10_001)])).toBe('target');
    expect(categoriesProblem([cat('a', 'A', -1)])).toBe('target');
    expect(categoriesProblem([cat('a', 'A', 33.5)])).toBe('target');
    expect(categoriesProblem([cat('a', 'A', null, 1001)])).toBe('sort');
    expect(categoriesProblem([cat('a', 'A', null, -1)])).toBe('sort');
  });
  it('ชื่อ: ซ้ำไม่สนตัวพิมพ์ · ช่องว่างหน้าหลัง · ว่าง · ยาวเกิน 60 · อักขระศูนย์ความกว้าง/ตัวกลับทิศ/ควบคุม', () => {
    expect(categoriesProblem([cat('a', 'Tech', null), cat('b', 'tech', null)])).toBe('duplicateName');
    expect(categoriesProblem([cat('a', ' Tech', null)])).toBe('name');
    expect(categoriesProblem([cat('a', 'Tech ', null)])).toBe('name');
    expect(categoriesProblem([cat('a', '', null)])).toBe('name');
    expect(categoriesProblem([cat('a', 'x'.repeat(61), null)])).toBe('name');
    expect(categoriesProblem([cat('a', 'x'.repeat(60), null)])).toBeNull();
    expect(categoriesProblem([cat('a', 'Te​ch', null)])).toBe('name');
    expect(categoriesProblem([cat('a', 'Te‮ch', null)])).toBe('name');
    expect(categoriesProblem([cat('a', 'Te\tch', null)])).toBe('name');
    expect(categoriesProblem([cat('a', 'Te\u007Fch', null)])).toBe('name');
  });
  it('รหัสซ้ำ/ว่าง · เกิน 50 หมวด (ตรงเพดานฐานข้อมูล)', () => {
    expect(categoriesProblem([cat('a', 'A', null), cat('a', 'B', null)])).toBe('duplicateId');
    expect(categoriesProblem([cat('', 'A', null)])).toBe('id');
    const many = Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => cat(`k${i}`, `N${i}`, null));
    expect(categoriesProblem(many)).toBe('count');
    expect(categoriesProblem(many.slice(0, MAX_CATEGORIES))).toBeNull();
  });
  it('sector: 1-60 ตัวอักษร ไม่มีช่องว่างหน้าหลัง/อักขระต้องห้าม', () => {
    expect(validSector('Information Technology')).toBe(true);
    expect(validSector('')).toBe(false);
    expect(validSector(' x')).toBe(false);
    expect(validSector('a‮b')).toBe(false);
    expect(validSector('x'.repeat(61))).toBe(false);
    expect(validSector(5)).toBe(false);
  });
});

describe('ไฟล์สำรอง: หมวด/sector/categoryId ส่งออก → ตรวจ → ได้ข้อมูลเดิม', () => {
  const accounts: Account[] = [
    { id: 'inv-a', name: 'หุ้น A', type: 'asset', currency: 'USD', kind: 'investment' },
    { id: 'inv-b', name: 'หุ้น B', type: 'asset', currency: 'USD', kind: 'investment' },
  ];
  const data: InvestmentData = {
    categories: THREE,
    assets: [
      { id: 'sa', name: 'หุ้น A', kind: 'stock', accountId: 'inv-a', currency: 'USD', ticker: 'AAA', exchange: 'NASDAQ', sector: 'Information Technology', categoryId: 'c1' },
      { id: 'sb', name: 'หุ้น B', kind: 'stock', accountId: 'inv-b', currency: 'USD', ticker: 'BBB', exchange: 'NYSE' },
    ],
    trades: [],
    prices: [],
  };
  const parse = (raw: unknown) => {
    const problems: string[] = [];
    const out = parseInvestments(raw, accounts, [], (m) => problems.push(m));
    return { out, problems };
  };
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  it('ส่งออกแล้วตรวจกลับได้ข้อมูลเท่าเดิมทุกค่า (วนกลับ)', () => {
    const json = investmentsToJson(data);
    expect(json.categories).toEqual([
      { id: 'c1', name: 'Tech', sortOrder: 1, targetBps: 5000 },
      { id: 'c2', name: 'Health', sortOrder: 2, targetBps: 3000 },
      { id: 'c3', name: 'Funds', sortOrder: 3, targetBps: 2000 },
    ]);
    const { out, problems } = parse(clone(json));
    expect(problems).toEqual([]);
    expect(out.categories).toEqual(THREE);
    expect(out.assets[0]).toMatchObject({ sector: 'Information Technology', categoryId: 'c1' });
    expect(out.assets[1]!.categoryId).toBeUndefined();
  });
  it('ไฟล์รุ่นเก่า (ไม่มีหมวด) ได้ผลเหมือนเดิม: ไม่มีคีย์ categories ในผลส่งออก/ตรวจ', () => {
    const old: InvestmentData = { assets: [data.assets[1]!], trades: [], prices: [] };
    const json = investmentsToJson(old);
    expect(Object.keys(json).sort()).toEqual(['assets', 'prices', 'trades']);
    const { out, problems } = parse(json);
    expect(problems).toEqual([]);
    expect(out.categories).toBeUndefined();
  });
  it('categoryId ที่ไม่มีหมวดในไฟล์ · เป้ารวมผิด · ชื่อซ้ำ · sector ผิดรูป ถูกปฏิเสธพร้อมเหตุผล', () => {
    const base = clone(investmentsToJson(data)) as { assets: Record<string, unknown>[]; categories: Record<string, unknown>[] };
    const badLink = clone(base);
    badLink.assets[0]!.categoryId = 'nope';
    expect(parse(badLink).problems.join('|')).toContain('categoryId');
    const badTotal = clone(base);
    badTotal.categories[2]!.targetBps = 1999;
    expect(parse(badTotal).problems.join('|')).toContain('100%');
    const dup = clone(base);
    dup.categories[1]!.name = 'TECH';
    expect(parse(dup).problems.join('|')).toContain('ชื่อหมวดซ้ำ');
    const badSector = clone(base);
    badSector.assets[0]!.sector = ' x';
    expect(parse(badSector).problems.join('|')).toContain('sector');
    const notObj = clone(base) as { categories: unknown[] };
    notObj.categories[0] = 5;
    expect(parse(notObj).problems.join('|')).toContain('ไม่ใช่วัตถุ');
    const many = { assets: [], categories: Array.from({ length: 51 }, (_, i) => ({ id: `k${i}`, name: `N${i}` })) };
    expect(parse(many).problems.join('|')).toContain('มีหมวดมากเกินไป');
  });
  it('มีหมวดอย่างเดียวก็ไม่ว่าง (นำเข้า/ส่งออกต้องไม่ทิ้งหมวด)', () => {
    expect(isEmptyInvestments({ assets: [], trades: [], prices: [], categories: THREE })).toBe(false);
    expect(isEmptyInvestments({ assets: [], trades: [], prices: [] })).toBe(true);
  });
});

describe('แถวจากฐานข้อมูล ↔ ข้อมูลในแอป', () => {
  it('rowToAsset อ่าน sector/category_id · ค่าว่างไม่ใส่ · rowToCategory เป้า null ได้', () => {
    const a = rowToAsset({ id: 's', name: 'N', kind: 'stock', account_id: 'inv-s', archived: false, sector: 'Utilities', category_id: 'c1' });
    expect(a).toMatchObject({ sector: 'Utilities', categoryId: 'c1' });
    const b = rowToAsset({ id: 's', name: 'N', kind: 'stock', account_id: 'inv-s', archived: false, sector: '', category_id: null });
    expect(b.sector).toBeUndefined();
    expect(b.categoryId).toBeUndefined();
    expect(rowToCategory({ id: 'c', name: 'X', target_bps: null, sort_order: 2 })).toEqual({ id: 'c', name: 'X', targetBps: null, sortOrder: 2 });
    expect(rowToCategory({ id: 'c', name: 'X', target_bps: 4500, sort_order: 0 }).targetBps).toBe(4500);
    expect(() => rowToCategory({ id: 'c', name: 'X', target_bps: 1.5, sort_order: 0 })).toThrow();
  });
  it('categoryToJson: เป้าที่ไม่ตั้งไม่ส่งคีย์ targetBps', () => {
    expect(categoryToJson(cat('c', 'X', null, 3))).toEqual({ id: 'c', name: 'X', sortOrder: 3 });
    expect(categoryToJson(cat('c', 'X', 0, 3))).toEqual({ id: 'c', name: 'X', sortOrder: 3, targetBps: 0 });
  });
});
