import { describe, expect, it } from 'vitest';
import { msUntilNextThaiMidnight } from '../../src/app/dates';
import { greetingFor, thaiHeaderDate } from '../../src/app/greeting';

/** เวลาไทย (UTC+7) เป็นหลักเสมอ ไม่ขึ้นกับเขตเวลาของเครื่อง · เดือนใช้เลข 1-12 */
const pad = (n: number) => String(n).padStart(2, '0');
const at = (h: number, min = 0, y = 2026, mo = 11, d = 2) =>
  new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(min)}:00+07:00`);

describe('greetingFor: คำทักทายตามช่วงเวลาไทย', () => {
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

  it('ใช้เวลาไทย ไม่ใช่ UTC หรือเวลาเครื่อง: 00:30 ไทย (17:30 UTC วันก่อน) เป็นตอนค่ำ', () => {
    expect(greetingFor(new Date('2026-11-01T17:30:00Z'))).toBe('สวัสดีตอนค่ำ');
    // 09:00 ไทย = 02:00 UTC ต้องเป็นตอนเช้า
    expect(greetingFor(new Date('2026-11-02T02:00:00Z'))).toBe('สวัสดีตอนเช้า');
    // 18:00 ไทย = 11:00 UTC ต้องเป็นตอนเย็น (ไม่ใช่ตอนเช้า)
    expect(greetingFor(new Date('2026-11-02T11:00:00Z'))).toBe('สวัสดีตอนเย็น');
  });
});

describe('thaiHeaderDate: วันที่หัวหน้า "จันทร์ 2 พ.ย. 2569" ตามเวลาไทย', () => {
  it('แสดงวันในสัปดาห์ วันที่ เดือนย่อ และปี พ.ศ.', () => {
    expect(thaiHeaderDate(at(12))).toBe('จันทร์ 2 พ.ย. 2569');
  });

  it('วันที่ 1 หลักไม่เติมศูนย์นำ', () => {
    expect(thaiHeaderDate(at(12, 0, 2026, 1, 5))).toBe('จันทร์ 5 ม.ค. 2569');
  });

  it('วันสิ้นเดือนและสิ้นปี', () => {
    expect(thaiHeaderDate(at(12, 0, 2026, 12, 31))).toBe('พฤหัสบดี 31 ธ.ค. 2569');
    expect(thaiHeaderDate(at(12, 0, 2026, 10, 31))).toBe('เสาร์ 31 ต.ค. 2569');
  });

  it('ปีอธิกสุรทิน 29 ก.พ.', () => {
    expect(thaiHeaderDate(at(12, 0, 2028, 2, 29))).toBe('อังคาร 29 ก.พ. 2571');
  });

  it('ขอบเที่ยงคืนไทย: 16:59:59 UTC ยังเป็นวันเดิม 17:00:00 UTC เป็นวันใหม่', () => {
    expect(thaiHeaderDate(new Date('2026-11-30T16:59:59Z'))).toBe('จันทร์ 30 พ.ย. 2569');
    expect(thaiHeaderDate(new Date('2026-11-30T17:00:00Z'))).toBe('อังคาร 1 ธ.ค. 2569');
    expect(thaiHeaderDate(new Date('2026-12-31T17:00:00Z'))).toBe('ศุกร์ 1 ม.ค. 2570');
  });

  it('ครบ 12 เดือนย่อ', () => {
    const labels = Array.from({ length: 12 }, (_, m) => thaiHeaderDate(at(12, 0, 2026, m + 1, 15)).split(' ')[2]);
    expect(labels).toEqual(['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']);
  });
});

describe('msUntilNextThaiMidnight: เวลาที่เหลือถึงเที่ยงคืนไทย (ใช้ตั้งเวลาให้ "วันนี้" อัปเดตเอง)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it('ก่อนเที่ยงคืนไทย 1 นาที = 60 วินาที', () => {
    expect(msUntilNextThaiMidnight(new Date('2026-11-30T16:59:00Z'))).toBe(60_000);
  });
  it('พอดีเที่ยงคืนไทย = เหลืออีกทั้งวัน (ไม่ใช่ 0 กันตั้งเวลาวน)', () => {
    expect(msUntilNextThaiMidnight(new Date('2026-11-30T17:00:00Z'))).toBe(DAY);
  });
  it('หลังเที่ยงคืนไทย 1 มิลลิวินาที', () => {
    expect(msUntilNextThaiMidnight(new Date('2026-11-30T17:00:00.001Z'))).toBe(DAY - 1);
  });
  it('เที่ยงวันไทย = เหลือ 12 ชั่วโมง', () => {
    expect(msUntilNextThaiMidnight(at(12))).toBe(12 * 60 * 60 * 1000);
  });
  it('ผลอยู่ในช่วง (0, 1 วัน] เสมอ', () => {
    for (const iso of ['2026-02-28T23:59:59Z', '2028-02-29T00:00:00Z', '2026-12-31T16:59:59.999Z']) {
      const ms = msUntilNextThaiMidnight(new Date(iso));
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(DAY);
    }
  });
});
