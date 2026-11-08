// สร้างบัญชีผู้ใช้ (รันในเครื่องเจ้าของเท่านั้น): node scripts/create-user.mjs <username>
// - แปลง username เป็นอีเมลภายในด้วยฟังก์ชันตัวเดียวกับเว็บ (src/domain/auth/credentials.ts)
// - สุ่มรหัสผ่านชั่วคราว 16 ตัว พิมพ์ครั้งเดียวทางหน้าจอนี้ (ส่งให้ผู้ใช้ทางช่องส่วนตัว)
// - ผู้ใช้ต้องตั้งรหัสใหม่ก่อนใช้ข้อมูล (ธง must_change_password บังคับที่ RLS) สคริปต์อ่านกลับมายืนยันธงเสมอ
// - ไม่รับรหัสหรือ key ทางอาร์กิวเมนต์ · key อ่านจากไฟล์นอกโปรเจกต์ผ่าน scripts/lib/admin.mjs
import { passwordProblem, usernameToEmail } from '../src/domain/auth/credentials.ts';
import { fail, loadAdmin } from './lib/admin.mjs';
import { generateTempPassword } from './lib/adminEnv.mjs';

const args = process.argv.slice(2);
if (args.length !== 1) fail('วิธีใช้: node scripts/create-user.mjs <username>');
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

const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) {
  const code = created.error && 'code' in created.error ? created.error.code : '';
  if (code === 'email_exists' || code === 'user_already_exists') fail('ชื่อผู้ใช้นี้มีอยู่แล้ว');
  fail(`สร้างผู้ใช้ไม่สำเร็จ: ${safeMessage(created.error)}`, 1);
}
const userId = created.data.user.id;

// ตรวจธงบังคับเปลี่ยนรหัส: trigger สร้าง profiles ให้ด้วยธง true ถ้าไม่ใช่ ต้องตั้งเองแล้วอ่านกลับ
const WARN = 'ห้ามส่งรหัสนี้ให้ผู้ใช้ (บัญชีถูกสร้างแล้ว ยังไม่ได้ลบ ไม่มีใครรู้รหัสนี้) ใช้ node scripts/reset-password.mjs <username> เพื่อตั้งรหัสและธงใหม่ หรือลบผู้ใช้ใน Dashboard แล้วสร้างใหม่';
async function readFlag() {
  const { data, error } = await client.from('profiles').select('must_change_password').eq('user_id', userId).maybeSingle();
  return { flag: data?.must_change_password, error };
}
let state = await readFlag();
if (state.error) fail(`อ่านธงไม่สำเร็จ: ${safeMessage(state.error)}\n${WARN}`, 1);
if (state.flag !== true) {
  const upsert = await client.from('profiles').upsert({ user_id: userId, must_change_password: true });
  if (upsert.error) fail(`ตั้งธงไม่สำเร็จ: ${safeMessage(upsert.error)}\n${WARN}`, 1);
  state = await readFlag();
}
if (state.flag !== true) fail(`ธงบังคับเปลี่ยนรหัสไม่เป็น true หลังตั้ง\n${WARN}`, 1);

console.log('สร้างบัญชีสำเร็จ');
console.log(`  ชื่อผู้ใช้:       ${username.trim().toLowerCase()}`);
console.log(`  รหัสผ่านชั่วคราว: ${password}`);
console.log('  (แสดงครั้งเดียว ส่งให้ผู้ใช้ทางช่องส่วนตัว ผู้ใช้ต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก)');
