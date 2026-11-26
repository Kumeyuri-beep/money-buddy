// ตัวช่วยล้วนของ admin:sql-tests (ไม่แตะไฟล์/เครือข่าย) · ทดสอบใน tests/unit/sqlTests.test.ts

export const STATEMENT_TIMEOUT_MS = 120_000;

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
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end;
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
    if (c === "'" || c === '"') {
      // E'...' ใช้ \ หนีอักขระ · ปกติใช้การซ้ำเครื่องหมาย
      const escapes = c === "'" && /(^|[^A-Za-z0-9_])[eE]$/.test(sql.slice(Math.max(0, i - 2), i));
      let closed = false;
      i += 1;
      while (i < n) {
        if (escapes && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === c) {
          if (sql[i + 1] === c) { i += 2; continue; }
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
    if (c === '$' && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
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

/** คำสั่งชั้นนอกที่ควบคุมธุรกรรม: จบ/เปิดธุรกรรมเองได้ คำสั่งหลังจากนั้นจะค้างในฐานข้อมูล */
const TX_STATEMENT = /^(begin|commit|end|rollback|abort|savepoint|release|start\s+transaction|prepare\s+transaction)\b/i;

/** เหตุผลที่ห้ามรันไฟล์นี้ (ว่าง = รันได้) */
export function sqlProblems(sql) {
  const problems = [];
  const { top, code, ok } = scan(String(sql));
  if (!ok) problems.push('มีคอมเมนต์หรือเครื่องหมายคำพูดที่ไม่ปิด อ่านไฟล์ให้แน่ใจไม่ได้');
  // "on commit drop/delete rows/preserve rows" เป็นตัวเลือกของตารางชั่วคราว ไม่ใช่คำสั่ง COMMIT
  const withoutOnCommit = code.replace(/\bon\s+commit\s+(drop|delete\s+rows|preserve\s+rows)\b/gi, ' ');
  if (/\bcommit\b/i.test(withoutOnCommit)) problems.push('มีคำสั่ง COMMIT');
  if (top.split(';').some((s) => TX_STATEMENT.test(s.trim()))) problems.push('มีคำสั่งควบคุมธุรกรรมที่ชั้นนอก (BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT ฯลฯ)');
  if (/^\s*\\/m.test(top)) problems.push('มีคำสั่งของ psql (ขึ้นต้นด้วย \\)');
  if (!String(sql).includes('TESTS_PASSED')) problems.push('ไม่มีข้อความ TESTS_PASSED ปิดท้าย');
  return problems;
}

/** ผ่านเฉพาะเมื่อฐานข้อมูลตอบ error ที่ไฟล์เทสต์ raise เอง: P0001 ขึ้นต้น TESTS_PASSED */
export function classifyOutcome(error) {
  if (!error) return { passed: false, code: '', message: 'ไฟล์รันจบโดยไม่ขึ้น TESTS_PASSED' };
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return { passed: code === 'P0001' && message.startsWith('TESTS_PASSED'), code, message };
}

/** รันหนึ่งไฟล์ในธุรกรรมของตัวเอง แล้ว ROLLBACK ทุกกรณี · rollback ล้ม = ไม่ผ่าน */
export async function runOne(client, sql) {
  let thrown = null;
  let rolledBack = true;
  try {
    await client.query('begin');
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}; set local lock_timeout = 15000; set local idle_in_transaction_session_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query(sql);
  } catch (e) {
    thrown = e;
  } finally {
    try {
      await client.query('rollback');
    } catch {
      rolledBack = false;
    }
  }
  const outcome = classifyOutcome(thrown);
  if (!rolledBack) return { ...outcome, passed: false, message: `สั่ง ROLLBACK ไม่สำเร็จ · ${outcome.message}` };
  return outcome;
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

/** ข้อความที่พิมพ์ได้: ตัดความลับทุกตัว (ยาว ≥ 3) URL โฮสต์ อีเมล และตัวเลขตั้งแต่ 5 หลัก */
export function safeText(text, secrets) {
  let out = String(text);
  for (const s of [...secrets].filter((x) => typeof x === 'string' && x.length >= 3).sort((a, b) => b.length - a.length)) out = out.split(s).join('***');
  return out
    .replace(/postgres(ql)?:\/\/\S+/gi, '***')
    .replace(/[A-Za-z0-9.-]+\.supabase\.(co|com)/gi, '***')
    .replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, '***')
    .replace(/\d{5,}/g, '***')
    .slice(0, 300);
}

/** เลือกไฟล์จากรายชื่อใน supabase/tests เท่านั้น (อาร์กิวเมนต์ = ชื่อไฟล์ล้วน ห้ามพาธ) */
export function selectFiles(available, args) {
  const sql = available.filter((f) => /^[A-Za-z0-9_]+\.sql$/.test(f)).sort();
  if (args.length === 0) return sql.length > 0 ? { ok: true, files: sql } : bad('ไม่พบไฟล์เทสต์');
  if (args.some((a) => !sql.includes(a))) return bad('ระบุได้เฉพาะชื่อไฟล์ .sql ที่อยู่ใน supabase/tests/ (ไม่ใส่พาธ)');
  return { ok: true, files: sql.filter((f) => args.includes(f)) };
}
