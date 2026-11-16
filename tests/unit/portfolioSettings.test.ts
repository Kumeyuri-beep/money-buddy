import { describe, expect, it } from 'vitest';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import { planSettingsPatch } from '../../src/domain/bills/settingsPatch';

/** ชื่อ/คำอธิบาย/สกุลเริ่มต้นของพอร์ตลงทุน (โหมด /invest) · ไม่ใช่ข้อมูลเงิน · ไม่ต้อง migration (ตาราง settings เป็น jsonb) */
describe('portfolio settings', () => {
  it('ค่าถูกต้องผ่านและถูกเก็บ', () => {
    const s = { portfolioName: 'Main portfolio', portfolioNote: 'Long-term US stocks', portfolioCurrency: 'USD' as const };
    expect(settingsProblem(s)).toBeNull();
    expect(sanitizeSettings(s)).toEqual(s);
  });
  it('ชื่อว่าง ยาวเกิน หรือมีช่องว่างหัวท้าย = ผิด', () => {
    expect(settingsProblem({ portfolioName: '' })).not.toBeNull();
    expect(settingsProblem({ portfolioName: 'a'.repeat(41) })).not.toBeNull();
    expect(settingsProblem({ portfolioName: ' x' })).not.toBeNull();
    expect(settingsProblem({ portfolioName: 'a'.repeat(40) })).toBeNull();
    expect(settingsProblem({ portfolioNote: 'n'.repeat(121) })).not.toBeNull();
    expect(settingsProblem({ portfolioNote: 'n'.repeat(120) })).toBeNull();
  });
  it('สกุลที่ไม่รู้จักถูกปฏิเสธ และข้อมูลภายนอกที่ผิดรูปถูกทิ้ง', () => {
    expect(settingsProblem({ portfolioCurrency: 'EUR' as never })).not.toBeNull();
    expect(sanitizeSettings({ portfolioName: 5, portfolioNote: '  ', portfolioCurrency: 'EUR' })).toEqual({});
  });
  it('patch: ตั้งค่าได้ · null = ลบคีย์ (คำอธิบายว่าง) · ค่าผิดถูกปฏิเสธ', () => {
    const ok = planSettingsPatch({ portfolioName: 'Growth', portfolioNote: null });
    expect(ok.ok && ok.plan.set).toEqual({ portfolioName: 'Growth' });
    expect(ok.ok && ok.plan.remove).toEqual(['portfolioNote']);
    expect(planSettingsPatch({ portfolioName: '' }).ok).toBe(false);
  });
});
