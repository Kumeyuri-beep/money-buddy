/** วันที่ตามเวลาเครื่องผู้ใช้ รูปแบบ YYYY-MM-DD (ไม่ใช้ toISOString เพราะเป็นเวลา UTC และวันที่จะเพี้ยนช่วงเช้าตรู่ในไทย) */
export function localIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ช่วงวันที่ของเดือนที่ date อยู่ (เปรียบเทียบเป็นข้อความได้เพราะวันสูงสุดคือ 31) */
export function monthRange(date: Date = new Date()): { from: string; to: string } {
  const prefix = localIsoDate(date).slice(0, 7);
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
