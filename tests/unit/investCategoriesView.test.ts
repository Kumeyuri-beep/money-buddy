import { describe, expect, it } from 'vitest';
import {
  addDraftCategory, buildCategoryTable, bpsToPercentText, draftTotals, draftsToCategories, fromSectors, mergeCategories, moveCategory,
  percentTextToBps, removeCategory, stateFromData, stateToSave, UNCATEGORIZED_ID, type CategoryState,
} from '../../src/domain/invest/categoriesView';
import { MAX_CATEGORIES, type Asset, type AssetCategory } from '../../src/domain/invest/types';
import type { HoldingRow } from '../../src/domain/invest/holdingsView';

// ข้อมูลสมมติทั้งหมด
const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({ id, name: `Demo ${id}`, kind: 'stock', accountId: `inv-${id}`, currency: 'USD', ticker: id.toUpperCase(), ...extra });
const cat = (id: string, name: string, targetBps: number | null, sortOrder = 0): AssetCategory => ({ id, name, targetBps, sortOrder });
const row = (assetId: string, o: Partial<HoldingRow> = {}): HoldingRow => ({
  assetId, name: assetId, ticker: assetId, units: 10n, hasTrades: true, sold: false, priceMicro: 1, pricePerShare: 1, cost: 1000, costPerShare: 100, value: 1000, dividends: 0, dividends12m: 0,
  yieldBps: null, yieldOnCostBps: null, profit: 0, profitBps: 0, unrealized: 0, unrealizedBps: 0, weightBps: null, sources: null, missing: null, ...o,
});

describe('bps <-> เปอร์เซ็นต์ (จำนวนเต็มล้วน)', () => {
  it('bpsToPercentText: 0, 1, 750, 4500, 9999, 10000', () => {
    expect(bpsToPercentText(0)).toBe('0');
    expect(bpsToPercentText(1)).toBe('0.01');
    expect(bpsToPercentText(750)).toBe('7.5');
    expect(bpsToPercentText(4500)).toBe('45');
    expect(bpsToPercentText(9999)).toBe('99.99');
    expect(bpsToPercentText(10_000)).toBe('100');
  });
  it('bpsToPercentText: ไม่ใช่จำนวนเต็ม/นอกช่วง = RangeError', () => {
    expect(() => bpsToPercentText(-1)).toThrow(RangeError);
    expect(() => bpsToPercentText(10_001)).toThrow(RangeError);
    expect(() => bpsToPercentText(1.5)).toThrow(RangeError);
  });
  it('percentTextToBps: ว่าง = empty · รูปแบบถูก = ok · เกิน 2 ตำแหน่ง/ติดลบ/เกิน 100/อักษร = invalid', () => {
    expect(percentTextToBps('')).toEqual({ kind: 'empty' });
    expect(percentTextToBps('  ')).toEqual({ kind: 'empty' });
    expect(percentTextToBps('0')).toEqual({ kind: 'ok', bps: 0 });
    expect(percentTextToBps('7.5')).toEqual({ kind: 'ok', bps: 750 });
    expect(percentTextToBps('7.50')).toEqual({ kind: 'ok', bps: 750 });
    expect(percentTextToBps('99.99')).toEqual({ kind: 'ok', bps: 9999 });
    expect(percentTextToBps('100')).toEqual({ kind: 'ok', bps: 10_000 });
    expect(percentTextToBps('100.00')).toEqual({ kind: 'ok', bps: 10_000 });
    expect(percentTextToBps('100.01')).toEqual({ kind: 'invalid' });
    expect(percentTextToBps('1.234')).toEqual({ kind: 'invalid' });
    expect(percentTextToBps('-1')).toEqual({ kind: 'invalid' });
    expect(percentTextToBps('abc')).toEqual({ kind: 'invalid' });
    expect(percentTextToBps('1e2')).toEqual({ kind: 'invalid' });
    expect(percentTextToBps('.5')).toEqual({ kind: 'invalid' });
    expect(percentTextToBps('5.')).toEqual({ kind: 'invalid' });
  });
  it('ไป-กลับได้ทุกค่า bps ที่เป็นไปได้ (ไม่มี float)', () => {
    for (let b = 0; b <= 10_000; b += 7) expect(percentTextToBps(bpsToPercentText(b))).toEqual({ kind: 'ok', bps: b });
  });
});

describe('draftTotals + draftsToCategories (เป้ารวม 100% พอดี)', () => {
  const d = (id: string, name: string, targetText: string) => ({ id, name, targetText });
  it('หมวดว่าง = ไม่มีเป้า บันทึกได้ (ไม่ตั้งเป้า)', () => {
    expect(draftTotals([])).toMatchObject({ status: 'none', diffBps: 0, setCount: 0 });
    expect(draftsToCategories([])).toEqual({ ok: true, categories: [] });
  });
  it('เป้า 0% ทุกหมวด รวม 0 = ขาด 100%', () => {
    const t = draftTotals([d('a', 'A', '0'), d('b', 'B', '0')]);
    expect(t.status).toBe('under');
    expect(t.diffBps).toBe(-10_000);
  });
  it('100.00% พอดี = ok · 99.99% = under (ขาด 1 bps) · 100.01% = over', () => {
    expect(draftTotals([d('a', 'A', '60'), d('b', 'B', '40')])).toMatchObject({ status: 'ok', totalBps: 10_000, diffBps: 0 });
    expect(draftTotals([d('a', 'A', '60'), d('b', 'B', '39.99')])).toMatchObject({ status: 'under', diffBps: -1 });
    expect(draftTotals([d('a', 'A', '60'), d('b', 'B', '40.01')])).toMatchObject({ status: 'over', diffBps: 1 });
    expect(draftsToCategories([d('a', 'A', '60'), d('b', 'B', '39.99')]).ok).toBe(false);
    expect(draftsToCategories([d('a', 'A', '60'), d('b', 'B', '40.01')]).ok).toBe(false);
  });
  it('ตั้งบางหมวด = partial · ข้อความเป้าผิดรูป = invalid ทั้งคู่ห้าม Save', () => {
    expect(draftTotals([d('a', 'A', '60'), d('b', 'B', '')]).status).toBe('partial');
    expect(draftsToCategories([d('a', 'A', '100'), d('b', 'B', '')])).toMatchObject({ ok: false, problem: 'targetTotal' });
    expect(draftTotals([d('a', 'A', '60'), d('b', 'B', '4x')]).status).toBe('invalid');
    expect(draftsToCategories([d('a', 'A', '60'), d('b', 'B', '4x')])).toMatchObject({ ok: false, problem: 'target' });
  });
  it('ผลลัพธ์ที่ใช้ได้: เก็บ bps จำนวนเต็ม · ลำดับ = ตำแหน่ง · ตัดช่องว่างหน้าหลังชื่อ', () => {
    const r = draftsToCategories([d('a', ' Tech ', '45'), d('b', 'Health', '55')]);
    expect(r).toEqual({ ok: true, categories: [cat('a', 'Tech', 4500, 0), cat('b', 'Health', 5500, 1)] });
  });
  it('ชื่อซ้ำไม่สนตัวพิมพ์/ชื่อว่างถูกปฏิเสธ · 50 หมวดผ่าน 51 หมวดไม่ผ่าน', () => {
    expect(draftsToCategories([d('a', 'Tech', ''), d('b', 'tech', '')])).toMatchObject({ ok: false, problem: 'duplicateName' });
    expect(draftsToCategories([d('a', '  ', '')])).toMatchObject({ ok: false, problem: 'name' });
    const many = (n: number) => Array.from({ length: n }, (_, i) => d(`c${i}`, `Cat ${i}`, ''));
    expect(draftsToCategories(many(MAX_CATEGORIES)).ok).toBe(true);
    expect(draftsToCategories(many(MAX_CATEGORIES + 1))).toMatchObject({ ok: false, problem: 'count' });
  });
});

describe('แก้สถานะร่าง', () => {
  const base = (): CategoryState => ({ drafts: [{ id: 'a', name: 'A', targetText: '50' }, { id: 'b', name: 'B', targetText: '50' }], assign: { x: 'a', y: 'b', z: 'a' } });
  it('removeCategory: สินทรัพย์ในหมวดกลับเป็น Uncategorized', () => {
    const s = removeCategory(base(), 'a');
    expect(s.drafts.map((x) => x.id)).toEqual(['b']);
    expect(s.assign).toEqual({ y: 'b' });
  });
  it('mergeCategories: ย้ายสินทรัพย์ทั้งหมดไปหมวดปลายทาง รวมเป้า (ทั้งคู่ตั้ง) แล้วลบต้นทาง', () => {
    const s = mergeCategories(base(), 'a', 'b');
    expect(s.drafts).toEqual([{ id: 'b', name: 'B', targetText: '100' }]);
    expect(s.assign).toEqual({ x: 'b', y: 'b', z: 'b' });
  });
  it('mergeCategories: เป้าฝั่งเดียวตั้ง = ใช้ค่านั้น · ไม่ตั้งทั้งคู่ = ว่าง · เป้ารวมเกิน 100 ใส่ข้อความเดิมของ merge ให้ผู้ใช้แก้ (ไม่เกินช่วงจะ invalid ตอน Save)', () => {
    const a = { drafts: [{ id: 'a', name: 'A', targetText: '' }, { id: 'b', name: 'B', targetText: '30' }], assign: {} };
    expect(mergeCategories(a, 'a', 'b').drafts[0]!.targetText).toBe('30');
    const b = { drafts: [{ id: 'a', name: 'A', targetText: '' }, { id: 'b', name: 'B', targetText: '' }], assign: {} };
    expect(mergeCategories(b, 'a', 'b').drafts[0]!.targetText).toBe('');
    const c = { drafts: [{ id: 'a', name: 'A', targetText: '70' }, { id: 'b', name: 'B', targetText: '40' }], assign: {} };
    expect(mergeCategories(c, 'a', 'b').drafts[0]!.targetText).toBe('110'); // เกิน 100 → ตรวจที่ draftTotals/draftsToCategories (over)
    expect(draftsToCategories(mergeCategories(c, 'a', 'b').drafts).ok).toBe(false);
  });
  it('mergeCategories: ต้นทาง = ปลายทาง หรือไม่มีรหัส = ไม่เปลี่ยน', () => {
    const s = base();
    expect(mergeCategories(s, 'a', 'a')).toEqual(s);
    expect(mergeCategories(s, 'a', 'zzz')).toEqual(s);
  });
  it('moveCategory: ขึ้น/ลง · ชนขอบ = ไม่เปลี่ยน', () => {
    const s = base();
    expect(moveCategory(s, 'b', -1).drafts.map((x) => x.id)).toEqual(['b', 'a']);
    expect(moveCategory(s, 'a', -1).drafts.map((x) => x.id)).toEqual(['a', 'b']);
    expect(moveCategory(s, 'b', 1).drafts.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('addDraftCategory: เพิ่มท้ายสุด เป้าว่าง · ครบ 50 แล้วไม่เพิ่ม', () => {
    expect(addDraftCategory(base(), 'c', 'C').drafts.at(-1)).toEqual({ id: 'c', name: 'C', targetText: '' });
    let s: CategoryState = { drafts: [], assign: {} };
    for (let i = 0; i < MAX_CATEGORIES + 3; i += 1) s = addDraftCategory(s, `c${i}`, `C${i}`);
    expect(s.drafts).toHaveLength(MAX_CATEGORIES);
  });
});

describe('fromSectors (สร้างจาก sector ของที่ถืออยู่)', () => {
  const held = (...ids: string[]) => new Set(ids);
  const assets = [
    asset('a', { sector: 'Technology' }), asset('b', { sector: 'technology' }), asset('c', { sector: 'Health Care' }),
    asset('d'), asset('e', { sector: 'Energy' }),
  ];
  let n = 0;
  const mk = () => `new-${(n += 1)}`;
  it('จัดกลุ่มไม่สนตัวพิมพ์ (ใช้ตัวสะกดของตัวแรก) · ไม่มี sector = Uncategorized · ขายหมดแล้ว (ไม่อยู่ในที่ถือ) ไม่นับ', () => {
    n = 0;
    const s = fromSectors({ drafts: [], assign: {} }, assets, held('a', 'b', 'c', 'd'), mk);
    expect(s.drafts.map((x) => x.name)).toEqual(['Health Care', 'Technology']); // เรียงตามชื่อ (e ไม่ได้ถือ ไม่เกิดหมวด Energy)
    const idOf = (name: string) => s.drafts.find((x) => x.name === name)!.id;
    expect(s.assign).toEqual({ a: idOf('Technology'), b: idOf('Technology'), c: idOf('Health Care') });
    expect(s.assign['d']).toBeUndefined();
    expect(s.drafts.every((x) => x.targetText === '')).toBe(true);
  });
  it('ใช้หมวดเดิมที่ชื่อตรง (ไม่สนตัวพิมพ์) · คงเป้าเดิม · หมวดเดิมอื่นคงอยู่', () => {
    n = 0;
    const start: CategoryState = { drafts: [{ id: 'old-t', name: 'TECHNOLOGY', targetText: '60' }, { id: 'old-x', name: 'Misc', targetText: '40' }], assign: {} };
    const s = fromSectors(start, assets, held('a', 'c'), mk);
    expect(s.drafts.map((x) => x.id)).toEqual(['old-t', 'old-x', 'new-1']);
    expect(s.assign).toEqual({ a: 'old-t', c: 'new-1' });
    expect(draftTotals(s.drafts).status).toBe('partial'); // หมวดใหม่ยังไม่มีเป้า → ผู้ใช้ต้องตั้งก่อน Save
  });
  it('ไม่มีสินทรัพย์ที่มี sector = ไม่เปลี่ยนอะไร · sector ที่ไม่ผ่านตรวจ (มีช่องว่างหน้าหลัง) ถือว่าไม่มี', () => {
    const start: CategoryState = { drafts: [], assign: {} };
    expect(fromSectors(start, [asset('p'), asset('q', { sector: ' Tech' })], held('p', 'q'), mk)).toEqual(start);
  });
  it('เกิน 50 หมวดไม่เกินเพดาน (ตัดส่วนเกิน)', () => {
    const many = Array.from({ length: 60 }, (_, i) => asset(`s${i}`, { sector: `Sec ${String(i).padStart(2, '0')}` }));
    const s = fromSectors({ drafts: [], assign: {} }, many, new Set(many.map((a) => a.id)), mk);
    expect(s.drafts).toHaveLength(MAX_CATEGORIES);
  });
});

describe('stateFromData / stateToSave', () => {
  it('stateFromData: หมวดเรียงตาม sortOrder · เป้าเป็นข้อความเปอร์เซ็นต์ · assign จาก asset.categoryId', () => {
    const s = stateFromData([asset('a', { categoryId: 'c2' }), asset('b')], [cat('c2', 'B', 2500, 2), cat('c1', 'A', 7500, 1)]);
    expect(s.drafts).toEqual([{ id: 'c1', name: 'A', targetText: '75' }, { id: 'c2', name: 'B', targetText: '25' }]);
    expect(s.assign).toEqual({ a: 'c2' });
  });
  it('stateToSave: ส่งเฉพาะสินทรัพย์ที่หมวดเปลี่ยน (null = ล้าง) · ไม่เปลี่ยน = ไม่ส่ง', () => {
    const assets = [asset('a', { categoryId: 'c1' }), asset('b', { categoryId: 'c1' }), asset('c')];
    const state: CategoryState = { drafts: [{ id: 'c1', name: 'A', targetText: '' }, { id: 'c2', name: 'B', targetText: '' }], assign: { a: 'c2', c: 'c1' } };
    const r = stateToSave(state, assets);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.assignments).toEqual([{ assetId: 'a', categoryId: 'c2' }, { assetId: 'b', categoryId: null }, { assetId: 'c', categoryId: 'c1' }]);
      expect(r.categories.map((c) => c.id)).toEqual(['c1', 'c2']);
    }
  });
  it('stateToSave: ร่างผิด = ok false พร้อมปัญหา', () => {
    const r = stateToSave({ drafts: [{ id: 'a', name: 'A', targetText: '50' }], assign: {} }, []);
    expect(r).toMatchObject({ ok: false, problem: 'targetTotal' });
  });
});

describe('buildCategoryTable (ตารางสรุปต่อหมวด · ใช้ totalsOf ของ domain)', () => {
  const assets = [asset('a', { categoryId: 'c1' }), asset('b', { categoryId: 'c1' }), asset('c', { categoryId: 'c2' }), asset('d')];
  const cats = [cat('c1', 'Tech', 6000, 1), cat('c2', 'Health', 4000, 2)];
  it('รวมมูลค่า/ต้นทุน/กำไรต่อหมวด + สัดส่วนรวม 10,000 + เทียบเป้า + แถว Uncategorized', () => {
    const rows = [
      row('a', { value: 3000, cost: 2000, unrealized: 1000, unrealizedBps: 5000 }),
      row('b', { value: 1000, cost: 1000, unrealized: 0 }),
      row('c', { value: 4000, cost: 5000, unrealized: -1000, unrealizedBps: -2000 }),
      row('d', { value: 2000, cost: 2000, unrealized: 0 }),
    ];
    const t = buildCategoryTable(rows, assets, cats, 'USD');
    expect(t.map((r) => r.name)).toEqual(['Tech', 'Health', 'Uncategorized']);
    expect(t[0]).toMatchObject({ id: 'c1', count: 2, value: 4000, cost: 3000, unrealized: 1000, targetBps: 6000 });
    expect(t[1]).toMatchObject({ id: 'c2', count: 1, value: 4000, cost: 5000, unrealized: -1000, targetBps: 4000 });
    expect(t[2]).toMatchObject({ id: UNCATEGORIZED_ID, count: 1, value: 2000, targetBps: null, diffBps: null, status: 'none' });
    expect(t.reduce((s, r) => s + (r.weightBps ?? 0), 0)).toBe(10_000);
    expect(t[0]!.weightBps).toBe(4000);
    expect(t[0]!.diffBps).toBe(-2000);
    expect(t[0]!.status).toBe('under');
    expect(t[1]!.diffBps).toBe(0);
    expect(t[1]!.status).toBe('on');
  });
  it('ไม่มีสินทรัพย์ Uncategorized = ไม่แสดงแถวนั้น · หมวดว่างยังแสดง (0 รายการ มูลค่า 0)', () => {
    const t = buildCategoryTable([row('a', { value: 100 })], [asset('a', { categoryId: 'c1' })], cats, 'USD');
    expect(t.map((r) => r.id)).toEqual(['c1', 'c2']);
    expect(t[1]).toMatchObject({ count: 0, value: 0, cost: 0 });
  });
  it('มีหุ้นในหมวดที่ไม่มีราคา = มูลค่าของหมวดเป็น null ("—" ไม่เดา) · สัดส่วนทั้งตารางเป็น null เพราะรวมไม่ครบ (R20.7)', () => {
    const rows = [row('a', { value: null, missing: 'price', unrealized: null }), row('b', { value: 1000 }), row('c', { value: 4000 }), row('d', { value: 100 })];
    const t = buildCategoryTable(rows, assets, cats, 'USD');
    expect(t[0]!.value).toBeNull();
    expect(t[0]!.complete).toBe(false);
    expect(t.every((r) => r.weightBps === null && r.diffBps === null && r.status === 'none')).toBe(true);
    expect(t[1]!.value).toBe(4000);
  });
  it('หุ้นที่ขายหมดแล้วไม่นับเป็นรายการ · ตะกร้าทั้งหมดมูลค่า 0 = ไม่แบ่งสัดส่วน (weightBps null)', () => {
    const rows = [row('a', { sold: true, units: 0n, value: 0, cost: 0 })];
    const t = buildCategoryTable(rows, [asset('a', { categoryId: 'c1' })], [cat('c1', 'Tech', null)], 'USD');
    expect(t[0]).toMatchObject({ count: 0, value: 0, weightBps: null, status: 'none' });
  });
  it('สถานะเทียบเป้า: ในช่วงยอมรับ = on · เกิน = over · ขาด = under · ไม่ตั้งเป้า = none', () => {
    const mk = (w: number) => {
      const other = 10_000 - w;
      const rows = [row('a', { value: w }), row('c', { value: other })];
      return buildCategoryTable(rows, [asset('a', { categoryId: 'c1' }), asset('c', { categoryId: 'c2' })], [cat('c1', 'T', 5000), cat('c2', 'H', 5000)], 'USD');
    };
    expect(mk(5000)[0]!.status).toBe('on');
    expect(mk(5149)[0]!.status).toBe('on');
    expect(mk(5151)[0]!.status).toBe('over');
    expect(mk(4849)[0]!.status).toBe('under');
    expect(buildCategoryTable([row('a', { value: 5 })], [asset('a', { categoryId: 'c1' })], [cat('c1', 'T', null)], 'USD')[0]!.status).toBe('none');
  });
  it('ไม่มีหมวดและไม่มีสินทรัพย์ = ตารางว่าง', () => {
    expect(buildCategoryTable([], [], [], 'USD')).toEqual([]);
  });
});
