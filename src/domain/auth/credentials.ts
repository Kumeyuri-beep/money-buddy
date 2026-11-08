/**
 * ชื่อผู้ใช้ + รหัสผ่าน (M2-B) · ไม่ใช้อีเมลจริง ไม่ส่งอีเมลใดๆ
 * ผู้ใช้พิมพ์แต่ชื่อผู้ใช้ ระบบแปลงเป็นอีเมลภายในเพื่อให้ Supabase Auth ใช้ (ผู้ใช้ไม่เห็น)
 * ไม่แตะ DOM หรือเครือข่าย
 */

/**
 * โดเมนอีเมลภายใน (เปลี่ยนที่เดียวได้) · ต้องไม่เป็นโดเมนจริงที่มีคนจดได้ (ถ้าโดเมนหลุดมือแล้วมีคนตั้ง MX
 * อีเมลกู้รหัสที่เจ้าของกดจาก Dashboard จะไปถึงเขา) · ยังไม่ยืนยันว่า Supabase รับโดเมนนี้ (spike ใน M2-B2)
 * ถ้าไม่รับ ให้เปลี่ยนเป็น users.money-buddy.invalid แล้วค่อย .test (RFC 2606)
 */
export const AUTH_EMAIL_DOMAIN = 'users.money-buddy.internal';

export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt ใช้ได้ไม่เกิน 72 ไบต์ ที่เกินจะถูกตัดเงียบๆ (รหัสต่างกันแต่ใช้ได้เหมือนกัน) จึงปฏิเสธ */
export const MAX_PASSWORD_BYTES = 72;

export class AuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthInputError';
  }
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** เหตุผลที่ชื่อผู้ใช้ใช้ไม่ได้ (null = ใช้ได้) · รับชื่อที่ผ่าน normalizeUsername แล้ว */
export function usernameProblem(username: string): string | null {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-32 ตัว';
  }
  if (username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    return 'ชื่อผู้ใช้ห้ามขึ้นต้นหรือลงท้ายด้วยจุด และห้ามมีจุดติดกัน';
  }
  return null;
}

const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

/** ชื่อผู้ใช้ต้องเป็น ASCII ตั้งแต่ก่อนแปลงตัวพิมพ์เล็ก (กันตัวอักษรหน้าตาเหมือนกัน/แปลงแล้วชนกับชื่ออื่น) · ใช้ฟังก์ชันนี้ตัวเดียวทั้งเว็บและสคริปต์ผู้ดูแล */
export function usernameToEmail(raw: string): string {
  if (typeof raw !== 'string' || !PRINTABLE_ASCII.test(raw)) {
    throw new AuthInputError('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-32 ตัว');
  }
  const username = normalizeUsername(raw);
  const problem = usernameProblem(username);
  if (problem) throw new AuthInputError(problem);
  return `${username}@${AUTH_EMAIL_DOMAIN}`;
}

/** ชื่อผู้ใช้ที่ผู้ใช้เห็น (ส่วนหน้า @ ของอีเมลภายใน) */
export function usernameOfEmail(email: string | undefined | null): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  return at < 0 ? email : email.slice(0, at);
}

/** รหัสผ่านยอดนิยมที่ยาวพอผ่านเกณฑ์ความยาว (เทียบแบบไม่สนตัวพิมพ์) Supabase แพ็กเกจฟรีไม่มีตัวตรวจรหัสรั่ว จึงตรวจเองฝั่งเว็บ */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '1234567890', '0987654321', 'password123', 'password1234', 'password12345', 'passw0rd123', 'p@ssw0rd123', 'qwertyuiop', 'qwerty12345',
  '1q2w3e4r5t', '1234512345', 'iloveyou123', 'letmein123', 'welcome123', 'admin12345', 'monkey1234',
  'abcd123456', 'thailand123', 'bangkok1234', 'moneybuddy1', 'money-buddy',
]);

function isSingleCharRepeat(value: string): boolean {
  return new Set(Array.from(value)).size === 1;
}

/** ทั้งสตริงเรียงขึ้นหรือลงทีละ 1 (0123456789, abcdefghij, 9876543210) */
function isSequential(value: string): boolean {
  const codes = Array.from(value).map((c) => c.codePointAt(0) ?? 0);
  if (codes.length < 2) return false;
  const step = (codes[1] ?? 0) - (codes[0] ?? 0);
  if (step !== 1 && step !== -1) return false;
  return codes.every((c, i) => i === 0 || c - (codes[i - 1] ?? 0) === step);
}

/** เหตุผลที่รหัสผ่านใหม่ใช้ไม่ได้ (null = ใช้ได้) · username ใช้เทียบว่ารหัสเท่ากับชื่อผู้ใช้ไหม */
export function passwordProblem(password: string, username?: string): string | null {
  if (typeof password !== 'string') return 'รหัสผ่านไม่ถูกต้อง';
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return `รหัสผ่านยาวเกินไป (ไม่เกิน ${MAX_PASSWORD_BYTES} ไบต์ ภาษาไทยตัวละ 3 ไบต์)`;
  if (password.trim() === '') return 'รหัสผ่านต้องไม่ใช่ช่องว่างล้วน';
  if (username !== undefined) {
    const name = normalizeUsername(username);
    const lower = password.toLowerCase();
    if (lower === name || (name.length >= 4 && lower.includes(name))) return 'รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ข้างใน';
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || isSingleCharRepeat(password) || isSequential(password)) {
    return 'รหัสผ่านง่ายเกินไป เดาได้ ลองใช้ประโยคหรือคำหลายคำต่อกัน';
  }
  return null;
}
