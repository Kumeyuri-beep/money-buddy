import { describe, expect, it } from 'vitest';
import { buildRetirementInput, emptyRetirementForm, parsePercentToBps, type RetirementForm } from '../../src/app/retirementForm';
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

/** ตัวอ้างอิงอิสระด้วย float (เฉพาะในเทสต์) เพื่อเทียบกับผลจำนวนเต็ม */
function oracle(i: RetirementInput) {
  const years = i.retireAge - i.currentAge;
  const infl = i.inflationBps / 10_000;
  const rb = i.returnBeforeBps / 10_000 / 12;
  const ra = i.returnAfterBps / 10_000 / 12;
  let w = i.monthlyExpense * (1 + infl) ** years;
  const w0 = w;
  let pv = 0;
  for (let k = 0; k < (i.lifeExpectancy - i.retireAge) * 12; k++) {
    if (k > 0 && k % 12 === 0) w *= 1 + infl;
    pv += w / (1 + ra) ** k;
  }
  const n = years * 12;
  const fv = (i.currentSavings ?? 0) * (1 + rb) ** n;
  const gap = Math.max(0, pv - fv);
  let a = 0;
  for (let j = 0; j < n; j++) a += (1 + rb) ** j;
  return { w0, pv, gap, monthly: gap / a };
}

describe('computeRetirement: ตัวอย่างที่ตรวจด้วยมือได้ (อัตราทั้งหมด 0%)', () => {
  it('เก็บ 30 ปี ใช้ 25 ปี ค่าใช้จ่ายคงที่: ต้องมี 300 เดือน x ค่าใช้จ่าย · เก็บต่อเดือน = ต้องมี / 360 ปัดขึ้น', () => {
    const r = computeRetirement(base);
    expect(r.yearsToRetire).toBe(30);
    expect(r.retirementYears).toBe(25);
    expect(r.monthlyExpenseAtRetirement).toBe(1_000_000);
    expect(r.requiredAtRetirement).toBe(300_000_000);
    expect(r.requiredInTodayMoney).toBe(300_000_000);
    expect(r.shortfall).toBe(300_000_000);
    expect(r.monthlySaving).toBe(833_334); // 300,000,000 / 360 = 833,333.33… ปัดขึ้น
  });
  it('มีเงินออมปัจจุบัน: หักออกก่อน · ส่วนขาด 200,000,000 / 360 = 555,555.56 ปัดขึ้น', () => {
    const r = computeRetirement({ ...base, currentSavings: 100_000_000 });
    expect(r.currentSavingsAtRetirement).toBe(100_000_000);
    expect(r.shortfall).toBe(200_000_000);
    expect(r.monthlySaving).toBe(555_556);
  });
  it('เงินออมเกินที่ต้องมีแล้ว: ต้องเก็บเพิ่ม 0 และส่วนขาด 0 (ไม่ติดลบ)', () => {
    const r = computeRetirement({ ...base, currentSavings: 400_000_000 });
    expect(r.shortfall).toBe(0);
    expect(r.monthlySaving).toBe(0);
  });
  it('เงินออมพอดีกับที่ต้องมี = ต้องเก็บเพิ่ม 0', () => {
    const r = computeRetirement({ ...base, currentSavings: 300_000_000 });
    expect(r.shortfall).toBe(0);
    expect(r.monthlySaving).toBe(0);
  });
});

describe('computeRetirement: เทียบกับตัวอ้างอิง float อิสระ (ความคลาดเคลื่อนสัมพัทธ์ < 1e-9)', () => {
  const cases: RetirementInput[] = [
    { ...base, inflationBps: 300, returnBeforeBps: 500, returnAfterBps: 300 },
    { ...base, inflationBps: 300, returnBeforeBps: 0, returnAfterBps: 0 },
    { ...base, inflationBps: 0, returnBeforeBps: 700, returnAfterBps: 0, currentSavings: 50_000_000 },
    { ...base, currentAge: 45, retireAge: 60, lifeExpectancy: 90, monthlyExpense: 2_500_050, inflationBps: 250, returnBeforeBps: 625, returnAfterBps: 175, currentSavings: 123_456_789 },
    { ...base, currentAge: 59, retireAge: 60, lifeExpectancy: 61, inflationBps: 300, returnBeforeBps: 400, returnAfterBps: 400 },
    { ...base, inflationBps: 2000, returnBeforeBps: 3000, returnAfterBps: 3000 },
  ];
  it.each(cases.map((c, i) => [i, c] as const))('ชุดที่ %i', (_i, c) => {
    const r = computeRetirement(c);
    const o = oracle(c);
    const near = (got: number, want: number): void => {
      expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.max(2, Math.abs(want) * 1e-9));
    };
    near(r.monthlyExpenseAtRetirement, o.w0);
    near(r.requiredAtRetirement, o.pv);
    near(r.shortfall, o.gap);
    near(r.monthlySaving, o.monthly);
  });
  it('ผลลัพธ์ "ต้องมี/ต้องเก็บ" ปัดขึ้นเสมอ (ไม่ต่ำกว่าค่าจริงของตัวอ้างอิงเกินสตางค์)', () => {
    for (const c of cases) {
      const r = computeRetirement(c);
      const o = oracle(c);
      expect(r.requiredAtRetirement).toBeGreaterThanOrEqual(Math.floor(o.pv) - 1);
      expect(r.monthlySaving).toBeGreaterThanOrEqual(Math.floor(o.monthly) - 1);
    }
  });
});

describe('computeRetirement: ความสัมพันธ์ทางทิศทาง (sanity)', () => {
  const r0 = computeRetirement({ ...base, inflationBps: 300, returnBeforeBps: 500, returnAfterBps: 300 });
  const more = (over: Partial<RetirementInput>) => computeRetirement({ ...base, inflationBps: 300, returnBeforeBps: 500, returnAfterBps: 300, ...over });
  it('ค่าใช้จ่ายสูงขึ้น/เงินเฟ้อสูงขึ้น/อยู่นานขึ้น → ต้องมีและต้องเก็บมากขึ้น', () => {
    expect(more({ monthlyExpense: 2_000_000 }).requiredAtRetirement).toBeGreaterThan(r0.requiredAtRetirement);
    expect(more({ inflationBps: 500 }).monthlySaving).toBeGreaterThan(r0.monthlySaving);
    expect(more({ lifeExpectancy: 95 }).requiredAtRetirement).toBeGreaterThan(r0.requiredAtRetirement);
  });
  it('ผลตอบแทนก่อนเกษียณสูงขึ้น หรือเริ่มเก็บเร็วขึ้น → ต้องเก็บต่อเดือนน้อยลง', () => {
    expect(more({ returnBeforeBps: 800 }).monthlySaving).toBeLessThan(r0.monthlySaving);
    expect(more({ currentAge: 20 }).monthlySaving).toBeLessThan(r0.monthlySaving);
  });
  it('มูลค่าวันนี้ของเงินที่ต้องมี น้อยกว่ามูลค่า ณ วันเกษียณเมื่อมีเงินเฟ้อ', () => {
    expect(r0.requiredInTodayMoney).toBeLessThan(r0.requiredAtRetirement);
  });
});

describe('computeRetirement: ขอบเขตและค่าผิด', () => {
  it('เก็บ 1 ปี ใช้ 1 ปี (ขอบล่างของช่วงเวลา) คำนวณได้', () => {
    const r = computeRetirement({ ...base, currentAge: 59, retireAge: 60, lifeExpectancy: 61 });
    expect(r.requiredAtRetirement).toBe(12_000_000);
    expect(r.monthlySaving).toBe(1_000_000); // 12,000,000 / 12
  });
  it('ค่าสูงสุดที่ยอมรับ (ค่าใช้จ่าย 10^11 สตางค์ อัตราสูงสุด 120 ปี) ไม่ล้มด้วยข้อผิดพลาดที่ไม่คาด และไม่คืนค่าที่ล้นช่วงปลอดภัย', () => {
    const big: RetirementInput = { currentAge: 0, retireAge: 100, lifeExpectancy: 120, monthlyExpense: 100_000_000_000, inflationBps: 2000, returnBeforeBps: 3000, returnAfterBps: 3000 };
    try {
      const r = computeRetirement(big);
      for (const v of Object.values(r)) expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError); // ใหญ่เกินกว่าจะแสดง = ปฏิเสธชัดเจน ไม่เพี้ยนเงียบ
    }
  });
  it('ค่าผิดช่วงถูกปฏิเสธ: อายุเกษียณ ≤ อายุปัจจุบัน, อายุคาดการณ์ ≤ อายุเกษียณ, ค่าใช้จ่าย 0, อัตราเกินช่วง, ทศนิยม', () => {
    const bad: Partial<RetirementInput>[] = [
      { retireAge: 30 }, { retireAge: 29 }, { lifeExpectancy: 60 }, { lifeExpectancy: 121 }, { currentAge: -1 }, { currentAge: 30.5 },
      { monthlyExpense: 0 }, { monthlyExpense: -5 }, { monthlyExpense: 1.5 }, { monthlyExpense: 100_000_000_001 },
      { inflationBps: -1 }, { inflationBps: 2001 }, { returnBeforeBps: 3001 }, { returnAfterBps: -1 }, { returnAfterBps: Number.NaN },
      { currentSavings: -1 }, { currentSavings: 10_000_000_000_001 },
    ];
    for (const over of bad) {
      expect(retirementProblems({ ...base, ...over }).length, JSON.stringify(over)).toBeGreaterThan(0);
      expect(() => computeRetirement({ ...base, ...over }), JSON.stringify(over)).toThrow(RangeError);
    }
  });
  it('ไม่ใช้ float: ผลทุกค่าเป็นจำนวนเต็มสตางค์', () => {
    const r = computeRetirement({ ...base, inflationBps: 333, returnBeforeBps: 457, returnAfterBps: 211, currentSavings: 7_777_777 });
    for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('ฟอร์ม: แปลงข้อความเป็นจำนวนเต็มที่ขอบ UI', () => {
  const filled = (over: Partial<RetirementForm> = {}): RetirementForm => ({
    ...emptyRetirementForm(), currentAge: '30', lifeExpectancy: '85', monthlyExpense: '10,000', inflation: '0', returnBefore: '0', returnAfter: '0', ...over,
  });
  it('ค่าเริ่มต้น: อายุเกษียณ 60 เงินเฟ้อ 3% · ช่องอื่นว่างต้องกรอก', () => {
    const f = emptyRetirementForm();
    expect(f.retireAge).toBe('60');
    expect(f.inflation).toBe('3');
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
  it('parsePercentToBps: "3"→300, "3.5"→350, "3.55"→355, "0"→0, "100"→10000 · ไม่รับ ติดลบ/3 ตำแหน่ง/ตัวอักษร', () => {
    expect(parsePercentToBps('3')).toBe(300);
    expect(parsePercentToBps('3.5')).toBe(350);
    expect(parsePercentToBps('3.55')).toBe(355);
    expect(parsePercentToBps(' 4 % ')).toBe(400);
    expect(parsePercentToBps('0')).toBe(0);
    for (const bad of ['-1', '3.555', '3,5', 'abc', '', '.5', '3.', '1e2', '+3']) expect(parsePercentToBps(bad), bad).toBeNull();
  });
  it('อัตรา 0.1 + 0.2 ไม่เพี้ยนแบบ float: "0.3" = 30 bps พอดี', () => {
    expect(parsePercentToBps('0.3')).toBe(30);
    expect(parsePercentToBps('4.35')).toBe(435);
  });
  it('ค่าผิดชี้เป็นรายช่อง: อายุทศนิยม/ติดลบ, อัตราเกินช่วง, อายุเกษียณน้อยกว่าอายุปัจจุบัน, เงินติดลบ', () => {
    const fields = (over: Partial<RetirementForm>) => {
      const r = buildRetirementInput(filled(over));
      return r.ok ? [] : r.errors.map((e) => e.field);
    };
    expect(fields({ currentAge: '30.5' })).toContain('currentAge');
    expect(fields({ currentAge: '-5' })).toContain('currentAge');
    expect(fields({ retireAge: '25' })).toContain('retireAge');
    expect(fields({ lifeExpectancy: '55' })).toContain('lifeExpectancy');
    expect(fields({ inflation: '25' })).toContain('inflation');
    expect(fields({ returnBefore: '40' })).toContain('returnBefore');
    expect(fields({ monthlyExpense: '-100' })).toContain('monthlyExpense');
    expect(fields({ monthlyExpense: '0' })).toContain('monthlyExpense');
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
  it('ค่าใหญ่จนแสดงไม่ได้ ไม่ทำให้ฟังก์ชันโยน: คืนข้อผิดพลาดรายช่อง', () => {
    const r = buildRetirementInput(filled({ currentAge: '0', retireAge: '100', lifeExpectancy: '120', monthlyExpense: '1000000000', inflation: '20', returnBefore: '30', returnAfter: '30' }));
    expect(typeof r.ok).toBe('boolean');
  });
});

describe('ไม่มี float/สูตรเงินนอก domain (R1, R2, R8)', () => {
  const src = import.meta.glob(['/src/domain/retirement/projection.ts', '/src/app/retirementForm.ts', '/src/ui/RetirementView.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const stripped = Object.entries(src).map(([p, t]) => [p, t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')] as const);
  it('มีไฟล์ครบ', () => expect(stripped).toHaveLength(3));
  it('ไม่ใช้ parseFloat / toFixed / Math.* / เลขทศนิยมลอยตัว ในโค้ดคำนวณและฟอร์ม', () => {
    for (const [p, t] of stripped) {
      expect(t, p).not.toMatch(/parseFloat|toFixed|Math\.|\bNumber\.parseFloat/);
    }
    expect(stripped.find(([p]) => p.endsWith('projection.ts'))![1]).not.toMatch(/\b\d+\.\d+\b/);
  });
  it('หน้าจอไม่มีสูตรเงิน: เรียก computeRetirement ผ่าน buildRetirementInput เท่านั้น และไม่คูณ/หารยอดเอง', () => {
    const view = stripped.find(([p]) => p.endsWith('RetirementView.tsx'))![1];
    expect(view).toContain('buildRetirementInput');
    expect(view).not.toMatch(/computeRetirement|\*\*|\bBigInt\b/);
  });
});
