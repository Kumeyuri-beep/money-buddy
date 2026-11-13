// ตัวช่วยล้วน (ไม่แตะไฟล์/เครือข่าย) ของ scripts/delete-user.mjs · ทดสอบใน tests/unit/deleteUserGuard.test.ts
// เหตุผล: 13 พ.ย. 2569 ลบผู้ใช้ทั้งหมดโดยไม่ตั้งใจจากหน้า Supabase → สคริปต์นี้บังคับ "ทีละคน ตามชื่อ ยืนยันซ้ำ"

/** บัญชีเจ้าของ: ลบได้ต้องใส่ --force เท่านั้น */
export const PROTECTED_USERNAME = 'kumeyuri';

/**
 * แยกอาร์กิวเมนต์: ชื่อผู้ใช้ 1 ตัว + --force (ถ้ามี) เท่านั้น
 * ปฏิเสธ: หลายชื่อ, ว่าง, ตัวแทน (* ? % , ; ช่องว่าง), ตัวเลือกอื่น
 * คืน { username, force } หรือ { error }
 */
export function parseDeleteArgs(args) {
  const forceCount = args.filter((a) => a === '--force').length;
  if (forceCount > 1) return { error: 'ใส่ --force ได้ครั้งเดียว' };
  const rest = args.filter((a) => a !== '--force');
  if (rest.some((a) => a.startsWith('-'))) return { error: 'ไม่รู้จักตัวเลือก (มีแค่ --force)' };
  if (rest.length !== 1) return { error: 'ลบได้ทีละ 1 บัญชีตามชื่อเท่านั้น' };
  const username = String(rest[0]);
  if (/[*?%,;\s]/.test(username)) return { error: 'ห้ามใช้ตัวแทน (wildcard) หรือหลายชื่อ' };
  return { username, force: forceCount === 1 };
}

/** เหตุผลที่ต้องปฏิเสธ (null = ลบได้) · totalUsers = จำนวนผู้ใช้ทั้งระบบก่อนลบ */
export function refusalReason({ username, totalUsers, force }) {
  if (force) return null;
  if (totalUsers <= 1) return 'ปฏิเสธ: นี่คือบัญชีสุดท้ายในระบบ (ถ้าตั้งใจจริงให้ใส่ --force)';
  if (username.trim().toLowerCase() === PROTECTED_USERNAME) {
    return `ปฏิเสธ: ${PROTECTED_USERNAME} คือบัญชีเจ้าของ (ถ้าตั้งใจจริงให้ใส่ --force)`;
  }
  return null;
}

/** ข้อความที่ต้องพิมพ์ยืนยัน: ปกติ = ชื่อผู้ใช้ · ใช้ --force ข้ามด่านบัญชีเจ้าของ/บัญชีสุดท้าย = วลียาวกว่า กันพิมพ์ตามความเคยชิน */
export function confirmationPhrase({ username, totalUsers, force }) {
  const name = String(username).trim().toLowerCase();
  const risky = force && (name === PROTECTED_USERNAME || totalUsers <= 1);
  return risky ? `ลบ ${name} ถาวร` : name;
}

/** ยืนยันต้องพิมพ์ข้อความที่กำหนดซ้ำ (ตัดช่องว่างหัวท้าย ไม่สนตัวพิมพ์ · ว่าง = ไม่ผ่าน) */
export function confirmationMatches(typed, expected) {
  if (typeof typed !== 'string' || typed.trim() === '') return false;
  return typed.trim().toLowerCase() === String(expected).trim().toLowerCase();
}

/** ตารางข้อมูลที่ผูกกับผู้ใช้ (นับแถวก่อน/หลังลบ) */
export const COUNT_TABLES = ['profiles', 'accounts', 'entries', 'lines', 'bills', 'settings', 'assets', 'trades', 'asset_prices'];
