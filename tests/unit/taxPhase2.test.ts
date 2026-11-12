import { describe, expect, it } from 'vitest';
import { MAX_TAX_INPUT_SATANG } from '../../src/domain/tax/config';
import { computeSalaryTax, type SalaryTaxInput } from '../../src/domain/tax/salaryTax';

const B = (baht: number): number => baht * 100;
const base: SalaryTaxInput = { annualSalary: 0, withheldTax: 0, socialSecurityPaid: 0, rmfPaid: 0, pensionInsurancePaid: 0, thaiEsgPaid: 0 };
const run = (over: Partial<SalaryTaxInput>) => computeSalaryTax({ ...base, ...over });
const line = (r: ReturnType<typeof run>, key: string) => r.deductions.find((d) => d.key === key)!;
const rich = B(1_500_000);

describe('เฟส 2: ครอบครัว (คู่สมรส บุตร บิดามารดา)', () => {
  it('คู่สมรสไม่มีเงินได้ 60,000 เมื่อติ๊ก · ไม่ติ๊กเป็น 0', () => {
    expect(line(run({ annualSalary: rich, spouseNoIncome: true }), 'spouse').allowed).toBe(B(60_000));
    expect(line(run({ annualSalary: rich }), 'spouse').allowed).toBe(0);
    expect(line(run({ annualSalary: rich, spouseNoIncome: false }), 'spouse').allowed).toBe(0);
  });
  it('บุตร: คนละ 30,000 และคนที่ 2 เป็นต้นไปที่เกิดปี 2561+ ได้เพิ่มอีกคนละ 30,000 (รวม 60,000)', () => {
    expect(line(run({ annualSalary: rich, childrenCount: 1 }), 'children').allowed).toBe(B(30_000));
    expect(line(run({ annualSalary: rich, childrenCount: 2, extraChildrenCount: 1 }), 'children').allowed).toBe(B(90_000));
    expect(line(run({ annualSalary: rich, childrenCount: 3, extraChildrenCount: 2 }), 'children').allowed).toBe(B(150_000));
    expect(line(run({ annualSalary: rich, childrenCount: 0 }), 'children').allowed).toBe(0);
  });
  it('บิดามารดา คนละ 30,000 สูงสุด 4 คน', () => {
    expect(line(run({ annualSalary: rich, parentsCount: 2 }), 'parents').allowed).toBe(B(60_000));
    expect(line(run({ annualSalary: rich, parentsCount: 4 }), 'parents').allowed).toBe(B(120_000));
  });
  it('จำนวนไม่ถูกต้อง = RangeError (ห้ามปัดเงียบ)', () => {
    const bads: Partial<SalaryTaxInput>[] = [
      { parentsCount: 5 },
      { parentsCount: -1 },
      { parentsCount: 1.5 },
      { parentsCount: Number.NaN },
      { childrenCount: 21 },
      { childrenCount: -1 },
      { childrenCount: 2, extraChildrenCount: 3 },
      { childrenCount: 2, extraChildrenCount: 2 },
      { childrenCount: 1, extraChildrenCount: 1 },
      { extraChildrenCount: 1 },
      { childrenCount: 2.5 },
    ];
    for (const bad of bads) expect(() => run({ annualSalary: rich, ...bad })).toThrow(RangeError);
    expect(() => run({ annualSalary: rich, spouseNoIncome: 'yes' as unknown as boolean })).toThrow(RangeError);
  });
});

describe('เฟส 2: ประกัน ดอกเบี้ยบ้าน บริจาค', () => {
  it('ประกันชีวิตเพดาน 100,000 · ประกันสุขภาพเพดาน 25,000 · รวมกันไม่เกิน 100,000 (ชีวิตก่อน)', () => {
    const a = run({ annualSalary: rich, lifeInsurancePaid: B(120_000) });
    expect(line(a, 'lifeInsurance').allowed).toBe(B(100_000));
    expect(line(a, 'lifeInsurance').clamped).toBe(true);
    const b = run({ annualSalary: rich, healthInsurancePaid: B(40_000) });
    expect(line(b, 'healthInsurance').allowed).toBe(B(25_000));
    const c = run({ annualSalary: rich, lifeInsurancePaid: B(90_000), healthInsurancePaid: B(25_000) });
    expect(line(c, 'lifeInsurance').allowed).toBe(B(90_000));
    expect(line(c, 'healthInsurance').allowed).toBe(B(10_000));
    expect(line(c, 'healthInsurance').clamped).toBe(true);
    const d = run({ annualSalary: rich, lifeInsurancePaid: B(100_000), healthInsurancePaid: B(25_000) });
    expect(line(d, 'healthInsurance').allowed).toBe(0);
  });
  it('"สิทธิที่ยังใช้ได้" ของประกันชีวิต/สุขภาพไม่เกินที่เหลือของกลุ่ม', () => {
    const none = run({ annualSalary: rich });
    expect(line(none, 'lifeInsurance').remaining).toBe(B(100_000));
    expect(line(none, 'healthInsurance').remaining).toBe(B(25_000));
    const life70 = run({ annualSalary: rich, lifeInsurancePaid: B(70_000) });
    expect(line(life70, 'lifeInsurance').remaining).toBe(B(30_000));
    expect(line(life70, 'healthInsurance').remaining).toBe(B(25_000));
    const life90 = run({ annualSalary: rich, lifeInsurancePaid: B(90_000) });
    expect(line(life90, 'healthInsurance').remaining).toBe(B(10_000));
  });
  it('ประกันสุขภาพบิดามารดา เพดาน 15,000 · ดอกเบี้ยบ้าน เพดาน 100,000', () => {
    const r = run({ annualSalary: rich, parentsHealthPaid: B(20_000), mortgageInterestPaid: B(150_000) });
    expect(line(r, 'parentsHealth').allowed).toBe(B(15_000));
    expect(line(r, 'parentsHealth').clamped).toBe(true);
    expect(line(r, 'mortgageInterest').allowed).toBe(B(100_000));
    expect(line(r, 'mortgageInterest').remaining).toBe(0);
  });
  it('บริจาค: ไม่เกิน 10% ของเงินได้หลังหักค่าใช้จ่ายและค่าลดหย่อนอื่นทั้งหมด', () => {
    // 1,500,000 − เหมา 100,000 − ส่วนตัว 60,000 = 1,340,000 → เพดาน 134,000
    const r = run({ annualSalary: rich, donationPaid: B(200_000) });
    expect(line(r, 'donation').allowed).toBe(B(134_000));
    expect(line(r, 'donation').clamped).toBe(true);
    expect(line(r, 'donation').remaining).toBe(0);
    const small = run({ annualSalary: rich, donationPaid: B(50_000) });
    expect(line(small, 'donation').allowed).toBe(B(50_000));
    expect(line(small, 'donation').remaining).toBe(B(84_000));
  });
  it('บริจาค: เศษครึ่งสตางค์ปัดครึ่งขึ้น (ฐาน 100,000.05 บาท × 10% = 10,000.005 บาท → 10,000.01)', () => {
    const r = run({ annualSalary: B(260_000) + 5, donationPaid: B(100_000) });
    expect(line(r, 'donation').allowed).toBe(B(10_000) + 1);
  });
  it('บริจาค: ฐานติดลบ = เพดาน 0 (ค่าลดหย่อนอื่นกินเงินได้หมดแล้ว)', () => {
    const r = run({ annualSalary: B(300_000), spouseNoIncome: true, parentsCount: 4, childrenCount: 2, donationPaid: B(10_000) });
    // 300,000 − 100,000 − (60 + 60 + 60 + 120 = 300,000) < 0
    expect(line(r, 'donation').allowed).toBe(0);
    expect(r.netIncome).toBe(0);
  });
  it('ตัวอย่างจบ-จบ: เงินได้ 1,500,000 ครอบครัว+ประกัน+ดอกเบี้ย+บริจาค → ภาษี 88,000', () => {
    const r = run({
      annualSalary: rich,
      spouseNoIncome: true,
      childrenCount: 2,
      extraChildrenCount: 1,
      parentsCount: 2,
      lifeInsurancePaid: B(120_000),
      healthInsurancePaid: B(30_000),
      parentsHealthPaid: B(20_000),
      mortgageInterestPaid: B(120_000),
      donationPaid: B(50_000),
    });
    // ส่วนตัว 60 + คู่สมรส 60 + บุตร 90 + บิดามารดา 60 + ชีวิต 100 + สุขภาพ 0 + สุขภาพพ่อแม่ 15 + ดอกเบี้ย 100 = 485,000
    // ฐานบริจาค = 1,500,000 − 100,000 − 485,000 = 915,000 → เพดาน 91,500 · ขอ 50,000 ได้ 50,000
    expect(r.totalAllowances).toBe(B(535_000));
    expect(r.netIncome).toBe(B(865_000));
    // 7,500 + 20,000 + 37,500 + (865,000 − 750,000) × 20% = 88,000
    expect(r.tax).toBe(B(88_000));
  });
  it('ข้อมูลเข้าเงินช่องใหม่ผิดทุกแบบ = RangeError', () => {
    const fields = ['lifeInsurancePaid', 'healthInsurancePaid', 'parentsHealthPaid', 'mortgageInterestPaid', 'donationPaid'] as const;
    for (const f of fields) {
      for (const v of [-1, 1.5, Number.NaN, -0, MAX_TAX_INPUT_SATANG + 1]) {
        expect(() => run({ [f]: v })).toThrow(RangeError);
      }
      expect(() => run({ [f]: MAX_TAX_INPUT_SATANG })).not.toThrow();
    }
  });
  it('property: ผลรวมค่าลดหย่อน = ผลรวมแต่ละรายการ · ชีวิต+สุขภาพ ≤ 100,000 · กลุ่มเกษียณ ≤ 500,000 · ไม่รายการใดเกินที่ขอ', () => {
    let seed = 987;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 400; i++) {
      const children = next() % 6;
      const r = run({
        annualSalary: (next() % 4_000_000) * 100,
        spouseNoIncome: next() % 2 === 0,
        childrenCount: children,
        extraChildrenCount: children === 0 ? 0 : next() % children,
        parentsCount: next() % 5,
        lifeInsurancePaid: (next() % 150_000) * 100,
        healthInsurancePaid: (next() % 60_000) * 100,
        parentsHealthPaid: (next() % 30_000) * 100,
        mortgageInterestPaid: (next() % 200_000) * 100,
        donationPaid: (next() % 400_000) * 100,
        rmfPaid: (next() % 700_000) * 100,
        pensionInsurancePaid: (next() % 300_000) * 100,
        thaiEsgPaid: (next() % 400_000) * 100,
        socialSecurityPaid: (next() % 20_000) * 100,
      });
      expect(line(r, 'lifeInsurance').allowed + line(r, 'healthInsurance').allowed).toBeLessThanOrEqual(B(100_000));
      expect(line(r, 'rmf').allowed + line(r, 'pensionInsurance').allowed).toBeLessThanOrEqual(B(500_000));
      expect(r.totalAllowances).toBe(r.deductions.reduce((sum, d) => sum + d.allowed, 0));
      const auto = new Set(['personal', 'spouse', 'children', 'parents']);
      for (const d of r.deductions) if (!auto.has(d.key)) expect(d.allowed).toBeLessThanOrEqual(d.requested);
    }
  });
});

describe('เฟส 2: ขอบเขตเพิ่มเติมตาม money-auditor (R14)', () => {
  it('เงินได้ 0 พร้อมช่องใหม่ทุกช่อง: ภาษี 0 สุทธิ 0 ค่าลดหย่อนที่ใช้ได้ไม่เกินเพดานตามเงินได้', () => {
    const r = run({
      annualSalary: 0,
      spouseNoIncome: true,
      childrenCount: 3,
      extraChildrenCount: 2,
      parentsCount: 4,
      lifeInsurancePaid: B(10_000),
      healthInsurancePaid: B(10_000),
      parentsHealthPaid: B(10_000),
      mortgageInterestPaid: B(10_000),
      donationPaid: B(10_000),
    });
    expect(r.tax).toBe(0);
    expect(r.netIncome).toBe(0);
    expect(line(r, 'donation').allowed).toBe(0);
  });
  it('ทุกช่องเงินที่ค่าสูงสุดพร้อมกัน ไม่ล้นและกลุ่มไม่เกินเพดาน', () => {
    const m = MAX_TAX_INPUT_SATANG;
    const r = run({ annualSalary: m, withheldTax: m, socialSecurityPaid: m, rmfPaid: m, pensionInsurancePaid: m, thaiEsgPaid: m, lifeInsurancePaid: m, healthInsurancePaid: m, parentsHealthPaid: m, mortgageInterestPaid: m, donationPaid: m, spouseNoIncome: true, childrenCount: 20, extraChildrenCount: 19, parentsCount: 4 });
    expect(Number.isSafeInteger(r.tax)).toBe(true);
    expect(line(r, 'lifeInsurance').allowed + line(r, 'healthInsurance').allowed).toBeLessThanOrEqual(B(100_000));
    expect(line(r, 'rmf').allowed + line(r, 'pensionInsurance').allowed).toBeLessThanOrEqual(B(500_000));
    expect(r.totalAllowances).toBe(r.deductions.reduce((s, d) => s + d.allowed, 0));
    expect(r.balanceKind).toBe('refund');
  });
  it('ฐานบริจาคหักค่าลดหย่อนอื่นครบ (ประกันสังคม RMF Thai ESG): 1,500,000 → เพดาน 82,950', () => {
    // ฐาน = 1,500,000 − 100,000 − (60,000 + 10,500 + 300,000 + 200,000) = 829,500 → 10% = 82,950
    const r = run({ annualSalary: B(1_500_000), socialSecurityPaid: B(10_500), rmfPaid: B(300_000), thaiEsgPaid: B(200_000), donationPaid: B(100_000) });
    expect(line(r, 'donation').allowed).toBe(B(82_950));
    expect(line(r, 'donation').clamped).toBe(true);
  });
  it('ลำดับเพดานกลุ่มเมื่อกรอกครบ: ประกันชีวิต 100,000 เต็ม → ประกันสุขภาพ 0 · RMF 500,000 เต็ม → บำนาญ 0', () => {
    const r = run({ annualSalary: B(5_000_000), lifeInsurancePaid: B(100_000), healthInsurancePaid: B(25_000), rmfPaid: B(500_000), pensionInsurancePaid: B(200_000) });
    expect(line(r, 'healthInsurance').allowed).toBe(0);
    expect(line(r, 'pensionInsurance').allowed).toBe(0);
  });
});
