import { PRIVACY_POLICY_VERSION } from '../domain/privacy/policy';
import type { AuthResult } from './auth';

/**
 * บัญชีผู้ใช้: ยอมรับนโยบาย (PDPA) และลบบัญชีพร้อมข้อมูลทั้งหมด (M2-E)
 * ฐานข้อมูลเป็นด่านจริง (RPC record_consent / delete_my_account ตรวจผู้เรียก รหัสผ่าน และจำกัดการลอง) ที่นี่แปลงผลเป็นข้อความไทย
 */
export interface RpcApi {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

const PARTIAL_DELETE = 'ข้อมูลบางส่วนถูกลบไปแล้ว และบัญชีอาจถูกลบเรียบร้อยแล้ว ลองเข้าสู่ระบบใหม่เพื่อตรวจ ถ้ายังเข้าได้ให้กดลบบัญชีอีกครั้ง';
const NETWORK = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่';
const UNKNOWN = 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
const RATE_LIMITED = 'ลองรหัสผ่านผิดหลายครั้งเกินไป ลองใหม่ภายหลัง';
export const COOLDOWN_MESSAGE = 'เพิ่งเปลี่ยนรหัสผ่านภายใน 24 ชั่วโมง จึงยังลบบัญชีไม่ได้ (มาตรการกันผู้อื่นที่ได้ session ไปเปลี่ยนรหัสแล้วลบข้อมูล) ลองใหม่ภายหลัง';

/** บันทึกว่าผู้ใช้ยอมรับนโยบาย (เวลาตั้งที่เซิร์ฟเวอร์ ไม่รับเวลาจากเว็บ) · เรียกซ้ำได้ ไม่เปลี่ยนเวลาเดิม */
export async function recordConsent(api: RpcApi): Promise<AuthResult> {
  try {
    // ส่งเวอร์ชันที่แสดงให้ผู้ใช้อ่านจริง (ฐานข้อมูลรับเฉพาะเวอร์ชันที่อยู่ในรายการอนุญาต ไม่รับข้อความอิสระ)
    const { error } = await api.rpc('record_consent', { p_version: PRIVACY_POLICY_VERSION });
    if (!error) return { ok: true };
    return { ok: false, message: /fetch|network/i.test(String(error.message ?? '')) ? NETWORK : UNKNOWN };
  } catch {
    return { ok: false, message: NETWORK };
  }
}

/**
 * ลบบัญชีและข้อมูลทั้งหมดของผู้ที่ล็อกอินอยู่ (ย้อนกลับไม่ได้) · ต้องส่งรหัสผ่านปัจจุบัน
 * รหัสผิด = ไม่ลบ ฐานข้อมูลจำกัดรหัสผิด 5 ครั้ง/15 นาที · ไม่ผ่านโดยไม่มี done จากเซิร์ฟเวอร์
 */
export async function deleteMyAccount(api: RpcApi, password: string): Promise<AuthResult> {
  if (typeof password !== 'string' || password === '') return { ok: false, message: 'ต้องใส่รหัสผ่านเพื่อยืนยัน' };
  try {
    // ลบเป็นชุดละ ≤ 500 รายการ (ข้อมูลหนักมากลบในคำสั่งเดียวชนเพดานเวลา 8 วินาที) · ฐานข้อมูลตรวจรหัสผ่านและ cooldown ทุกชุด
    // more = ยังเหลือ เรียกซ้ำ · done = ลบบัญชีแล้ว · หยุดที่ 200 ชุดกันวนไม่รู้จบ · ค่าที่ไม่รู้จักไม่นับว่าลบ
    for (let i = 0; i < 200; i++) {
      const { data, error } = await api.rpc('delete_my_account_step', { p_password: password });
      if (error) {
        if (error.code === '53400') return { ok: false, message: RATE_LIMITED };
        if (error.code === '55000') return { ok: false, message: COOLDOWN_MESSAGE };
        // หลังลบไปแล้วบางชุด (i > 0) แล้วถูกปฏิเสธเพราะ session/บัญชีใช้ไม่ได้ (42501): บัญชีอาจถูกลบไปแล้วแต่คำตอบสุดท้ายหายระหว่างทาง ไม่นับว่าสำเร็จ แต่บอกให้ตรวจ
        if (error.code === '42501' && i > 0) return { ok: false, message: PARTIAL_DELETE };
        return { ok: false, message: /fetch|network/i.test(String(error.message ?? '')) ? NETWORK : UNKNOWN };
      }
      if (data === 'done') return { ok: true };
      if (data === 'wrong') return { ok: false, message: 'รหัสผ่านไม่ถูกต้อง ไม่ได้ลบบัญชี' };
      if (data !== 'more') return { ok: false, message: UNKNOWN };
    }
    return { ok: false, message: UNKNOWN };
  } catch {
    return { ok: false, message: NETWORK };
  }
}

/** ต้องตรงกับ private.assert_password_cooled ในฐานข้อมูล (migration 20261108001400) ฐานข้อมูลเป็นด่านจริง ที่นี่ใช้แสดงผลเท่านั้น */
export const PASSWORD_COOLDOWN_HOURS = 24;

export interface CooldownState {
  /** เวลาที่เหลือเป็นมิลลิวินาที (> 0) */
  remainingMs: number;
  /** เวลาที่ลบบัญชีได้ */
  until: Date;
}

/** ยังอยู่ในช่วง cooldown หลังเปลี่ยนรหัสผ่านไหม (null = ไม่อยู่ในช่วง · ค่าว่าง/อ่านไม่ได้ = ไม่แสดง ให้ฐานข้อมูลตัดสิน) */
export function cooldownState(passwordChangedAt: string | null | undefined, now: Date = new Date()): CooldownState | null {
  if (typeof passwordChangedAt !== 'string' || passwordChangedAt === '') return null;
  const changed = Date.parse(passwordChangedAt);
  if (Number.isNaN(changed)) return null;
  const untilMs = changed + PASSWORD_COOLDOWN_HOURS * 3_600_000;
  const remainingMs = untilMs - now.getTime();
  return remainingMs > 0 ? { remainingMs, until: new Date(untilMs) } : null;
}

/** "5 ชั่วโมง 30 นาที" (ปัดนาทีขึ้น ไม่ให้บอกว่าเหลือ 0 นาทีทั้งที่ยังไม่ครบ) */
export function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} นาที`;
  return minutes === 0 ? `${hours} ชั่วโมง` : `${hours} ชั่วโมง ${minutes} นาที`;
}
