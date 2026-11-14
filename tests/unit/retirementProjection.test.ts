import { describe, expect, it } from 'vitest';
import { buildRetirementInput, emptyRetirementForm, type RetirementForm } from '../../src/app/retirementForm';
import { parseRateToBps } from '../../src/domain/money/rate';
import { ceilDivBig, roundHalfUpBig } from '../../src/domain/money/round';
import { computeRetirement, retirementProblems, type RetirementInput } from '../../src/domain/retirement/projection';

const base: RetirementInput = {
  currentAge: 30,
  retireAge: 60,
  lifeExpectancy: 85,
  monthlyExpense: 1_000_000, // 10,000 บาท (สมมติ)
  inflationBps: 0,
  returnBeforeBps: 0,
  returnAfterBps: 0,
};

/** เศษส่วนแท้ BigInt (ตัวอ้างอิงอิสระ ไม่ปัดระหว่างทาง) · ใช้เฉพาะในเทสต์ */
class Frac {
  constructor(public n: bigint, public d: bigint = 1n) {
    const g = Frac.gcd(n < 0n ? -n : n, d);
    if (g > 1n) {
      this.n /= g;
      this.d /= g;
    }
  }
  static gcd(a: bigint, b: bigint): bigint {
    while (b !== 0n) [a, b] = [b, a % b];
    return a === 0n ? 1n : a;
  }
  add(o: Frac): Frac {
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  mul(o: Frac): Frac {
    return new Frac(this.n * o.n, this.d * o.d);
  }
  sub(o: Frac): Frac {
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  div(o: Frac): Frac {
    return new Frac(this.n * o.d, this.d * o.n);
  }
  ceil(): bigint {
    return (this.n + this.d - 1n) / this.d;
  }
  /** ปัดครึ่งขึ้น (ค่าบวกเท่านั้น) */
  round(): bigint {
    return (2n * this.n + this.d) / (2n * this.d);
  }
}

/**
 * เงินที่ต้องมีและเงินเก็บต่อเดือนแบบคณิตศาสตร์แท้ (ไม่ปัดระหว่างทาง)
 * คำนวณเป็นเศษส่วนเดียวที่ตัวส่วนร่วม (ตารางกำลังของ BigInt ครั้งเดียว + ตัดเศษส่วนที่ท้ายสุดครั้งเดียว)
 * แทนการบวก/คูณเศษส่วนทีละเดือนแล้วตัดทอนทุกขั้น: ผลเท่ากันทุกตัวเลข แต่เร็วกว่าราว 100 เท่า
 * (เดิมเทสต์ชุดนี้กิน CPU ~1.2 วินาทีต่อเคส จึงเกินเวลา 5 วินาทีของ vitest เมื่อรันขนานกับไฟล์อื่น · แก้ที่ต้นเหตุคือปริมาณงาน ไม่ใช่เพิ่มเวลารอ)
 */
function powers(base: bigint, n: number): bigint[] {
  const out: bigint[] = [1n];
  for (let k = 1; k <= n; k++) out.push(out[k - 1]! * base);
  return out;
}

function exact(i: RetirementInput): { required: bigint; exactPv: Frac; monthly: bigint } {
  const years = i.retireAge - i.currentAge;
  const retMonths = (i.lifeExpectancy - i.retireAge) * 12;
  const accMonths = years * 12;
  // เงินเฟ้อต่อปี I/J · ตัวคูณลดค่าต่อเดือนหลังเกษียณ P/Q · ตัวคูณโตต่อเดือนก่อนเกษียณ G/H
  const [I, J] = [BigInt(10_000 + i.inflationBps), 10_000n];
  const [P, Q] = [120_000n, BigInt(120_000 + i.returnAfterBps)];
  const [G, H] = [BigInt(120_000 + i.returnBeforeBps), 120_000n];
  // เงินที่ต้องมี: Σ_m E · (I/J)^k(m) · (P/Q)^m ที่ k(m) = ปีถึงเกษียณ + ⌊m/12⌋ → ตัวส่วนร่วม J^Kmax · Q^(R-1)
  let pv = new Frac(0n);
  if (retMonths > 0) {
    const kMax = years + Math.floor((retMonths - 1) / 12);
    const [pI, pJ, pP, pQ] = [powers(I, kMax), powers(J, kMax), powers(P, retMonths - 1), powers(Q, retMonths - 1)];
    let num = 0n;
    for (let m = 0; m < retMonths; m++) {
      const k = years + Math.floor(m / 12);
      num += BigInt(i.monthlyExpense) * pI[k]! * pJ[kMax - k]! * pP[m]! * pQ[retMonths - 1 - m]!;
    }
    pv = new Frac(num, pJ[kMax]! * pQ[retMonths - 1]!);
  }
  // ช่วงสะสม: a = Σ_{t<A} (G/H)^t (ตัวส่วน H^(A-1)) · p = (G/H)^A
  let a = new Frac(0n);
  let p = new Frac(1n);
  if (accMonths > 0) {
    const [pG, pH] = [powers(G, accMonths), powers(H, accMonths)];
    let num = 0n;
    for (let t = 0; t < accMonths; t++) num += pG[t]! * pH[accMonths - 1 - t]!;
    a = new Frac(num, pH[accMonths - 1]!);
    p = new Frac(pG[accMonths]!, pH[accMonths]!);
  }
  const fv = new Frac(BigInt(i.currentSavings ?? 0)).mul(p);
  const gap = pv.sub(fv);
  return { required: pv.round(), exactPv: pv, monthly: gap.n > 0n ? gap.div(a).ceil() : 0n };
}

describe('computeRetirement: ตัวอย่างตรวจมือ R18 (ชุด A)', () => {
  const A: RetirementInput = { currentAge: 59, retireAge: 60, lifeExpectancy: 62, monthlyExpense: 1_000_000, inflationBps: 300, returnBeforeBps: 0, returnAfterBps: 0 };
  it('E_ret 1,030,000 · W0 1,030,000 · W1 1,060,900 · N 25,090,800 · PMT 2,090,900 (ลงตัว ไม่ +1) · N วันนี้ 24,360,000', () => {
    const r = computeRetirement(A);
    expect(r.yearsToRetire).toBe(1);
    expect(r.retirementYears).toBe(2);
    expect(r.monthlyExpenseAtRetirement).toBe(1_030_000);
    expect(r.requiredAtRetirement).toBe(12 * 1_030_000 + 12 * 1_060_900);
    expect(r.requiredAtRetirement).toBe(25_090_800);
    expect(r.monthlySaving).toBe(2_090_900);
    expect(r.requiredInTodayMoney).toBe(24_360_000);
    expect(r.realReturnNegativeAfter).toBe(true); // ผลตอบแทนหลังเกษียณ 0% < เงินเฟ้อ 3%
  });
  it('เงินออม 30,000,000 (ผลตอบแทน 0%) เกินที่ต้องมี → ต้องเก็บเพิ่ม 0 ส่วนขาด 0 ไม่ติดลบ', () => {
    const r = computeRetirement({ ...A, currentSavings: 30_000_000 });
    expect(r.monthlySaving).toBe(0);
    expect(r.shortfall).toBe(0);
    expect(r.requiredAtRetirement).toBe(25_090_800);
  });
  it('เงินเฟ้อ 0, เงินออม 1,200,000, เก็บ 1 ปี ใช้ 24 เดือน: N 24,000,000 · gap 22,800,000 · PMT 1,900,000', () => {
    const r = computeRetirement({ ...A, inflationBps: 0, currentSavings: 1_200_000 });
    expect(r.requiredAtRetirement).toBe(24_000_000);
    expect(r.shortfall).toBe(22_800_000);
    expect(r.monthlySaving).toBe(1_900_000);
  });
  it('เงินออมเท่ากับที่ต้องมีพอดี = ต้องเก็บเพิ่ม 0', () => {
    const r = computeRetirement({ ...A, currentSavings: 25_090_800 });
    expect(r.shortfall).toBe(0);
    expect(r.monthlySaving).toBe(0);
  });
});

describe('computeRetirement: อัตรา 0% ผลเป็นจำนวนเต็มตรงตัว และ ceiling', () => {
  it('30 ปีเก็บ 25 ปีใช้: N = 300 เดือน x ค่าใช้จ่าย · PMT = ⌈N/360⌉ = 833,334 (เหลือเศษจึง +1)', () => {
    const r = computeRetirement(base);
    expect(r.requiredAtRetirement).toBe(300_000_000);
    expect(r.monthlySaving).toBe(833_334);
    expect(r.monthlyExpenseAtRetirement).toBe(1_000_000);
    expect(r.requiredInTodayMoney).toBe(300_000_000);
  });
  it('หารลงตัวพอดีไม่ +1 (ใช้ 25 ปี เก็บ 25 ปี: N/300 = 1,000,000 พอดี)', () => {
    const r = computeRetirement({ ...base, currentAge: 35, retireAge: 60, lifeExpectancy: 85 });
    expect(r.monthlySaving).toBe(1_000_000);
  });
  it('มีเงินออมปัจจุบัน: หักออก · ส่วนขาด 200,000,000 / 360 = 555,555.56 ปัดขึ้น', () => {
    const r = computeRetirement({ ...base, currentSavings: 100_000_000 });
    expect(r.currentSavingsAtRetirement).toBe(100_000_000);
    expect(r.shortfall).toBe(200_000_000);
    expect(r.monthlySaving).toBe(555_556);
  });
  it('เกษียณปีเดียว (n = 12) และช่วงเกษียณปีเดียว (M = 12) คำนวณได้', () => {
    const r = computeRetirement({ ...base, currentAge: 59, retireAge: 60, lifeExpectancy: 61 });
    expect(r.requiredAtRetirement).toBe(12_000_000);
    expect(r.monthlySaving).toBe(1_000_000);
  });
});

describe('การปัดเศษ: .5 สตางค์ปัดขึ้น และเลขใหญ่เกิน 2^53', () => {
  it('ค่าใช้จ่าย 50 สตางค์ x 1.03 = 51.5 → 52 (ปัดครึ่งขึ้น)', () => {
    const r = computeRetirement({ ...base, currentAge: 59, retireAge: 60, lifeExpectancy: 61, monthlyExpense: 50, inflationBps: 300 });
    expect(r.monthlyExpenseAtRetirement).toBe(52);
  });
  it('ceilDivBig: หารลงตัวไม่ +1 · มีเศษ +1 · เลขใหญ่เกิน 2^53 · ปฏิเสธตัวหาร ≤ 0 และตัวตั้งติดลบ', () => {
    expect(ceilDivBig(10n, 5n)).toBe(2n);
    expect(ceilDivBig(11n, 5n)).toBe(3n);
    expect(ceilDivBig(0n, 7n)).toBe(0n);
    const big = 10n ** 30n;
    expect(ceilDivBig(big, 3n)).toBe(big / 3n + 1n);
    expect(ceilDivBig(big, 10n)).toBe(big / 10n);
    expect(() => ceilDivBig(1n, 0n)).toThrow(RangeError);
    expect(() => ceilDivBig(-1n, 1n)).toThrow(RangeError);
    expect(roundHalfUpBig(5n, 2n)).toBe(3n);
  });
});

/**
 * ขอบความคลาดเคลื่อนที่ยอมรับได้เมื่อเทียบกับคณิตศาสตร์แท้ (ไม่ปัดระหว่างทาง):
 * เงินถอนรายเดือนถูกปัดเป็นสตางค์จริง (E_ret และ W_k แต่ละปี) จึงคลาดได้ ≤ 0.5 x ตัวคูณเงินเฟ้อ + 0.5 สตางค์ ต่อเดือน
 * รวมทุกเดือนของช่วงเกษียณ (ตัวคูณลดค่า ≤ 1) + ceiling 1 สตางค์ · ขอบสำหรับเงินเก็บต่อเดือนหารด้วยตัวคูณ annuity (≥ จำนวนเดือน)
 */
function toleranceN(c: RetirementInput): number {
  const retYears = c.lifeExpectancy - c.retireAge;
  const f = 1 + c.inflationBps / 10_000;
  let sum = 0;
  for (let k = 0; k < retYears; k++) sum += 0.5 * f ** k + 0.5; // ปัด W_k
  sum += 0.5 * (12 * retYears) * f ** retYears; // ปัด E_ret แล้วคูณเงินเฟ้อต่อ (ขอบบน)
  return Math.ceil(12 * sum) + 2;
}

describe('เทียบกับเศษส่วนแท้ที่ไม่ปัดระหว่างทาง (ต่างไม่เกินขอบจากการปัดเป็นสตางค์ของเงินถอนรายเดือน)', () => {
  const cases: RetirementInput[] = [
    { currentAge: 40, retireAge: 60, lifeExpectancy: 85, monthlyExpense: 3_000_000, inflationBps: 300, returnBeforeBps: 500, returnAfterBps: 300 },
    { currentAge: 30, retireAge: 55, lifeExpectancy: 80, monthlyExpense: 2_500_050, inflationBps: 250, returnBeforeBps: 625, returnAfterBps: 175, currentSavings: 123_456_789 },
    { currentAge: 50, retireAge: 60, lifeExpectancy: 75, monthlyExpense: 1_234_567, inflationBps: 0, returnBeforeBps: 700, returnAfterBps: 0, currentSavings: 50_000_000 },
    { currentAge: 59, retireAge: 60, lifeExpectancy: 61, monthlyExpense: 1_000_000, inflationBps: 300, returnBeforeBps: 400, returnAfterBps: 400 },
    { currentAge: 35, retireAge: 60, lifeExpectancy: 80, monthlyExpense: 987_654, inflationBps: 1000, returnBeforeBps: 1500, returnAfterBps: 1500 },
    { currentAge: 45, retireAge: 65, lifeExpectancy: 90, monthlyExpense: 4_321_000, inflationBps: 333, returnBeforeBps: 457, returnAfterBps: 211, currentSavings: 7_777_777 },
  ];
  it.each(cases.map((c, i) => [i, c] as const))('ชุดที่ %i', (_i, c) => {
    const r = computeRetirement(c);
    const e = exact(c);
    const tol = toleranceN(c);
    expect(Math.abs(r.requiredAtRetirement - Number(e.required))).toBeLessThanOrEqual(tol);
    const n = (c.retireAge - c.currentAge) * 12;
    expect(Math.abs(r.monthlySaving - Number(e.monthly))).toBeLessThanOrEqual(Math.ceil(tol / n) + 2);
  });
  it('ผลเป็นจำนวนเต็มเสมอ · เมื่อไม่มีเงินเฟ้อ (เงินถอนเป็นสตางค์เต็มอยู่แล้ว) ผลตรงกับค่าแท้ไม่เกิน 2 สตางค์', () => {
    for (const c of cases) for (const v of Object.values(computeRetirement(c))) if (typeof v === 'number') expect(Number.isInteger(v)).toBe(true);
    const flat: RetirementInput[] = [
      { ...base, returnBeforeBps: 500, returnAfterBps: 300 },
      { ...base, currentAge: 45, retireAge: 65, lifeExpectancy: 90, monthlyExpense: 1_234_567, returnBeforeBps: 700, returnAfterBps: 100, currentSavings: 9_000_000 },
      { ...base, currentAge: 59, retireAge: 60, lifeExpectancy: 61, returnBeforeBps: 1200, returnAfterBps: 1200 },
    ];
    for (const c of flat) {
      const r = computeRetirement(c);
      const e = exact(c);
      expect(Math.abs(r.requiredAtRetirement - Number(e.required))).toBeLessThanOrEqual(2);
      expect(Math.abs(r.monthlySaving - Number(e.monthly))).toBeLessThanOrEqual(2);
    }
  });
});

describe('ความสัมพันธ์ทิศทาง · deterministic · real return', () => {
  const k: RetirementInput = { ...base, inflationBps: 300, returnBeforeBps: 500, returnAfterBps: 300 };
  const r0 = computeRetirement(k);
  const more = (over: Partial<RetirementInput>) => computeRetirement({ ...k, ...over });
  it('ผลเดิมทุกครั้งเมื่อข้อมูลเข้าเท่ากัน', () => {
    expect(computeRetirement(k)).toEqual(r0);
  });
  it('N ไม่ลดลงเมื่อค่าใช้จ่าย/เงินเฟ้อ/อายุขัยเพิ่ม', () => {
    expect(more({ monthlyExpense: 2_000_000 }).requiredAtRetirement).toBeGreaterThan(r0.requiredAtRetirement);
    expect(more({ inflationBps: 500 }).requiredAtRetirement).toBeGreaterThanOrEqual(r0.requiredAtRetirement);
    expect(more({ lifeExpectancy: 95 }).requiredAtRetirement).toBeGreaterThan(r0.requiredAtRetirement);
  });
  it('PMT ไม่เพิ่มเมื่อเงินออม/ผลตอบแทนก่อนเกษียณเพิ่มหรือเริ่มเร็วขึ้น', () => {
    expect(more({ currentSavings: 50_000_000 }).monthlySaving).toBeLessThanOrEqual(r0.monthlySaving);
    expect(more({ returnBeforeBps: 800 }).monthlySaving).toBeLessThanOrEqual(r0.monthlySaving);
    expect(more({ currentAge: 20 }).monthlySaving).toBeLessThanOrEqual(r0.monthlySaving);
  });
  it('ผลตอบแทนหลังเกษียณสูงขึ้น N ไม่เพิ่มขึ้น · ต่ำกว่าเงินเฟ้อ/เท่า/สูงกว่า ไม่โยนข้อผิดพลาดและติดธงถูก', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const b2 of [0, 100, 300, 600, 1200]) {
      const n = more({ returnAfterBps: b2 }).requiredAtRetirement;
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
    expect(more({ returnAfterBps: 200 }).realReturnNegativeAfter).toBe(true);
    expect(more({ returnAfterBps: 300 }).realReturnNegativeAfter).toBe(false);
    expect(more({ returnAfterBps: 400 }).realReturnNegativeAfter).toBe(false);
  });
  it('มูลค่าวันนี้ของเงินที่ต้องมี น้อยกว่ามูลค่า ณ วันเกษียณเมื่อมีเงินเฟ้อ', () => {
    expect(r0.requiredInTodayMoney).toBeLessThan(r0.requiredAtRetirement);
  });
});

describe('ช่วงค่าและค่าผิด (R18 ข้อ 18.2): min / max / min-1 / max+1 ของทุกช่อง', () => {
  const ok = (over: Partial<RetirementInput>): boolean => retirementProblems({ ...base, ...over }).length === 0;
  it('อายุปัจจุบัน 18-79 (และต้องน้อยกว่าอายุเกษียณ ซึ่งไม่เกิน 80)', () => {
    expect(ok({ currentAge: 18 })).toBe(true);
    expect(ok({ currentAge: 79, retireAge: 80, lifeExpectancy: 85 })).toBe(true);
    expect(ok({ currentAge: 80, retireAge: 81, lifeExpectancy: 85 })).toBe(false);
    expect(ok({ currentAge: 17 })).toBe(false);
    expect(ok({ currentAge: 59 })).toBe(true);
    expect(ok({ currentAge: 60 })).toBe(false); // = อายุเกษียณ
  });
  it('อายุเกษียณ 30-80 และมากกว่าอายุปัจจุบัน (เจ้าของกำหนด 12 พ.ย. 2569)', () => {
    expect(ok({ currentAge: 18, retireAge: 30, lifeExpectancy: 85 })).toBe(true);
    expect(ok({ currentAge: 18, retireAge: 29 })).toBe(false);
    expect(ok({ retireAge: 80, lifeExpectancy: 110 })).toBe(true);
    expect(ok({ retireAge: 81, lifeExpectancy: 110 })).toBe(false);
    expect(ok({ retireAge: 30 })).toBe(false); // = อายุปัจจุบัน
  });
  it('อายุคาดการณ์ ≤ 110 และมากกว่าอายุเกษียณ', () => {
    expect(ok({ lifeExpectancy: 110 })).toBe(true);
    expect(ok({ lifeExpectancy: 111 })).toBe(false);
    expect(ok({ lifeExpectancy: 61 })).toBe(true);
    expect(ok({ lifeExpectancy: 60 })).toBe(false);
  });
  it('ค่าใช้จ่าย 1-100,000,000 สตางค์', () => {
    expect(ok({ monthlyExpense: 1 })).toBe(true);
    expect(ok({ monthlyExpense: 0 })).toBe(false);
    expect(ok({ monthlyExpense: 100_000_000 })).toBe(true);
    expect(ok({ monthlyExpense: 100_000_001 })).toBe(false);
  });
  it('เงินเฟ้อ 0-1,000 bps · ผลตอบแทนก่อน/หลังเกษียณ -500 ถึง 1,500 bps (เจ้าของกำหนด 12 พ.ย. 2569)', () => {
    expect(ok({ inflationBps: 0 }) && ok({ inflationBps: 1000 })).toBe(true);
    expect(ok({ inflationBps: -1 }) || ok({ inflationBps: 1001 })).toBe(false);
    for (const f of ['returnBeforeBps', 'returnAfterBps'] as const) {
      expect(ok({ [f]: 1500 }), f).toBe(true);
      expect(ok({ [f]: 1501 }), f).toBe(false);
      expect(ok({ [f]: -500 }), f).toBe(true);
      expect(ok({ [f]: -501 }), f).toBe(false);
      expect(ok({ [f]: -1 }), f).toBe(true);
    }
  });
  it('เงินออม 0-100,000,000,000 สตางค์ (ไม่กรอกได้)', () => {
    expect(ok({ currentSavings: 0 }) && ok({ currentSavings: 100_000_000_000 }) && ok({})).toBe(true);
    expect(ok({ currentSavings: -1 }) || ok({ currentSavings: 100_000_000_001 })).toBe(false);
  });
  it('NaN / Infinity / -0 / ทศนิยม ในทุกช่องถูกปฏิเสธ และ computeRetirement โยน RangeError', () => {
    const fields: (keyof RetirementInput)[] = ['currentAge', 'retireAge', 'lifeExpectancy', 'monthlyExpense', 'inflationBps', 'returnBeforeBps', 'returnAfterBps', 'currentSavings'];
    for (const f of fields) {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1.5]) {
        const input = { ...base, [f]: bad } as RetirementInput;
        // -0 ในช่องที่ 0 เป็นค่าต่ำสุดที่ถูกต้อง (inflation/return/savings) ก็ต้องถูกปฏิเสธตามกฎ ห้าม -0
        expect(retirementProblems(input).length, `${f}=${String(bad)}`).toBeGreaterThan(0);
        expect(() => computeRetirement(input), `${f}=${String(bad)}`).toThrow(RangeError);
      }
    }
  });
});

describe('ช่วงเวลายาวสุดและเลขใหญ่', () => {
  it('n = 744 เดือน (18→80) กับ M = 360 เดือน ทำงานเสร็จเร็วและผลเป็นจำนวนเต็มปลอดภัย', () => {
    const t0 = Date.now();
    const r = computeRetirement({ currentAge: 18, retireAge: 80, lifeExpectancy: 110, monthlyExpense: 1_000_000, inflationBps: 300, returnBeforeBps: 500, returnAfterBps: 300 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isSafeInteger(v)).toBe(true);
  });
  it('M = 960 เดือน (เกษียณ 30 อยู่ถึง 110) ทำงานได้', () => {
    const r = computeRetirement({ currentAge: 18, retireAge: 30, lifeExpectancy: 110, monthlyExpense: 1_000_000, inflationBps: 300, returnBeforeBps: 500, returnAfterBps: 300 });
    expect(r.retirementYears).toBe(80);
    expect(r.requiredAtRetirement).toBeGreaterThan(0);
  });
  it('ค่าสุดขอบทุกตัว: ได้ผลที่อยู่ในช่วงปลอดภัย หรือ RangeError ชัดเจน (ไม่เพี้ยนเงียบ)', () => {
    const big: RetirementInput = { currentAge: 18, retireAge: 30, lifeExpectancy: 110, monthlyExpense: 100_000_000, inflationBps: 1000, returnBeforeBps: 0, returnAfterBps: 0, currentSavings: 0 };
    try {
      const r = computeRetirement(big);
      for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
    }
  });
});

describe('ตัวแปลงอัตรา parseRateToBps (R18 ข้อ 18.6)', () => {
  it('"3"→300, "3.5"→350, "3.55"→355, "0"→0, "100"→10000, "00.5"→50, "0.00"→0', () => {
    expect(parseRateToBps('3')).toBe(300);
    expect(parseRateToBps('3.5')).toBe(350);
    expect(parseRateToBps('3.55')).toBe(355);
    expect(parseRateToBps(' 4 ')).toBe(400);
    expect(parseRateToBps('0')).toBe(0);
    expect(parseRateToBps('0.00')).toBe(0);
    expect(parseRateToBps('100')).toBe(10_000);
    expect(parseRateToBps('00.5')).toBe(50);
  });
  it('ปฏิเสธ: ทศนิยมเกิน 2, ว่าง, ติดลบ, -0, 1e2, "3.", ".5", ตัวอักษร, NaN, %, ลูกน้ำ, ช่องว่างกลาง, +', () => {
    for (const bad of ['3.555', '', '   ', '-0', '-0.00', '--1', '-', '-.5', '-1.', '- 1', '1e2', '3.', '.5', 'abc', 'NaN', '3%', '3,5', '3 .5', '+3', '1000', '-1000']) {
      expect(parseRateToBps(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('รับค่าติดลบ (ผลตอบแทนติดลบ ตามที่เจ้าของอนุมัติ): "-2"→-200, "-0.5"→-50, "-4.55"→-455, "-5"→-500', () => {
    expect(parseRateToBps('-2')).toBe(-200);
    expect(parseRateToBps('-0.5')).toBe(-50);
    expect(parseRateToBps('-4.55')).toBe(-455);
    expect(parseRateToBps(' -5 ')).toBe(-500);
    expect(parseRateToBps('-0.01')).toBe(-1);
  });
  it('0.1 + 0.2 แบบ float ไม่เกิดขึ้น: "0.3" = 30 · "4.35" = 435 ตรงตัว', () => {
    expect(parseRateToBps('0.3')).toBe(30);
    expect(parseRateToBps('4.35')).toBe(435);
  });
});

describe('ฟอร์ม: แปลงข้อความเป็นจำนวนเต็มที่ขอบ UI', () => {
  const filled = (over: Partial<RetirementForm> = {}): RetirementForm => ({
    ...emptyRetirementForm(), currentAge: '30', lifeExpectancy: '85', monthlyExpense: '10,000', inflation: '0', returnBefore: '0', returnAfter: '0', ...over,
  });
  it('ค่าเริ่มต้น: อายุเกษียณ 60 เงินเฟ้อ 3% · ผลตอบแทน/อายุคาดการณ์/ค่าใช้จ่าย/อายุตอนนี้ ว่างต้องกรอก (ไม่มีค่าเริ่มต้นที่ดูเหมือนคำสัญญา)', () => {
    const f = emptyRetirementForm();
    expect(f.retireAge).toBe('60');
    expect(f.inflation).toBe('3');
    expect(f.returnBefore).toBe('');
    expect(f.returnAfter).toBe('');
    const r = buildRetirementInput(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field).sort()).toEqual(['currentAge', 'lifeExpectancy', 'monthlyExpense', 'returnAfter', 'returnBefore']);
  });
  it('กรอกครบ: ผลตรงกับตัวคำนวณ (10,000 บาท = 1,000,000 สตางค์)', () => {
    const r = buildRetirementInput(filled());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.input.monthlyExpense).toBe(1_000_000);
    expect(r.result.monthlySaving).toBe(833_334);
  });
  it('ค่าผิดชี้เป็นรายช่อง', () => {
    const fields = (over: Partial<RetirementForm>) => {
      const r = buildRetirementInput(filled(over));
      return r.ok ? [] : r.errors.map((e) => e.field);
    };
    expect(fields({ currentAge: '30.5' })).toContain('currentAge');
    expect(fields({ currentAge: '-5' })).toContain('currentAge');
    expect(fields({ currentAge: '10' })).toContain('currentAge');
    expect(fields({ retireAge: '25' })).toContain('retireAge');
    expect(fields({ lifeExpectancy: '55' })).toContain('lifeExpectancy');
    expect(fields({ inflation: '10.01' })).toContain('inflation');
    expect(fields({ inflation: '-1' })).toContain('inflation'); // เงินเฟ้อติดลบไม่รับ
    expect(fields({ returnBefore: '-5.01' })).toContain('returnBefore');
    expect(fields({ returnAfter: '15.01' })).toContain('returnAfter');
    expect(fields({ retireAge: '81' })).toContain('retireAge');
    expect(fields({ lifeExpectancy: '111' })).toContain('lifeExpectancy');
    expect(fields({ inflation: '3%' })).toContain('inflation');
    expect(fields({ returnBefore: '40' })).toContain('returnBefore');
    expect(fields({ returnBefore: '-5', returnAfter: '-5', inflation: '10' })).toEqual([]);
    expect(fields({ monthlyExpense: '-100' })).toContain('monthlyExpense');
    expect(fields({ monthlyExpense: '0' })).toContain('monthlyExpense');
    expect(fields({ monthlyExpense: '2000000' })).toContain('monthlyExpense'); // เกิน 1 ล้านบาท/เดือน
    expect(fields({ currentSavings: 'abc' })).toContain('currentSavings');
    expect(fields({ currentSavings: '-1' })).toContain('currentSavings');
  });
  it('เงินออมปัจจุบันว่าง = ไม่ใช้ (0) · ใส่แล้วนำไปคำนวณ', () => {
    const a = buildRetirementInput(filled({ currentSavings: '' }));
    const b = buildRetirementInput(filled({ currentSavings: '1,000,000' }));
    if (!a.ok || !b.ok) throw new Error('ควรผ่าน');
    expect(a.input.currentSavings).toBeUndefined();
    expect(b.input.currentSavings).toBe(100_000_000);
    expect(b.result.monthlySaving).toBeLessThan(a.result.monthlySaving);
  });
  it('ผลที่ใหญ่เกินแสดงไม่ได้ ไม่ทำให้ฟังก์ชันโยน: คืนข้อผิดพลาดรายช่อง', () => {
    const r = buildRetirementInput(filled({ currentAge: '18', retireAge: '30', lifeExpectancy: '110', monthlyExpense: '1000000', inflation: '10', returnBefore: '-5', returnAfter: '-5' }));
    expect(typeof r.ok).toBe('boolean');
  });
});

describe('ไม่แตะสมุดบัญชี และไม่มี float/สูตรเงินนอก domain (R1, R2, R8, R16, R18)', () => {
  const src = import.meta.glob(['/src/domain/retirement/projection.ts', '/src/domain/money/rate.ts', '/src/domain/retirement/display.ts', '/src/app/retirementForm.ts', '/src/ui/RetirementView.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const stripped = Object.entries(src).map(([p, t]) => [p, t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')] as const);
  const get = (name: string) => stripped.find(([p]) => p.endsWith(name))![1];
  it('มีไฟล์ครบ', () => expect(stripped).toHaveLength(5));
  it('ไม่ใช้ parseFloat / toFixed / Math.* / เลขทศนิยมลอยตัว ในโค้ดคำนวณ ตัวแปลงอัตรา และฟอร์ม', () => {
    for (const [p, t] of stripped) expect(t, p).not.toMatch(/parseFloat|toFixed|Math\./);
    expect(get('projection.ts')).not.toMatch(/\b\d+\.\d+\b/);
    expect(get('rate.ts')).toMatch(/\* 100 \+/); // คำนวณด้วยจำนวนเต็ม: ส่วนจำนวนเต็ม x 100 + ทศนิยมสองหลัก
  });
  it('โดเมนเกษียณไม่ import ledger/storage/ui (ไม่เปลี่ยน cashBalance, SAFE-TO-SPEND, รายรับรายจ่าย)', () => {
    expect(get('projection.ts')).not.toMatch(/from '\.\.\/ledger|from '\.\.\/\.\.\/storage|from '\.\.\/\.\.\/ui|from '\.\.\/bills|from '\.\.\/invest/);
  });
  it('หน้าจอไม่มีสูตรเงิน: เรียกผ่าน buildRetirementInput เท่านั้น ไม่คูณ/หารยอดเอง', () => {
    const view = get('RetirementView.tsx');
    expect(view).toContain('buildRetirementInput');
    expect(view).not.toMatch(/computeRetirement|\*\*|\bBigInt\b/);
  });
});

describe('คำเตือนบังคับและคำต้องห้าม (R18 ข้อ 18.1)', () => {
  const view = Object.values(import.meta.glob('/src/ui/RetirementView.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  const form = Object.values(import.meta.glob('/src/app/retirementForm.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  it('หน้าจอใช้ข้อความเตือนบังคับและข้อจำกัดทุกครั้งที่มีผลลัพธ์ · แสดงสมมติฐานคู่ผลลัพธ์', async () => {
    const { RETIREMENT_DISCLAIMER, RETIREMENT_LIMITATIONS } = await import('../../src/app/retirementForm');
    expect(RETIREMENT_DISCLAIMER).toContain('ประมาณการ');
    expect(RETIREMENT_DISCLAIMER).toContain('ไม่ใช่ยอดในบัญชีของคุณ');
    expect(RETIREMENT_DISCLAIMER).toContain('ไม่ใช่คำแนะนำการลงทุน');
    expect(RETIREMENT_DISCLAIMER).toContain('ไม่ใช่การรับประกันผลลัพธ์');
    expect(RETIREMENT_LIMITATIONS).toMatch(/ภาษี.*ค่าธรรมเนียม.*บำนาญ.*อายุยืน|ภาษี.*ค่าธรรมเนียม.*บำนาญ/);
    const resultSection = view.slice(view.indexOf('rt-result-title'));
    expect(resultSection).toContain('RETIREMENT_DISCLAIMER');
    expect(resultSection).toContain('RETIREMENT_LIMITATIONS');
    expect(resultSection).toContain('สมมติฐานที่ใช้');
    expect(resultSection).toContain('realReturnNegativeAfter');
    expect((resultSection.match(/\(ประมาณการ\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it('ไม่มีคำที่สื่อว่ารับประกัน (ยกเว้นประโยคปฏิเสธ "ไม่ใช่การรับประกัน")', () => {
    const text = (view + form).replace(/ไม่ใช่การรับประกันผลลัพธ์/g, '').replace(/ไม่มีการรับประกัน/g, '');
    for (const w of ['รับประกัน', 'การันตี', 'แน่นอน', 'ปลอดภัยแน่', 'จะได้', 'เกษียณสบาย']) expect(text, w).not.toContain(w);
  });
  it('ผลตอบแทนไม่มีค่าเริ่มต้นในฟอร์ม', () => {
    expect(emptyRetirementForm().returnBefore).toBe('');
    expect(emptyRetirementForm().returnAfter).toBe('');
  });
});

describe('R18 ตามมติเจ้าของ 12 พ.ย. 2569: ปัดขึ้นเฉพาะเงินเก็บต่อเดือน · เงินที่ต้องมีปัดครึ่งขึ้น', () => {
  const flat: RetirementInput[] = [
    { ...base, returnBeforeBps: 500, returnAfterBps: 300 },
    { ...base, currentAge: 45, retireAge: 65, lifeExpectancy: 90, monthlyExpense: 1_234_567, returnBeforeBps: 700, returnAfterBps: 100, currentSavings: 9_000_000 },
    { ...base, currentAge: 59, retireAge: 60, lifeExpectancy: 61, returnBeforeBps: 1200, returnAfterBps: 1200 },
    { ...base, currentAge: 50, retireAge: 55, lifeExpectancy: 70, monthlyExpense: 777_777, returnBeforeBps: 250, returnAfterBps: 475 },
  ];
  it('เงินที่ต้องมี (ไม่มีเงินเฟ้อ เงินถอนเป็นจำนวนเต็ม) = ปัดครึ่งขึ้นของค่าแท้ ไม่ใช่ปัดขึ้น', () => {
    for (const c of flat) expect(computeRetirement(c).requiredAtRetirement, JSON.stringify(c)).toBe(Number(exact(c).required));
  });
  it('มีอย่างน้อยหนึ่งชุดที่ปัดครึ่งขึ้นกับปัดขึ้นให้ค่าต่างกัน (เทสต์นี้แยกสองแบบออกจริง)', () => {
    expect(flat.some((c) => exact(c).exactPv.ceil() !== exact(c).required)).toBe(true);
  });
  it('เงินเก็บต่อเดือนยังปัดขึ้น: คูณ 360 งวด (อัตรา 0%) ไม่น้อยกว่าส่วนที่ขาด และลดลง 1 สตางค์แล้วไม่พอ', () => {
    const r = computeRetirement(base);
    expect(r.monthlySaving * 360).toBeGreaterThanOrEqual(r.shortfall);
    expect((r.monthlySaving - 1) * 360).toBeLessThan(r.shortfall);
  });
});

describe('ผลตอบแทนติดลบ (-5% ถึง 0%) ตามที่เจ้าของอนุมัติ', () => {
  it('ก่อนเกษียณ -5%: ต้องเก็บมากกว่า 0% และตรงกับค่าแท้ (ต่างไม่เกิน 2 สตางค์เมื่อไม่มีเงินเฟ้อ)', () => {
    const neg: RetirementInput = { ...base, returnBeforeBps: -500 };
    const r = computeRetirement(neg);
    expect(r.monthlySaving).toBeGreaterThan(computeRetirement(base).monthlySaving);
    expect(Math.abs(r.monthlySaving - Number(exact(neg).monthly))).toBeLessThanOrEqual(2);
    expect(r.requiredAtRetirement).toBe(300_000_000); // ผลตอบแทนก่อนเกษียณไม่กระทบเงินที่ต้องมี
  });
  it('หลังเกษียณ -5%: ต้องมีเงินมากกว่า 0% และตรงกับค่าแท้ · มีคำเตือน real return', () => {
    const neg: RetirementInput = { ...base, returnAfterBps: -500 };
    const r = computeRetirement(neg);
    expect(r.requiredAtRetirement).toBeGreaterThan(300_000_000);
    expect(Math.abs(r.requiredAtRetirement - Number(exact(neg).required))).toBeLessThanOrEqual(2);
    expect(r.realReturnNegativeAfter).toBe(true);
  });
  it('เงินออมเดิมหดลงเมื่อผลตอบแทนก่อนเกษียณติดลบ แต่ไม่ติดลบเป็นยอด', () => {
    const r = computeRetirement({ ...base, returnBeforeBps: -500, currentSavings: 100_000_000 });
    expect(r.currentSavingsAtRetirement).toBeLessThan(100_000_000);
    expect(r.currentSavingsAtRetirement).toBeGreaterThan(0);
  });
  it('-5% ทั้งสองช่วงและค่าสุดขอบ (เงินเฟ้อ 10%) ได้ผลจำนวนเต็มปลอดภัย หรือ RangeError ชัดเจน', () => {
    try {
      const r = computeRetirement({ currentAge: 18, retireAge: 80, lifeExpectancy: 110, monthlyExpense: 1_000_000, inflationBps: 1000, returnBeforeBps: -500, returnAfterBps: -500 });
      for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
    }
  });
});
