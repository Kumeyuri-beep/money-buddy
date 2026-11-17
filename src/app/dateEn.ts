/**
 * วันที่ภาษาอังกฤษสำหรับโหมด /invest (ปีคริสต์ศักราช) · ข้อความล้วนจาก YYYY-MM-DD ไม่ใช้ Date จึงไม่ขึ้นกับเขตเวลา · ไม่มีสูตรเงิน
 */
export const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-16" → "16 Nov 2026" · รูปแบบผิด = RangeError (ไม่เดา) */
export function formatDateEn(iso: string): string {
  const m = ISO.exec(iso);
  const month = m ? Number(m[2]) : 0;
  if (!m || month < 1 || month > 12) throw new RangeError(`วันที่ไม่ถูกต้อง: ${iso}`);
  return `${Number(m[3])} ${MONTHS_EN[month - 1]} ${m[1]}`;
}

/** "2026-11-16" → "16 Nov" */
export function formatDayMonthEn(iso: string): string {
  return formatDateEn(iso).split(' ').slice(0, 2).join(' ');
}
