/**
 * ตรวจไฟล์รูปสลิปและคำนวณขนาดย่อ (ฟังก์ชันล้วน ไม่แตะ DOM)
 * รูปไม่ถูกส่งออกนอกเครื่องและไม่ถูกเก็บ ส่วนที่แตะรูปจริงอยู่ใน src/ocr/
 */

export const MAX_SLIP_BYTES = 15 * 1024 * 1024;
export const MAX_SLIP_SIDE = 1600;

export type SlipFileCheck = { ok: true } | { ok: false; message: string };

/** รับเฉพาะรูปแรสเตอร์ (SVG ไม่รับ เพราะไม่ใช่สลิปที่แคปมาและอาจมีสคริปต์) */
export function validateSlipFile(file: { type: string; size: number }): SlipFileCheck {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
    return { ok: false, message: 'ไฟล์นี้ไม่ใช่รูปภาพ เลือกรูปสลิปที่เป็น PNG หรือ JPEG' };
  }
  if (file.size <= 0) return { ok: false, message: 'ไฟล์ว่างเปล่า เลือกรูปสลิปอีกครั้ง' };
  if (file.size > MAX_SLIP_BYTES) {
    return { ok: false, message: 'ไฟล์ใหญ่เกิน 15 MB ลองแคปหน้าจอสลิปใหม่แทนรูปต้นฉบับ' };
  }
  return { ok: true };
}

export interface FittedSize {
  width: number;
  height: number;
  /** true เมื่อรูปถูกย่อ */
  scaled: boolean;
}

/** ย่อให้ด้านยาวไม่เกิน max โดยรักษาสัดส่วน ไม่ขยายรูปเล็ก ด้านสั้นปัดลงและไม่ต่ำกว่า 1px */
export function fitWithin(width: number, height: number, max: number = MAX_SLIP_SIDE): FittedSize {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`ขนาดรูปไม่ถูกต้อง: ${String(width)}x${String(height)}`);
  }
  const long = Math.max(width, height);
  if (long <= max) return { width, height, scaled: false };
  const shrink = (side: number) => Math.max(1, Math.floor((side * max) / long));
  return width >= height
    ? { width: max, height: shrink(height), scaled: true }
    : { width: shrink(width), height: max, scaled: true };
}
