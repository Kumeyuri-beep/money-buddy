/**
 * ตัวแปลงอัตรา % ต่อปี จากข้อความผู้ใช้ เป็น basis points จำนวนเต็ม (1% = 100) · ที่ขอบ UI เท่านั้น (R2, ร่าง R18 ข้อ 18.6)
 * รับเฉพาะ ^\d{1,3}(\.\d{1,2})?$ หลัง trim · คำนวณด้วยจำนวนเต็ม ไม่ใช้ parseFloat/toFixed
 * ปฏิเสธ (คืน null ไม่ปัดเงียบ): ว่าง, ติดลบ, ทศนิยมเกิน 2 ตำแหน่ง, 1e2, 3., .5, มี % ลูกน้ำ ช่องว่างกลาง, ตัวอักษร
 */
const RATE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function parseRateToBps(text: string): number | null {
  const m = RATE.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
