import { describe, expect, it } from 'vitest';
import { buildTaxInput, emptyTaxForm, TAX_FIELD_SCREEN_ORDER, TAX_LIMITATIONS, type TaxForm } from '../../src/app/taxForm';
import { TAX_CONFIG_2569 } from '../../src/domain/tax/config';

const form = (over: Partial<TaxForm>): TaxForm => ({ ...emptyTaxForm(), annualSalary: '2000000', ...over });

describe('buildTaxInput: ครอบครัวเพิ่มเติม (ฝากครรภ์ คนพิการ บุตรบุญธรรม ประกันคู่สมรส)', () => {
  it('ช่องใหม่ว่าง = 0 / อาร์เรย์ครรภ์เป็น 0', () => {
    const r = buildTaxInput(form({ annualSalary: '600000' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input).toMatchObject({ adoptedChildrenCount: 0, disabledRelativesCount: 0, disabledOtherCount: 0, prenatalPaid: [0, 0], spouseLifeInsurancePaid: 0 });
  });

  it('ตัวอย่างจบ-จบ: ครอบครัวครบ → ภาษี 240,500 (ตรงโดเมน)', () => {
    const r = buildTaxInput(
      form({ spouseNoIncome: true, childrenCount: '1', adoptedChildrenCount: '1', parentsCount: '1', disabledRelativesCount: '1', disabledOtherCount: '1', prenatalPaid1: '70,000', spouseLifeInsurancePaid: '8000' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.totalAllowances).toBe(39_800_000);
      expect(r.result.tax).toBe(24_050_000);
      expect(r.input.prenatalPaid).toEqual([7_000_000, 0]);
    }
  });

  it('สองครรภ์แยกเพดาน: 80,000 + 20,000 → ใช้ได้ 80,000', () => {
    const r = buildTaxInput(form({ prenatalPaid1: '80000', prenatalPaid2: '20000' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.deductions.find((d) => d.key === 'prenatal')!.allowed).toBe(8_000_000);
  });

  it('เบี้ยประกันชีวิตคู่สมรสโดยไม่ติ๊กคู่สมรสไม่มีเงินได้ → ข้อผิดพลาดรายช่อง', () => {
    const r = buildTaxInput(form({ spouseLifeInsurancePaid: '5000' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors).toEqual([{ field: 'spouseLifeInsurancePaid', message: 'เบี้ยประกันชีวิตคู่สมรสใช้ได้เมื่อคู่สมรสไม่มีเงินได้ ติ๊ก "คู่สมรสไม่มีเงินได้" ก่อน' }]);
  });

  it('จำนวนเกินขีด: บุตรบุญธรรม 4, คนพิการอื่น 2, ญาติ 21 → ข้อผิดพลาดรายช่อง', () => {
    const r = buildTaxInput(form({ adoptedChildrenCount: '4', disabledOtherCount: '2', disabledRelativesCount: '21' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors.map((e) => e.field)).toEqual(['adoptedChildrenCount', 'disabledRelativesCount', 'disabledOtherCount']);
  });

  it('จำนวนที่ไม่ใช่จำนวนเต็ม และเงินครรภ์ที่มีเครื่องหมาย ถูกปฏิเสธ', () => {
    const r = buildTaxInput(form({ adoptedChildrenCount: '1.5', prenatalPaid1: '-5', prenatalPaid2: 'abc' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors.map((e) => e.field)).toEqual(['adoptedChildrenCount', 'prenatalPaid1', 'prenatalPaid2']);
  });

  it('ลำดับช่องบนจอครอบคลุมทุกช่องข้อความ และข้อจำกัดไม่ตรวจเอกสารประกอบสิทธิ', () => {
    expect(new Set(TAX_FIELD_SCREEN_ORDER).size).toBe(TAX_FIELD_SCREEN_ORDER.length);
    expect(TAX_FIELD_SCREEN_ORDER).toHaveLength(21);
    expect(TAX_LIMITATIONS).toContain('ไม่ตรวจเอกสารประกอบสิทธิ');
    expect(TAX_LIMITATIONS).not.toContain('ค่าฝากครรภ์');
  });
});

describe('config: ครอบครัวเพิ่มเติม', () => {
  const cfg = TAX_CONFIG_2569;
  it('ตัวเลขตรงเอกสารกรมสรรพากร และเป็น partial', () => {
    expect(cfg.prenatal).toMatchObject({ capPerPregnancySatang: 6_000_000, maxPregnancies: 2 });
    expect(cfg.disability).toMatchObject({ perSatang: 6_000_000, maxRelatives: 20, maxOthers: 1 });
    expect(cfg.adoptedChild).toMatchObject({ perSatang: 3_000_000, maxTotalChildren: 3 });
    expect(cfg.spouseLifeInsurance.capSatang).toBe(1_000_000);
    for (const it of [cfg.prenatal, cfg.disability, cfg.adoptedChild, cfg.spouseLifeInsurance]) {
      expect(it.confidence).toBe('partial');
      expect(it.source.length).toBeGreaterThan(5);
      expect(it.note && it.note.length > 10).toBe(true);
    }
  });
});
