// รันชุดเทสต์ SQL ใน supabase/tests/ กับฐานข้อมูลจริง (เจ้าของสั่ง 26 พ.ย. 2569)
//   MONEY_BUDDY_SQL_TESTS=yes npm run admin:sql-tests                 ทุกไฟล์
//   MONEY_BUDDY_SQL_TESTS=yes npm run admin:sql-tests -- a_test.sql   เฉพาะไฟล์ที่ระบุ (ชื่อไฟล์ล้วน)
// แต่ละไฟล์ใช้การเชื่อมต่อและธุรกรรมของตัวเอง แล้ว ROLLBACK เสมอ · ไฟล์ที่มี COMMIT/คำสั่งควบคุมธุรกรรม = ไม่รันเลยทั้งชุด
// ค่าเชื่อมต่อ SUPABASE_DB_URL อยู่ใน <โฟลเดอร์บ้าน>/.money-buddy-admin/admin.env เท่านั้น · ห้ามพิมพ์ค่าเชื่อมต่อ/รหัสผ่านลงข้อความใดๆ
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { fail, loadAdmin } from './lib/admin.mjs';
import { ADMIN_DIR_NAME } from './lib/adminEnv.mjs';
import { parseDbUrl, projectRefProblem, runOne, safeText, selectFiles, sqlProblems } from './lib/sqlTests.mjs';

if (process.env.MONEY_BUDDY_SQL_TESTS !== 'yes') {
  fail('ต้องตั้ง MONEY_BUDDY_SQL_TESTS=yes ก่อนจึงจะรัน (กันรันกับฐานข้อมูลจริงโดยไม่ตั้งใจ)');
}

const testsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'tests');
const names = readdirSync(testsDir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
const selected = selectFiles(names, process.argv.slice(2));
if (!selected.ok) fail(selected.message);

// ตรวจทุกไฟล์ก่อนต่อฐานข้อมูล: มีไฟล์เสี่ยงแม้ไฟล์เดียว = ไม่รันอะไรเลย
const scripts = selected.files.map((name) => {
  const path = resolve(testsDir, name);
  if (lstatSync(path).isSymbolicLink()) fail(`ปฏิเสธ: ${name} เป็นลิงก์`);
  return { name, sql: readFileSync(path, 'utf8') };
});
const refused = scripts.map((s) => ({ name: s.name, problems: sqlProblems(s.sql) })).filter((s) => s.problems.length > 0);
if (refused.length > 0) {
  for (const r of refused) console.error(`ปฏิเสธ ${r.name}: ${r.problems.join(' · ')}`);
  fail('ไม่ได้รันไฟล์ใดเลย');
}

const { url, dbUrl } = loadAdmin();
const parsed = parseDbUrl(dbUrl);
if (!parsed.ok) fail(parsed.message);
const mismatch = projectRefProblem(parsed.ref, url);
if (mismatch) fail(mismatch);
const secrets = [dbUrl, parsed.config.password, parsed.config.user, parsed.config.host, parsed.ref];

// ตรวจใบรับรองของเซิร์ฟเวอร์เสมอ · ใบรับรองรากของ Supabase วางไว้ข้างไฟล์ admin.env (นอกโปรเจกต์)
const caFile = resolve(homedir(), ADMIN_DIR_NAME, 'supabase-ca.crt');
const ssl = { rejectUnauthorized: true, ...(existsSync(caFile) ? { ca: readFileSync(caFile, 'utf8') } : {}) };

async function connect() {
  const client = new pg.Client({ ...parsed.config, ssl, connectionTimeoutMillis: 20_000, application_name: 'money-buddy-sql-tests' });
  client.on('error', () => {}); // ข้อความของไลบรารีอาจมีค่าเชื่อมต่อ ไม่พิมพ์ · คำสั่งถัดไปจะล้มและรายงานแบบปิดบังแล้ว
  try {
    await client.connect();
  } catch (e) {
    const code = safeText(String(e?.code ?? ''), secrets);
    const hint = /CERT|SELF_SIGNED|UNABLE_TO/.test(code)
      ? ' · ดาวน์โหลดใบรับรองจาก Supabase Dashboard (Database Settings > SSL) มาไว้ที่ <โฟลเดอร์บ้าน>/.money-buddy-admin/supabase-ca.crt'
      : ' · ตรวจรหัสผ่าน โฮสต์ และชนิดการเชื่อมต่อ (เน็ตที่ไม่มี IPv6 ต้องใช้ session pooler)';
    fail(`เชื่อมต่อฐานข้อมูลไม่ได้ (${code || 'ไม่ทราบรหัส'})${hint}`, 1);
  }
  return client;
}

/** จำนวนแถวของตารางข้อมูล (นับอย่างเดียว ไม่อ่านเนื้อหา) ใช้ยืนยันว่าไม่มีอะไรค้างหลังรัน */
async function rowCounts() {
  const client = await connect();
  try {
    const tables = await client.query(
      "select format('%I.%I', table_schema, table_name) as t from information_schema.tables where table_type = 'BASE TABLE' and (table_schema in ('public', 'private') or (table_schema = 'auth' and table_name = 'users')) order by 1",
    );
    const counts = new Map();
    for (const row of tables.rows) counts.set(row.t, (await client.query(`select count(*)::text as n from ${row.t}`)).rows[0].n);
    return counts;
  } catch (e) {
    return fail(`นับจำนวนแถวไม่สำเร็จ: ${safeText(`${e?.code ?? ''} ${e?.message ?? ''}`, secrets)}`, 1);
  } finally {
    await client.end().catch(() => {});
  }
}

const before = await rowCounts();
let passed = 0;
const failed = [];
for (const [index, script] of scripts.entries()) {
  const client = await connect();
  const started = Date.now();
  const outcome = await runOne(client, script.sql);
  await client.end().catch(() => {});
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const label = `[${index + 1}/${scripts.length}] ${script.name} (${seconds}s)`;
  if (outcome.passed) {
    passed += 1;
    console.log(`TESTS_PASSED ${label}`);
  } else {
    failed.push(script.name);
    console.log(`ล้ม ${label}: ${safeText(`${outcome.code} ${outcome.message}`, secrets)}`);
  }
}
const after = await rowCounts();
const changed = [...new Set([...before.keys(), ...after.keys()])].filter((t) => before.get(t) !== after.get(t));

console.log(`\nสรุป: TESTS_PASSED ${passed}/${scripts.length} ไฟล์ · ล้ม ${failed.length}`);
if (failed.length > 0) console.log(`ไฟล์ที่ล้ม: ${failed.join(', ')}`);
console.log(changed.length === 0 ? `จำนวนแถวเท่าก่อนรันทุกตาราง (${before.size} ตาราง)` : `คำเตือน: จำนวนแถวเปลี่ยนในตาราง ${changed.join(', ')} (อาจมีผู้ใช้ใช้งานระหว่างรัน หรือมีข้อมูลทดสอบค้าง ต้องตรวจ)`);
process.exit(failed.length === 0 && changed.length === 0 ? 0 : 1);
