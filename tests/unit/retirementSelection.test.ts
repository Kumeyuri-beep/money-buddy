import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import { MAX_RETIREMENT_ASSETS, retirementAssetIdsProblem, sanitizeRetirementAssetIds } from '../../src/domain/invest/retirementSelection';
import { MoneyDB } from '../../src/storage/db';
import { loadSettings, saveSettings, StorageError } from '../../src/storage/repository';
import { initialRetirementSelection, retirementAssetOptions } from '../../src/app/retirementPortfolio';
import type { Asset, InvestmentData, TradeRecord } from '../../src/domain/invest/types';

describe('sanitizeRetirementAssetIds: อ่านค่าจากภายนอกแบบไม่เชื่อ', () => {
  it('เก็บเฉพาะรหัสที่ถูกต้อง ไม่ซ้ำ เรียงตามเดิม', () => {
    expect(sanitizeRetirementAssetIds(['a1', 'a2', 'a1', '', 5, null, { x: 1 }, 'a3'])).toEqual(['a1', 'a2', 'a3']);
  });
  it('ไม่ใช่อาร์เรย์ / ว่าง = []', () => {
    expect(sanitizeRetirementAssetIds(undefined)).toEqual([]);
    expect(sanitizeRetirementAssetIds('a1')).toEqual([]);
    expect(sanitizeRetirementAssetIds({})).toEqual([]);
    expect(sanitizeRetirementAssetIds([])).toEqual([]);
  });
  it('รหัสยาวเกิน 100 ตัวอักษร หรือมีอักขระที่ฐานข้อมูลรับไม่ได้ถูกทิ้ง', () => {
    expect(sanitizeRetirementAssetIds(['x'.repeat(100), 'x'.repeat(101), 'a\u0000b'])).toEqual(['x'.repeat(100)]);
  });
  it(`เกินเพดาน ${MAX_RETIREMENT_ASSETS} รายการ = ตัดเหลือเพดาน`, () => {
    const many = Array.from({ length: MAX_RETIREMENT_ASSETS + 5 }, (_, i) => `a${i}`);
    expect(sanitizeRetirementAssetIds(many)).toHaveLength(MAX_RETIREMENT_ASSETS);
  });
});

describe('retirementAssetIdsProblem: ตรวจก่อนบันทึก (ปฏิเสธ ไม่ตัดเงียบ)', () => {
  it('ถูกต้อง = null', () => {
    expect(retirementAssetIdsProblem(['a1', 'a2'])).toBeNull();
    expect(retirementAssetIdsProblem([])).toBeNull();
  });
  it('ไม่ใช่อาร์เรย์ · ซ้ำ · รหัสผิดรูป · เกินเพดาน', () => {
    expect(retirementAssetIdsProblem('a1' as unknown as string[])).toContain('อาร์เรย์');
    expect(retirementAssetIdsProblem(['a1', 'a1'])).toContain('ซ้ำ');
    expect(retirementAssetIdsProblem(['a1', ''])).toContain('รหัส');
    expect(retirementAssetIdsProblem([5 as unknown as string])).toContain('รหัส');
    expect(retirementAssetIdsProblem(Array.from({ length: MAX_RETIREMENT_ASSETS + 1 }, (_, i) => `a${i}`))).toContain('ไม่เกิน');
  });
});

describe('ค่าตั้งค่า (settings) รองรับ retirementAssetIds', () => {
  it('sanitizeSettings เก็บรหัสที่ถูกต้อง · ไม่มี = ไม่มีฟิลด์', () => {
    expect(sanitizeSettings({ payDay: 25, retirementAssetIds: ['a1', 5, 'a1'] })).toEqual({ payDay: 25, retirementAssetIds: ['a1'] });
    expect(sanitizeSettings({ payDay: 25, retirementAssetIds: [] })).toEqual({ payDay: 25 });
    expect(sanitizeSettings({ payDay: 25, retirementAssetIds: 'a1' })).toEqual({ payDay: 25 });
  });
  it('settingsProblem ปฏิเสธรายการผิดรูป', () => {
    expect(settingsProblem({ retirementAssetIds: ['a1'] })).toBeNull();
    expect(settingsProblem({ retirementAssetIds: ['a1', 'a1'] })).toContain('เกษียณ');
  });
});

describe('เพดานขนาดรวมของค่าตั้งค่า (ตารางฐานข้อมูลจำกัด 16 KB)', () => {
  const longId = (i: number) => `${String(i).padStart(3, '0')}${'あ'.repeat(97)}`; // ตัวอักษรไทย/ญี่ปุ่น 3 ไบต์ต่อตัว
  const bigPlans = Array.from({ length: 20 }, (_, i) => ({ id: longId(i), assetId: longId(i + 100), amount: 100_000, dayOfMonth: 5, startMonth: '2026-09' }));
  it('รหัสยาวสุดรวมกับแผน DCA จนเกิน 12,000 ไบต์ถูกปฏิเสธด้วยข้อความไทยที่ชัด (ไม่ปล่อยให้ฐานข้อมูลปฏิเสธแบบงงๆ)', () => {
    const ids = Array.from({ length: MAX_RETIREMENT_ASSETS }, (_, i) => longId(i));
    expect(settingsProblem({ dcaPlans: bigPlans, retirementAssetIds: ids })).toContain('ขนาดใหญ่เกินไป');
  });
  it('ใช้งานจริง (รหัสราว 40 ตัวอักษร ครบ 30 รายการ) ผ่าน', () => {
    const ids = Array.from({ length: MAX_RETIREMENT_ASSETS }, (_, i) => `asset-${String(i).padStart(2, '0')}-${'x'.repeat(30)}`);
    expect(settingsProblem({ payDay: 25, retirementAssetIds: ids })).toBeNull();
  });
  it('ตรวจตอนบันทึกในเครื่องด้วย: ขนาดเกินถูกปฏิเสธ ของเดิมไม่เปลี่ยน', async () => {
    const db = new MoneyDB(`retire-size-${Math.random().toString(36).slice(2)}`);
    try {
      await saveSettings(db, { retirementAssetIds: ['a1'] });
      const ids = Array.from({ length: MAX_RETIREMENT_ASSETS }, (_, i) => longId(i));
      await expect(saveSettings(db, { dcaPlans: bigPlans, retirementAssetIds: ids })).rejects.toThrow(StorageError);
      expect((await loadSettings(db)).retirementAssetIds).toEqual(['a1']);
    } finally {
      db.close();
    }
  });
});

describe('ไฟล์สำรองรวมการเลือกสินทรัพย์เกษียณ (ผ่าน settings)', () => {
  const accountsF = [{ id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' }];
  const backup = (settings: unknown) => JSON.stringify({ schemaVersion: 2, exportedAt: '2026-11-10T00:00:00.000Z', accounts: accountsF, entries: [], bills: [], settings });
  it('รหัสที่ถูกต้องคงอยู่ · ไม่ขึ้นคำเตือน "ไม่รู้จัก" (ทั้ง retirementAssetIds และ dcaPlans เป็นฟิลด์ที่รู้จัก)', () => {
    const plan = { id: 'p1', assetId: 'a1', amount: 100_000, dayOfMonth: 5, startMonth: '2026-09' };
    const r = parseBackup(backup({ payDay: 25, dcaPlans: [plan], retirementAssetIds: ['a1', 'a2'] }), '2026-11-10');
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.data.settings).toEqual({ payDay: 25, dcaPlans: [plan], retirementAssetIds: ['a1', 'a2'] });
    expect(r.warnings.join('\n')).not.toMatch(/ไม่รู้จัก/);
  });
  it('รหัสผิดรูปในไฟล์ถูกปฏิเสธทั้งไฟล์ (ไม่ตัดเงียบ)', () => {
    const r = parseBackup(backup({ retirementAssetIds: ['a1', 'a1'] }), '2026-11-10');
    expect(r.ok).toBe(false);
  });
  it('รหัสที่ไม่มีสินทรัพย์รองรับในไฟล์ผ่านได้ (ข้ามตอนใช้งาน ไม่ใช่ข้อผิดพลาดของไฟล์)', () => {
    const r = parseBackup(backup({ retirementAssetIds: ['gone'] }), '2026-11-10');
    expect(r.ok).toBe(true);
  });
});

describe('saveSettings/loadSettings (ที่เก็บในเครื่อง): การเลือกไม่หายเมื่อผู้เรียกไม่รู้จักฟิลด์', () => {
  let db: MoneyDB;
  let n = 0;
  beforeEach(() => {
    n += 1;
    db = new MoneyDB(`retire-sel-${n}-${Math.random().toString(36).slice(2)}`);
  });
  afterEach(() => db.close());
  it('บันทึกค่าอื่น (หน้าบิลสร้างค่าตั้งค่าใหม่ทั้งก้อน) โดยไม่ส่งรหัส = คงของเดิม', async () => {
    await saveSettings(db, { payDay: 25, retirementAssetIds: ['a1'] });
    expect(await saveSettings(db, { payDay: 10 })).toEqual({ payDay: 10, retirementAssetIds: ['a1'] });
    expect(await loadSettings(db)).toEqual({ payDay: 10, retirementAssetIds: ['a1'] });
  });
  it('ส่งอาร์เรย์ว่าง = ลบการเลือก · ผิดรูปถูกปฏิเสธและของเดิมไม่เปลี่ยน', async () => {
    await saveSettings(db, { retirementAssetIds: ['a1'] });
    await expect(saveSettings(db, { retirementAssetIds: ['a1', 'a1'] })).rejects.toThrow(StorageError);
    expect((await loadSettings(db)).retirementAssetIds).toEqual(['a1']);
    expect(await saveSettings(db, { retirementAssetIds: [] })).toEqual({});
  });
  it('ไม่ลบแผน DCA เมื่อบันทึกการเลือก และกลับกัน', async () => {
    const plan = { id: 'p1', assetId: 'a1', amount: 100_000, dayOfMonth: 5, startMonth: '2026-09' };
    await saveSettings(db, { dcaPlans: [plan] });
    expect(await saveSettings(db, { dcaPlans: [plan], retirementAssetIds: ['a1'] })).toEqual({ dcaPlans: [plan], retirementAssetIds: ['a1'] });
    expect(await saveSettings(db, { payDay: 3 })).toEqual({ payDay: 3, dcaPlans: [plan], retirementAssetIds: ['a1'] });
  });
});

describe('initialRetirementSelection: สินทรัพย์ที่เคยเลือกแล้วถูกลบ = ข้ามเงียบๆ', () => {
  const asset = (id: string): Asset => ({ id, name: id, kind: 'fund', accountId: `inv-${id}` });
  const buy = (assetId: string): TradeRecord => ({
    id: `t-${assetId}`, assetId, kind: 'buy', date: '2026-01-10', createdAt: '2026-01-10T03:00:00.000Z', units: '100000000', amount: 100_000, fee: 0, withholding: 0, memo: '',
  });
  const data: InvestmentData = { assets: [asset('a1'), asset('a2'), asset('a3')], trades: [buy('a1'), buy('a2')], prices: [] };
  const options = retirementAssetOptions(data, '2026-11-20');
  it('เลือกเฉพาะที่ยังมีในตัวเลือก · รหัสที่ไม่มีแล้ว (ถูกลบ) และสินทรัพย์ที่ไม่มีหน่วยแล้วถูกข้าม ไม่โยนข้อผิดพลาด', () => {
    expect([...initialRetirementSelection(['a1', 'gone', 'a3'], options)]).toEqual(['a1']);
  });
  it('ไม่เคยเลือก (undefined / ว่าง) = ไม่เลือกอะไร (ค่าเริ่มต้นตามกฎ)', () => {
    expect(initialRetirementSelection(undefined, options).size).toBe(0);
    expect(initialRetirementSelection([], options).size).toBe(0);
  });
  it('ตัวเลือกว่าง (ไม่มีพอร์ต) = ว่าง', () => {
    expect(initialRetirementSelection(['a1'], []).size).toBe(0);
  });
});

describe('ขอบเขตโค้ด (R16, R18)', () => {
  const files = import.meta.glob(['/src/domain/invest/retirementSelection.ts', '/src/ui/RetirementView.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const get = (n: string) => strip(Object.entries(files).find(([p]) => p.endsWith(n))![1]);
  it('มีไฟล์ครบ ไม่มี float/Math', () => {
    expect(Object.keys(files)).toHaveLength(2);
    for (const n of ['retirementSelection.ts', 'RetirementView.tsx']) expect(get(n), n).not.toMatch(/parseFloat|toFixed|Math\./);
  });
  it('หน้าจอเขียนได้เฉพาะ updateSettings (เก็บแค่รหัสที่เลือก ไม่เก็บผลลัพธ์/ยอด) · เปลี่ยนเฉพาะคีย์ retirementAssetIds เพื่อไม่ทับค่าอื่นที่แท็บอื่นเพิ่งบันทึก', () => {
    const v = get('RetirementView.tsx');
    expect(v).not.toMatch(/\brepo\.(save|record|add|delete|import)\w*/); // ไม่มี saveSettings (แทนทั้งชุด) อีกแล้ว
    expect(v).toContain('retirementAssetIds');
    expect(v).toContain("repo.updateSettings(['retirementAssetIds']"); // compare-and-set เฉพาะคีย์นี้
    expect(v).not.toContain('repo.patchSettings(');
    expect(v).toContain('retirementAssetIds: list.length > 0 ? list : null'); // ส่งเฉพาะรายชื่อรหัส ว่าง = ลบคีย์
    expect(v).not.toContain('...current'); // ไม่อ่านทั้งก้อนแล้วเขียนทั้งก้อน
    expect(v).toContain('MAX_RETIREMENT_ASSETS'); // ปิดช่องติ๊กเมื่อครบเพดาน
  });
});
