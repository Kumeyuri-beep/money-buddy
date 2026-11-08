// Spike กับ Supabase Auth จริง (รันในเครื่องเจ้าของเท่านั้น): node scripts/spike-auth.mjs
// ตอบข้อที่ยังไม่พิสูจน์ใน docs/decisions/2026-11-08-m2-a.md ข้อ 17 และ docs/plans/2026-11-04-m2-multi-user.md ข้อ 4.5-4.6
//   - Supabase รับโดเมนอีเมลภายในไหม (ลอง .internal -> .invalid -> .test)
//   - ธง must_change_password: trigger ทำงานกับผู้ใช้ที่สร้างผ่าน Admin API ไหม และล็อกอินหลายครั้งไม่ปลดธง (ไม่ rehash)
//   - token จริง (มี session_id) ผ่านด่าน RLS ได้เมื่อเปลี่ยนรหัสแล้วเท่านั้น
//   - updateUser ด้วยรหัสเดิมถูกปฏิเสธไหม · signOut(others) ลบ session จริงไหม
//   - Admin updateUserById({password}) เพิกถอน session เดิมไหม · admin_revoke_sessions ทำให้ token เก่าใช้ไม่ได้ทันทีไหม
// สร้างผู้ใช้ทดสอบ spike-<สุ่ม> ใช้แล้วลบทิ้งเสมอ (ไม่ใช่ข้อมูลจริงของใคร) · ไม่พิมพ์ token/key/รหัสผ่าน
// ต้องมี: ไฟล์ key ผู้ดูแลนอกโปรเจกต์ (scripts/lib/admin.mjs) + .env ของโปรเจกต์ (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
// ต้องใส่ migration 20261108000400 ก่อน มิฉะนั้นข้อที่ใช้ admin_session_count จะถูกข้ามพร้อมแจ้ง
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { AUTH_EMAIL_DOMAIN } from '../src/domain/auth/credentials.ts';
import { fail, loadAdmin } from './lib/admin.mjs';
import { generateTempPassword } from './lib/adminEnv.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
if (!existsSync(envFile)) fail('ไม่พบ .env ของโปรเจกต์ (ต้องมี VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
const projectEnv = parseEnv(readFileSync(envFile, 'utf8')); // ไม่เขียน process.env
const anonUrl = projectEnv.VITE_SUPABASE_URL;
const anonKey = projectEnv.VITE_SUPABASE_ANON_KEY;
if (!anonUrl || !anonKey) fail('.env ไม่มี VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

const { client: admin, url: adminUrl, safeMessage } = loadAdmin();
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const info = (text) => console.log(`INFO  ${text}`);
const newAnon = () => createClient(anonUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

if (anonUrl.replace(/\/+$/, '') !== adminUrl.replace(/\/+$/, '')) {
  fail('หยุด: URL ใน .env ของโปรเจกต์ ไม่ตรงกับ URL ใน admin.env (อาจเป็นคนละโปรเจกต์) ไม่ทำอะไรต่อ');
}
check('URL ของ .env ตรงกับ URL ใน admin.env', true);

const suffix = globalThis.crypto.getRandomValues(new Uint8Array(4)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
const local = `spike-${suffix}`;
const tempPassword = generateTempPassword();
const newPassword = `${generateTempPassword()}x`;
let userId = null;
let email = '';

async function flag() {
  const { data, error } = await admin.from('profiles').select('must_change_password').eq('user_id', userId).maybeSingle();
  return error ? `error:${safeMessage(error)}` : data ? data.must_change_password : 'no-row';
}
let rpcProblem = '';
async function sessionCount() {
  const { data, error } = await admin.rpc('admin_session_count', { p_user: userId });
  if (error) {
    // PGRST202 / 42883 = ไม่พบฟังก์ชัน (ยังไม่ได้ใส่ migration) · อย่างอื่น (เช่น 42501) = มีฟังก์ชันแต่เรียกไม่ได้ ต้องดูข้อความ
    rpcProblem = error.code === 'PGRST202' || error.code === '42883' ? 'missing' : safeMessage(error);
    return null;
  }
  return data;
}

const SPIKE_EMAIL = /^spike-[0-9a-f]{8}@users\.money-buddy\.(internal|invalid|test)$/;

async function removeUser(id) {
  const del = await admin.auth.admin.deleteUser(id);
  if (del.error) console.error(`ลบผู้ใช้ทดสอบไม่สำเร็จ (${safeMessage(del.error)}) โปรดลบใน Dashboard เอง`);
  return !del.error;
}

// กด Ctrl+C หรือถูกสั่งหยุด: ลบผู้ใช้ทดสอบก่อนออก (finally ไม่ทำงานกับสัญญาณเหล่านี้)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void (async () => {
      if (userId !== null) await removeUser(userId);
      process.exit(130);
    })();
  });
}

if (process.argv[2] === '--cleanup') {
  let removed = 0;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`อ่านรายชื่อผู้ใช้ไม่สำเร็จ: ${safeMessage(error)}`, 1);
    for (const u of data.users) {
      if (SPIKE_EMAIL.test(u.email ?? '') && (await removeUser(u.id))) removed++;
    }
    if (data.users.length < 200) break;
  }
  console.log(`ลบผู้ใช้ทดสอบที่ค้างอยู่ ${removed} คน (เฉพาะชื่อรูปแบบ spike-xxxxxxxx)`);
  process.exit(0);
}

try {
  // 1) โดเมนอีเมลภายใน
  const domains = [AUTH_EMAIL_DOMAIN, 'users.money-buddy.invalid', 'users.money-buddy.test'];
  for (const domain of domains) {
    const candidate = `${local}@${domain}`;
    const created = await admin.auth.admin.createUser({ email: candidate, password: tempPassword, email_confirm: true });
    if (!created.error && created.data.user) {
      userId = created.data.user.id;
      email = candidate;
      check(`Supabase รับโดเมนอีเมลภายใน ${domain}`, true, domain === AUTH_EMAIL_DOMAIN ? 'ใช้ตามแผนได้' : 'โดเมนหลักไม่ผ่าน ต้องเปลี่ยน AUTH_EMAIL_DOMAIN');
      break;
    }
    check(`Supabase รับโดเมนอีเมลภายใน ${domain}`, false, safeMessage(created.error));
    // ลองโดเมนถัดไปเฉพาะเมื่อ error เกี่ยวกับรูปแบบ/โดเมนอีเมล (ไม่ลองซ้ำเมื่อเป็น timeout/สิทธิ์ ซึ่งอาจสร้างผู้ใช้ซ้ำ)
    if (!/email|domain|invalid|format|address/i.test(`${created.error?.code ?? ''} ${created.error?.message ?? ''}`)) break;
  }
  if (userId === null) throw new Error('สร้างผู้ใช้ทดสอบไม่ได้ทุกโดเมน');

  // 2) ธงและ trigger
  check('trigger สร้างแถว profiles ให้ผู้ใช้ที่สร้างผ่าน Admin API และธงเป็น true', (await flag()) === true, `ได้ ${String(await flag())}`);

  // 3) ล็อกอิน: รหัสผิดถูกปฏิเสธ รหัสถูกผ่าน ล็อกอิน 3 ครั้งธงต้องยังเป็น true (ไม่มี rehash ที่ปลดธง)
  const wrong = await newAnon().auth.signInWithPassword({ email, password: `${tempPassword}!` });
  check('รหัสผิดถูกปฏิเสธ', !!wrong.error, `code=${wrong.error?.code ?? '-'}`);
  const user = newAnon();
  const first = await user.auth.signInWithPassword({ email, password: tempPassword });
  check('ล็อกอินด้วยรหัสชั่วคราวผ่าน', !first.error && !!first.data.session, first.error ? safeMessage(first.error) : '');
  for (let i = 0; i < 2; i++) await newAnon().auth.signInWithPassword({ email, password: tempPassword });
  check('ล็อกอินหลายครั้งไม่ปลดธง (ไม่มี rehash ที่ทำให้ trigger เคลียร์ธง)', (await flag()) === true, `ธง=${String(await flag())}`);

  // 4) ด่าน RLS ด้วย token จริงตอนยังไม่เปลี่ยนรหัส
  const readBefore = await user.from('accounts').select('id');
  check('ยังไม่เปลี่ยนรหัส: อ่านตาราง accounts ไม่ได้ (ว่างหรือ error)', !readBefore.error ? (readBefore.data ?? []).length === 0 : true);
  const writeBefore = await user.from('accounts').insert({ id: 'spike-acc', type: 'asset', name: 'spike', currency: 'THB' });
  check('ยังไม่เปลี่ยนรหัส: เขียนตาราง accounts ไม่ได้', !!writeBefore.error, `code=${writeBefore.error?.code ?? '-'}`);

  // 5) เปลี่ยนรหัส: รหัสเดิมซ้ำถูกปฏิเสธ รหัสใหม่ผ่าน ธงถูกเคลียร์
  const same = await user.auth.updateUser({ password: tempPassword });
  check('updateUser ด้วยรหัสเดิมถูกปฏิเสธ (same_password)', !!same.error, `code=${same.error?.code ?? 'ไม่ error → ธงอาจถูกปลดโดยไม่ได้เปลี่ยนรหัสจริง'}`);
  info(`ธงหลังลองรหัสเดิม = ${String(await flag())}`);
  const changed = await user.auth.updateUser({ password: newPassword });
  check('updateUser รหัสใหม่ผ่าน', !changed.error, changed.error ? safeMessage(changed.error) : '');
  check('เปลี่ยนรหัสจริงแล้ว trigger เคลียร์ธงเป็น false', (await flag()) === false, `ธง=${String(await flag())}`);

  // 6) ด่าน RLS หลังเปลี่ยนรหัส (พิสูจน์ว่า token จริงมี session_id ที่ private.can_use_data() ตรวจผ่าน)
  const writeAfter = await user.from('accounts').insert({ id: 'spike-acc', type: 'asset', name: 'spike', currency: 'THB' });
  check('เปลี่ยนรหัสแล้ว: เขียน accounts ได้ด้วย token จริง', !writeAfter.error, writeAfter.error ? safeMessage(writeAfter.error) : '');
  const readAfter = await user.from('accounts').select('id');
  check('เปลี่ยนรหัสแล้ว: อ่าน accounts ได้ 1 แถว', !readAfter.error && (readAfter.data ?? []).length === 1);

  // 7) session: signOut(others) ลบ session จริงไหม
  const count0 = await sessionCount();
  if (count0 === null) {
    info(rpcProblem === 'missing' ? 'ข้ามข้อ session: ยังไม่ได้ใส่ migration 20261108000400 (admin_session_count)' : `ข้ามข้อ session: เรียก admin_session_count ไม่ได้ (${rpcProblem}) ตรวจสิทธิ์ service_role และชนิด key`);
    check('เรียกฟังก์ชันผู้ดูแล admin_session_count ได้', false, rpcProblem === 'missing' ? 'ฟังก์ชันไม่มี' : rpcProblem);
  } else {
    const other = newAnon();
    await other.auth.signInWithPassword({ email, password: newPassword });
    const beforeOthers = await sessionCount();
    const out = await other.auth.signOut({ scope: 'others' });
    const afterOthers = await sessionCount();
    check('signOut(others) ลบ session อื่นจริง (เหลือเฉพาะเครื่องที่สั่ง)', !out.error && afterOthers === 1, `ก่อน=${String(beforeOthers)} หลัง=${String(afterOthers)}`);

    // 8) Admin updateUserById({password}) เพิกถอน session เดิมไหม (ข้อไม่แน่ใจหลักของแผน)
    const beforeAdmin = await sessionCount();
    const adminSet = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
    const afterAdmin = await sessionCount();
    check('Admin updateUserById ตั้งรหัสสำเร็จ', !adminSet.error);
    info(`Admin updateUserById เพิกถอน session เดิมไหม: ก่อน=${String(beforeAdmin)} หลัง=${String(afterAdmin)} → ${afterAdmin === 0 ? 'ลบให้' : 'ไม่ลบ (จึงต้องเรียก admin_revoke_sessions เองเสมอ)'}`);
    info(`ธงหลัง Admin ตั้งรหัส = ${String(await flag())} (ถ้า false แปลว่าต้องตั้งธงเองหลังตั้งรหัส ตามที่ reset-password.mjs ทำ)`);

    // 9) admin_revoke_sessions: token เก่าใช้อ่านข้อมูลไม่ได้ทันที และ refresh ไม่ได้
    const stillThere = await sessionCount();
    await admin.from('profiles').update({ must_change_password: false }).eq('user_id', userId); // ให้ธงไม่ใช่ตัวขวางผลทดสอบ session
    const accessible = await user.from('accounts').select('id');
    info(`ก่อนเพิกถอนด้วย RPC: session เหลือ ${String(stillThere)} อ่านได้ ${accessible.error ? 'ไม่ได้' : String((accessible.data ?? []).length)} แถว`);
    const revoked = await admin.rpc('admin_revoke_sessions', { p_user: userId });
    check('admin_revoke_sessions ทำงานและเหลือ session 0', !revoked.error && (await sessionCount()) === 0, revoked.error ? safeMessage(revoked.error) : `ลบ ${String(revoked.data)}`);
    const readAfterRevoke = await user.from('accounts').select('id');
    check('หลังเพิกถอน: token เก่าอ่านข้อมูลไม่ได้ทันที (ไม่ต้องรอหมดอายุ)', readAfterRevoke.error ? true : (readAfterRevoke.data ?? []).length === 0);
    const refreshed = await user.auth.refreshSession();
    check('หลังเพิกถอน: refresh token เก่าใช้ต่ออายุไม่ได้', !!refreshed.error || !refreshed.data.session, `code=${refreshed.error?.code ?? '-'}`);
  }
} catch (e) {
  check('สคริปต์ทำงานครบ', false, safeMessage(e));
} finally {
  // ลบผู้ใช้ทดสอบ (เป็นผู้ใช้ที่สคริปต์นี้สร้างเอง) แล้วตรวจว่าข้อมูลหายหมดตาม cascade
  if (userId !== null) {
    if (await removeUser(userId)) {
      const { data: left } = await admin.from('profiles').select('user_id').eq('user_id', userId);
      const { data: acc } = await admin.from('accounts').select('id').eq('user_id', userId);
      check('ลบผู้ใช้ทดสอบแล้วข้อมูลหายตาม cascade', (left ?? []).length === 0 && (acc ?? []).length === 0);
    }
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nสรุป: ผ่าน ${results.length - failed} / ${results.length}`);
process.exit(failed === 0 ? 0 : 1);
