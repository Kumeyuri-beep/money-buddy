import { describe, expect, it } from 'vitest';
import { formatHundredBaht, roundToHundredBaht } from '../../src/domain/retirement/display';

describe('แสดงผลปัดเป็นหลักร้อยบาท (R18 มติเจ้าของ 12 พ.ย. 2569)', () => {
  it('ปัดครึ่งขึ้นเป็นหลักร้อยบาท (10,000 สตางค์): 0, 4,999, 5,000, 14,999, 15,000', () => {
    expect(roundToHundredBaht(0, 'nearest')).toBe(0);
    expect(roundToHundredBaht(4_999, 'nearest')).toBe(0);
    expect(roundToHundredBaht(5_000, 'nearest')).toBe(10_000);
    expect(roundToHundredBaht(14_999, 'nearest')).toBe(10_000);
    expect(roundToHundredBaht(15_000, 'nearest')).toBe(20_000);
  });
  it('ปัดขึ้น (เงินเก็บต่อเดือน ไม่ให้เก็บขาด): 0 คงเดิม, 1 → 100 บาท, 10,000 ลงตัวไม่ +1, 10,001 → 200 บาท', () => {
    expect(roundToHundredBaht(0, 'up')).toBe(0);
    expect(roundToHundredBaht(1, 'up')).toBe(10_000);
    expect(roundToHundredBaht(10_000, 'up')).toBe(10_000);
    expect(roundToHundredBaht(10_001, 'up')).toBe(20_000);
  });
  it('ค่าใหญ่เกิน 2^53 หลังปัด ติดลบ ทศนิยม NaN Infinity -0 = RangeError ไม่ปัดเงียบ', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => roundToHundredBaht(bad, 'nearest'), String(bad)).toThrow(RangeError);
    }
    expect(() => roundToHundredBaht(Number.MAX_SAFE_INTEGER, 'up')).toThrow(RangeError);
    expect(roundToHundredBaht(Number.MAX_SAFE_INTEGER - 10_000, 'nearest') % 10_000).toBe(0);
  });
  it('ข้อความ: 1,234,567 สตางค์ (12,345.67 บาท) → ฿12,300 (ใกล้สุด) / ฿12,400 (ปัดขึ้น) · 0 → ฿0 · ไม่มีทศนิยม', () => {
    expect(formatHundredBaht(1_234_567, 'nearest')).toBe('฿12,300');
    expect(formatHundredBaht(1_234_567, 'up')).toBe('฿12,400');
    expect(formatHundredBaht(0, 'up')).toBe('฿0');
    expect(formatHundredBaht(123_456_789_000, 'nearest')).toBe('฿1,234,567,900'); // 1,234,567,890 บาท → หลักร้อย
  });
});

describe('หน้าจอเกษียณใช้ตัวปัดแสดงผลและมีคำเตือน', () => {
  const view = Object.values(import.meta.glob('/src/ui/RetirementView.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  it('เงินเก็บต่อเดือนใช้ปัดขึ้น ค่าอื่นปัดใกล้สุด ไม่แสดงผลลัพธ์เป็นสตางค์ละเอียด', () => {
    const section = view.slice(view.indexOf('rt-result-title'));
    expect(section).toContain("formatHundredBaht(result.result.monthlySaving, 'up')");
    expect(section).toContain("formatHundredBaht(result.result.requiredAtRetirement, 'nearest')");
    expect(section).toContain("formatHundredBaht(result.result.requiredInTodayMoney, 'nearest')");
    expect(section).toContain("formatHundredBaht(result.result.monthlyExpenseAtRetirement, 'nearest')");
    expect(section).toContain('formatHundredBahtNonZero(result.result.shortfall)');
    expect(section).toContain("formatHundredBaht(result.result.currentSavingsAtRetirement, 'nearest')");
    expect(section).toContain('RETIREMENT_ROUNDING_NOTE');
    expect(section).not.toMatch(/baht\(result\.result\./);
  });
  it('คำเตือนการปัด: บอกว่าปัดหลักร้อยบาท เป็นการประมาณ และเงินเก็บต่อเดือนปัดขึ้น', async () => {
    const { RETIREMENT_ROUNDING_NOTE } = await import('../../src/app/retirementForm');
    expect(RETIREMENT_ROUNDING_NOTE).toContain('หลักร้อยบาท');
    expect(RETIREMENT_ROUNDING_NOTE).toContain('ประมาณ');
    expect(RETIREMENT_ROUNDING_NOTE).toContain('ปัดขึ้น');
  });
});

describe('ส่วนที่ยังขาดเล็กมาก', () => {
  it('ค่าบวกที่ปัดแล้วเป็น 0 แสดง "น้อยกว่า ฿100" · 0 แสดง ฿0 · ค่าปกติเหมือนเดิม', async () => {
    const { formatHundredBahtNonZero } = await import('../../src/domain/retirement/display');
    expect(formatHundredBahtNonZero(1)).toBe('น้อยกว่า ฿100');
    expect(formatHundredBahtNonZero(4_999)).toBe('น้อยกว่า ฿100');
    expect(formatHundredBahtNonZero(0)).toBe('฿0');
    expect(formatHundredBahtNonZero(5_000)).toBe('฿100');
  });
});
