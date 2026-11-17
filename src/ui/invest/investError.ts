import { codedMessage, hasCode, messageFor } from '../../domain/errors/coded';

const DEFAULT_EN = 'Could not save. Please try again.';

/**
 * ข้อความ error ภาษาอังกฤษสำหรับโหมด /invest (หน้าอื่นใช้ friendlyError ภาษาไทยเหมือนเดิม)
 * มีรหัส = ข้อความอังกฤษจากแม่แบบพร้อมตัวเลข · ไม่มีรหัส = ข้อความสำรองตามชนิดของ error (ห้ามแสดงข้อความไทยดิบ)
 */
export function investError(e: unknown, fallback: string = DEFAULT_EN): string {
  const coded = codedMessage(e, 'en');
  if (coded !== null) return coded;
  if (hasCode(e)) return fallback; // รหัสที่ยังไม่มีแม่แบบอังกฤษ: ไม่แสดงข้อความไทย
  if (e instanceof RangeError) return 'The number is too large or invalid. Check the amount and try again.';
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) return 'Cannot connect. Check your internet connection and try again.';
  return fallback;
}

/** ปัญหาที่มี message ไทย + รหัส (จากฟอร์ม/แถวพอร์ต/ตัวตรวจ) → ข้อความอังกฤษ · ไม่มีรหัสหรือไม่รู้จัก = ข้อความสำรอง (ไม่แสดงไทยดิบ) */
export function investProblem(p: { message: string; code?: string; params?: Readonly<Record<string, string | number>> }, fallback = 'Invalid input'): string {
  if (p.code) {
    const en = messageFor(p.code, p.params ?? {}, 'en');
    if (en !== null) return en;
  }
  return /[\u0E00-\u0E7F]/.test(p.message) ? fallback : p.message;
}
