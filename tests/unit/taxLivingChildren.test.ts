import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TAX_FIELD_SCREEN_ORDER, buildTaxInput, emptyTaxForm, type TaxForm } from '../../src/app/taxForm';
import { computeSalaryTax, type SalaryTaxInput } from '../../src/domain/tax/salaryTax';
import { TaxView } from '../../src/ui/TaxView';

const B = (baht: number): number => baht * 100;
const base: SalaryTaxInput = { annualSalary: B(2_000_000), withheldTax: 0, socialSecurityPaid: 0, rmfPaid: 0, pensionInsurancePaid: 0, thaiEsgPaid: 0 };
const run = (over: Partial<SalaryTaxInput>) => computeSalaryTax({ ...base, ...over });
const line = (r: ReturnType<typeof run>, key: string) => r.deductions.find((d) => d.key === key)!;
const form = (over: Partial<TaxForm>): TaxForm => ({ ...emptyTaxForm(), annualSalary: '2000000', ...over });

describe('บุตรที่มีชีวิตทั้งหมด (รวมคนที่ไม่ได้ลดหย่อน) ใช้นับเพดานบุตรบุญธรรม 3 คน', () => {
  it('ไม่ระบุ = ใช้จำนวนบุตรที่ลดหย่อน (พฤติกรรมเดิม)', () => {
    expect(line(run({ childrenCount: 1, adoptedChildrenCount: 2 }), 'adoptedChildren').allowed).toBe(B(60_000));
  });
  it('มีบุตรที่มีชีวิต 3 คน แต่ลดหย่อนได้ 1 คน → บุตรบุญธรรมหักไม่ได้ (ตามเอกสาร ภ.ง.ด.94 นับรวมคนที่ไม่เข้าเกณฑ์)', () => {
    const l = line(run({ childrenCount: 1, livingChildrenCount: 3, adoptedChildrenCount: 2 }), 'adoptedChildren');
    expect(l.allowed).toBe(0);
    expect(l.clamped).toBe(true);
  });
  it('มีชีวิต 2 คน (ลดหย่อน 1) + บุตรบุญธรรม 2 → ได้ 1 คน', () => {
    expect(line(run({ childrenCount: 1, livingChildrenCount: 2, adoptedChildrenCount: 2 }), 'adoptedChildren').allowed).toBe(B(30_000));
  });
  it('ไม่เปลี่ยนค่าลดหย่อนของบุตรชอบด้วยกฎหมาย', () => {
    expect(line(run({ childrenCount: 1, livingChildrenCount: 3 }), 'children').allowed).toBe(B(30_000));
  });
  it('จำนวนผิด = RangeError: น้อยกว่าจำนวนที่ลดหย่อน, เกินขีด, ทศนิยม, ติดลบ', () => {
    const bads: Partial<SalaryTaxInput>[] = [{ childrenCount: 2, livingChildrenCount: 1 }, { livingChildrenCount: 21 }, { livingChildrenCount: 1.5 }, { livingChildrenCount: -1 }];
    for (const bad of bads) expect(() => run(bad)).toThrow(RangeError);
  });
  it('ฟอร์ม: ว่าง = ไม่ระบุ · น้อยกว่าบุตรที่ลดหย่อน = ข้อผิดพลาดรายช่อง', () => {
    const ok = buildTaxInput(form({ childrenCount: '1', adoptedChildrenCount: '2' }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.input.livingChildrenCount).toBeUndefined();
    const bad = buildTaxInput(form({ childrenCount: '2', livingChildrenCount: '1' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok && !bad.unsupported) expect(bad.errors).toEqual([{ field: 'livingChildrenCount', message: 'จำนวนบุตรที่มีชีวิตทั้งหมดต้องไม่น้อยกว่าจำนวนบุตรที่ลดหย่อน' }]);
  });
});

describe('คนพิการซ้อนกับลดหย่อนปกติ (เอกสารแยกเป็นคนละรายการ ไม่ห้ามซ้อน)', () => {
  it('คู่สมรสพิการและไม่มีเงินได้: คู่สมรส 60,000 + คนพิการ 60,000 = 120,000', () => {
    const r = run({ spouseNoIncome: true, disabledRelativesCount: 1 });
    expect(line(r, 'spouse').allowed + line(r, 'disabled').allowed).toBe(B(120_000));
  });
});

describe('ลำดับช่องบนจอ (DOM) ตรงกับลำดับโฟกัสข้อผิดพลาด', () => {
  const idOf: Record<string, string> = {
    annualSalary: 'tx-salary',
    withheldTax: 'tx-withheld',
    spouseLifeInsurancePaid: 'tx-spouse-life',
    childrenCount: 'tx-children',
    extraChildrenCount: 'tx-children-extra',
    livingChildrenCount: 'tx-living',
    adoptedChildrenCount: 'tx-adopted',
    prenatalPaid1: 'tx-prenatal-1',
    prenatalPaid2: 'tx-prenatal-2',
    parentsCount: 'tx-parents',
    parentsHealthPaid: 'tx-parents-health',
    disabledRelativesCount: 'tx-disabled-rel',
    disabledOtherCount: 'tx-disabled-other',
    socialSecurityPaid: 'tx-ss',
    lifeInsurancePaid: 'tx-life',
    healthInsurancePaid: 'tx-health',
    mortgageInterestPaid: 'tx-mortgage',
    donationPaid: 'tx-donation',
    rmfPaid: 'tx-rmf',
    pensionInsurancePaid: 'tx-pension',
    thaiEsgPaid: 'tx-esg',
  };
  it('ทุกช่องมีตำแหน่งใน DOM เรียงจากบนลงล่างตาม TAX_FIELD_SCREEN_ORDER', () => {
    const html = renderToString(createElement(TaxView));
    const positions = TAX_FIELD_SCREEN_ORDER.map((f) => {
      const id = idOf[f];
      expect(id).toBeDefined();
      const pos = html.indexOf(`id="${id}"`);
      expect(pos).toBeGreaterThan(-1);
      return pos;
    });
    for (let i = 1; i < positions.length; i++) expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    expect(new Set(TAX_FIELD_SCREEN_ORDER).size).toBe(Object.keys(idOf).length);
  });
});
