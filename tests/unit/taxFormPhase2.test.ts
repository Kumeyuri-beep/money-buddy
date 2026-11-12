import { describe, expect, it } from 'vitest';
import { buildTaxInput, DEDUCTION_LABELS, emptyTaxForm, TAX_LIMITATIONS, type TaxForm } from '../../src/app/taxForm';
import { DEDUCTION_ORDER } from '../../src/domain/tax/salaryTax';

const form = (over: Partial<TaxForm>): TaxForm => ({ ...emptyTaxForm(), annualSalary: '1500000', ...over });

describe('buildTaxInput เฟส 2', () => {
  it('ช่องใหม่ว่าง = 0/ไม่ติ๊ก และได้ข้อมูลเข้าครบ', () => {
    const r = buildTaxInput(form({ annualSalary: '600000' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toMatchObject({ spouseNoIncome: false, childrenCount: 0, extraChildrenCount: 0, parentsCount: 0, lifeInsurancePaid: 0, healthInsurancePaid: 0, parentsHealthPaid: 0, mortgageInterestPaid: 0, donationPaid: 0 });
    }
  });

  it('กรอกครอบครัว+ประกัน+บ้าน+บริจาค ได้ภาษีตรงตัวอย่างจบ-จบ (88,000)', () => {
    const r = buildTaxInput(
      form({ spouseNoIncome: true, childrenCount: '2', extraChildrenCount: '1', parentsCount: '2', lifeInsurancePaid: '120,000', healthInsurancePaid: '30000', parentsHealthPaid: '20000', mortgageInterestPaid: '120000', donationPaid: '50000' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.tax).toBe(8_800_000);
      expect(r.result.deductions.map((d) => d.key)).toEqual([...DEDUCTION_ORDER]);
    }
  });

  it('จำนวนคนต้องเป็นจำนวนเต็มบวก ชี้รายช่อง', () => {
    for (const bad of ['-1', '1.5', 'สอง', '100', '+2', '2 คน']) {
      const r = buildTaxInput(form({ parentsCount: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok && !r.unsupported) expect(r.errors.some((e) => e.field === 'parentsCount')).toBe(true);
    }
  });

  it('เกินจำนวนสูงสุด: บิดามารดา > 4, บุตร > 20 ถูกปฏิเสธรายช่อง', () => {
    const a = buildTaxInput(form({ parentsCount: '5' }));
    expect(a.ok).toBe(false);
    if (!a.ok && !a.unsupported) expect(a.errors).toEqual([{ field: 'parentsCount', message: 'จำนวนบิดามารดาต้องไม่เกิน 4 คน (รวมของคู่สมรส)' }]);
    const b = buildTaxInput(form({ childrenCount: '21' }));
    expect(b.ok).toBe(false);
    if (!b.ok && !b.unsupported) expect(b.errors[0]!.field).toBe('childrenCount');
  });

  it('บุตรที่ได้ลดหย่อนเพิ่มต้องน้อยกว่าบุตรทั้งหมด (คนแรกเพิ่มไม่ได้)', () => {
    const r = buildTaxInput(form({ childrenCount: '1', extraChildrenCount: '1' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors).toEqual([{ field: 'extraChildrenCount', message: 'จำนวนบุตรที่ได้ลดหย่อนเพิ่มต้องน้อยกว่าจำนวนบุตรทั้งหมดอย่างน้อย 1 คน (บุตรคนแรกไม่ได้ลดหย่อนเพิ่ม)' }]);
  });

  it('ช่องเงินใหม่: เครื่องหมาย/ข้อความที่อ่านไม่ได้ ชี้รายช่อง', () => {
    const r = buildTaxInput(form({ donationPaid: '-5', lifeInsurancePaid: 'abc', mortgageInterestPaid: '฿+1' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors.map((e) => e.field).sort()).toEqual(['donationPaid', 'lifeInsurancePaid', 'mortgageInterestPaid']);
  });

  it('ป้ายชื่อค่าลดหย่อนครบทุกรายการตามลำดับโดเมน', () => {
    expect(Object.keys(DEDUCTION_LABELS).sort()).toEqual([...DEDUCTION_ORDER].sort());
  });

  it('ข้อจำกัดบอกสิ่งที่ยังไม่รองรับ และไม่ตรวจเงื่อนไขสิทธิ', () => {
    expect(TAX_LIMITATIONS).toContain('ไม่ตรวจเงื่อนไขของสิทธิ');
    expect(TAX_LIMITATIONS).toContain('กองทุนสำรองเลี้ยงชีพ');
    expect(TAX_LIMITATIONS).toContain('e-Donation');
    expect(TAX_LIMITATIONS).toContain('SSF');
  });
});

describe('ลำดับข้อผิดพลาดตามหน้าจอ (โฟกัสช่องแรกที่เห็น)', () => {
  it('เรียงตามลำดับช่องบนจอ ไม่ใช่ลำดับที่ตรวจ', () => {
    const r = buildTaxInput(form({ annualSalary: 'x', donationPaid: 'x', parentsCount: 'x', rmfPaid: 'x', lifeInsurancePaid: 'x' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors.map((e) => e.field)).toEqual(['annualSalary', 'parentsCount', 'lifeInsurancePaid', 'donationPaid', 'rmfPaid']);
  });
});
