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

/** ช่วงวันที่ของเดือนที่ date อยู่ (เปรียบเทียบเป็นข้อความได้เพราะวันสูงสุดคือ 31) */
export function monthRange(date: Date = new Date()): { from: string; to: string } {
  const prefix = thaiIsoDate(date).slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-31` };
}

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d ?? 1);
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
export function thaiMonthLabel(date: Date = new Date()): string {
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
