// รีเซ็ตรหัสผ่านที่ผู้ใช้ลืม — รันใน terminal ของเจ้าของเองเท่านั้น: node scripts/reset-password.mjs <username>
// (ห้ามรันผ่านผู้ช่วย AI: รหัสชั่วคราวที่พิมพ์ออกมาจะไปอยู่ในบันทึกการคุย)
//
// ลำดับ (แผน M2 ข้อ 4.6 + ผลตรวจ security-auditor):
//   0 ระงับบัญชีชั่วคราว (ban) -> กันการล็อกอินและต่ออายุ token ทุกชนิดระหว่างทำ (ปิดช่องที่คนรู้รหัสเดิมล็อกอินแทรกกลางทาง)
//   1 เพิกถอน session ทั้งหมด  2 ตั้งรหัสชั่วคราว  3 ตั้งธงบังคับเปลี่ยนรหัส (หลังตั้งรหัสเสมอ เพราะ trigger เคลียร์ธงเมื่อ hash เปลี่ยน)
//   4 เพิกถอนซ้ำ  5 อ่านกลับยืนยันธงและ session = 0  6 ปลดระงับ (ขั้นสุดท้าย) แล้วอ่านกลับว่าปลดแล้ว
// ขั้นไหนล้มเหลว = จบ exit 1 พร้อม "ห้ามส่งรหัสให้ผู้ใช้" และบัญชียังถูกระงับอยู่ (สถานะปลอดภัย) รันใหม่ได้ หรือปลดใน Dashboard
// เหตุผลที่ต้องเพิกถอน session เอง: JWT expiry ตั้งไม่ได้ (1 ชั่วโมง)
// ต้องมี migration 20261108000400 (public.admin_revoke_sessions / admin_session_count) ใส่ในฐานข้อมูลแล้ว
import { passwordProblem, usernameToEmail } from '../src/domain/auth/credentials.ts';
import { fail, loadAdmin } from './lib/admin.mjs';
import { generateTempPassword } from './lib/adminEnv.mjs';

const args = process.argv.slice(2);
if (args.length !== 1) fail('วิธีใช้: node scripts/reset-password.mjs <username>');
const username = args[0] ?? '';

let email;
try {
  email = usernameToEmail(username);
} catch (e) {
  fail(`ชื่อผู้ใช้ไม่ถูกต้อง: ${e instanceof Error ? e.message : 'รูปแบบผิด'}`);
}

let password = generateTempPassword();
for (let i = 0; i < 20 && passwordProblem(password, username) !== null; i++) password = generateTempPassword();
if (passwordProblem(password, username) !== null) fail('สุ่มรหัสผ่านชั่วคราวที่ผ่านเกณฑ์ไม่สำเร็จ');

const { client, safeMessage } = loadAdmin();
const DONT_SEND = '\n*** ห้ามส่งรหัสให้ผู้ใช้ *** ขั้นตอนไม่ครบ บัญชียังถูกระงับอยู่ (ปลอดภัย) ตรวจสอบแล้วรันใหม่ หรือปลดระงับใน Dashboard';

// หาผู้ใช้ (ไม่เกิน 20 คน แต่วนอ่านครบกันพลาด)
let userId = null;
for (let page = 1; page <= 10 && userId === null; page++) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`อ่านรายชื่อผู้ใช้ไม่สำเร็จ: ${safeMessage(error)}`, 1);
  userId = data.users.find((u) => (u.email ?? '').toLowerCase() === email)?.id ?? null;
  if (data.users.length < 200) break;
}
if (userId === null) fail('ไม่พบผู้ใช้ชื่อนี้');

async function revoke(label) {
  const { data, error } = await client.rpc('admin_revoke_sessions', { p_user: userId });
  if (error) fail(`เพิกถอน session (${label}) ไม่สำเร็จ: ${safeMessage(error)}${DONT_SEND}`, 1);
  return data;
}

// 0) ระงับบัญชีก่อนทำอะไรทั้งสิ้น
const banned = await client.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
if (banned.error) fail(`ระงับบัญชีชั่วคราวไม่สำเร็จ: ${safeMessage(banned.error)}\nยังไม่ได้เปลี่ยนอะไร รันใหม่ได้`, 1);

// 1) เพิกถอน session ทั้งหมดก่อน
const revokedBefore = await revoke('ก่อนตั้งรหัส');

// 2) ตั้งรหัสชั่วคราว (trigger จะเคลียร์ธงตรงนี้)
const updated = await client.auth.admin.updateUserById(userId, { password });
if (updated.error) fail(`ตั้งรหัสไม่สำเร็จ: ${safeMessage(updated.error)}${DONT_SEND}`, 1);

// 3) ตั้งธงบังคับเปลี่ยนรหัสหลังตั้งรหัสเสมอ
const flagSet = await client.from('profiles').update({ must_change_password: true }).eq('user_id', userId);
if (flagSet.error) fail(`ตั้งธงไม่สำเร็จ: ${safeMessage(flagSet.error)}${DONT_SEND}`, 1);

// 4-5) เพิกถอนซ้ำ แล้วอ่านกลับยืนยันทั้งธงและจำนวน session
await revoke('หลังตั้งรหัส');
const flag = await client.from('profiles').select('must_change_password').eq('user_id', userId).maybeSingle();
if (flag.error || flag.data?.must_change_password !== true) fail(`ธงบังคับเปลี่ยนรหัสไม่เป็น true หลังตั้ง${DONT_SEND}`, 1);
const count = await client.rpc('admin_session_count', { p_user: userId });
if (count.error || count.data !== 0) fail(`ยังมี session เหลือหลังเพิกถอน${DONT_SEND}`, 1);

// 6) ปลดระงับ (ขั้นสุดท้าย) แล้วยืนยันว่าปลดแล้ว
const unbanned = await client.auth.admin.updateUserById(userId, { ban_duration: 'none' });
if (unbanned.error) fail(`ปลดระงับไม่สำเร็จ: ${safeMessage(unbanned.error)}${DONT_SEND}`, 1);
const check = await client.auth.admin.getUserById(userId);
if (check.error || check.data.user?.banned_until) fail(`บัญชียังถูกระงับหลังสั่งปลด${DONT_SEND}`, 1);

console.log('รีเซ็ตรหัสผ่านสำเร็จ');
console.log(`  ชื่อผู้ใช้:       ${username.trim().toLowerCase()}`);
console.log(`  รหัสผ่านชั่วคราว: ${password}`);
console.log(`  session เดิมที่ถูกเพิกถอน: ${String(revokedBefore)} (ตอนนี้เหลือ 0)`);
console.log('  (แสดงครั้งเดียว ส่งให้ผู้ใช้ทางช่องส่วนตัว ผู้ใช้ต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก)');
