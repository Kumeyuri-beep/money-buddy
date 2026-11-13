const THAI_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * "วันนี้" ตามเวลาประเทศไทย (Asia/Bangkok, UTC+7) รูปแบบ YYYY-MM-DD ไม่ขึ้นกับเขตเวลาของเครื่อง (กฎ R15)
 * ฐานข้อมูลใช้เขตเวลาเดียวกัน (private.current_month) เดือนปัจจุบันของเว็บกับฐานข้อมูลจึงตรงกันเสมอ
 * ไม่ใช้ toISOString (เป็น UTC วันที่จะเพี้ยนช่วงเช้าตรู่ในไทย) และไม่ใช้ getFullYear/getMonth/getDate (เวลาเครื่อง)
 */
export function thaiIsoDate(date: Date = new Date()): string {
  const parts = THAI_DATE_FORMAT.formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year').padStart(4, '0')}-${pick('month')}-${pick('day')}`;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** ประเทศไทยใช้ UTC+7 ตลอดปี ไม่มีเวลาออมแสง */
export const THAI_OFFSET_MS = 7 * HOUR_MS;

/**
 * เวลาไทยของ date แยกเป็นส่วนๆ (คำนวณจากเวลา UTC บวก 7 ชั่วโมง ไม่ใช้เขตเวลาของเครื่อง)
 * weekday: 0 = อาทิตย์ · month: 1-12
 */
export function thaiClock(date: Date = new Date()): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const t = new Date(date.getTime() + THAI_OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    weekday: t.getUTCDay(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/** มิลลิวินาทีที่เหลือถึงเที่ยงคืนไทยครั้งถัดไป (อยู่ในช่วง 1 ถึง 1 วัน พอดีเที่ยงคืน = เหลืออีกทั้งวัน) */
export function msUntilNextThaiMidnight(date: Date = new Date()): number {
  const intoDay = (((date.getTime() + THAI_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - intoDay;
}

/** ช่วงวันที่ของเดือนที่ date อยู่ (เปรียบเทียบเป็นข้อความได้เพราะวันสูงสุดคือ 31) */
export function monthRange(date: Date = new Date()): { from: string; to: string } {
  const prefix = thaiIsoDate(date).slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-31` };
}

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d ?? 1);
}

/** "13 พฤศจิกายน 2569" (วัน เดือนเต็ม ปี พ.ศ.) สำหรับแสดงวันที่เต็มในหน้าโปรไฟล์ */
export function thaiFullDate(iso: string): string {
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }).format(fromIso(iso));
}

/** "อา. 1 พ.ย." สำหรับหัวข้อวันในหน้ารายการ */
export function thaiDayLabel(iso: string): string {
  return new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }).format(fromIso(iso));
}

/** 'YYYY-MM' -> "พฤศจิกายน 2569" */
export function thaiMonthKeyLabel(monthKey: string): string {
  return thaiMonthLabel(fromIso(`${monthKey}-01`));
}

/** "พฤศจิกายน 2569" */
/** date ต้องเป็นวันที่ที่สร้างจากเวลาเครื่อง (เช่น fromIso) เท่านั้น: จัดรูปแบบด้วยเขตเวลาเครื่อง ไม่ใช่เวลาไทย จึงไม่มีค่าเริ่มต้นเป็นเวลาปัจจุบัน */
export function thaiMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(date);
}

/** เลื่อนวันที่ YYYY-MM-DD ไปข้างหน้า (บวก) หรือย้อนหลัง (ลบ) ด้วยการคำนวณแบบ UTC จึงไม่เพี้ยนเพราะเขตเวลา */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${t.getUTCFullYear()}-${mm}-${dd}`;
}
