import { describe, expect, it } from 'vitest';
import { FORM_SETTINGS_KEYS, formSettingsPatch, planOutsideKeysProblem, planSettingsPatch, settingsKeysChanged } from '../../src/domain/bills/settingsPatch';

describe('settingsKeysChanged: เทียบเฉพาะคีย์ที่ประกาศ (R16 ข้อมูลไม่ถูกเขียนทับข้ามแท็บ)', () => {
  it('ไม่มี = ไม่มีเหมือนกัน · ค่าเท่ากัน = ไม่ต่าง · อาร์เรย์ต่างลำดับ = ต่าง', () => {
    expect(settingsKeysChanged(['payDay'], {}, {})).toBe(false);
    expect(settingsKeysChanged(['payDay'], { payDay: 5 }, { payDay: 5 })).toBe(false);
    expect(settingsKeysChanged(['payDay'], { payDay: 5 }, {})).toBe(true);
    expect(settingsKeysChanged(['retirementAssetIds'], { retirementAssetIds: ['a', 'b'] }, { retirementAssetIds: ['b', 'a'] })).toBe(true);
  });
  it('คีย์อื่นต่างกันไม่นับ', () => {
    expect(settingsKeysChanged(['payDay'], { payDay: 5, monthlyBudget: 1 }, { payDay: 5, monthlyBudget: 2 })).toBe(false);
  });
});

describe('planOutsideKeysProblem: ตรวจแผนไม่แตะคีย์นอกขอบเขต', () => {
  const plan = (patch: Parameters<typeof planSettingsPatch>[0]) => {
    const r = planSettingsPatch(patch);
    if (!r.ok) throw new Error(r.problem);
    return r.plan;
  };
  it('ในขอบเขต = null · นอกขอบเขต (ตั้งหรือลบ) = ข้อความ', () => {
    expect(planOutsideKeysProblem(plan({ payDay: 5, monthlyBudget: null }), ['payDay', 'monthlyBudget'])).toBeNull();
    expect(planOutsideKeysProblem(plan({ payDay: 5 }), ['monthlyBudget'])).toContain('payDay');
    expect(planOutsideKeysProblem(plan({ monthlyBudget: null }), ['payDay'])).toContain('monthlyBudget');
  });
});

describe('formSettingsPatch: ฟอร์มหน้าบิลแตะเฉพาะ 4 คีย์ของฟอร์ม', () => {
  it('ว่าง = ลบ (null) · ไม่แตะแผน DCA/เกษียณ/ป้ายภาษี', () => {
    expect(FORM_SETTINGS_KEYS).toEqual(['payDay', 'monthlySavingsGoal', 'monthlyBudget', 'nextPaydayOverride']);
    const p = formSettingsPatch({ payDay: 25, dcaPlans: [], retirementAssetIds: ['x'] });
    expect(p).toEqual({ payDay: 25, monthlySavingsGoal: null, monthlyBudget: null, nextPaydayOverride: null });
    expect(Object.keys(p)).not.toContain('dcaPlans');
  });
});
