import { describe, expect, it } from 'vitest';
import {
  formatMonthsTenths,
  formatPercentBps,
  formatSignedBaht,
  formatSignedPercentBps,
  meterPercent,
  sparklinePoints,
} from '../../src/app/overviewFormat';
import { buildOverview } from '../../src/app/overview';
import { satang } from '../../src/domain/money/satang';

describe('formatPercentBps (basis points -> ข้อความ ไม่ใช้ float)', () => {
  it('ค่าปกติ', () => {
    expect(formatPercentBps(2000)).toBe('20.0%');
    expect(formatPercentBps(432)).toBe('4.3%');
    expect(formatPercentBps(10000)).toBe('100.0%');
  });
  it('ขอบเขต: 0, น้อยมาก, ปัดครึ่งออกจากศูนย์', () => {
    expect(formatPercentBps(0)).toBe('0.0%');
    expect(formatPercentBps(1)).toBe('0.0%');
    expect(formatPercentBps(5)).toBe('0.1%');
    expect(formatPercentBps(-5)).toBe('−0.1%');
    expect(formatPercentBps(-4)).toBe('0.0%'); // ไม่ขึ้น −0.0%
  });
  it('ค่าติดลบและเกิน 100%', () => {
    expect(formatPercentBps(-1250)).toBe('−12.5%');
    expect(formatPercentBps(25050)).toBe('250.5%');
  });
});

describe('formatSignedPercentBps', () => {
  it('ใส่ + นำหน้าค่าบวก, ศูนย์ไม่มีเครื่องหมาย', () => {
    expect(formatSignedPercentBps(1234)).toBe('+12.3%');
    expect(formatSignedPercentBps(-1234)).toBe('−12.3%');
    expect(formatSignedPercentBps(0)).toBe('0.0%');
    expect(formatSignedPercentBps(2)).toBe('0.0%');
  });
});

describe('formatMonthsTenths', () => {
  it('จำนวนเดือน x10 -> "4.3 เดือน"', () => {
    expect(formatMonthsTenths(43)).toBe('4.3 เดือน');
    expect(formatMonthsTenths(60)).toBe('6.0 เดือน');
    expect(formatMonthsTenths(0)).toBe('0.0 เดือน');
    expect(formatMonthsTenths(5)).toBe('0.5 เดือน');
    expect(formatMonthsTenths(1205)).toBe('120.5 เดือน');
  });
});

describe('formatSignedBaht', () => {
  it('บวก/ลบ/ศูนย์/1 สตางค์', () => {
    expect(formatSignedBaht(satang(12345))).toBe('+฿123.45');
    expect(formatSignedBaht(satang(-12345))).toBe('−฿123.45');
    expect(formatSignedBaht(satang(0))).toBe('฿0.00');
    expect(formatSignedBaht(satang(1))).toBe('+฿0.01');
  });
});

describe('meterPercent (ความกว้างแถบ 0-100 จำนวนเต็ม)', () => {
  it('ค่าอยู่ในช่วง 0..100 เสมอ', () => {
    expect(meterPercent(0, 2000)).toBe(0);
    expect(meterPercent(1000, 2000)).toBe(50);
    expect(meterPercent(2000, 2000)).toBe(100);
    expect(meterPercent(9000, 2000)).toBe(100);
    expect(meterPercent(-500, 2000)).toBe(0);
  });
  it('เป้า 0 ไม่หารด้วยศูนย์', () => {
    expect(meterPercent(100, 0)).toBe(0);
  });
});

describe('sparklinePoints', () => {
  it('น้อยกว่า 2 จุด = ไม่วาด', () => {
    expect(sparklinePoints([], 100, 20)).toEqual([]);
    expect(sparklinePoints([5], 100, 20)).toEqual([]);
  });
  it('กระจายแกน x เท่ากัน, ค่าสูงสุดอยู่ y=0, ต่ำสุดอยู่ y=สูงสุด', () => {
    expect(sparklinePoints([0, 50, 100], 100, 20)).toEqual([
      { x: 0, y: 20 },
      { x: 50, y: 10 },
      { x: 100, y: 0 },
    ]);
  });
  it('ค่าเท่ากันหมด = เส้นตรงกลาง ไม่หารด้วยศูนย์', () => {
    expect(sparklinePoints([7, 7], 100, 20)).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
  });
  it('ค่าติดลบได้', () => {
    const pts = sparklinePoints([-100, 0], 10, 10);
    expect(pts[0]).toEqual({ x: 0, y: 10 });
    expect(pts[1]).toEqual({ x: 10, y: 0 });
  });
});

describe('โควตากระจกแท้ (CLAUDE.md: ไม่เกิน 8 ใบต่อหน้า)', () => {
  it('การ์ดสรุปมี 8 ใบพอดี (นับจากโครงสร้างที่ buildOverview คืนจริง ไม่ใช่รายการแยก)', () => {
    const { month, ...cards } = buildOverview([], [], '2026-11-14');
    expect(month).toBe('2026-11');
    expect(Object.keys(cards).sort()).toEqual(['income', 'netWorth', 'outgoing', 'runway', 'safeToSpend', 'savingsRate', 'surplus', 'vsLastMonth']);
  });
  it('หน้าภาพรวม: class "glass" (กระจกแท้) อยู่ที่คอมโพเนนต์การ์ดสรุปที่เดียว ที่เหลือใช้ glass-lite หรือ solid', () => {
    const sources = import.meta.glob('/src/ui/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >;
    const hits = Object.entries(sources)
      .filter(([path]) => !/\/(LedgerView|Setup|AddEntryDialog)\.tsx$/.test(path)) // หน้าอื่น นับโควตาแยกต่างหาก
      .filter(([, src]) => /className=\{?["'`][^"'`]*(?<![\w-])glass(?![\w-])/.test(src))
      .map(([path]) => path);
    expect(hits).toEqual(['/src/ui/overview/SummaryCards.tsx']);
  });
});
