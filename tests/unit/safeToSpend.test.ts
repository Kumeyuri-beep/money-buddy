import { describe, expect, it } from 'vitest';
import { computeSafeToSpend } from '../../src/domain/bills/safeToSpend';

// ข้อมูลทั้งหมดสมมติ ยอดเป็นสตางค์ (R15: (ยอดกระเป๋าที่ใช้จ่ายได้ − บิลค้างก่อนเงินเดือนถัดไป − เงินสำรอง) ÷ วันที่เหลือ)
const base = { spendable: 300_000, outstanding: 50_000, reserve: 100_000, today: '2026-11-05', payDay: 25 };

describe('computeSafeToSpend: กรณีปกติ', () => {
  it('(3,000 − 500 − 1,000) บาท ÷ 20 วัน = 75 บาท/วัน', () => {
    expect(computeSafeToSpend(base)).toEqual({
      kind: 'ok',
      perDay: 7_500,
      available: 150_000,
      daysLeft: 20,
      nextPayday: '2026-11-25',
    });
  });

  it('วันที่เหลือ: วันก่อนเงินเดือน = 1 วัน (นับรวมวันนี้)', () => {
    const r = computeSafeToSpend({ ...base, today: '2026-11-24' });
    expect(r.daysLeft).toBe(1);
    expect(r.perDay).toBe(150_000);
  });

  it('วันนี้คือวันเงินเดือน: ถือว่าเงินเข้าแล้ว ถัดไปคือเดือนหน้า (30 วัน)', () => {
    const r = computeSafeToSpend({ ...base, today: '2026-11-25' });
    expect(r.nextPayday).toBe('2026-12-25');
    expect(r.daysLeft).toBe(30);
    expect(r.perDay).toBe(5_000);
  });

  it('ก.พ. ปีอธิกสุรทิน: 15 ก.พ. 2028 ถึงก่อน 1 มี.ค. = 15 วัน', () => {
    const r = computeSafeToSpend({ ...base, today: '2028-02-15', payDay: 1 });
    expect(r.nextPayday).toBe('2028-03-01');
    expect(r.daysLeft).toBe(15);
  });

  it('วันเงินเดือน 31 ในเดือนสั้น: เงินเดือนออก 28 ก.พ. (18 วัน จาก 10 ก.พ.)', () => {
    const r = computeSafeToSpend({ ...base, today: '2026-02-10', payDay: 31 });
    expect(r.nextPayday).toBe('2026-02-28');
    expect(r.daysLeft).toBe(18);
  });

  it('ข้ามปี: 26 ธ.ค. (เลยวันเงินเดือนแล้ว) ถึงก่อนเงินเดือน 25 ม.ค. = 30 วัน', () => {
    const r = computeSafeToSpend({ ...base, today: '2026-12-26', payDay: 25 });
    expect(r.nextPayday).toBe('2027-01-25');
    expect(r.daysLeft).toBe(30);
  });

  it('ก่อนวันเงินเดือนในเดือนเดียวกัน (20 ธ.ค.) ยังไม่ข้ามปี = 5 วัน', () => {
    const r = computeSafeToSpend({ ...base, today: '2026-12-20', payDay: 25 });
    expect(r.nextPayday).toBe('2026-12-25');
    expect(r.daysLeft).toBe(5);
  });
});

describe('computeSafeToSpend: ปัดเศษต่อวัน (R8 ปัดครึ่งออกจากศูนย์ ด้วยตัวปัดกลาง)', () => {
  const threeDays = { spendable: 0, outstanding: 0, reserve: 0, today: '2026-11-22', payDay: 25 }; // 22, 23, 24 = 3 วัน
  const twoDays = { ...threeDays, today: '2026-11-23' };

  it('100 สตางค์ ÷ 3 วัน = 33.33 -> 33', () => {
    expect(computeSafeToSpend({ ...threeDays, spendable: 100 }).perDay).toBe(33);
  });

  it('200 สตางค์ ÷ 3 วัน = 66.67 -> 67', () => {
    expect(computeSafeToSpend({ ...threeDays, spendable: 200 }).perDay).toBe(67);
  });

  it('5 สตางค์ ÷ 2 วัน = 2.5 -> 3 (ครึ่งปัดขึ้น)', () => {
    expect(computeSafeToSpend({ ...twoDays, spendable: 5 }).perDay).toBe(3);
  });
});

describe('computeSafeToSpend: ผลเป็นศูนย์และติดลบ (ห้ามแสดงตัวเลขติดลบเป็นเงินที่ใช้ได้)', () => {
  it('คงเหลือพอดีศูนย์ -> ok ใช้ได้ 0 ไม่ถือว่าขาด', () => {
    const r = computeSafeToSpend({ ...base, spendable: 150_000 });
    expect(r).toMatchObject({ kind: 'ok', perDay: 0, available: 0 });
  });

  it('ยอดน้อยมาก 1 สตางค์ ÷ 20 วัน -> ใช้ได้ 0 (ok)', () => {
    const r = computeSafeToSpend({ ...base, spendable: 150_001 });
    expect(r).toMatchObject({ kind: 'ok', perDay: 0, available: 1 });
  });

  it('บิลค้างมากกว่าเงินที่มี -> shortfall perDay = 0 พร้อมจำนวนที่ขาด', () => {
    const r = computeSafeToSpend({ spendable: 100_000, outstanding: 150_000, reserve: 0, today: '2026-11-05', payDay: 25 });
    expect(r).toEqual({ kind: 'shortfall', perDay: 0, available: -50_000, shortfall: 50_000, daysLeft: 20, nextPayday: '2026-11-25' });
  });

  it('เงินสำรองเกินที่มี 1 สตางค์ -> shortfall 1', () => {
    const r = computeSafeToSpend({ spendable: 100_000, outstanding: 0, reserve: 100_001, today: '2026-11-05', payDay: 25 });
    expect(r).toMatchObject({ kind: 'shortfall', perDay: 0, shortfall: 1 });
  });

  it('กระเป๋าติดลบ (เบิกเกิน) -> shortfall รวมยอดติดลบเข้าไปด้วย', () => {
    const r = computeSafeToSpend({ spendable: -500, outstanding: 1_000, reserve: 0, today: '2026-11-05', payDay: 25 });
    expect(r).toMatchObject({ kind: 'shortfall', perDay: 0, shortfall: 1_500 });
  });

  it('ทุกอย่างเป็นศูนย์ -> ok 0', () => {
    expect(computeSafeToSpend({ ...base, spendable: 0, outstanding: 0, reserve: 0 })).toMatchObject({ kind: 'ok', perDay: 0 });
  });

  it('ทุกชุดข้อมูลที่ลอง: perDay ไม่เคยติดลบ และ kind สอดคล้องกับ available', () => {
    for (const spendable of [-1_000_000, -1, 0, 1, 999, 1_000_000]) {
      for (const outstanding of [0, 1, 500_000, 2_000_000]) {
        for (const reserve of [0, 1, 700_000]) {
          const r = computeSafeToSpend({ spendable, outstanding, reserve, today: '2026-11-05', payDay: 25 });
          expect(r.perDay).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(r.perDay)).toBe(true);
          expect(r.kind === 'shortfall').toBe(spendable - outstanding - reserve < 0);
        }
      }
    }
  });
});

describe('computeSafeToSpend: ยอดใหญ่และข้อมูลเข้าผิดรูป', () => {
  it('ยอดใกล้ MAX_SAFE_INTEGER ไม่โยนข้อผิดพลาด และคืนจำนวนเต็ม', () => {
    const r = computeSafeToSpend({ ...base, spendable: Number.MAX_SAFE_INTEGER, outstanding: 0, reserve: 0 });
    expect(r.kind).toBe('ok');
    expect(r.perDay).toBe(450_359_962_737_050);
  });

  it('ผลต่างเกินช่วงปลอดภัย -> RangeError ไม่ปัดเงียบ', () => {
    expect(() =>
      computeSafeToSpend({ spendable: -Number.MAX_SAFE_INTEGER, outstanding: Number.MAX_SAFE_INTEGER, reserve: 0, today: '2026-11-05', payDay: 25 }),
    ).toThrow(RangeError);
  });

  it('ยอดไม่ใช่จำนวนเต็ม/NaN/Infinity -> RangeError', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeSafeToSpend({ ...base, spendable: bad })).toThrow(RangeError);
      expect(() => computeSafeToSpend({ ...base, outstanding: bad })).toThrow(RangeError);
      expect(() => computeSafeToSpend({ ...base, reserve: bad })).toThrow(RangeError);
    }
  });

  it('บิลค้างหรือเงินสำรองติดลบ -> RangeError (ติดลบได้เฉพาะยอดกระเป๋า)', () => {
    expect(() => computeSafeToSpend({ ...base, outstanding: -1 })).toThrow(RangeError);
    expect(() => computeSafeToSpend({ ...base, reserve: -1 })).toThrow(RangeError);
  });

  it('วันเงินเดือนหรือวันนี้ไม่ถูกต้อง -> RangeError', () => {
    expect(() => computeSafeToSpend({ ...base, payDay: 0 })).toThrow(RangeError);
    expect(() => computeSafeToSpend({ ...base, payDay: 32 })).toThrow(RangeError);
    expect(() => computeSafeToSpend({ ...base, today: '2026-02-30' })).toThrow(RangeError);
  });
});
