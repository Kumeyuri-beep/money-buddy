// ลบบัญชีผู้ใช้ทีละคน (รันในเครื่องเจ้าของเท่านั้น): npm run admin:delete-user -- <username> [--force]
// ใช้แทนการลบในหน้า Supabase (เหตุการณ์ 13 พ.ย. 2569: เผลอลบผู้ใช้ทั้งหมด)
// - ลบทีละ 1 บัญชีตามชื่อเท่านั้น ไม่รับหลายชื่อ/ตัวแทน
// - แสดงชื่อ + จำนวนแถวต่อตาราง (ไม่แสดงเนื้อหา) แล้วต้องพิมพ์ชื่อซ้ำเพื่อยืนยัน (ต้องรันใน terminal จริง ไม่รับ pipe)
// - ปฏิเสธถ้าเป็นบัญชีสุดท้ายในระบบ หรือชื่อ kumeyuri เว้นแต่ใส่ --force
// - key อ่านจาก admin.env นอกโปรเจกต์ผ่าน scripts/lib/admin.mjs (เหมือน create-user) · ห้ามรันผ่านผู้ช่วย AI
import { createInterface } from 'node:readline/promises';
import { usernameToEmail } from '../src/domain/auth/credentials.ts';
import { fail, loadAdmin } from './lib/admin.mjs';
import { COUNT_TABLES, confirmationMatches, confirmationPhrase, parseDeleteArgs, refusalReason } from './lib/deleteUserGuard.mjs';

const parsed = parseDeleteArgs(process.argv.slice(2));
if ('error' in parsed) fail(`${parsed.error}\nวิธีใช้: npm run admin:delete-user -- <username> [--force]`);
const { username, force } = parsed;

let email;
try {
  email = usernameToEmail(username);
} catch (e) {
  fail(`ชื่อผู้ใช้ไม่ถูกต้อง: ${e instanceof Error ? e.message : 'รูปแบบผิด'}`);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) fail('ปฏิเสธ: ต้องรันใน terminal ที่พิมพ์ยืนยันได้เอง (ไม่รับ pipe/สคริปต์)');

const { client, safeMessage } = loadAdmin();

// อ่านผู้ใช้ทั้งหมด (นับ + หาตามอีเมลตรงตัว) วนจนได้หน้าว่าง · เกิน 50 หน้า = ล้ม (ไม่เดาจำนวน)
async function scanUsers() {
  let count = 0;
  let found = null;
  for (let page = 1; ; page++) {
    if (page > 50) fail('ผู้ใช้เยอะเกินที่สคริปต์นับได้ครบ (ไม่ได้ลบอะไร)', 1);
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`อ่านรายชื่อผู้ใช้ไม่สำเร็จ: ${safeMessage(error)}`, 1);
    if (data.users.length === 0) break;
    count += data.users.length;
    found = found ?? data.users.find((u) => (u.email ?? '').toLowerCase() === email) ?? null;
  }
  return { count, found };
}
const scanned = await scanUsers();
const total = scanned.count;
const target = scanned.found;
if (target === null) fail('ไม่พบผู้ใช้ชื่อนี้ (ไม่ได้ลบอะไร)');

const refusal = refusalReason({ username, totalUsers: total, force });
if (refusal) fail(refusal);

async function countRows(userId) {
  const counts = {};
  for (const table of COUNT_TABLES) {
    const { count, error } = await client.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (error) fail(`นับแถวตาราง ${table} ไม่สำเร็จ: ${safeMessage(error)} (ไม่ได้ลบอะไร)`, 1);
    counts[table] = count ?? 0;
  }
  return counts;
}

const before = await countRows(target.id);
const shown = username.trim().toLowerCase();
console.log(`จะลบบัญชี: ${shown}  (ผู้ใช้ทั้งระบบตอนนี้ ${total} บัญชี${force ? ' · ใช้ --force' : ''})`);
console.log('จำนวนแถวที่จะถูกลบถาวร (กู้คืนไม่ได้ถ้าไม่มีไฟล์สำรอง):');
for (const table of COUNT_TABLES) console.log(`  ${table.padEnd(13)} ${before[table]}`);

const phrase = confirmationPhrase({ username, totalUsers: total, force });
const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = await rl.question(`พิมพ์ "${phrase}" ซ้ำเพื่อยืนยันการลบ (หรือกด Enter เพื่อยกเลิก): `);
rl.close();
if (!confirmationMatches(typed, phrase)) fail('ยกเลิก: ข้อความที่พิมพ์ไม่ตรง ไม่ได้ลบอะไร', 0);

// นับผู้ใช้ซ้ำหลังรอยืนยัน (ระหว่างรออาจมีการลบ/สร้างบัญชีอื่น) แล้วตรวจด่านอีกรอบ
const rescanned = await scanUsers();
if (rescanned.found === null || rescanned.found.id !== target.id) fail('บัญชีเปลี่ยนไประหว่างรอยืนยัน ไม่ได้ลบอะไร ลองใหม่', 1);
const refusal2 = refusalReason({ username, totalUsers: rescanned.count, force });
if (refusal2) fail(refusal2);

const deleted = await client.auth.admin.deleteUser(target.id);
if (deleted.error) fail(`ลบไม่สำเร็จ: ${safeMessage(deleted.error)}\nตรวจสถานะก่อนลองใหม่`, 1);

// อ่านกลับยืนยัน: ผู้ใช้หายและแถวทุกตารางเป็น 0
const gone = await client.auth.admin.getUserById(target.id);
const after = await countRows(target.id);
const leftover = COUNT_TABLES.reduce((s, t) => s + after[t], 0);
// ถือว่าหายจริงเฉพาะ 404/user_not_found · error อื่น (เน็ตหลุด 500 key หมดอายุ) = ยืนยันผลไม่ได้
const goneCode = gone.error && typeof gone.error === 'object' && 'code' in gone.error ? String(gone.error.code ?? '') : '';
const goneStatus = gone.error && typeof gone.error === 'object' && 'status' in gone.error ? Number(gone.error.status) : 0;
if (!gone.error && gone.data?.user) fail('เตือน: สั่งลบแล้วแต่ยังพบบัญชีอยู่ ตรวจใน Dashboard', 1);
if (gone.error && goneStatus !== 404 && goneCode !== 'user_not_found') fail(`ยืนยันผลไม่ได้ (${safeMessage(gone.error)}) ตรวจใน Dashboard`, 1);
if (leftover !== 0) fail(`เตือน: ลบบัญชีแล้วแต่ยังมีแถวค้าง ${leftover} แถว ตรวจใน Dashboard`, 1);
console.log(`ลบสำเร็จ: ไม่พบบัญชี และตารางข้อมูล ${COUNT_TABLES.length} ตาราง (รวม profiles) เป็น 0 แถว`);
