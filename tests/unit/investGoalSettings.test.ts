import { describe, expect, it } from 'vitest';
import { MAX_SETTINGS_BYTES, sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import { applySettingsPlan, planSettingsPatch, planSettingsReplace, SETTINGS_KEYS } from '../../src/domain/bills/settingsPatch';
import type { InvestGoal } from '../../src/domain/invest/goalProjection';

/** เป้าหมายลงทุน (หน้า My goal · R28) เก็บใน settings jsonb ฟิลด์เดียว investGoal · ไม่ต้อง migration · ข้อมูลสมมติ */
const goal: InvestGoal = { kind: 'value', targetMinor: 1_000_000, contributionMinor: 20_000, achieveBy: '2040-06', returnBps: 700, inflationBps: 250, currency: 'USD' };

describe('settings.investGoal', () => {
  it('ค่าถูกต้องผ่านและถูกเก็บ · อยู่ใน SETTINGS_KEYS', () => {
    expect(SETTINGS_KEYS).toContain('investGoal');
    expect(settingsProblem({ investGoal: goal })).toBeNull();
    expect(sanitizeSettings({ investGoal: goal })).toEqual({ investGoal: goal });
  });
  it('ค่าผิดรูปถูกปฏิเสธ (settingsProblem) และข้อมูลภายนอกที่ผิดถูกทิ้ง', () => {
    expect(settingsProblem({ investGoal: { ...goal, targetMinor: -1 } })).not.toBeNull();
    expect(settingsProblem({ investGoal: { ...goal, returnBps: 99_999 } })).not.toBeNull();
    expect(settingsProblem({ investGoal: { ...goal, achieveBy: 'soon' } })).not.toBeNull();
    expect(sanitizeSettings({ investGoal: { ...goal, currency: 'EUR' } })).toEqual({});
    expect(sanitizeSettings({ investGoal: 'x' })).toEqual({});
  });
  it('patch: ตั้งได้ · null = ลบ · ค่าผิดถูกปฏิเสธ · คีย์อื่นไม่ถูกแตะ', () => {
    const set = planSettingsPatch({ investGoal: goal });
    expect(set.ok && set.plan.set).toEqual({ investGoal: goal });
    const del = planSettingsPatch({ investGoal: null });
    expect(del.ok && del.plan.remove).toEqual(['investGoal']);
    expect(planSettingsPatch({ investGoal: { ...goal, contributionMinor: 1.5 } }).ok).toBe(false);
    expect(set.ok && applySettingsPlan({ payDay: 25, portfolioName: 'Main' }, set.plan)).toEqual({ payDay: 25, portfolioName: 'Main', investGoal: goal });
  });
  it('บันทึกทั้งชุดแบบเดิมโดยไม่ส่ง investGoal = คงของเดิม (ไม่ลบเป้าหมายของผู้ใช้)', () => {
    const r = planSettingsReplace({ payDay: 25 });
    expect(r.ok && r.plan.remove).not.toContain('investGoal');
  });
  it('ขนาดรวมเกิน MAX_SETTINGS_BYTES ถูกปฏิเสธ แม้เป้าหมายเองใช้ได้ (เป้าหมายตัดฟิลด์แปลกปลอมทิ้ง จึงมีขนาดคงที่เล็ก)', () => {
    expect(new TextEncoder().encode(JSON.stringify({ investGoal: goal })).length).toBeLessThan(300);
    expect(sanitizeSettings({ investGoal: { ...goal, junk: 'x'.repeat(MAX_SETTINGS_BYTES) } })).toEqual({ investGoal: goal });
  });
});
