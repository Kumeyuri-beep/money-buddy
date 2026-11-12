import { describe, expect, it } from 'vitest';
import { MAX_TAX_INPUT_SATANG } from '../../src/domain/tax/config';
import { computeSalaryTax, type SalaryTaxInput } from '../../src/domain/tax/salaryTax';

const B = (baht: number): number => baht * 100;
const base: SalaryTaxInput = { annualSalary: 0, withheldTax: 0, socialSecurityPaid: 0, rmfPaid: 0, pensionInsurancePaid: 0, thaiEsgPaid: 0 };
const run = (over: Partial<SalaryTaxInput>) => computeSalaryTax({ ...base, ...over });
const line = (r: ReturnType<typeof run>, key: string) => r.deductions.find((d) => d.key === key)!;
const rich = B(2_000_000);

describe('ค่าฝากครรภ์และคลอดบุตร (≤ 60,000 ต่อครรภ์)', () => {
  it('ครรภ์เดียว: จ่ายจริงไม่เกิน 60,000', () => {
    expect(line(run({ annualSalary: rich, prenatalPaid: [B(50_000)] }), 'prenatal').allowed).toBe(B(50_000));
    const over = line(run({ annualSalary: rich, prenatalPaid: [B(80_000)] }), 'prenatal');
    expect(over.allowed).toBe(B(60_000));
    expect(over.clamped).toBe(true);
    expect(over.requested).toBe(B(80_000));
  });
  it('สองครรภ์: เพดานแยกต่อครรภ์ ไม่เอายอดเกินของครรภ์หนึ่งไปชดเชยอีกครรภ์', () => {
    const r = line(run({ annualSalary: rich, prenatalPaid: [B(80_000), B(20_000)] }), 'prenatal');
    expect(r.allowed).toBe(B(80_000)); // 60,000 + 20,000 (ไม่ใช่ 100,000)
    expect(r.requested).toBe(B(100_000));
    expect(r.clamped).toBe(true);
  });
  it('พอดี 60,000 ไม่ถูกตัด · เกิน 1 สตางค์ถูกตัด', () => {
    expect(line(run({ annualSalary: rich, prenatalPaid: [B(60_000)] }), 'prenatal').clamped).toBe(false);
    const over = line(run({ annualSalary: rich, prenatalPaid: [B(60_000) + 1] }), 'prenatal');
    expect(over.allowed).toBe(B(60_000));
    expect(over.clamped).toBe(true);
  });
  it('ไม่กรอก/อาร์เรย์ว่าง = 0', () => {
    expect(line(run({ annualSalary: rich }), 'prenatal').allowed).toBe(0);
    expect(line(run({ annualSalary: rich, prenatalPaid: [] }), 'prenatal').allowed).toBe(0);
  });
  it('ข้อมูลเข้าผิด = RangeError: เกิน 2 ครรภ์, ติดลบ, ทศนิยม, NaN, -0, ไม่ใช่อาร์เรย์, เกินสูงสุด', () => {
    const bads: unknown[] = [[1, 2, 3], [-1], [1.5], [Number.NaN], [-0], [MAX_TAX_INPUT_SATANG + 1], 5, 'x'];
    for (const bad of bads) expect(() => run({ annualSalary: rich, prenatalPaid: bad as number[] })).toThrow(RangeError);
  });
});

describe('อุปการะคนพิการหรือทุพพลภาพ (คนละ 60,000)', () => {
  it('ญาติตามรายการคนละ 60,000 · บุคคลอื่นได้ไม่เกิน 1 คน', () => {
    expect(line(run({ annualSalary: rich, disabledRelativesCount: 2 }), 'disabled').allowed).toBe(B(120_000));
    expect(line(run({ annualSalary: rich, disabledOtherCount: 1 }), 'disabled').allowed).toBe(B(60_000));
    expect(line(run({ annualSalary: rich, disabledRelativesCount: 2, disabledOtherCount: 1 }), 'disabled').allowed).toBe(B(180_000));
    expect(line(run({ annualSalary: rich }), 'disabled').allowed).toBe(0);
  });
  it('จำนวนผิด = RangeError: บุคคลอื่น 2, ญาติ 21, ติดลบ, ทศนิยม', () => {
    for (const bad of [{ disabledOtherCount: 2 }, { disabledRelativesCount: 21 }, { disabledRelativesCount: -1 }, { disabledOtherCount: 0.5 }, { disabledRelativesCount: Number.NaN }]) {
      expect(() => run({ annualSalary: rich, ...bad })).toThrow(RangeError);
    }
  });
});

describe('บุตรบุญธรรม (คนละ 30,000 รวมกับบุตรชอบด้วยกฎหมายต้องไม่เกิน 3 คน)', () => {
  it('ไม่มีบุตรชอบด้วยกฎหมาย: บุตรบุญธรรม 2 คน = 60,000', () => {
    const l = line(run({ annualSalary: rich, adoptedChildrenCount: 2 }), 'adoptedChildren');
    expect(l.allowed).toBe(B(60_000));
    expect(l.clamped).toBe(false);
  });
  it('บุตรชอบด้วยกฎหมาย 2 + บุตรบุญธรรม 2 → ได้ 1 (ครบ 3 คน) ขอ 60,000 ใช้ได้ 30,000', () => {
    const l = line(run({ annualSalary: rich, childrenCount: 2, adoptedChildrenCount: 2 }), 'adoptedChildren');
    expect(l.allowed).toBe(B(30_000));
    expect(l.requested).toBe(B(60_000));
    expect(l.clamped).toBe(true);
  });
  it('บุตรชอบด้วยกฎหมายตั้งแต่ 3 คน → บุตรบุญธรรมหักไม่ได้', () => {
    const l = line(run({ annualSalary: rich, childrenCount: 3, adoptedChildrenCount: 1 }), 'adoptedChildren');
    expect(l.allowed).toBe(0);
    expect(l.clamped).toBe(true);
    expect(line(run({ annualSalary: rich, childrenCount: 5, adoptedChildrenCount: 1 }), 'adoptedChildren').allowed).toBe(0);
  });
  it('บุตรบุญธรรมไม่ได้ลดหย่อนเพิ่มของคนที่ 2+ (เพิ่มเฉพาะบุตรชอบด้วยกฎหมาย)', () => {
    const r = run({ annualSalary: rich, childrenCount: 1, adoptedChildrenCount: 2 });
    expect(line(r, 'children').allowed).toBe(B(30_000));
    expect(line(r, 'adoptedChildren').allowed).toBe(B(60_000));
  });
  it('จำนวนผิด = RangeError: เกิน 3, ติดลบ, ทศนิยม', () => {
    for (const bad of [{ adoptedChildrenCount: 4 }, { adoptedChildrenCount: -1 }, { adoptedChildrenCount: 1.5 }]) {
      expect(() => run({ annualSalary: rich, ...bad })).toThrow(RangeError);
    }
  });
});

describe('เบี้ยประกันชีวิตคู่สมรสที่ไม่มีเงินได้ (≤ 10,000)', () => {
  it('ติ๊กคู่สมรสไม่มีเงินได้: ขอ 15,000 ใช้ได้ 10,000', () => {
    const l = line(run({ annualSalary: rich, spouseNoIncome: true, spouseLifeInsurancePaid: B(15_000) }), 'spouseLifeInsurance');
    expect(l.allowed).toBe(B(10_000));
    expect(l.clamped).toBe(true);
    expect(l.remaining).toBe(0);
    expect(line(run({ annualSalary: rich, spouseNoIncome: true, spouseLifeInsurancePaid: B(4_000) }), 'spouseLifeInsurance').remaining).toBe(B(6_000));
  });
  it('ไม่ติ๊กคู่สมรสไม่มีเงินได้แต่กรอกเบี้ย = RangeError (ไม่ปล่อยให้ได้สิทธิเงียบๆ)', () => {
    expect(() => run({ annualSalary: rich, spouseLifeInsurancePaid: B(5_000) })).toThrow(RangeError);
    expect(() => run({ annualSalary: rich, spouseLifeInsurancePaid: 0 })).not.toThrow();
  });
  it('ไม่นับรวมในกลุ่มประกันชีวิต+สุขภาพของผู้มีเงินได้', () => {
    const r = run({ annualSalary: rich, spouseNoIncome: true, spouseLifeInsurancePaid: B(10_000), lifeInsurancePaid: B(100_000), healthInsurancePaid: B(25_000) });
    expect(line(r, 'lifeInsurance').allowed).toBe(B(100_000));
    expect(line(r, 'spouseLifeInsurance').allowed).toBe(B(10_000));
  });
  it('ข้อมูลเข้าผิด = RangeError', () => {
    for (const v of [-1, 1.5, Number.NaN, -0, MAX_TAX_INPUT_SATANG + 1]) {
      expect(() => run({ annualSalary: rich, spouseNoIncome: true, spouseLifeInsurancePaid: v })).toThrow(RangeError);
    }
  });
});

describe('ตัวอย่างจบ-จบและ property ของรายการครอบครัวเพิ่มเติม', () => {
  it('เงินได้ 2,000,000: ครอบครัวครบ → สุทธิ 1,502,000 ภาษี 240,500', () => {
    const r = run({
      annualSalary: rich,
      spouseNoIncome: true,
      childrenCount: 1,
      adoptedChildrenCount: 1,
      parentsCount: 1,
      disabledRelativesCount: 1,
      disabledOtherCount: 1,
      prenatalPaid: [B(70_000)],
      spouseLifeInsurancePaid: B(8_000),
    });
    // ส่วนตัว 60 + คู่สมรส 60 + บุตร 30 + บุตรบุญธรรม 30 + บิดามารดา 30 + พิการ 120 + ฝากครรภ์ 60 + ประกันคู่สมรส 8 = 398,000
    expect(r.totalAllowances).toBe(B(398_000));
    expect(r.netIncome).toBe(B(1_502_000));
    // 115,000 (ถึง 1 ล้าน) + 502,000 × 25% = 240,500
    expect(r.tax).toBe(B(240_500));
  });
  it('ทุกช่องใหม่ที่ค่าสูงสุดพร้อมกัน ไม่ล้น ผลรวมตรงกับแต่ละรายการ', () => {
    const m = MAX_TAX_INPUT_SATANG;
    const r = run({
      annualSalary: m,
      spouseNoIncome: true,
      childrenCount: 20,
      extraChildrenCount: 19,
      adoptedChildrenCount: 3,
      parentsCount: 4,
      disabledRelativesCount: 20,
      disabledOtherCount: 1,
      prenatalPaid: [m, m],
      spouseLifeInsurancePaid: m,
    });
    expect(Number.isSafeInteger(r.tax)).toBe(true);
    expect(r.totalAllowances).toBe(r.deductions.reduce((s, d) => s + d.allowed, 0));
    expect(line(r, 'prenatal').allowed).toBe(B(120_000));
  });
  it('property: ผลรวมรายการ = totalAllowances · ฝากครรภ์ ≤ 60,000 ต่อครรภ์ · ไม่รายการใดเกินที่ขอ', () => {
    let seed = 4242;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 400; i++) {
      const children = next() % 6;
      const preg = next() % 3;
      const prenatal = Array.from({ length: preg }, () => (next() % 120_000) * 100);
      const spouse = next() % 2 === 0;
      const r = run({
        annualSalary: (next() % 5_000_000) * 100,
        spouseNoIncome: spouse,
        childrenCount: children,
        extraChildrenCount: children === 0 ? 0 : next() % children,
        adoptedChildrenCount: next() % 4,
        disabledRelativesCount: next() % 4,
        disabledOtherCount: next() % 2,
        prenatalPaid: prenatal,
        spouseLifeInsurancePaid: spouse ? (next() % 20_000) * 100 : 0,
        lifeInsurancePaid: (next() % 150_000) * 100,
        donationPaid: (next() % 300_000) * 100,
      });
      expect(r.totalAllowances).toBe(r.deductions.reduce((s, d) => s + d.allowed, 0));
      const expectedPrenatal = prenatal.reduce((s, v) => s + Math.min(v, B(60_000)), 0);
      expect(line(r, 'prenatal').allowed).toBe(expectedPrenatal);
      const adoptedAllowed = line(r, 'adoptedChildren').allowed;
      expect(adoptedAllowed).toBeLessThanOrEqual(B(30_000) * Math.max(0, 3 - children));
    }
  });
});
