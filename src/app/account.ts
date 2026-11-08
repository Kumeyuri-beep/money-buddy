import type { AuthResult } from './auth';

/**
 * บัญชีผู้ใช้: ยอมรับนโยบาย (PDPA) และลบบัญชีพร้อมข้อมูลทั้งหมด (M2-E)
 * ฐานข้อมูลเป็นด่านจริง (RPC record_consent / delete_my_account ตรวจผู้เรียก รหัสผ่าน และจำกัดการลอง) ที่นี่แปลงผลเป็นข้อความไทย
 */
export interface RpcApi {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

const NETWORK = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่';
const UNKNOWN = 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
const RATE_LIMITED = 'ลองรหัสผ่านผิดหลายครั้งเกินไป ลองใหม่ภายหลัง';
export const COOLDOWN_MESSAGE = 'เพิ่งเปลี่ยนรหัสผ่านภายใน 24 ชั่วโมง จึงยังลบบัญชีไม่ได้ (มาตรการกันผู้อื่นที่ได้ session ไปเปลี่ยนรหัสแล้วลบข้อมูล) ลองใหม่ภายหลัง';

/** บันทึกว่าผู้ใช้ยอมรับนโยบาย (เวลาตั้งที่เซิร์ฟเวอร์ ไม่รับเวลาจากเว็บ) · เรียกซ้ำได้ ไม่เปลี่ยนเวลาเดิม */
export async function recordConsent(api: RpcApi): Promise<AuthResult> {
  try {
    const { error } = await api.rpc('record_consent');
    if (!error) return { ok: true };
    return { ok: false, message: /fetch|network/i.test(String(error.message ?? '')) ? NETWORK : UNKNOWN };
  } catch {
    return { ok: false, message: NETWORK };
  }
}

/**
 * ลบบัญชีและข้อมูลทั้งหมดของผู้ที่ล็อกอินอยู่ (ย้อนกลับไม่ได้) · ต้องส่งรหัสผ่านปัจจุบัน
 * รหัสผิด = ไม่ลบ ฐานข้อมูลจำกัด 5 ครั้ง/15 นาที · ไม่ผ่านโดยไม่มี true จากเซิร์ฟเวอร์
 */
export async function deleteMyAccount(api: RpcApi, password: string): Promise<AuthResult> {
  if (typeof password !== 'string' || password === '') return { ok: false, message: 'ต้องใส่รหัสผ่านเพื่อยืนยัน' };
  try {
    const { data, error } = await api.rpc('delete_my_account', { p_password: password });
    if (error) {
      if (error.code === '53400') return { ok: false, message: RATE_LIMITED };
      if (error.code === '55000') return { ok: false, message: COOLDOWN_MESSAGE };
      return { ok: false, message: /fetch|network/i.test(String(error.message ?? '')) ? NETWORK : UNKNOWN };
    }
    return data === true ? { ok: true } : { ok: false, message: 'รหัสผ่านไม่ถูกต้อง ไม่ได้ลบบัญชี' };
  } catch {
    return { ok: false, message: NETWORK };
  }
}
