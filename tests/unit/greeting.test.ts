import { describe, expect, it } from 'vitest';
import { greetingFor, thaiHeaderDate } from '../../src/app/greeting';

/** เวลาตามเครื่องผู้ใช้ (ไม่ใช่ UTC) เดือนใช้เลข 1-12 */
const at = (h: number, min = 0, y = 2026, mo = 11, d = 2) => new Date(y, mo - 1, d, h, min);

describe('greetingFor: คำทักทายตามช่วงเวลา', () => {
  it('ตอนเช้า 05:00 - 11:59', () => {
    expect(greetingFor(at(5, 0))).toBe('สวัสดีตอนเช้า');
    expect(greetingFor(at(11, 59))).toBe('สวัสดีตอนเช้า');
  });

  it('ตอนบ่าย 12:00 - 16:59', () => {
    expect(greetingFor(at(12, 0))).toBe('สวัสดีตอนบ่าย');
    expect(greetingFor(at(16, 59))).toBe('สวัสดีตอนบ่าย');
  });

  it('ตอนเย็น 17:00 - 20:59', () => {
    expect(greetingFor(at(17, 0))).toBe('สวัสดีตอนเย็น');
    expect(greetingFor(at(20, 59))).toBe('สวัสดีตอนเย็น');
  });

  it('ตอนค่ำ 21:00 - 04:59 (รวมเที่ยงคืน)', () => {
    expect(greetingFor(at(21, 0))).toBe('สวัสดีตอนค่ำ');
    expect(greetingFor(at(0, 0))).toBe('สวัสดีตอนค่ำ');
    expect(greetingFor(at(4, 59))).toBe('สวัสดีตอนค่ำ');
  });

  it('ใช้เวลาตามเครื่อง ไม่ใช่ UTC: 00:30 ของวันใหม่ยังเป็นตอนค่ำ', () => {
    expect(greetingFor(new Date(2026, 10, 2, 0, 30))).toBe('สวัสดีตอนค่ำ');
  });
});

describe('thaiHeaderDate: วันที่หัวหน้า "จันทร์ 2 พ.ย. 2569"', () => {
  it('แสดงวันในสัปดาห์ วันที่ เดือนย่อ และปี พ.ศ.', () => {
    expect(thaiHeaderDate(new Date(2026, 10, 2))).toBe('จันทร์ 2 พ.ย. 2569');
  });

  it('วันที่ 1 หลักไม่เติมศูนย์นำ', () => {
    expect(thaiHeaderDate(new Date(2026, 0, 5))).toBe('จันทร์ 5 ม.ค. 2569');
  });

  it('วันสิ้นเดือนและสิ้นปี', () => {
    expect(thaiHeaderDate(new Date(2026, 11, 31))).toBe('พฤหัสบดี 31 ธ.ค. 2569');
    expect(thaiHeaderDate(new Date(2026, 9, 31))).toBe('เสาร์ 31 ต.ค. 2569');
  });

  it('ปีอธิกสุรทิน 29 ก.พ.', () => {
    expect(thaiHeaderDate(new Date(2028, 1, 29))).toBe('อังคาร 29 ก.พ. 2571');
  });

  it('ครบ 12 เดือนย่อ', () => {
    const labels = Array.from({ length: 12 }, (_, m) => thaiHeaderDate(new Date(2026, m, 15)).split(' ')[2]);
    expect(labels).toEqual(['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']);
  });
});
