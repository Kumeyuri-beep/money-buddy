// รันชุดเทสต์ SQL ใน supabase/tests/ กับฐานข้อมูลจริง (เจ้าของสั่ง 26-27 พ.ย. 2569)
//   MONEY_BUDDY_SQL_TESTS=yes npm run admin:sql-tests                   ทุกไฟล์
//   MONEY_BUDDY_SQL_TESTS=yes npm run admin:sql-tests -- a_test.sql     เฉพาะไฟล์ที่ระบุ (ชื่อไฟล์ล้วน)
//   MONEY_BUDDY_SQL_TESTS=yes npm run admin:sql-tests -- --prove-only   รันเฉพาะข้อพิสูจน์ (เขียนแค่ temp table)
// แต่ละไฟล์ใช้การเชื่อมต่อและธุรกรรมของตัวเอง รันทั้งไฟล์ผ่าน execute ในบล็อกเดียว (ฐานข้อมูลปฏิเสธ COMMIT เอง) แล้ว ROLLBACK เสมอ
// ค่าเชื่อมต่อ SUPABASE_DB_URL อยู่ใน <โฟลเดอร์บ้าน>/.money-buddy-admin/admin.env เท่านั้น · ห้ามพิมพ์ค่าเชื่อมต่อ/รหัสผ่านลงข้อความใดๆ
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { fail, loadDbUrl } from './lib/admin.mjs';
import { ADMIN_DIR_NAME } from './lib/adminEnv.mjs';
import {
  FINGERPRINT_SQL, OUTSIDE_TX_EXTENSIONS, parseDbUrl, pgEnvProblem, projectRefProblem, reportDetail, runOne, runProbes,
  safeText, selectFiles, serverProblem, snapshotChanges, sqlProblems,
} from './lib/sqlTests.mjs';

let secrets = [];

// error ที่ไม่มีใครจับ: พิมพ์แค่รหัส (ข้อความของไลบรารีอาจมีค่าเชื่อมต่อหรือข้อมูลจริง) · แทนตัวจับกลางของ admin.mjs ที่พิมพ์ข้อความ
function stop(error) {
  fail(`หยุด: เกิดข้อผิดพลาด (${safeText(String(error?.code ?? 'ไม่ทราบรหัส'), secrets)})`, 1);
}
process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', stop);
process.on('uncaughtException', stop);

function readScripts(args) {
  const testsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'tests');
  const names = readdirSync(testsDir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  const selected = selectFiles(names, args);
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
  return scripts;
}

async function main() {
  if (process.env.MONEY_BUDDY_SQL_TESTS !== 'yes') {
    fail('ต้องตั้ง MONEY_BUDDY_SQL_TESTS=yes ก่อนจึงจะรัน (กันรันกับฐานข้อมูลจริงโดยไม่ตั้งใจ)');
  }
  const envProblem = pgEnvProblem(process.env);
  if (envProblem) fail(envProblem);

  const args = process.argv.slice(2);
  const proveOnly = args.includes('--prove-only');
  if (proveOnly && args.length > 1) fail('--prove-only ใช้เดี่ยวๆ (ไม่ใส่ชื่อไฟล์)');
  const scripts = proveOnly ? [] : readScripts(args);

  const { url, dbUrl } = loadDbUrl();
  const parsed = parseDbUrl(dbUrl);
  if (!parsed.ok) fail(parsed.message);
  const mismatch = projectRefProblem(parsed.ref, url);
  if (mismatch) fail(mismatch);
  secrets = [dbUrl, parsed.config.password, parsed.config.user, parsed.config.host, parsed.ref];

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

  /** งานอ่านอย่างเดียวบนการเชื่อมต่อของตัวเอง ในธุรกรรมแบบ read only */
  async function readOnly(label, work) {
    const client = await connect();
    try {
      await client.query('begin read only');
      const result = await work(client);
      await client.query('rollback');
      return result;
    } catch (e) {
      return fail(`${label}ไม่สำเร็จ (${safeText(String(e?.code ?? 'ไม่ทราบรหัส'), secrets)})`, 1);
    } finally {
      await client.end().catch(() => {});
    }
  }

  const server = await readOnly('ตรวจฐานข้อมูล', async (client) => ({
    extensions: (await client.query('select extname from pg_extension where extname = any($1)', [OUTSIDE_TX_EXTENSIONS])).rows.map((r) => r.extname),
    foreignServers: (await client.query('select count(*)::int as n from pg_foreign_server')).rows[0].n,
  }));
  const blocked = serverProblem(server);
  if (blocked) fail(blocked, 1);

  // พิสูจน์กับฐานข้อมูลจริงก่อนทุกครั้ง: เขียนแค่ temp table แล้วสั่ง COMMIT ฯลฯ ต้องถูกปฏิเสธ
  const proof = await runProbes(connect);
  for (const r of proof.results) console.log(`${r.ok ? 'พิสูจน์ผ่าน' : 'พิสูจน์ล้ม'}: ${r.name} (${safeText(r.code, secrets)})`);
  if (!proof.ok) fail('ข้อพิสูจน์ไม่ผ่าน ไม่ได้รันไฟล์ใดเลย', 1);
  if (proveOnly) return 0;

  /** จำนวนแถว (นับอย่างเดียว) และลายนิ้วมือโครงสร้าง */
  const snapshot = () => readOnly('เก็บสถานะก่อน/หลังรัน', async (client) => {
    const state = new Map();
    const tables = await client.query(
      "select format('%I.%I', table_schema, table_name) as t from information_schema.tables where table_type = 'BASE TABLE' and (table_schema in ('public', 'private') or (table_schema = 'auth' and table_name = 'users')) order by 1",
    );
    for (const row of tables.rows) state.set(`จำนวนแถว ${row.t}`, (await client.query(`select count(*)::text as n from ${row.t}`)).rows[0].n);
    for (const row of (await client.query(FINGERPRINT_SQL)).rows) state.set(`โครงสร้าง ${row.k}`, row.h);
    return state;
  });

  const before = await snapshot();
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
      console.log(`ล้ม ${label}: ${reportDetail(outcome, secrets)}`);
      if (outcome.inTransaction === false) break; // สถานะฐานข้อมูลไม่แน่นอน หยุดทันที
    }
  }
  const changed = snapshotChanges(before, await snapshot());

  console.log(`\nสรุป: TESTS_PASSED ${passed}/${scripts.length} ไฟล์ · ล้ม ${failed.length}`);
  if (failed.length > 0) console.log(`ไฟล์ที่ล้ม: ${failed.join(', ')}`);
  console.log(changed.length === 0
    ? 'จำนวนแถวและโครงสร้าง (ฟังก์ชัน policy สิทธิ์ ฯลฯ) เท่าก่อนรัน · เป็นการตรวจเสริม จับการแก้ค่าในแถวเดิมไม่ได้'
    : `คำเตือน: เปลี่ยนจากก่อนรัน: ${changed.join(', ')} (อาจมีผู้ใช้ใช้งานระหว่างรัน หรือมีของทดสอบค้าง ต้องตรวจ)`);
  return failed.length === 0 && changed.length === 0 ? 0 : 1;
}

main().catch(stop).then((code) => process.exit(code));
