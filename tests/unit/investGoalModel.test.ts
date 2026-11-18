import { describe, expect, it } from 'vitest';
import { bpsToInput, draftFromGoal, parseGoalDraft, type GoalDraft } from '../../src/ui/invest/goal/goalDraft';
import { goalAmountsForDisplay, runGoal, type GoalContext } from '../../src/ui/invest/goal/goalModel';
import { sanitizeInvestGoal, type InvestGoal } from '../../src/domain/invest/goalProjection';

/** ข้อมูลสมมติทั้งหมด · วันนี้ = 2026-11-18 */
const TODAY = '2026-11-18';
const goal: InvestGoal = { kind: 'value', targetMinor: 130_000, contributionMinor: 10_000, achieveBy: '2027-11', returnBps: 1_200, inflationBps: 0, currency: 'USD' };
const ctx: GoalContext = { startMinor: 100_000, yieldBps: 300, rateMicro: 35_000_000, suggestedContributionMinor: null };

describe('goalAmountsForDisplay (R26)', () => {
  it('สกุลเดียวกัน = ค่าเดิม', () => {
    expect(goalAmountsForDisplay(goal, 'USD', null)).toEqual({ kind: 'ok', targetMinor: 130_000, contributionMinor: 10_000 });
  });
  it('USD → THB ที่ .5 สตางค์ปัดออกจากศูนย์: 1 เซนต์ เรต 32.500000 → 33 สตางค์', () => {
    expect(goalAmountsForDisplay({ ...goal, targetMinor: 1, contributionMinor: 1 }, 'THB', 32_500_000)).toEqual({ kind: 'ok', targetMinor: 33, contributionMinor: 33 });
  });
  it('ไม่มีเรต = needs-rate (ไม่เดา)', () => {
    expect(goalAmountsForDisplay(goal, 'THB', null)).toEqual({ kind: 'needs-rate' });
  });
  it('เกินช่วงปลอดภัยหลังแปลง = too-large (ไม่โยน ไม่ปัดเงียบ)', () => {
    const big: InvestGoal = { ...goal, targetMinor: 9_000_000_000_000_000 };
    expect(goalAmountsForDisplay(big, 'THB', 35_000_000)).toEqual({ kind: 'too-large' });
  });
});

describe('runGoal', () => {
  it('ตัวอย่างมือ: เป้า 130,000 ถึงเดือนที่ 3 · On track', () => {
    const r = runGoal(goal, ctx, 'USD', TODAY);
    if (r.state !== 'ok') throw new Error(r.state);
    expect(r.months).toBe(3);
    expect(r.status).toBe('on-track');
  });
  it('ไม่มีเรตแต่เป้าตั้งไว้คนละสกุล = needs rate', () => {
    expect(runGoal(goal, { ...ctx, rateMicro: null }, 'THB', TODAY)).toEqual({ state: 'needs', needs: 'rate' });
  });
  it('เป้าเกินช่วงปลอดภัยหลังสลับสกุล = invalid too-large (หน้าไม่พัง)', () => {
    const big: InvestGoal = { ...goal, targetMinor: 9_000_000_000_000_000 };
    expect(runGoal(big, ctx, 'THB', TODAY)).toEqual({ state: 'invalid', reason: 'too-large' });
  });
  it('ไม่มีมูลค่าตลาด = needs value · เป้ารายได้ไม่มี yield = needs yield', () => {
    expect(runGoal(goal, { ...ctx, startMinor: null }, 'USD', TODAY)).toEqual({ state: 'needs', needs: 'value' });
    expect(runGoal({ ...goal, kind: 'income' }, { ...ctx, yieldBps: null }, 'USD', TODAY)).toEqual({ state: 'needs', needs: 'yield' });
  });
  it('เดือนเป้าย้อนหลัง: Behind (ถ้ายังไม่ถึง) และไม่พัง', () => {
    const past: InvestGoal = { ...goal, achieveBy: '2026-01', targetMinor: 900_000 };
    const r = runGoal(past, ctx, 'USD', TODAY);
    if (r.state !== 'ok') throw new Error(r.state);
    expect(r.deadlineMonths).toBe(-10);
    expect(r.status).toBe('behind');
  });
});

const draft: GoalDraft = { kind: 'value', currency: 'USD', target: '100', month: '12', year: '2030', contribution: '', returnPct: '7', inflationPct: '' };
const parse = (p: Partial<GoalDraft>) => parseGoalDraft({ ...draft, ...p }, TODAY);

describe('parseGoalDraft', () => {
  it('ค่าปกติ: เป้า 100.00 → 10,000 หน่วยย่อย · เงินเพิ่มว่าง = 0 · ผลตอบแทน 7% = 700 bps', () => {
    const r = parse({});
    expect(r.ok && r.goal).toMatchObject({ targetMinor: 10_000, contributionMinor: 0, returnBps: 700, inflationBps: 0, achieveBy: '2030-12' });
  });
  it.each(['0', '0.00', '', '-0', '0.005', '1e2'])('เป้า "%s" ถูกปฏิเสธ', (t) => {
    const r = parse({ target: t });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.target).toBeTruthy();
  });
  it('เป้า 0.01 (น้อยสุด) รับได้', () => {
    const r = parse({ target: '0.01' });
    expect(r.ok && r.goal.targetMinor).toBe(1);
  });
  it('เป้าใหญ่มาก "90000000000000.01" ไม่ทำให้พัง: ถูกปฏิเสธหรือรับเป็นจำนวนเต็มปลอดภัยเท่านั้น', () => {
    const r = parse({ target: '90000000000000.01' });
    if (r.ok) expect(Number.isSafeInteger(r.goal.targetMinor)).toBe(true);
    else expect(r.errors.target).toBeTruthy();
  });
  it('เงินเพิ่มติดลบหรือเป็นตัวอักษรถูกปฏิเสธ', () => {
    expect(parse({ contribution: '-5' }).ok).toBe(false);
    expect(parse({ contribution: 'abc' }).ok).toBe(false);
  });
  it('เดือนเป้าย้อนหลังถูกปฏิเสธ · เดือนนี้รับได้', () => {
    const past = parse({ month: '10', year: '2026' });
    expect(!past.ok && past.errors.year).toBe('Choose this month or a later one');
    expect(parse({ month: '11', year: '2026' }).ok).toBe(true);
  });
  it('ผลตอบแทน -0 / นอกช่วง ถูกปฏิเสธ · เงินเฟ้อติดลบถูกปฏิเสธ', () => {
    expect(parse({ returnPct: '-0' }).ok).toBe(false);
    expect(parse({ returnPct: '301' }).ok).toBe(false);
    expect(parse({ returnPct: '-51' }).ok).toBe(false);
    expect(parse({ inflationPct: '-1' }).ok).toBe(false);
  });
});

describe('bpsToInput', () => {
  it('จำนวนเต็มล้วน ไม่ขึ้น "-0"', () => {
    expect(bpsToInput(0)).toBe('0');
    expect(bpsToInput(-0)).toBe('0');
    expect(bpsToInput(-225)).toBe('-2.25');
    expect(bpsToInput(700)).toBe('7');
    expect(bpsToInput(750)).toBe('7.5');
    expect(bpsToInput(-5)).toBe('-0.05');
  });
});

describe('เก็บจำนวน+สกุลตามที่พิมพ์ (R26): ฟอร์มแก้ไขไม่แปลงตามปุ่มสกุล', () => {
  it('เก็บ USD → เปิดมุมมอง THB → ฟอร์มแสดงค่า USD เดิม → Save ไม่แก้ → ได้ค่าและสกุลเดิมทุกบิต', () => {
    const stored: InvestGoal = { kind: 'income', targetMinor: 123_457, contributionMinor: 5_005, achieveBy: '2031-07', returnBps: 725, inflationBps: 250, currency: 'USD' };
    const d = draftFromGoal(stored); // ไม่มีพารามิเตอร์ปุ่มสกุล/เรต: ไม่แปลง
    expect(d.currency).toBe('USD');
    const r = parseGoalDraft(d, TODAY);
    expect(r.ok && r.goal).toEqual(stored);
  });
  it('เก็บ THB ก็ได้ค่าเดิมกลับมาเหมือนกัน', () => {
    const stored: InvestGoal = { kind: 'value', targetMinor: 1, contributionMinor: 0, achieveBy: '2027-01', returnBps: 0, inflationBps: 0, currency: 'THB' };
    const r = parseGoalDraft(draftFromGoal(stored), TODAY);
    expect(r.ok && r.goal).toEqual(stored);
  });
  it('ผู้ใช้เปลี่ยนสกุลในฟอร์มเอง = เก็บตามสกุลที่เลือก (จำนวนที่พิมพ์ไม่ถูกแปลง)', () => {
    const r = parse({ currency: 'THB', target: '100' });
    expect(r.ok && r.goal).toMatchObject({ currency: 'THB', targetMinor: 10_000 });
  });
  it('ข้อมูลเก่าที่ไม่มีรหัสสกุล/ผิดรูป: sanitize ทิ้งทั้งก้อน ไม่โยน (หน้าเริ่มเป็นฟอร์มว่าง)', () => {
    const legacy = { kind: 'value', targetMinor: 1000, contributionMinor: 0, achieveBy: '2030-01', returnBps: 700, inflationBps: 0 };
    expect(() => sanitizeInvestGoal(legacy)).not.toThrow();
    expect(sanitizeInvestGoal(legacy)).toBeUndefined();
  });
});
