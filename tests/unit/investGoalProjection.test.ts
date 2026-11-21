import { describe, expect, it } from 'vitest';
import {
  averageMonthlyBuysUsd,
  goalStatus,
  investGoalProblem,
  monthsUntil,
  progressBps,
  projectGoal,
  reachYear,
  realReturnBps,
  sanitizeInvestGoal,
  type GoalInput,
  type InvestGoal,
} from '../../src/domain/invest/goalProjection';
import { emptyInvestments, type InvestmentData, type TradeRecord } from '../../src/domain/invest/types';

/** ตัวอย่างมือ R28 (ข้อมูลสมมติ): V0 = 100,000 · C = 10,000 · r = 1,200 (1%/เดือน) · y = 300 */
const base: GoalInput = { startMinor: 100_000, contributionMinor: 10_000, returnBps: 1_200, inflationBps: 0, yieldBps: 300, kind: 'value', targetMinor: 130_000 };
const ok = (r: ReturnType<typeof projectGoal>) => {
  if (r.kind !== 'ok') throw new Error(`ต้องคำนวณได้ แต่ได้ ${r.reason}`);
  return r;
};

describe('R28: ตัวอย่างมือ', () => {
  it('V1=111,000 V2=122,110 V3=133,331 (123,331.1 ปัดลง) · เป้ามูลค่า 130,000 ถึงเดือนที่ 3', () => {
    const r = ok(projectGoal({ ...base, targetMinor: 130_000 }, { horizonMonths: 12 }));
    expect(r.months).toBe(3);
    // จุดที่เดือน 0 และเดือนที่ถึงเป้า (เดือน 3 = 133,331)
    expect(r.path.find((p) => p.month === 3)?.valueMinor).toBe(133_331);
    expect(r.path.find((p) => p.month === 0)?.valueMinor).toBe(100_000);
    // เป้าที่ใหญ่ขึ้นเพื่อดูทีละเดือน: ถึงเมื่อ >= 111,000 ที่เดือน 1, >= 122,110 ที่เดือน 2
    expect(ok(projectGoal({ ...base, targetMinor: 111_000 })).months).toBe(1);
    expect(ok(projectGoal({ ...base, targetMinor: 111_001 })).months).toBe(2);
    expect(ok(projectGoal({ ...base, targetMinor: 122_110 })).months).toBe(2);
    expect(ok(projectGoal({ ...base, targetMinor: 122_111 })).months).toBe(3);
  });
  it('เป้ารายได้ 300/เดือน: k=1 ได้ 277.5 ปัดเป็น 278 (ยังไม่ถึง) · k=2 ได้ 305.275 ปัดเป็น 305 ถึงเมื่อ k=2', () => {
    const r = ok(projectGoal({ ...base, kind: 'income', targetMinor: 300 }));
    expect(r.months).toBe(2);
    expect(ok(projectGoal({ ...base, kind: 'income', targetMinor: 278 })).months).toBe(1);
    expect(ok(projectGoal({ ...base, kind: 'income', targetMinor: 279 })).months).toBe(2);
    expect(r.incomeNowMinor).toBe(250); // 100,000 x 300 / 120,000 = 250 พอดี
  });
  it('Portfolio needed: เป้ามูลค่า = เป้า · เป้ารายได้ = ปัด(T x 120,000 / y)', () => {
    expect(ok(projectGoal(base)).neededMinor).toBe(130_000);
    expect(ok(projectGoal({ ...base, kind: 'income', targetMinor: 300 })).neededMinor).toBe(120_000); // 300 x 120,000 / 300
    expect(ok(projectGoal({ ...base, kind: 'income', targetMinor: 1, yieldBps: 7 })).neededMinor).toBe(17_143); // 120,000/7 = 17,142.86 ปัดขึ้น
  });
});

describe('R28: ขอบเขต', () => {
  it('เป้า 0 หรือถึงแล้วตั้งแต่วันนี้ = เดือน 0', () => {
    expect(ok(projectGoal({ ...base, targetMinor: 0 })).months).toBe(0);
    expect(ok(projectGoal({ ...base, targetMinor: 100_000 })).months).toBe(0);
    expect(ok(projectGoal({ ...base, kind: 'income', targetMinor: 0 })).months).toBe(0);
  });
  it('ไม่ถึงใน 1,200 เดือน = null (r=0 และ C=0 กับเป้าสูงกว่า V0)', () => {
    expect(ok(projectGoal({ ...base, returnBps: 0, contributionMinor: 0, targetMinor: 100_001 })).months).toBeNull();
  });
  it('ถึงพอดีเดือนที่ 1,200 = 1,200 · เกินจากนั้น = null (C=1 ต่อเดือน r=0 เป้า V0+1,200 / V0+1,201)', () => {
    const f = { ...base, startMinor: 0, returnBps: 0, contributionMinor: 1 };
    expect(ok(projectGoal({ ...f, targetMinor: 1_200 })).months).toBe(1_200);
    expect(ok(projectGoal({ ...f, targetMinor: 1_201 })).months).toBeNull();
  });
  it('เริ่มจากศูนย์ (ยังไม่มีหุ้น) คำนวณจากเงินเพิ่มรายเดือนได้', () => {
    expect(ok(projectGoal({ ...base, startMinor: 0, targetMinor: 25_000 })).months).toBe(3); // 10,000 → 20,100 → 30,301
  });
  it('ผลตอบแทนติดลบ: มูลค่าลดลงเดือนละ (ปัดครึ่งออกจากศูนย์)', () => {
    const r = ok(projectGoal({ ...base, returnBps: -1_200, contributionMinor: 0, targetMinor: 0 }, { horizonMonths: 12 }));
    expect(r.path.find((p) => p.month === 12)?.valueMinor).toBeLessThan(100_000);
  });
  it('เงินเฟ้อ: i = r → r_real = 0 · i = 0 → r เดิม · สูตร roundHalfUp((10,000+r) x 10,000 / (10,000+i)) − 10,000', () => {
    expect(realReturnBps(500, 500)).toBe(0);
    expect(realReturnBps(1_200, 0)).toBe(1_200);
    expect(realReturnBps(700, 300)).toBe(388); // 10,700 x 10,000 / 10,300 = 10,388.35 → 10,388
    expect(realReturnBps(300, 700)).toBe(-374); // 10,300 x 10,000 / 10,700 = 9,626.17 → 9,626
    expect(realReturnBps(-1_000, 500)).toBe(-1_429); // 9,000 x 10,000 / 10,500 = 8,571.43 → 8,571 → −1,429
    const r = ok(projectGoal({ ...base, returnBps: 1_200, inflationBps: 1_200, contributionMinor: 0, targetMinor: 100_001 }));
    expect(r.realReturnBps).toBe(0);
    expect(r.months).toBeNull(); // r_real = 0 และ C = 0 กับเป้าสูงกว่า V0
  });
  it('ไม่มีข้อมูล: ไม่มีมูลค่าเริ่มต้น = no-value · เป้ารายได้แต่ไม่มี yield = no-yield (ไม่เดา)', () => {
    expect(projectGoal({ ...base, startMinor: null })).toEqual({ kind: 'na', reason: 'no-value' });
    expect(projectGoal({ ...base, kind: 'income', yieldBps: null })).toEqual({ kind: 'na', reason: 'no-yield' });
    // เป้ามูลค่าไม่ต้องใช้ yield
    expect(ok(projectGoal({ ...base, yieldBps: null })).incomeNowMinor).toBeNull();
  });
  it('ค่าติดลบ/เกินช่วง/ไม่ใช่จำนวนเต็ม ถูกปฏิเสธ (invalid)', () => {
    const bad = [
      { startMinor: -1 }, { contributionMinor: -1 }, { targetMinor: -1 }, { returnBps: -5_001 }, { returnBps: 30_001 }, { inflationBps: -1 }, { inflationBps: 10_001 },
      { contributionMinor: 1.5 }, { targetMinor: Number.MAX_SAFE_INTEGER + 1 }, { yieldBps: -1 }, { yieldBps: 10_001 },
    ];
    for (const b of bad) expect(projectGoal({ ...base, ...b }), JSON.stringify(b)).toEqual({ kind: 'na', reason: 'invalid' });
  });
  it('ตัวเลขใหญ่เกินช่วงปลอดภัยก่อนถึงเป้า = too-large (ไม่ปัดเงียบ)', () => {
    const r = projectGoal({ ...base, startMinor: Number.MAX_SAFE_INTEGER - 1, returnBps: 30_000, targetMinor: Number.MAX_SAFE_INTEGER });
    expect(r).toEqual({ kind: 'na', reason: 'too-large' });
  });
  it('yield 0 กับเป้ารายได้ > 0 = ไม่ถึง (null) และ Portfolio needed = null', () => {
    const r = ok(projectGoal({ ...base, kind: 'income', yieldBps: 0, targetMinor: 100 }));
    expect(r.months).toBeNull();
    expect(r.neededMinor).toBeNull();
  });
});

describe('ปีและสถานะ', () => {
  it('reachYear = ปีปฏิทินของวันนี้ + k เดือน', () => {
    expect(reachYear('2026-11-18', 0)).toBe(2026);
    expect(reachYear('2026-11-18', 1)).toBe(2026);
    expect(reachYear('2026-11-18', 2)).toBe(2027);
    expect(reachYear('2026-01-31', 11)).toBe(2026);
    expect(reachYear('2026-01-31', 12)).toBe(2027);
  });
  it('monthsUntil: จำนวนเดือนจากเดือนนี้ถึงเดือนเป้า (ย้อนหลัง = ติดลบ)', () => {
    expect(monthsUntil('2026-11-18', '2026-11')).toBe(0);
    expect(monthsUntil('2026-11-18', '2035-12')).toBe(109);
    expect(monthsUntil('2026-11-18', '2026-10')).toBe(-1);
  });
  it('goalStatus: ถึงเป้าภายในกำหนด = on-track · เกิน/ไม่ถึง = behind', () => {
    expect(goalStatus(109, 109)).toBe('on-track');
    expect(goalStatus(110, 109)).toBe('behind');
    expect(goalStatus(null, 109)).toBe('behind');
    expect(goalStatus(0, 0)).toBe('on-track');
    expect(goalStatus(1, -1)).toBe('behind');
  });
});

describe('ค่าเริ่มต้นเงินเพิ่มรายเดือนจากรายการซื้อจริง', () => {
  let seq = 0;
  const buy = (date: string, amount: number, over: Partial<TradeRecord> = {}): TradeRecord => ({ id: `t${++seq}`, assetId: 'us1', kind: 'buy', date, createdAt: `${date}T03:00:00.000Z`, units: '100000000', priceMicro: 1_000_000, amount, fee: 5, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over });
  const data = (trades: TradeRecord[]): InvestmentData => ({ ...emptyInvestments(), assets: [{ id: 'us1', name: 'US1', kind: 'stock', accountId: 'a', currency: 'USD' }, { id: 'th1', name: 'TH1', kind: 'fund', accountId: 'b' }], trades });
  it('ไม่มีรายการซื้อ = null', () => {
    expect(averageMonthlyBuysUsd(data([]), '2026-11-18')).toBeNull();
  });
  it('รวมยอดซื้อ 12 เดือนล่าสุด (ไม่รวมค่าธรรมเนียม) ÷ 12 ปัดครึ่งออกจากศูนย์ · นอกช่วง ปันผล ขาย และสินทรัพย์บาทไม่นับ', () => {
    const d = data([
      buy('2026-11-18', 10_000),
      buy('2026-01-05', 20_005),
      buy('2025-11-18', 99_999), // วันตัดช่วง (ไม่รวมวันเริ่ม)
      buy('2025-11-19', 5),
      buy('2026-11-19', 777), // อนาคต
      buy('2026-06-01', 888, { kind: 'sell' }),
      buy('2026-06-01', 999, { kind: 'dividend' }),
      buy('2026-06-01', 555, { assetId: 'th1' }),
    ]);
    // 10,000 + 20,005 + 5 = 30,010 → 30,010 / 12 = 2,500.83 → 2,501
    expect(averageMonthlyBuysUsd(d, '2026-11-18')).toBe(2_501);
  });
  it('ซื้อ 6 เซนต์ครั้งเดียว: 0.5 ปัดเป็น 1', () => {
    expect(averageMonthlyBuysUsd(data([buy('2026-11-01', 6)]), '2026-11-18')).toBe(1);
  });
});

describe('ตรวจและทำความสะอาดค่า investGoal (settings)', () => {
  const goal: InvestGoal = { kind: 'income', targetMinor: 5_000, contributionMinor: 18_519, achieveBy: '2035-12', returnBps: 800, inflationBps: 250, currency: 'USD' };
  it('ค่าถูกต้องผ่านและคงเดิม', () => {
    expect(investGoalProblem(goal)).toBeNull();
    expect(sanitizeInvestGoal(goal)).toEqual(goal);
  });
  it('ค่าผิดรูป/เกินช่วงถูกปฏิเสธ', () => {
    const bad: Partial<InvestGoal>[] = [
      { kind: 'x' as never }, { targetMinor: -1 }, { targetMinor: 1.5 }, { contributionMinor: -1 }, { achieveBy: '2035-13' }, { achieveBy: '1999-12' }, { achieveBy: '2201-01' }, { achieveBy: '2035-1' },
      { returnBps: -5_001 }, { returnBps: 30_001 }, { returnBps: 1.5 }, { inflationBps: -1 }, { inflationBps: 10_001 }, { currency: 'EUR' as never },
    ];
    for (const b of bad) {
      expect(investGoalProblem({ ...goal, ...b }), JSON.stringify(b)).not.toBeNull();
      expect(sanitizeInvestGoal({ ...goal, ...b }), JSON.stringify(b)).toBeUndefined();
    }
  });
  it('ข้อมูลภายนอกที่ไม่ใช่ออบเจ็กต์ หรือมีฟิลด์แปลกปลอม: ทิ้ง/ตัดฟิลด์เกิน', () => {
    expect(sanitizeInvestGoal(null)).toBeUndefined();
    expect(sanitizeInvestGoal('x')).toBeUndefined();
    expect(sanitizeInvestGoal([])).toBeUndefined();
    expect(sanitizeInvestGoal({ ...goal, evil: 'x'.repeat(5_000) })).toEqual(goal);
  });
});

describe('progressBps (ความคืบหน้าสู่เป้า)', () => {
  it('ปัดครึ่งออกจากศูนย์ · เป้า 0 = null · เกินเป้าได้ · ค่าผิด = null', () => {
    expect(progressBps(250, 1_000)).toBe(2_500);
    expect(progressBps(1, 3)).toBe(3_333); // 3,333.33
    expect(progressBps(2, 3)).toBe(6_667); // 6,666.67
    expect(progressBps(1, 16_000)).toBe(1); // 0.625 ปัดเป็น 1
    expect(progressBps(0, 1_000)).toBe(0);
    expect(progressBps(2_000, 1_000)).toBe(20_000);
    expect(progressBps(5, 0)).toBeNull();
    expect(progressBps(-1, 10)).toBeNull();
  });
});

describe('ขอบเพิ่มเติม (รอบตรวจ #219)', () => {
  it('-0 ถูกปฏิเสธเหมือนค่าผิดรูป (กัน -0 หลุดเข้า settings · R18/R19)', () => {
    expect(projectGoal({ ...base, targetMinor: -0 })).toEqual({ kind: 'na', reason: 'invalid' });
    expect(projectGoal({ ...base, contributionMinor: -0 })).toEqual({ kind: 'na', reason: 'invalid' });
    expect(projectGoal({ ...base, returnBps: -0 })).toEqual({ kind: 'na', reason: 'invalid' });
    expect(projectGoal({ ...base, inflationBps: -0 })).toEqual({ kind: 'na', reason: 'invalid' });
    expect(investGoalProblem({ kind: 'value', targetMinor: -0, contributionMinor: 0, achieveBy: '2030-01', returnBps: 0, inflationBps: 0, currency: 'USD' })).not.toBeNull();
  });

  it('ผลตอบแทนติดลบ r=-1200 (−1%/เดือน) ค่าเป๊ะ: V0=100,000 ไม่มีเงินเพิ่ม → V1=99,000 (ตรวจผ่านรายได้ y=12,000 bps = V/10 ต่อเดือน: เป้า 9,900 ถึงที่เดือน 1)', () => {
    // เป้ารายได้ลดตามมูลค่า จึงถึงเป้า "≥" ตั้งแต่เดือน 0; ใช้ตัวคุมด้วยเงินเพิ่มแทน: V0=98,000, C=1,000 → V1 = roundHalfUp(98,000 x 118,800 / 120,000) + 1,000 = 97,020 + 1,000 = 98,020
    const at = (target: number) => ok(projectGoal({ ...base, startMinor: 98_000, contributionMinor: 1_000, returnBps: -1_200, kind: 'value', targetMinor: target })).months;
    expect(at(98_020)).toBe(1);
    expect(at(98_021)).toBe(2); // V2 = roundHalfUp(98,020 x 0.99) + 1,000 = 97,039.8 → 97,040 + 1,000 = 98,040
    expect(at(98_040)).toBe(2);
    expect(at(98_041)).toBe(3);
    // ไม่มีเงินเพิ่ม: มูลค่าลดลงจริง (เดือน 12 < V0) และเป้าสูงกว่า V0 ไม่ถึง
    const down = ok(projectGoal({ ...base, returnBps: -1_200, contributionMinor: 0, targetMinor: 100_001 }, { horizonMonths: 12 }));
    expect(down.months).toBeNull();
    expect(down.path.find((p) => p.month === 12)?.valueMinor).toBeLessThan(100_000);
  });

  it('realReturnBps ติดลบ: ผลหารลงตัวและ .5 พอดี (ปัดออกจากศูนย์)', () => {
    expect(realReturnBps(-5_000, 10_000)).toBe(-7_500); // 5,000 x 10,000 / 20,000 = 2,500 ... ตรวจด้านล่าง
    // (10,000 + r) x 10,000 / 20,000 = (10,000 + r) / 2 : r = -4,999 → 2,500.5 → 2,501 → 2,501 - 10,000 = -7,499
    expect(realReturnBps(-4_999, 10_000)).toBe(-7_499);
    // r = -5,001 ไม่อยู่ในช่วงของ projectGoal แต่ฟังก์ชันล้วนต้องปัดออกจากศูนย์ตามขนาด: (4,999 / 2 = 2,499.5 → 2,500) - 10,000
    expect(realReturnBps(-5_001, 10_000)).toBe(-7_500);
  });

  it('startMinor = MAX_SAFE_INTEGER เทียบเป้าต่ำกว่า → ถึงแล้ว months=0', () => {
    const r = ok(projectGoal({ ...base, startMinor: Number.MAX_SAFE_INTEGER, targetMinor: 1_000 }));
    expect(r.months).toBe(0);
  });

  it('horizonMonths ผิดค่า (-1, 1.5) = invalid', () => {
    for (const h of [-1, 1.5]) expect(projectGoal(base, { horizonMonths: h })).toEqual({ kind: 'na', reason: 'invalid' });
  });
});

describe('averageMonthlyBuysUsd สิ้นเดือน', () => {
  const one = (date: string): InvestmentData => ({
    ...emptyInvestments(),
    assets: [{ id: 'us1', name: 'US1', kind: 'stock', accountId: 'a', currency: 'USD' }],
    trades: [{ id: 't1', assetId: 'us1', kind: 'buy', date, createdAt: `${date}T03:00:00.000Z`, units: '100000000', priceMicro: 1_000_000, amount: 12_000, fee: 0, withholding: 0, memo: '', fxRateMicro: 35_000_000 }],
  });
  it('วันนี้ 2026-03-31: ซื้อวันนี้นับ · ขอบเริ่ม 2025-03-31 ไม่นับ · 2025-04-01 นับ', () => {
    expect(averageMonthlyBuysUsd(one('2026-03-31'), '2026-03-31')).toBe(1_000);
    expect(averageMonthlyBuysUsd(one('2025-03-31'), '2026-03-31')).toBeNull();
    expect(averageMonthlyBuysUsd(one('2025-04-01'), '2026-03-31')).toBe(1_000);
  });
  it('วันนี้ 2026-02-28: ขอบเริ่ม 2025-02-28 ไม่นับ · 2025-03-01 นับ', () => {
    expect(averageMonthlyBuysUsd(one('2025-02-28'), '2026-02-28')).toBeNull();
    expect(averageMonthlyBuysUsd(one('2025-03-01'), '2026-02-28')).toBe(1_000);
  });
  it('วันนี้ 2024-02-29 (อธิกสุรทิน): ขอบเริ่ม 2023-02-28 ไม่นับ · 2023-03-01 นับ', () => {
    expect(averageMonthlyBuysUsd(one('2023-02-28'), '2024-02-29')).toBeNull();
    expect(averageMonthlyBuysUsd(one('2023-03-01'), '2024-02-29')).toBe(1_000);
  });
});
