import { describe, expect, it } from 'vitest';
import { TAX_CONFIG_2569, type Sourced } from '../../src/domain/tax/config';
import { computeSalaryTax, DEDUCTION_ORDER, type SalaryTaxInput } from '../../src/domain/tax/salaryTax';
import { buildTaxInput, confidenceBadge, emptyTaxForm, TAX_CONTINUING_BADGE, TAX_CONTINUING_NOTE } from '../../src/app/taxForm';

/**
 * ภาษีเฟส 2 ต่อ (R19): กองทุนสำรองเลี้ยงชีพ (PVD) + เบี้ยบำนาญล้นเข้าช่องประกันชีวิต + ลำดับเพดานกลุ่มเกษียณ
 * แหล่ง: rd.go.th/59674.html (หน้าปี 2560) · rd.go.th/43975.html (ถาม-ตอบปี 2553 มีตัวอย่าง) · อินโฟกราฟิกลดหย่อนปี 2565
 */
const B = (baht: number): number => baht * 100;
const base: SalaryTaxInput = { annualSalary: 0, withheldTax: 0, socialSecurityPaid: 0, rmfPaid: 0, pensionInsurancePaid: 0, thaiEsgPaid: 0 };
const run = (over: Partial<SalaryTaxInput>) => computeSalaryTax({ ...base, ...over });
const line = (r: ReturnType<typeof run>, key: string) => r.deductions.find((d) => d.key === key)!;
const allowed = (r: ReturnType<typeof run>, key: string): number => line(r, key).allowed;

describe('ตัวอย่างกรมสรรพากร (rd.go.th/43975.html ข้อ 1): เงินได้ 3,400,000', () => {
  // กองทุนสำรองเลี้ยงชีพ 100,000 · ประกันชีวิตปกติ 60,000 · ประกันบำนาญ 300,000 · RMF 360,000
  const r = run({ annualSalary: B(3_400_000), providentFundPaid: B(100_000), lifeInsurancePaid: B(60_000), pensionInsurancePaid: B(300_000), rmfPaid: B(360_000) });

  it('ประกันชีวิตปกติ 60,000 + เบี้ยบำนาญเติมอีก 40,000 = ช่องประกันชีวิตเต็ม 100,000 (ตรงเอกสาร)', () => {
    expect(allowed(r, 'lifeInsurance')).toBe(B(60_000));
    expect(allowed(r, 'pensionToLife')).toBe(B(40_000));
    expect(allowed(r, 'lifeInsurance') + allowed(r, 'pensionToLife')).toBe(B(100_000));
    // เพดานรายตัวของบำนาญ: 15% × 3,400,000 = 510,000 แต่ไม่เกิน 200,000 → ส่วนเกิน 100,000 เป็นส่วนที่ล้น (ตามเอกสาร "ใช้สิทธิได้ไม่เกิน 200,000")
    expect(line(r, 'pensionToLife').requested).toBe(B(100_000));
    expect(line(r, 'pensionToLife').clamped).toBe(true);
  });

  it('กลุ่มเกษียณ (กองทุนสำรองฯ + RMF + บำนาญ) รวมเต็ม 500,000 พอดี (ตรงเอกสาร)', () => {
    const group = allowed(r, 'providentFund') + allowed(r, 'rmf') + allowed(r, 'pensionInsurance');
    expect(group).toBe(B(500_000));
    // ลำดับคงที่ของแอป (กองทุนสำรองฯ → RMF → บำนาญ): เอกสารแบ่งต่างกัน (40,000/360,000/100,000) แต่ผลรวมกลุ่มเท่ากัน
    expect(allowed(r, 'providentFund')).toBe(B(100_000));
    expect(allowed(r, 'rmf')).toBe(B(360_000));
    expect(allowed(r, 'pensionInsurance')).toBe(B(40_000));
  });

  it('ค่าลดหย่อนรวม 660,000 และภาษีคำนวณเองตามขั้นบันได = 557,000', () => {
    // ส่วนตัว 60,000 + ประกันชีวิต 100,000 (60,000+40,000) + กลุ่มเกษียณ 500,000 = 660,000
    expect(r.totalAllowances).toBe(B(660_000));
    expect(r.expense).toBe(B(100_000));
    expect(r.netIncome).toBe(B(2_640_000));
    // 150k@0 + 150k@5% 7,500 + 200k@10% 20,000 + 250k@15% 37,500 + 250k@20% 50,000 + 1,000k@25% 250,000 + 640k@30% 192,000
    expect(r.tax).toBe(B(557_000));
  });
});

describe('กองทุนสำรองเลี้ยงชีพ: หักลดหย่อน 10,000 + ส่วนเกินยกเว้นไม่เกิน 490,000 และไม่เกิน 15% ของค่าจ้าง', () => {
  const split = (r: ReturnType<typeof run>) => line(r, 'providentFund').providentSplit!;

  it('จ่าย 0 / น้อยกว่า 10,000 / พอดี 10,000', () => {
    expect(allowed(run({ annualSalary: B(600_000) }), 'providentFund')).toBe(0);
    const small = run({ annualSalary: B(600_000), providentFundPaid: B(5_000) });
    expect(split(small)).toEqual({ deduction: B(5_000), exempt: 0 });
    const ten = run({ annualSalary: B(600_000), providentFundPaid: B(10_000) });
    expect(split(ten)).toEqual({ deduction: B(10_000), exempt: 0 });
    expect(line(ten, 'providentFund').clamped).toBe(false);
  });

  it('เงินได้ 600,000: ส่วนเกินยกเว้นไม่เกิน 15% = 90,000 จ่าย 120,000 → ใช้ได้ 100,000 ขอ 120,000 (เกินเพดาน)', () => {
    const r = run({ annualSalary: B(600_000), providentFundPaid: B(120_000) });
    expect(split(r)).toEqual({ deduction: B(10_000), exempt: B(90_000) });
    expect(line(r, 'providentFund').requested).toBe(B(120_000));
    expect(allowed(r, 'providentFund')).toBe(B(100_000));
    expect(line(r, 'providentFund').clamped).toBe(true);
    expect(line(r, 'providentFund').remaining).toBe(0);
  });

  it('เงินได้ 100,000: 15% = 15,000 → ส่วนเกินยกเว้นได้ 15,000 รวม 25,000', () => {
    const r = run({ annualSalary: B(100_000), providentFundPaid: B(50_000) });
    expect(split(r)).toEqual({ deduction: B(10_000), exempt: B(15_000) });
  });

  it('เงินได้ 5,000,000 จ่าย 600,000: ส่วนเกินยกเว้นไม่เกิน 490,000 รวมได้ 500,000 เต็มกลุ่ม → RMF ที่ตามมาได้ 0', () => {
    const r = run({ annualSalary: B(5_000_000), providentFundPaid: B(600_000), rmfPaid: B(100_000) });
    expect(split(r)).toEqual({ deduction: B(10_000), exempt: B(490_000) });
    expect(allowed(r, 'providentFund')).toBe(B(500_000));
    expect(allowed(r, 'rmf')).toBe(0);
    expect(line(r, 'rmf').clamped).toBe(true);
  });

  it('เศษครึ่งสตางค์ของ 15% ปัดครึ่งขึ้นด้วยตัวปัดกลาง (เงินได้ 100,000.10 บาท × 15% = 15,000.015 → 15,000.02)', () => {
    const r = run({ annualSalary: 10_000_010, providentFundPaid: B(1_000) * 100 });
    expect(split(r).exempt).toBe(1_500_002);
  });

  it('ลำดับตัดเพดานกลุ่ม 500,000: กองทุนสำรองฯ ก่อน แล้ว RMF แล้วบำนาญ (ไม่ตัดตามสัดส่วน)', () => {
    const r = run({ annualSalary: B(2_000_000), providentFundPaid: B(300_000), rmfPaid: B(300_000), pensionInsurancePaid: B(100_000) });
    expect(allowed(r, 'providentFund')).toBe(B(300_000));
    expect(allowed(r, 'rmf')).toBe(B(200_000));
    expect(allowed(r, 'pensionInsurance')).toBe(0);
    expect(line(r, 'pensionInsurance').clamped).toBe(true);
    expect(allowed(r, 'pensionToLife')).toBe(0); // บำนาญไม่เกินเพดานรายตัว จึงไม่มีส่วนล้น (ที่ถูกกลุ่มตัดไม่เติมช่องประกันชีวิต)
    expect(DEDUCTION_ORDER.indexOf('providentFund')).toBeLessThan(DEDUCTION_ORDER.indexOf('rmf'));
    expect(DEDUCTION_ORDER.indexOf('rmf')).toBeLessThan(DEDUCTION_ORDER.indexOf('pensionInsurance'));
  });

  it('ขอบ 1 สตางค์: จ่าย 10,000.01 บาท → ส่วนเกิน 0.01 · ส่วนเกินเพดาน 490,000 อีก 1 สตางค์ถูกตัด', () => {
    const a = run({ annualSalary: B(5_000_000), providentFundPaid: B(10_000) + 1 });
    expect(split(a)).toEqual({ deduction: B(10_000), exempt: 1 });
    const b = run({ annualSalary: B(5_000_000), providentFundPaid: B(500_000) + 1 });
    expect(split(b)).toEqual({ deduction: B(10_000), exempt: B(490_000) });
    expect(line(b, 'providentFund').clamped).toBe(true);
    expect(allowed(b, 'providentFund')).toBe(B(500_000));
  });

  it('เงินได้ 0 + จ่ายมาก: ส่วนยกเว้น 0 (15% ของ 0) · เงินได้สุทธิ 0 ภาษี 0 ไม่มี -0', () => {
    const r = run({ annualSalary: 0, providentFundPaid: B(1_000_000) });
    expect(split(r).exempt).toBe(0);
    expect(r.netIncome).toBe(0);
    expect(r.tax).toBe(0);
    expect(Object.is(r.balance, -0)).toBe(false);
  });

  it('กลุ่มเต็ม 500,000 พอดีแล้วบำนาญเหลือ 1 สตางค์ → บำนาญได้ 0 และขอเกินเพดาน', () => {
    const r = run({ annualSalary: B(5_000_000), providentFundPaid: B(500_000), pensionInsurancePaid: 1 });
    expect(allowed(r, 'providentFund')).toBe(B(500_000));
    expect(allowed(r, 'pensionInsurance')).toBe(0);
    expect(line(r, 'pensionInsurance').clamped).toBe(true);
  });

  it('เงินได้และ PVD เต็มช่วง 100 ล้านบาท: ไม่พลาดเรื่องขนาด ผลรวมกลุ่มยัง 500,000', () => {
    const r = run({ annualSalary: B(100_000_000), providentFundPaid: B(100_000_000), rmfPaid: B(100_000_000), pensionInsurancePaid: B(100_000_000) });
    expect(allowed(r, 'providentFund')).toBe(B(500_000));
    expect(allowed(r, 'rmf') + allowed(r, 'pensionInsurance')).toBe(0);
    expect(Number.isSafeInteger(r.tax)).toBe(true);
  });

  it('ข้อมูลเข้าผิด = RangeError ไทย (ติดลบ / -0 / ทศนิยม / เกินช่วง)', () => {
    expect(() => run({ providentFundPaid: -0 })).toThrow(RangeError);
    expect(() => run({ providentFundPaid: -1 })).toThrow(RangeError);
    expect(() => run({ providentFundPaid: 1.5 })).toThrow(RangeError);
    expect(() => run({ providentFundPaid: Number.MAX_SAFE_INTEGER })).toThrow(/กองทุนสำรองเลี้ยงชีพ/);
  });
});

describe('เบี้ยบำนาญส่วนเกินเพดานรายตัว เติมช่องประกันชีวิต (ลำดับ: ประกันชีวิต → บำนาญล้น → ประกันสุขภาพ → กลุ่มเกษียณ)', () => {
  it('เงินได้ 600,000 ประกันชีวิต 30,000 บำนาญ 150,000: เพดานบำนาญ 90,000 ส่วนล้น 60,000 เติมช่องชีวิตได้ 60,000 · สุขภาพ 25,000 เหลือที่ 10,000', () => {
    const r = run({ annualSalary: B(600_000), lifeInsurancePaid: B(30_000), pensionInsurancePaid: B(150_000), healthInsurancePaid: B(25_000) });
    expect(allowed(r, 'pensionInsurance')).toBe(B(90_000));
    expect(allowed(r, 'pensionToLife')).toBe(B(60_000));
    expect(allowed(r, 'lifeInsurance') + allowed(r, 'pensionToLife')).toBe(B(90_000));
    expect(allowed(r, 'healthInsurance')).toBe(B(10_000));
    expect(line(r, 'healthInsurance').clamped).toBe(true);
    expect(allowed(r, 'lifeInsurance') + allowed(r, 'pensionToLife') + allowed(r, 'healthInsurance')).toBe(B(100_000));
  });

  it('ประกันชีวิตเต็ม 100,000 แล้ว: ไม่มีที่ให้เติม (ส่วนล้นทิ้ง) และบอกว่าขอเกิน', () => {
    const r = run({ annualSalary: B(3_400_000), lifeInsurancePaid: B(100_000), pensionInsurancePaid: B(300_000) });
    expect(allowed(r, 'pensionToLife')).toBe(0);
    expect(line(r, 'pensionToLife').requested).toBe(B(100_000));
    expect(line(r, 'pensionToLife').clamped).toBe(true);
    expect(allowed(r, 'pensionInsurance')).toBe(B(200_000));
  });

  it('บำนาญไม่เกินเพดานรายตัว: ไม่มีส่วนล้น', () => {
    const r = run({ annualSalary: B(600_000), pensionInsurancePaid: B(50_000) });
    expect(allowed(r, 'pensionToLife')).toBe(0);
    expect(line(r, 'pensionToLife').requested).toBe(0);
    expect(line(r, 'pensionToLife').clamped).toBe(false);
  });

  it('ขอบ: บำนาญเกินเพดาน 1 สตางค์ → ส่วนล้น 1 สตางค์ เติมได้ 1 สตางค์', () => {
    const r = run({ annualSalary: B(600_000), pensionInsurancePaid: B(90_000) + 1 });
    expect(line(r, 'pensionToLife').requested).toBe(1);
    expect(allowed(r, 'pensionToLife')).toBe(1);
  });
});

describe('คุณสมบัติรวม (สุ่มแบบกำหนดผลได้): เพดานกลุ่ม ประกันชีวิต/สุขภาพ ส่วนที่ได้ ≤ ที่ขอ', () => {
  it('2,000 กรณีสุ่ม: กลุ่มเกษียณ ≤ 500,000 · ชีวิต+บำนาญล้น+สุขภาพ ≤ 100,000 · หักลดหย่อนกองทุนสำรองฯ ≤ 10,000 · ผลรวมรายการ = ค่าลดหย่อนรวม', () => {
    let seed = 20261113;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const amount = (maxBaht: number): number => (next() < 0.25 ? 0 : Math.floor(next() * maxBaht * 100));
    for (let i = 0; i < 2000; i++) {
      const r = run({
        annualSalary: Math.floor(next() * B(6_000_000)),
        providentFundPaid: amount(700_000),
        rmfPaid: amount(700_000),
        pensionInsurancePaid: amount(400_000),
        lifeInsurancePaid: amount(150_000),
        healthInsurancePaid: amount(40_000),
      });
      const group = allowed(r, 'providentFund') + allowed(r, 'rmf') + allowed(r, 'pensionInsurance');
      expect(group).toBeLessThanOrEqual(B(500_000));
      expect(allowed(r, 'lifeInsurance') + allowed(r, 'pensionToLife') + allowed(r, 'healthInsurance')).toBeLessThanOrEqual(B(100_000));
      const pvd = line(r, 'providentFund');
      expect(pvd.providentSplit!.deduction).toBeLessThanOrEqual(B(10_000));
      expect(pvd.providentSplit!.deduction + pvd.providentSplit!.exempt).toBe(pvd.allowed);
      expect(pvd.allowed).toBeLessThanOrEqual(pvd.requested);
      for (const key of ['rmf', 'pensionInsurance', 'lifeInsurance', 'healthInsurance']) expect(allowed(r, key)).toBeLessThanOrEqual(line(r, key).requested);
      const sum = r.deductions.reduce((a, d) => a + d.allowed, 0);
      expect(sum).toBe(r.totalAllowances);
    }
  });
});

describe('config: ลิงก์แหล่งทางการและระดับความมั่นใจของรายการใหม่/ที่อัปเดต (R13)', () => {
  const c = TAX_CONFIG_2569;
  const links = (x: Sourced): string[] => [x.source, ...(x.moreSources ?? [])];
  it('กองทุนสำรองเลี้ยงชีพ → rd.go.th/59674.html · ประกันบำนาญ → rd.go.th/43975.html', () => {
    expect(c.providentFund.source).toBe('https://rd.go.th/59674.html');
    expect(c.pensionInsurance.source).toBe('https://www.rd.go.th/43975.html');
    expect(c.providentFund).toMatchObject({ deductionSatang: B(10_000), exemptCapSatang: B(490_000), wageRateBps: 1500 });
  });
  it('RMF, ประกันชีวิต, สุขภาพตนเอง, สุขภาพบิดามารดา, ดอกเบี้ยบ้าน, กลุ่มเกษียณ → อินโฟกราฟิก SME_Infolv1_2.pdf', () => {
    for (const item of [c.rmf, c.lifeInsurance, c.healthInsurance, c.lifeHealthGroup, c.parentsHealth, c.mortgageInterest, c.retirementGroup]) {
      expect(links(item)).toContain('https://www.rd.go.th/fileadmin/user_upload/SMEs/infographic/SME_Infolv1_2.pdf');
    }
  });
  it('ตัวเลขตรงที่เจ้าของให้มา และทุกค่ามีที่มาเป็นลิงก์ https', () => {
    expect(c.retirementGroup.capSatang).toBe(B(500_000));
    expect(c.rmf.rateBps).toBe(3000);
    expect(c.lifeInsurance.capSatang).toBe(B(100_000));
    expect(c.healthInsurance.capSatang).toBe(B(25_000));
    expect(c.lifeHealthGroup.capSatang).toBe(B(100_000));
    expect(c.parentsHealth.capSatang).toBe(B(15_000));
    expect(c.mortgageInterest.capSatang).toBe(B(100_000));
    expect(c.pensionInsurance).toMatchObject({ rateBps: 1500, capSatang: B(200_000) });
    for (const item of [c.providentFund, c.pensionInsurance, c.rmf, c.retirementGroup, c.lifeInsurance, c.healthInsurance, c.parentsHealth, c.mortgageInterest]) {
      for (const l of links(item)) expect(l).toMatch(/^https:\/\//);
      expect(item.confidence).toBe('partial'); // ไม่ยกเป็น verified: เอกสารระบุปีก่อนหน้า (2553/2560/2565)
      expect(item.basis).toBe('continuing');
    }
  });
  it('ป้ายบนจอ: "เกณฑ์ที่ใช้ต่อเนื่อง ไม่พบประกาศเปลี่ยนแปลงสำหรับปี 2569" และมีคำอธิบายปีของเอกสารจริง', () => {
    expect(TAX_CONTINUING_BADGE).toBe('เกณฑ์ที่ใช้ต่อเนื่อง ไม่พบประกาศเปลี่ยนแปลงสำหรับปี 2569');
    expect(confidenceBadge('partial', 'continuing')).toBe(TAX_CONTINUING_BADGE);
    expect(confidenceBadge('partial')).not.toBe(TAX_CONTINUING_BADGE);
    expect(confidenceBadge('unverified', 'continuing')).toBe('ยังไม่ยืนยัน'); // ไม่ยืนยันยังชนะเสมอ
    for (const year of ['2560', '2553', '2565']) expect(TAX_CONTINUING_NOTE).toContain(year);
    const r = run({ annualSalary: B(600_000), providentFundPaid: B(50_000), rmfPaid: B(10_000), lifeInsurancePaid: B(1_000) });
    for (const key of ['providentFund', 'rmf', 'lifeInsurance']) expect(line(r, key).basis).toBe('continuing');
    expect(line(r, 'personal').basis).toBeUndefined();
  });
});

describe('ฟอร์ม: ช่องเงินสะสมกองทุนสำรองเลี้ยงชีพ', () => {
  it('กรอกแล้วเข้าสูตร · ว่าง = 0 · ติดลบถูกปฏิเสธรายช่อง', () => {
    const ok = buildTaxInput({ ...emptyTaxForm(), annualSalary: '600,000', providentFundPaid: '120,000' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.input.providentFundPaid).toBe(B(120_000));
      expect(line(ok.result, 'providentFund').allowed).toBe(B(100_000));
    }
    const empty = buildTaxInput({ ...emptyTaxForm(), annualSalary: '600,000' });
    if (empty.ok) expect(empty.input.providentFundPaid).toBe(0);
    const neg = buildTaxInput({ ...emptyTaxForm(), annualSalary: '600,000', providentFundPaid: '-5' });
    expect(neg.ok).toBe(false);
    if (!neg.ok && !neg.unsupported) expect(neg.errors[0]).toMatchObject({ field: 'providentFundPaid' });
  });
});
