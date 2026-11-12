import { describe, expect, it } from 'vitest';
import { MAX_TAX_INPUT_SATANG, TAX_CONFIG_2569 } from '../../src/domain/tax/config';
import { computeSalaryTax, DEDUCTION_ORDER, type SalaryTaxInput } from '../../src/domain/tax/salaryTax';

const B = (baht: number): number => baht * 100;
const base: SalaryTaxInput = { annualSalary: 0, withheldTax: 0, socialSecurityPaid: 0, rmfPaid: 0, pensionInsurancePaid: 0, thaiEsgPaid: 0 };
const run = (over: Partial<SalaryTaxInput>) => computeSalaryTax({ ...base, ...over });
const line = (r: ReturnType<typeof run>, key: string) => r.deductions.find((d) => d.key === key)!;

describe('computeSalaryTax: ขอบเขตพื้นฐาน (R19)', () => {
  it('เงินได้ 0 → ทุกค่า 0 ไม่มี -0', () => {
    const r = run({});
    expect(r.tax).toBe(0);
    expect(r.netIncome).toBe(0);
    expect(r.expense).toBe(0);
    expect(Object.is(r.balance, -0)).toBe(false);
    expect(r.balanceKind).toBe('even');
    expect(r.year).toBe(2569);
  });

  it('เงินได้ 1 สตางค์ → ภาษี 0', () => {
    const r = run({ annualSalary: 1 });
    expect(r.tax).toBe(0);
    expect(r.netIncome).toBe(0);
  });

  it('ลดหย่อนส่วนตัว 60,000 ใช้เสมอ และเงินได้สุทธิไม่ติดลบ', () => {
    const r = run({ annualSalary: B(100_000) }); // เหมา 50,000 + ส่วนตัว 60,000 > 100,000
    expect(r.expense).toBe(B(50_000));
    expect(line(r, 'personal').allowed).toBe(B(60_000));
    expect(r.netIncome).toBe(0);
    expect(r.tax).toBe(0);
  });

  it('ลำดับแสดงผลคงที่', () => {
    expect(run({}).deductions.map((d) => d.key)).toEqual([...DEDUCTION_ORDER]);
    expect(DEDUCTION_ORDER).toEqual(['personal', 'socialSecurity', 'rmf', 'pensionInsurance', 'thaiEsg']);
  });
});

describe('ค่าใช้จ่ายเหมา 50% ไม่เกิน 100,000 (รวมครั้งเดียว)', () => {
  it('เงินได้ 200,000.00 → 100,000 พอดี', () => {
    expect(run({ annualSalary: B(200_000) }).expense).toBe(B(100_000));
  });
  it('เงินได้ 200,000.01 → ยังจำกัดที่ 100,000', () => {
    expect(run({ annualSalary: B(200_000) + 1 }).expense).toBe(B(100_000));
  });
  it('เงินได้ 199,999.99 → ครึ่งสตางค์ปัดขึ้น = 100,000.00', () => {
    expect(run({ annualSalary: B(200_000) - 1 }).expense).toBe(B(100_000));
  });
  it('เงินได้ 199,999.97 → 99,999.99 (ปัดครึ่งขึ้นจาก .985)', () => {
    expect(run({ annualSalary: B(200_000) - 3 }).expense).toBe(B(100_000) - 1);
  });
  it('เงินได้ 1,000,000 → ยังคง 100,000 ไม่ใช่ 500,000', () => {
    expect(run({ annualSalary: B(1_000_000) }).expense).toBe(B(100_000));
  });
});

describe('ภาษีขั้นบันได: รอยต่อทุกขั้น (เงินได้สุทธิ = เงินเดือน − 160,000 เมื่อเงินเดือน ≥ 200,000)', () => {
  const cases: [string, number, number][] = [
    ['สุทธิ 150,000.00 (ขั้นยกเว้นพอดี)', B(310_000), 0],
    ['สุทธิ 300,000', B(460_000), B(7_500)],
    ['สุทธิ 500,000', B(660_000), B(27_500)],
    ['สุทธิ 750,000', B(910_000), B(65_000)],
    ['สุทธิ 1,000,000', B(1_160_000), B(115_000)],
    ['สุทธิ 2,000,000', B(2_160_000), B(365_000)],
    ['สุทธิ 5,000,000', B(5_160_000), B(1_265_000)],
    ['สุทธิ 5,000,000.01 (ขั้น 35% เริ่ม)', B(5_160_000) + 1, B(1_265_000)], // 1 สตางค์ × 35% = 0.35 สตางค์ → ปัดเป็น 0
    ['สุทธิ 5,000,001.00', B(5_160_001), B(1_265_000) + 35],
  ];
  for (const [name, salary, tax] of cases) {
    it(name, () => {
      expect(run({ annualSalary: salary }).tax).toBe(tax);
    });
  }

  it('150,000.01 บาทเหนือขั้นยกเว้น: 1 สตางค์ × 5% = 0.05 สตางค์ → 0', () => {
    expect(run({ annualSalary: B(310_000) + 1 }).tax).toBe(0);
  });

  it('ปัดครึ่งขึ้นครั้งเดียวที่ปลายทาง: เศษจากขั้นที่เริ่มต้น 5 สตางค์ × 10% = 0.5 สตางค์ → ปัดขึ้น', () => {
    // สุทธิ 300,000.05 บาท: ขั้น 5% เต็ม 150,000 บาท = 750,000 สตางค์ พอดี · ขั้น 10% ได้ 5 สตางค์ × 10% = 0.5 สตางค์
    const r = run({ annualSalary: B(460_000) + 5 });
    expect(r.netIncome).toBe(B(300_000) + 5);
    expect(r.tax).toBe(B(7_500) + 1);
  });
  it('เศษ 0.4 สตางค์ปัดลง: สุทธิ 300,000.04 บาท', () => {
    expect(run({ annualSalary: B(460_000) + 4 }).tax).toBe(B(7_500));
  });

  it('ภาษีไม่ลดเมื่อเงินได้เพิ่ม (monotonic)', () => {
    let prev = -1;
    for (let s = 0; s <= B(8_000_000); s += 123_457_00) {
      const t = run({ annualSalary: s }).tax;
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('แถวของตารางขั้นบันไดแจกแจงส่วนเงินได้สุทธิครบ (ผลรวมส่วน = เงินได้สุทธิ)', () => {
    const r = run({ annualSalary: B(1_160_000) });
    expect(r.brackets.length).toBe(8);
    expect(r.brackets.reduce((s, b) => s + b.amountInBracket, 0)).toBe(r.netIncome);
    expect(r.brackets[0]).toMatchObject({ fromSatang: 0, upToSatang: B(150_000), rateBps: 0, amountInBracket: B(150_000) });
    expect(r.brackets[7]).toMatchObject({ upToSatang: null, rateBps: 3500, amountInBracket: 0 });
  });
});

describe('ค่าลดหย่อน: เพดานรายตัว', () => {
  it('ประกันสังคม ขอ 11,000 ใช้ได้ 10,500 (ขอเกินเพดาน → clamped)', () => {
    const r = run({ annualSalary: B(600_000), socialSecurityPaid: B(11_000) });
    const l = line(r, 'socialSecurity');
    expect(l.requested).toBe(B(11_000));
    expect(l.allowed).toBe(B(10_500));
    expect(l.clamped).toBe(true);
    expect(l.remaining).toBe(0);
    expect(l.confidence).toBe('unverified');
  });
  it('ประกันสังคม 10,500 พอดีและต่ำกว่าเพดาน → ไม่ clamped และมี "สิทธิที่ยังใช้ได้"', () => {
    const at = line(run({ annualSalary: B(600_000), socialSecurityPaid: B(10_500) }), 'socialSecurity');
    expect(at.clamped).toBe(false);
    expect(at.remaining).toBe(0);
    const under = line(run({ annualSalary: B(600_000), socialSecurityPaid: B(4_000) }), 'socialSecurity');
    expect(under.remaining).toBe(B(6_500));
  });
  it('Thai ESG เพดาน 30% ไม่เกิน 300,000: เงินได้ 5,000,000 ขอ 400,000 → 300,000', () => {
    const l = line(run({ annualSalary: B(5_000_000), thaiEsgPaid: B(400_000) }), 'thaiEsg');
    expect(l.allowed).toBe(B(300_000));
    expect(l.clamped).toBe(true);
  });
  it('Thai ESG เพดานเป็นร้อยละของเงินได้: เงินได้ 600,000 → 180,000', () => {
    const l = line(run({ annualSalary: B(600_000), thaiEsgPaid: B(250_000) }), 'thaiEsg');
    expect(l.allowed).toBe(B(180_000));
    expect(l.remaining).toBe(0);
  });
  it('Thai ESG ขอ 100,000 จากเงินได้ 5,000,000 → เหลือสิทธิ 200,000', () => {
    const l = line(run({ annualSalary: B(5_000_000), thaiEsgPaid: B(100_000) }), 'thaiEsg');
    expect(l.allowed).toBe(B(100_000));
    expect(l.remaining).toBe(B(200_000));
  });
  it('เศษครึ่งสตางค์ของ 30%: เงินได้ 100,000.05 บาท × 30% = 30,000.015 → ปัดครึ่งขึ้น 30,000.02 (ไม่ปัดลง)', () => {
    const l = line(run({ annualSalary: B(100_000) + 5, rmfPaid: B(100_000) }), 'rmf');
    expect(l.allowed).toBe(B(30_000) + 2);
  });
  it('ประกันชีวิตแบบบำนาญ 15% ไม่เกิน 200,000: เงินได้ 5,000,000 → 200,000', () => {
    const l = line(run({ annualSalary: B(5_000_000), pensionInsurancePaid: B(300_000) }), 'pensionInsurance');
    expect(l.allowed).toBe(B(200_000));
    expect(l.clamped).toBe(true);
  });
});

describe('เศษครึ่งสตางค์ของเพดานบำนาญ 15% และ config ที่ไม่มีเพดานค่าใช้จ่าย', () => {
  it('บำนาญ 15%: เงินได้ 100,000.10 บาท × 15% = 15,000.015 → ปัดครึ่งขึ้น 15,000.02', () => {
    const l = line(run({ annualSalary: B(100_000) + 10, pensionInsurancePaid: B(100_000) }), 'pensionInsurance');
    expect(l.allowed).toBe(B(15_000) + 2);
  });
  it('RMF ถูกเพดาน 30% แล้ว ยังเหลือสิทธิตามกลุ่ม: เงินได้ 600,000 ขอ 180,000 → เหลือ min(0, กลุ่ม) = 0 และบำนาญเหลือสิทธิ 90,000', () => {
    const r = run({ annualSalary: B(600_000), rmfPaid: B(180_000) });
    expect(line(r, 'rmf').remaining).toBe(0);
    expect(line(r, 'pensionInsurance').remaining).toBe(B(90_000));
  });
  it('config ที่ไม่มีเพดานค่าใช้จ่าย (null) = ไม่จำกัด ไม่ใช่ 0', () => {
    const cfg = { ...TAX_CONFIG_2569, employmentExpense: { ...TAX_CONFIG_2569.employmentExpense, capSatang: null } };
    expect(computeSalaryTax({ ...base, annualSalary: B(1_000_000) }, cfg).expense).toBe(B(500_000));
  });
});

describe('เพดานรวมกลุ่มเกษียณ 500,000 (RMF + ประกันบำนาญ · Thai ESG อยู่นอกกลุ่ม)', () => {
  const rich = B(5_000_000);
  it('RMF 600,000 → ใช้ได้ 500,000 (ชนเพดานกลุ่ม) ประกันบำนาญ 100,000 → 0', () => {
    const r = run({ annualSalary: rich, rmfPaid: B(600_000), pensionInsurancePaid: B(100_000) });
    expect(line(r, 'rmf').allowed).toBe(B(500_000));
    expect(line(r, 'pensionInsurance').allowed).toBe(0);
    expect(line(r, 'pensionInsurance').clamped).toBe(true);
  });
  it('RMF 400,000 + ประกันบำนาญ 200,000 → RMF 400,000 และประกันบำนาญถูกตัดเหลือ 100,000', () => {
    const r = run({ annualSalary: rich, rmfPaid: B(400_000), pensionInsurancePaid: B(200_000) });
    expect(line(r, 'rmf').allowed).toBe(B(400_000));
    expect(line(r, 'pensionInsurance').allowed).toBe(B(100_000));
  });
  it('พอดี 500,000 (RMF 300,000 + บำนาญ 200,000) ไม่ถูกตัด · เกิน 1 สตางค์ถูกตัด 1 สตางค์', () => {
    const exact = run({ annualSalary: rich, rmfPaid: B(300_000), pensionInsurancePaid: B(200_000) });
    expect(line(exact, 'rmf').allowed + line(exact, 'pensionInsurance').allowed).toBe(B(500_000));
    expect(line(exact, 'pensionInsurance').clamped).toBe(false);
    const over = run({ annualSalary: rich, rmfPaid: B(300_000) + 1, pensionInsurancePaid: B(200_000) });
    expect(line(over, 'rmf').allowed).toBe(B(300_000) + 1);
    expect(line(over, 'pensionInsurance').allowed).toBe(B(200_000) - 1);
    expect(line(over, 'pensionInsurance').clamped).toBe(true);
  });
  it('Thai ESG 300,000 ไม่ถูกนับในกลุ่ม: กลุ่มเต็ม 500,000 แล้วยังได้ Thai ESG เต็ม', () => {
    const r = run({ annualSalary: rich, rmfPaid: B(500_000), thaiEsgPaid: B(300_000) });
    expect(line(r, 'rmf').allowed).toBe(B(500_000));
    expect(line(r, 'thaiEsg').allowed).toBe(B(300_000));
  });
  it('"สิทธิที่ยังใช้ได้" ของ RMF/บำนาญ ไม่เกินที่เหลือของกลุ่ม', () => {
    const none = run({ annualSalary: rich });
    expect(line(none, 'rmf').remaining).toBe(B(500_000)); // เพดานกลุ่มชนก่อนเพดาน 30% (1.5 ล้าน)
    expect(line(none, 'pensionInsurance').remaining).toBe(B(200_000));
    const mid = run({ annualSalary: rich, rmfPaid: B(400_000) });
    expect(line(mid, 'rmf').remaining).toBe(B(100_000));
    expect(line(mid, 'pensionInsurance').remaining).toBe(B(100_000));
  });
  it('property: RMF + บำนาญที่ใช้ได้ ≤ 500,000 เสมอ และแต่ละค่า ≤ ที่ขอ', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 400; i++) {
      const r = run({
        annualSalary: (next() % 3_000_000) * 100,
        rmfPaid: (next() % 900_000) * 100,
        pensionInsurancePaid: (next() % 500_000) * 100,
        thaiEsgPaid: (next() % 500_000) * 100,
        socialSecurityPaid: (next() % 20_000) * 100,
      });
      const g = line(r, 'rmf').allowed + line(r, 'pensionInsurance').allowed;
      expect(g).toBeLessThanOrEqual(B(500_000));
      for (const d of r.deductions) {
        if (d.key !== 'personal') expect(d.allowed).toBeLessThanOrEqual(d.requested);
        expect(d.allowed).toBeGreaterThanOrEqual(0);
      }
      expect(r.totalAllowances).toBe(r.deductions.reduce((s, d) => s + d.allowed, 0));
    }
  });
});

describe('ตัวอย่างจบ-จบ (golden)', () => {
  it('เงินได้ 600,000 + ประกันสังคม 9,000 → สุทธิ 431,000 ภาษี 20,600', () => {
    const r = run({ annualSalary: B(600_000), socialSecurityPaid: B(9_000), withheldTax: B(18_000) });
    expect(r.expense).toBe(B(100_000));
    expect(r.totalAllowances).toBe(B(69_000));
    expect(r.netIncome).toBe(B(431_000));
    // 150,000×5% = 7,500 + 131,000×10% = 13,100
    expect(r.tax).toBe(B(20_600));
    expect(r.balance).toBe(B(2_600));
    expect(r.balanceKind).toBe('payMore');
  });
  it('ทุกลดหย่อนเต็มที่เงินได้ 5,000,000 → คำนวณตามมือ', () => {
    const r = run({ annualSalary: B(5_000_000), socialSecurityPaid: B(9_000), rmfPaid: B(300_000), pensionInsurancePaid: B(200_000), thaiEsgPaid: B(300_000) });
    // ลดหย่อน = 60,000 + 9,000 + 300,000 + 200,000 + 300,000 = 869,000 · เหมา 100,000 → สุทธิ 4,031,000
    expect(r.totalAllowances).toBe(B(869_000));
    expect(r.netIncome).toBe(B(4_031_000));
    // 365,000 (ถึง 2 ล้าน) + (4,031,000 − 2,000,000)×30% = 365,000 + 609,300
    expect(r.tax).toBe(B(974_300));
  });
  it('ข้อมูลใหญ่สุด 100 ล้านบาท ไม่เพี้ยน', () => {
    const r = run({ annualSalary: MAX_TAX_INPUT_SATANG });
    // สุทธิ = 100,000,000 − 100,000 − 60,000 = 99,840,000 · ภาษี = 1,265,000 + (99,840,000 − 5,000,000)×35%
    expect(r.netIncome).toBe(B(99_840_000));
    expect(r.tax).toBe(B(34_459_000));
  });
});

describe('ผลต่างกับภาษีที่ถูกหักแล้ว (เครื่องหมายแยกชัด)', () => {
  const salary = B(600_000); // ภาษี = 21,500 (ไม่มีลดหย่อนอื่น: สุทธิ 440,000)
  it('หักเท่าภาษีพอดี → 0 ไม่ใช่ -0', () => {
    const r = run({ annualSalary: salary, withheldTax: B(21_500) });
    expect(r.tax).toBe(B(21_500));
    expect(r.balance).toBe(0);
    expect(Object.is(r.balance, -0)).toBe(false);
    expect(r.balanceKind).toBe('even');
  });
  it('หักเกิน → ติดลบ = ขอคืน', () => {
    const r = run({ annualSalary: salary, withheldTax: B(25_000) });
    expect(r.balance).toBe(-B(3_500));
    expect(r.balanceKind).toBe('refund');
  });
  it('หักน้อยกว่า → บวก = ชำระเพิ่ม', () => {
    const r = run({ annualSalary: salary, withheldTax: 0 });
    expect(r.balance).toBe(B(21_500));
    expect(r.balanceKind).toBe('payMore');
  });
  it('ไม่มีเงินได้แต่มีภาษีถูกหัก → ขอคืนทั้งก้อน', () => {
    const r = run({ withheldTax: B(1_000) });
    expect(r.balance).toBe(-B(1_000));
    expect(r.balanceKind).toBe('refund');
  });
});

describe('ข้อมูลเข้าไม่ถูกต้อง = RangeError (ห้ามปัดเงียบ)', () => {
  const fields = ['annualSalary', 'withheldTax', 'socialSecurityPaid', 'rmfPaid', 'pensionInsurancePaid', 'thaiEsgPaid'] as const;
  const bad: [string, number][] = [
    ['ติดลบ', -1],
    ['ทศนิยม', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-0', -0],
    ['เกินสูงสุด', MAX_TAX_INPUT_SATANG + 1],
    ['เกินช่วงปลอดภัย', Number.MAX_SAFE_INTEGER + 2],
  ];
  for (const f of fields) {
    for (const [name, v] of bad) {
      it(`${f} = ${name}`, () => {
        expect(() => run({ [f]: v })).toThrow(RangeError);
      });
    }
    it(`${f} = สูงสุดพอดีใช้ได้`, () => {
      expect(() => run({ [f]: MAX_TAX_INPUT_SATANG })).not.toThrow();
    });
  }
  it('ข้อความข้อผิดพลาดเป็นภาษาไทยและบอกชื่อช่อง', () => {
    expect(() => run({ annualSalary: -1 })).toThrow('เงินได้ทั้งปี');
    expect(() => run({ rmfPaid: 0.5 })).toThrow('RMF');
  });
});

describe('ซอร์สไม่มีทศนิยมลอยตัว (R19)', () => {
  const files = import.meta.glob('../../src/domain/tax/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('พบไฟล์ซอร์ส', () => {
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(2);
  });
  for (const [path, text] of Object.entries(files)) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    it(`${path.split('/').pop()}: ไม่มี parseFloat / toFixed / Math.round / Math.floor / Math.pow`, () => {
      expect(code).not.toMatch(/parseFloat|toFixed|Math\.round|Math\.floor|Math\.trunc|Math\.pow|\*\*/);
    });
  }
});

describe('config ปีภาษี', () => {
  it('คำนวณด้วย config ที่ส่งเข้าได้ (ไม่ผูกตายตัวกับ 2569)', () => {
    const cfg = { ...TAX_CONFIG_2569, year: 2570 };
    const r = computeSalaryTax({ ...base, annualSalary: B(600_000) }, cfg);
    expect(r.year).toBe(2570);
    expect(r.tax).toBe(B(21_500));
  });
});
