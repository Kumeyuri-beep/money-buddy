import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DcaPlan } from '../../src/domain/invest/dcaPlan';
import { MoneyDB } from '../../src/storage/db';
import { loadSettings, saveSettings, StorageError } from '../../src/storage/repository';

let db: MoneyDB;
let n = 0;
beforeEach(() => {
  n += 1;
  db = new MoneyDB(`dca-settings-${n}-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  db.close();
});

const plan: DcaPlan = { id: 'dca-1', assetId: 'a1', amount: 100_000, dayOfMonth: 5, startMonth: '2026-11' };

describe('saveSettings (ที่เก็บในเครื่อง): แผน DCA ไม่หายเมื่อผู้เรียกไม่รู้จักแผน', () => {
  it('บันทึกค่าอื่น (เช่นหน้าบิล สร้างค่าตั้งค่าใหม่ทั้งก้อน) โดยไม่ส่ง dcaPlans = คงแผนเดิม', async () => {
    await saveSettings(db, { payDay: 25, dcaPlans: [plan] });
    expect(await saveSettings(db, { payDay: 10 })).toEqual({ payDay: 10, dcaPlans: [plan] });
    expect(await loadSettings(db)).toEqual({ payDay: 10, dcaPlans: [plan] });
  });
  it('ส่งอาร์เรย์ว่าง = ลบแผนทั้งหมด', async () => {
    await saveSettings(db, { dcaPlans: [plan] });
    expect(await saveSettings(db, { payDay: 10, dcaPlans: [] })).toEqual({ payDay: 10 });
  });
  it('แผนผิดรูปถูกปฏิเสธและแผนเดิมไม่เปลี่ยน', async () => {
    await saveSettings(db, { dcaPlans: [plan] });
    await expect(saveSettings(db, { dcaPlans: [{ ...plan, amount: 0 }] })).rejects.toThrow(StorageError);
    expect((await loadSettings(db)).dcaPlans).toEqual([plan]);
  });
});
