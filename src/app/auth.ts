import { passwordProblem, usernameToEmail } from '../domain/auth/credentials';

/**
 * ขั้นตอนใช้งานของล็อกอิน (M2-B) · ไม่แตะ React/DOM · รับ API ผ่าน interface เพื่อทดสอบโดยไม่ต่อเน็ต
 * หลักความปลอดภัย: ล็อกอินผิดทุกกรณีแสดงข้อความเดียวกัน (กันเดาว่ามี username ไหน) ไม่แสดงรายละเอียดของเซิร์ฟเวอร์
 */

export interface AuthError {
  message?: string;
  status?: number;
  code?: string;
}

/** ส่วนของ supabase.auth ที่ใช้ (ให้ตรงกับ SupabaseClient['auth'] เฉพาะที่จำเป็น) */
export interface AuthApi {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{ error: AuthError | null }>;
  updateUser(attributes: { password: string }): Promise<{ error: AuthError | null }>;
  signOut(): Promise<{ error: AuthError | null }>;
  /** ออกจากระบบเครื่อง/แท็บอื่นของผู้ใช้เดียวกัน (คงเครื่องนี้ไว้) */
  signOutOthers(): Promise<{ error: AuthError | null }>;
}

export type AuthResult = { ok: true } | { ok: false; message: string };

export const GENERIC_LOGIN_ERROR = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
const RATE_LIMITED = 'ลองหลายครั้งเกินไป ลองใหม่ภายหลัง';
const NETWORK = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่';
const SERVER = 'เซิร์ฟเวอร์ขัดข้องชั่วคราว ลองใหม่ภายหลัง';
const UNKNOWN = 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง';

type ErrorKind = 'rate-limit' | 'network' | 'server' | 'same-password' | 'weak-password' | 'other';

function classify(error: AuthError): ErrorKind {
  const code = error.code ?? '';
  if (error.status === 429 || code.includes('rate_limit')) return 'rate-limit';
  if (code === 'same_password') return 'same-password';
  if (code === 'weak_password') return 'weak-password';
  if (error.status === 0 || (error.status === undefined && /fetch|network/i.test(error.message ?? ''))) return 'network';
  if (typeof error.status === 'number' && error.status >= 500) return 'server';
  return 'other';
}

function failureOfSignIn(error: AuthError): AuthResult {
  switch (classify(error)) {
    case 'rate-limit':
      return { ok: false, message: RATE_LIMITED };
    case 'network':
      return { ok: false, message: NETWORK };
    case 'server':
      return { ok: false, message: SERVER };
    default:
      // ไม่มีผู้ใช้ / รหัสผิด / ยังไม่ยืนยัน ฯลฯ: ข้อความเดียวกันทั้งหมด
      return { ok: false, message: GENERIC_LOGIN_ERROR };
  }
}

export async function signIn(api: AuthApi, username: string, password: string): Promise<AuthResult> {
  let email: string;
  try {
    email = usernameToEmail(username);
  } catch {
    return { ok: false, message: GENERIC_LOGIN_ERROR }; // ไม่บอกรูปแบบที่ถูกต้อง ข้อความเดียวกับรหัสผิด
  }
  if (typeof password !== 'string' || password === '') return { ok: false, message: GENERIC_LOGIN_ERROR };
  try {
    const { error } = await api.signInWithPassword({ email, password });
    return error ? failureOfSignIn(error) : { ok: true };
  } catch {
    return { ok: false, message: UNKNOWN };
  }
}

export interface ChangePasswordInput {
  username: string;
  current: string;
  next: string;
}

/**
 * เปลี่ยนรหัสผ่าน: ตรวจรหัสใหม่ก่อน (ไม่ยิงเน็ตถ้าไม่ผ่าน) ยืนยันรหัสเดิมด้วยการล็อกอินซ้ำ แล้วค่อยเปลี่ยน
 * (ยืนยันรหัสเดิมฝั่งเว็บอย่างเดียว ด่านจริงคือ session ถูกเพิกถอนเมื่อเจ้าของ reset ดู docs/plans m2 ข้อ 4.6)
 */
export async function changePassword(api: AuthApi, input: ChangePasswordInput): Promise<AuthResult> {
  const problem = passwordProblem(input.next, input.username);
  if (problem) return { ok: false, message: problem };
  if (input.current === input.next) return { ok: false, message: 'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม' };

  const verified = await signIn(api, input.username, input.current);
  if (!verified.ok) {
    return { ok: false, message: verified.message === GENERIC_LOGIN_ERROR ? 'รหัสผ่านเดิมไม่ถูกต้อง' : verified.message };
  }
  try {
    const { error } = await api.updateUser({ password: input.next });
    if (!error) {
      // เพิกถอน session อื่น: ใครถือรหัสชั่วคราว/session เก่าอยู่จะหลุดทันที (ล้มเหลวไม่ทำให้การเปลี่ยนรหัสที่สำเร็จแล้วล้ม)
      try {
        await api.signOutOthers();
      } catch {
        /* ไม่มีอะไรให้ทำ */
      }
      return { ok: true };
    }
    switch (classify(error)) {
      case 'same-password':
        return { ok: false, message: 'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม' };
      case 'weak-password':
        return { ok: false, message: 'เซิร์ฟเวอร์ไม่รับรหัสผ่านนี้ ต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข ยาวอย่างน้อย 10 ตัว และไม่ใช่รหัสที่เดาง่าย' };
      case 'rate-limit':
        return { ok: false, message: RATE_LIMITED };
      case 'network':
        return { ok: false, message: NETWORK };
      case 'server':
        return { ok: false, message: SERVER };
      default:
        return { ok: false, message: UNKNOWN };
    }
  } catch {
    return { ok: false, message: UNKNOWN };
  }
}

/** ออกจากระบบ: ไม่โยนแม้เครือข่ายล้ม (ผู้ใช้กดแล้วต้องออกจากหน้าเสมอ) */
export async function signOutQuietly(api: AuthApi): Promise<void> {
  try {
    await api.signOut();
  } catch {
    /* ไม่มีอะไรให้ทำ session ในเครื่องจะถูกล้างโดยผู้เรียก */
  }
}

export interface ProfileRow {
  must_change_password: boolean;
  consented_at: string | null;
}

export type GateState = 'ready' | 'must-change' | 'no-profile';

/**
 * ตัดสินว่าผู้ที่ล็อกอินแล้วเข้าแอปได้ไหม · ปิดไว้ก่อน: ไม่มีแถว หรือธงไม่ใช่ boolean = ไม่พร้อม
 * (ฐานข้อมูลบังคับซ้ำที่ RLS เว็บเป็นเพียงการแสดงหน้าที่ถูกต้องให้ผู้ใช้)
 */
export function gateStateFromProfile(profile: ProfileRow | null | undefined): GateState {
  if (!profile || typeof profile.must_change_password !== 'boolean') return 'no-profile';
  return profile.must_change_password ? 'must-change' : 'ready';
}
