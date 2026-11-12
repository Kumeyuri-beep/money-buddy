import { describe, expect, it } from 'vitest';
import { applySettingsPlan, planSettingsPatch, planSettingsReplace, SETTINGS_KEYS, type SettingsPlan } from '../../src/domain/bills/settingsPatch';
import { MAX_SETTINGS_BYTES } from '../../src/domain/bills/settings';
import type { DcaPlan } from '../../src/domain/invest/dcaPlan';

const plan = (r: ReturnType<typeof planSettingsPatch>): SettingsPlan => {
  if (!r.ok) throw new Error('expected ok: ' + r.problem);
  return r.plan;
};

const dca: DcaPlan = { id: 'p1', assetId: 'a1', amount: 100_000, dayOfMonth: 5, startMonth: '2026-11' };

describe('planSettingsPatch (เปลี่ยนเฉพาะคีย์ที่ส่ง)', () => {
  it('ส่งคีย์เดียว: set มีคีย์เดียว ไม่ลบอะไร', () => {
    expect(plan(planSettingsPatch({ payDay: 25 }))).toEqual({ set: { payDay: 25 }, remove: [] });
  });
  it('undefined = ไม่แตะ · null = ลบ · อาร์เรย์ว่าง = ลบ', () => {
    const p = plan(planSettingsPatch({ payDay: undefined, monthlyBudget: null, retirementAssetIds: [], dcaPlans: undefined }));
    expect(p.set).toEqual({});
    expect([...p.remove].sort()).toEqual(['monthlyBudget', 'retirementAssetIds']);
  });
  it('ค่าผิดรูปถูกปฏิเสธ ไม่ลบค่าเดิมเงียบๆ: วันเงินเดือน 32, ติดลบ, ทศนิยม, วันที่ไม่มีจริง', () => {
    for (const bad of [{ payDay: 32 }, { payDay: 0 }, { monthlyBudget: -1 }, { monthlySavingsGoal: 1.5 }, { nextPaydayOverride: '2026-02-30' }]) {
      const r = planSettingsPatch(bad);
      expect(r.ok).toBe(false);
    }
  });
  it('รหัสสินทรัพย์เกษียณซ้ำ/เกินเพดานถูกปฏิเสธ', () => {
    expect(planSettingsPatch({ retirementAssetIds: ['a', 'a'] }).ok).toBe(false);
    expect(planSettingsPatch({ retirementAssetIds: Array.from({ length: 31 }, (_, i) => `x${i}`) }).ok).toBe(false);
  });
  it('ขนาดของ set เกินเพดาน 12,000 ไบต์ถูกปฏิเสธ', () => {
    const many = Array.from({ length: 30 }, (_, i) => `asset-${String(i).padStart(3, '0')}-${'x'.repeat(400)}`);
    const r = planSettingsPatch({ retirementAssetIds: many });
    expect(r.ok).toBe(false);
    expect(MAX_SETTINGS_BYTES).toBe(12_000);
  });
  it('ไม่ส่งอะไรเลย = แผนว่าง', () => {
    expect(plan(planSettingsPatch({}))).toEqual({ set: {}, remove: [] });
  });
  it('คีย์ทั้งหมดของ FinanceSettings อยู่ใน SETTINGS_KEYS', () => {
    expect([...SETTINGS_KEYS]).toEqual(['payDay', 'monthlySavingsGoal', 'monthlyBudget', 'nextPaydayOverride', 'dcaPlans', 'retirementAssetIds', 'taxRmfAssetIds', 'taxThaiEsgAssetIds']);
  });
});

describe('planSettingsReplace (saveSettings แบบเดิม: ไม่ส่ง = ไม่ตั้ง ยกเว้น dcaPlans/retirementAssetIds ไม่ส่ง = คงเดิม)', () => {
  it('ส่งเฉพาะ payDay: ลบคีย์ธรรมดาที่ไม่ส่ง แต่คง dcaPlans/retirementAssetIds', () => {
    const p = plan(planSettingsReplace({ payDay: 25 }));
    expect(p.set).toEqual({ payDay: 25 });
    expect([...p.remove].sort()).toEqual(['monthlyBudget', 'monthlySavingsGoal', 'nextPaydayOverride']);
    expect(p.remove).not.toContain('dcaPlans');
    expect(p.remove).not.toContain('retirementAssetIds');
  });
  it('ส่ง dcaPlans: [] = ลบ · ส่ง retirementAssetIds: [] = ลบ', () => {
    const p = plan(planSettingsReplace({ payDay: 1, dcaPlans: [], retirementAssetIds: [] }));
    expect(p.remove).toContain('dcaPlans');
    expect(p.remove).toContain('retirementAssetIds');
  });
  it('ส่งทุกคีย์: ไม่ลบอะไร', () => {
    const p = plan(planSettingsReplace({ payDay: 1, monthlySavingsGoal: 0, monthlyBudget: 0, nextPaydayOverride: '2026-12-01', dcaPlans: [dca], retirementAssetIds: ['a1'], taxRmfAssetIds: ['r1'], taxThaiEsgAssetIds: ['e1'] }));
    expect(p.remove).toEqual([]);
    expect(Object.keys(p.set).sort()).toEqual([...SETTINGS_KEYS].sort());
  });
  it('ค่าผิดรูป = ปฏิเสธ', () => {
    expect(planSettingsReplace({ payDay: 99 }).ok).toBe(false);
  });
  it('ตั้งค่าว่าง {}: ลบคีย์ธรรมดาทั้งหมด คงสองคีย์ที่คงเดิม', () => {
    const p = plan(planSettingsReplace({}));
    expect(p.set).toEqual({});
    expect([...p.remove].sort()).toEqual(['monthlyBudget', 'monthlySavingsGoal', 'nextPaydayOverride', 'payDay']);
  });
});

describe('applySettingsPlan (ผลหลังรวม)', () => {
  it('คีย์ที่ไม่ส่งคงเดิม คีย์ที่ส่งแทน คีย์ที่ลบหาย (เหตุผลของการแก้ช่องแข่งเขียน)', () => {
    const current = { payDay: 25, monthlyBudget: 3_000_000, retirementAssetIds: ['a1', 'a2'] };
    const next = applySettingsPlan(current, plan(planSettingsPatch({ payDay: 28 })));
    expect(next).toEqual({ payDay: 28, monthlyBudget: 3_000_000, retirementAssetIds: ['a1', 'a2'] });
    const removed = applySettingsPlan(current, plan(planSettingsPatch({ retirementAssetIds: null })));
    expect(removed).toEqual({ payDay: 25, monthlyBudget: 3_000_000 });
  });
  it('จำลองสองแท็บบันทึกเหลื่อมกัน: แท็บ A เปลี่ยน payDay แท็บ B เปลี่ยนรหัสสินทรัพย์ ทั้งสองค่าอยู่ครบไม่ว่าลำดับ', () => {
    const start = { monthlyBudget: 1_000_000 };
    const a = plan(planSettingsPatch({ payDay: 10 }));
    const b = plan(planSettingsPatch({ retirementAssetIds: ['a9'] }));
    expect(applySettingsPlan(applySettingsPlan(start, a), b)).toEqual(applySettingsPlan(applySettingsPlan(start, b), a));
    expect(applySettingsPlan(applySettingsPlan(start, a), b)).toEqual({ monthlyBudget: 1_000_000, payDay: 10, retirementAssetIds: ['a9'] });
  });
  it('ข้อมูลเดิมที่ผิดรูปถูกทำความสะอาดทิ้งตอนรวม (ไม่เชื่อข้อมูลที่เก็บ)', () => {
    const next = applySettingsPlan({ payDay: 99 } as unknown as Record<string, never>, plan(planSettingsPatch({ monthlyBudget: 5 })));
    expect(next).toEqual({ monthlyBudget: 5 });
  });
});
