// ตัวช่วยของ admin:sql-tests (ไม่แตะไฟล์/เครือข่ายเอง) · ทดสอบใน tests/unit/sqlTests.test.ts

export const STATEMENT_TIMEOUT_MS = 120_000;

// Postgres ถือว่าอักขระที่ไม่ใช่ ASCII เป็นส่วนของชื่อได้ และ $ ต่อท้ายชื่อได้
const IDENT_START = /[A-Za-z_]|[^\x00-\x7F]/;
const IDENT_PART = /[A-Za-z0-9_$]|[^\x00-\x7F]/;
const DOLLAR_TAG = /^\$((?:[A-Za-z_]|[^\x00-\x7F])(?:[A-Za-z0-9_]|[^\x00-\x7F])*)?\$/;

/**
 * อ่าน SQL แบบแยกคำ: ตัดคอมเมนต์ (ซ้อนได้) และข้อความใน '...' / "..." ทิ้ง
 * top = คำสั่งชั้นนอก (เนื้อใน $tag$ ถูกตัด) · code = โค้ดทั้งหมดรวมเนื้อใน $tag$ (อ่านซ้อนแบบเดียวกัน)
 * ok = false เมื่อมีเครื่องหมายที่ไม่ปิด
 */
function scan(sql) {
  let top = '';
  let code = '';
  let ok = true;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n' && sql[i] !== '\r') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth += 1; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth -= 1; i += 2; }
        else i += 1;
      }
      if (depth > 0) ok = false;
      top += ' ';
      code += ' ';
      continue;
    }
    // อ่านชื่อ/คำทั้งก้อน เพื่อไม่ให้ $ หรือ e ท้ายชื่อถูกเข้าใจเป็น dollar quote หรือ E'...'
    let escapes = false;
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(sql[j])) j += 1;
      const word = sql.slice(i, j);
      top += word;
      code += word;
      i = j;
      if ((word !== 'e' && word !== 'E') || sql[j] !== "'") continue;
      escapes = true;
    }
    const q = sql[i];
    if (q === "'" || q === '"') {
      // E'...' ใช้ \ หนีอักขระ · ปกติใช้การซ้ำเครื่องหมาย
      let closed = false;
      i += 1;
      while (i < n) {
        if (escapes && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === q) {
          if (sql[i + 1] === q) { i += 2; continue; }
          closed = true;
          i += 1;
          break;
        }
        i += 1;
      }
      if (!closed) ok = false;
      top += ' ? ';
      code += ' ? ';
      continue;
    }
    if (c === '$') {
      const tag = DOLLAR_TAG.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) { ok = false; break; }
        // เนื้อใน $tag$ อาจเป็นชิ้นข้อความ (เช่น ต่อสตริง) ไม่ใช่โค้ดครบประโยค: อ่านแยกคำไม่ได้ = ตรวจจากข้อความดิบทั้งก้อน (เข้มกว่า)
        const body = sql.slice(i + tag.length, end);
        const inner = scan(body);
        top += ' ? ';
        code += ` ${inner.ok ? inner.code : body} `;
        i = end + tag.length;
        continue;
      }
    }
    top += c;
    code += c;
    i += 1;
  }
  return { top, code, ok };
}

/** คำสั่งชั้นนอกที่ควบคุมธุรกรรม */
const TX_STATEMENT = /^(begin|commit|end|rollback|abort|savepoint|release|start\s+transaction|prepare\s+transaction)\b/i;

/** สิ่งที่มีผลนอกธุรกรรม (ROLLBACK ย้อนไม่ถึง): ตรวจทั้งข้อความดิบและโค้ดที่ตัดคอมเมนต์แล้ว */
const OUTSIDE_TX = [
  /dblink|postgres_fdw|file_fdw/i,
  /\bcreate\s+(or\s+replace\s+)?(extension|server|foreign|user\s+mapping|subscription|publication)\b/i,
  /\bimport\s+foreign\s+schema\b/i,
  /\balter\s+system\b/i,
  /\bprepare\s+transaction\b/i,
  /\b(lo_import|lo_export|setval|pg_terminate_backend|pg_cancel_backend|pg_reload_conf)\b/i,
  /\bhttp(_[a-z]+)?\s*\(/i,
  /\bu&['"]/i,
];

/**
 * เหตุผลที่ห้ามรันไฟล์นี้ (ว่าง = รันได้) · เป็นด่านชั้นแรกเท่านั้น
 * คนที่ปฏิเสธ COMMIT จริงคือฐานข้อมูล (ดู runOne) ตัวอ่านข้อความนี้ไม่ใช่ตัวแยกคำของ Postgres
 */
export function sqlProblems(sql) {
  const raw = String(sql);
  const problems = [];
  const { top, code, ok } = scan(raw);
  if (!ok) problems.push('มีคอมเมนต์หรือเครื่องหมายคำพูดที่ไม่ปิด อ่านไฟล์ให้แน่ใจไม่ได้');
  // "on commit drop/delete rows/preserve rows" เป็นตัวเลือกของตารางชั่วคราว ไม่ใช่คำสั่ง COMMIT
  const withoutOnCommit = code.replace(/\bon\s+commit\s+(drop|delete\s+rows|preserve\s+rows)\b/gi, ' ');
  if (/\bcommit\b/i.test(withoutOnCommit)) problems.push('มีคำสั่ง COMMIT');
  if (/\b(rollback|abort)\b/i.test(code)) problems.push('มีคำสั่ง ROLLBACK/ABORT');
  // begin atomic ... end เป็นเนื้อฟังก์ชันแบบ SQL: ยอมให้มี end ได้เท่าจำนวนนั้น
  let atomicEnds = top.match(/\bbegin\s+atomic\b/gi)?.length ?? 0;
  const statements = top.split(';').map((s) => s.trim()).filter((s) => !(/^end$/i.test(s) && atomicEnds-- > 0));
  if (statements.some((s) => TX_STATEMENT.test(s))) problems.push('มีคำสั่งควบคุมธุรกรรมที่ชั้นนอก (BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT ฯลฯ)');
  if (OUTSIDE_TX.some((re) => re.test(raw) || re.test(code)) || /\bcopy\b/i.test(code)) {
    problems.push('มีคำสั่งที่มีผลนอกธุรกรรม (เช่น dblink, create extension/server, copy, lo_export, setval)');
  }
  if (/^\s*\\/m.test(top)) problems.push('มีคำสั่งของ psql (ขึ้นต้นด้วย \\)');
  if (!raw.includes('TESTS_PASSED')) problems.push('ไม่มีข้อความ TESTS_PASSED ปิดท้าย');
  return problems;
}

/** ผ่านเฉพาะเมื่อฐานข้อมูลตอบ error ที่ไฟล์เทสต์ raise เอง: P0001 ขึ้นต้น TESTS_PASSED */
export function classifyOutcome(error) {
  if (!error) return { passed: false, code: '', message: '', note: 'ไฟล์รันจบโดยไม่ขึ้น TESTS_PASSED' };
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return { passed: code === 'P0001' && message.startsWith('TESTS_PASSED'), code, message };
}

const WRAPPER = "do $mb$ begin execute current_setting('money_buddy.sql_file'); end $mb$";

/**
 * รันหนึ่งไฟล์ในธุรกรรมของตัวเอง แล้ว ROLLBACK ทุกกรณี
 * ทั้งไฟล์ถูกส่งเป็นพารามิเตอร์แล้ว execute ภายใน DO บล็อกเดียว: Postgres ไม่ยอมให้ COMMIT/ROLLBACK จากข้างใน
 * หลังรันต้องย้อนถึง savepoint ที่ตั้งไว้ก่อนรันได้ (= ยังอยู่ในธุรกรรมเดิม)
 */
export async function runOne(client, sql) {
  const guard = `mb_guard_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  let thrown = null;
  let inTransaction = null;
  let rolledBack = true;
  try {
    await client.query('begin');
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}; set local lock_timeout = 15000; set local idle_in_transaction_session_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query(`savepoint ${guard}`);
    try {
      await client.query("select set_config('money_buddy.sql_file', $1, true)", [sql]);
      await client.query(WRAPPER);
    } catch (e) {
      thrown = e;
    }
    try {
      await client.query(`rollback to savepoint ${guard}`);
      inTransaction = true;
    } catch {
      inTransaction = false;
    }
  } catch (e) {
    thrown ??= e;
  } finally {
    try {
      await client.query('rollback');
    } catch {
      rolledBack = false;
    }
  }
  const outcome = { ...classifyOutcome(thrown), inTransaction };
  if (inTransaction === false) return { ...outcome, passed: false, note: 'ยืนยันไม่ได้ว่ายังอยู่ในธุรกรรมเดิมหลังรัน (ต้องตรวจฐานข้อมูล)' };
  if (!rolledBack) return { ...outcome, passed: false, note: 'สั่ง ROLLBACK ไม่สำเร็จ' };
  return outcome;
}

const PROBE_HEAD = 'create temp table mb_probe (x int); insert into mb_probe values (1);';

/** ข้อพิสูจน์ที่รันกับฐานข้อมูลก่อนไฟล์จริงทุกครั้ง · เขียนเฉพาะ temp table · ไม่ได้อยู่ใน supabase/tests */
export const PROBES = [
  { name: 'หลายคำสั่งรันในบล็อกได้', expect: 'P0001', sql: `${PROBE_HEAD} do $p$ begin if (select count(*) from mb_probe) = 1 then raise exception 'TESTS_PASSED probe'; end if; end $p$;` },
  { name: 'COMMIT ถูกปฏิเสธ', expect: '0A000', sql: `${PROBE_HEAD} commit;` },
  { name: 'END ถูกปฏิเสธ', expect: '0A000', sql: `${PROBE_HEAD} end;` },
  { name: 'ROLLBACK ถูกปฏิเสธ', expect: '0A000', sql: `${PROBE_HEAD} rollback;` },
  { name: 'COMMIT ในบล็อกซ้อนถูกปฏิเสธ', expect: '2D000', sql: `${PROBE_HEAD} do $p$ begin commit; end $p$;` },
];

/** connect() ต้องคืนการเชื่อมต่อใหม่ (มี query และ end) · ok เมื่อทุกข้อได้รหัสตามคาด ยังอยู่ในธุรกรรมเดิม และ temp table ไม่ค้าง */
export async function runProbes(connect) {
  const results = [];
  for (const probe of PROBES) {
    const client = await connect();
    const outcome = await runOne(client, probe.sql);
    let gone = false;
    try {
      gone = (await client.query("select to_regclass('pg_temp.mb_probe') is null as gone")).rows[0]?.gone === true;
    } catch {
      gone = false;
    }
    await client.end().catch(() => {});
    const ok = outcome.code === probe.expect && outcome.passed === (probe.expect === 'P0001') && outcome.inTransaction === true && gone;
    results.push({ name: probe.name, ok, code: outcome.code });
  }
  return { ok: results.every((r) => r.ok), results };
}

/** ตัวแปรที่ไลบรารี pg อ่านเองจาก shell (เปลี่ยนการเชื่อมต่อหรือค่าเซสชันได้) · บอกเฉพาะชื่อ */
export function pgEnvProblem(env) {
  const names = Object.keys(env).filter((k) => {
    const u = k.toUpperCase();
    return u === 'NODE_PG_FORCE_NATIVE' || (u.startsWith('PG') && u !== 'PGDATA' && u !== 'PGROOT');
  });
  return names.length === 0 ? null : `ปฏิเสธ: พบตัวแปร ${names.join(', ')} ใน environment ของ shell ให้ลบออกก่อน`;
}

/** ส่วนขยายที่ออกนอกธุรกรรมได้ ถ้ามีในฐานข้อมูล ด่านตรวจข้อความอย่างเดียวไม่พอ */
export const OUTSIDE_TX_EXTENSIONS = ['dblink', 'postgres_fdw', 'file_fdw', 'http', 'plpython3u', 'plperlu', 'pltclu'];

export function serverProblem({ extensions, foreignServers }) {
  if (extensions.length > 0) return `ฐานข้อมูลมีส่วนขยายที่ทำงานนอกธุรกรรมได้: ${extensions.join(', ')} (ไม่รัน)`;
  if (foreignServers > 0) return 'ฐานข้อมูลมี foreign server ตั้งไว้ (ไม่รัน)';
  return null;
}

/** ลายนิ้วมือโครงสร้าง (แฮชต่อหมวด ไม่อ่านข้อมูลในตารางของแอป) ใช้เทียบก่อน/หลังรัน */
export const FINGERPRINT_SQL = `
with ns as (select oid, nspname from pg_namespace where nspname in ('public', 'private', 'auth', 'storage')),
rel as (select c.* from pg_class c join ns on ns.oid = c.relnamespace where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')),
items(k, v) as (
  select 'functions', concat_ws('|', p.oid::regprocedure, md5(p.prosrc), p.prosecdef, p.provolatile, p.proconfig::text, p.proacl::text, p.proowner::regrole) from pg_proc p join ns on ns.oid = p.pronamespace
  union all select 'policies', concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check) from pg_policies
  union all select 'relations', concat_ws('|', oid::regclass, relkind, relrowsecurity, relforcerowsecurity, relacl::text, relowner::regrole, reloptions::text, case when relkind in ('v', 'm') then md5(pg_get_viewdef(oid)) end) from rel
  union all select 'columns', concat_ws('|', a.attrelid::regclass, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attacl::text, pg_get_expr(d.adbin, d.adrelid)) from pg_attribute a join rel on rel.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attnum > 0 and not a.attisdropped
  union all select 'constraints', concat_ws('|', co.conrelid::regclass, co.conname, co.convalidated, pg_get_constraintdef(co.oid)) from pg_constraint co join ns on ns.oid = co.connamespace
  union all select 'triggers', concat_ws('|', t.tgenabled, pg_get_triggerdef(t.oid)) from pg_trigger t join rel on rel.oid = t.tgrelid where not t.tgisinternal
  union all select 'indexes', concat_ws('|', schemaname, indexname, indexdef) from pg_indexes where schemaname in (select nspname from ns)
  union all select 'default_privileges', concat_ws('|', defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl::text) from pg_default_acl
  union all select 'extensions', concat_ws('|', extname, extversion) from pg_extension
  union all select 'roles', concat_ws('|', rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit, rolconfig::text) from pg_roles
  union all select 'role_members', concat_ws('|', roleid::regrole, member::regrole, admin_option) from pg_auth_members
)
select k, md5(string_agg(coalesce(v, ''), chr(10) order by v)) as h from items group by k order by k`;

/** ชื่อรายการที่ต่างกันระหว่างสอง snapshot (รวมที่หายหรือเพิ่ม) */
export function snapshotChanges(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k)).sort();
}

const bad = (message) => ({ ok: false, message });

/** แยกส่วนของ connection string · ข้อความผิดพลาดห้ามมีค่าใดจาก URL */
export function parseDbUrl(raw) {
  if (!raw) return bad('ไม่มีค่า SUPABASE_DB_URL ใน admin.env');
  let url;
  try {
    url = new URL(raw);
  } catch {
    return bad('SUPABASE_DB_URL ไม่ใช่ connection string ที่ถูกต้อง (ถ้ารหัสผ่านมีอักขระพิเศษ ต้องเข้ารหัสแบบ % ก่อน)');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return bad('SUPABASE_DB_URL ต้องขึ้นต้นด้วย postgresql://');
  const host = url.hostname.toLowerCase();
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host);
  if (!direct && !pooler) return bad('โฮสต์ใน SUPABASE_DB_URL ต้องเป็นของ Supabase (direct หรือ session pooler)');
  const port = Number(url.port || 5432);
  if (port !== 5432) return bad('ใช้พอร์ต 5432 เท่านั้น (direct หรือ session pooler) · ไม่ใช้ transaction pooler 6543');
  let user;
  let password;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    return bad('ชื่อผู้ใช้หรือรหัสผ่านใน SUPABASE_DB_URL เข้ารหัส % ไม่ถูกต้อง');
  }
  if (!user || !password || /^\[.*\]$/.test(password)) return bad('SUPABASE_DB_URL ยังไม่มีชื่อผู้ใช้หรือรหัสผ่านจริง (แทนที่ [YOUR-PASSWORD] ด้วยรหัสของฐานข้อมูล)');
  const ref = direct ? direct[1] : (/^[a-z_]+\.([a-z0-9]{20})$/.exec(user)?.[1] ?? '');
  const database = url.pathname.replace(/^\//, '') || 'postgres';
  return { ok: true, config: { host, port, user, password, database }, ref };
}

/** โปรเจกต์ของ connection string ต้องตรงกับ SUPABASE_URL ในไฟล์เดียวกัน */
export function projectRefProblem(ref, supabaseUrl) {
  let expected = '';
  try {
    expected = new URL(supabaseUrl).hostname.split('.')[0] ?? '';
  } catch {
    expected = '';
  }
  return ref !== '' && ref === expected ? null : 'SUPABASE_DB_URL ไม่ใช่โปรเจกต์เดียวกับ SUPABASE_URL (ไม่รัน)';
}

/** ข้อความที่พิมพ์ได้: ตัดความลับทุกตัว (ยาว ≥ 3) URL โฮสต์ อีเมล uuid และตัวเลขตั้งแต่ 4 หลัก */
export function safeText(text, secrets) {
  let out = String(text);
  for (const s of [...secrets].filter((x) => typeof x === 'string' && x.length >= 3).sort((a, b) => b.length - a.length)) out = out.split(s).join('***');
  return out
    .replace(/postgres(ql)?:\/\/\S+/gi, '***')
    .replace(/[A-Za-z0-9.-]+\.supabase\.(co|com)/gi, '***')
    .replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, '***')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '***')
    .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}/g, '***')
    .slice(0, 300);
}

const TX_REFUSED = { '0A000': 'EXECUTE of transaction commands is not implemented', '2D000': 'invalid transaction termination' };

/**
 * รายละเอียดผลที่พิมพ์ได้: รหัส error เสมอ · ข้อความจากฐานข้อมูลพิมพ์เฉพาะรูปแบบของไฟล์เทสต์ (P0001 FAIL/TESTS_PASSED)
 * ข้อความ error อื่นอาจมีชื่อหรือค่าจากข้อมูลจริง จึงไม่พิมพ์
 */
export function reportDetail(outcome, secrets) {
  const code = String(outcome.code ?? '');
  const message = String(outcome.message ?? '');
  let detail = /^[0-9A-Z]{5}$/.test(code) ? code : safeText(code, secrets);
  if (code === 'P0001' && /^(FAIL|TESTS_PASSED)/.test(message)) detail = `${code} ${safeText(message, secrets)}`;
  else if (message !== '' && TX_REFUSED[code] === message) detail = `${code} ฐานข้อมูลปฏิเสธคำสั่งควบคุมธุรกรรม`;
  return [outcome.note, detail].filter(Boolean).join(' · ') || 'ไม่ทราบรหัส';
}

/** เลือกไฟล์จากรายชื่อใน supabase/tests เท่านั้น (อาร์กิวเมนต์ = ชื่อไฟล์ล้วน ห้ามพาธ) */
export function selectFiles(available, args) {
  const sql = available.filter((f) => /^[A-Za-z0-9_]+\.sql$/.test(f)).sort();
  if (args.length === 0) return sql.length > 0 ? { ok: true, files: sql } : bad('ไม่พบไฟล์เทสต์');
  if (args.some((a) => !sql.includes(a))) return bad('ระบุได้เฉพาะชื่อไฟล์ .sql ที่อยู่ใน supabase/tests/ (ไม่ใส่พาธ)');
  return { ok: true, files: sql.filter((f) => args.includes(f)) };
}
