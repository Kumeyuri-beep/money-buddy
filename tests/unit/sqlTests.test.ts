import { describe, expect, it } from 'vitest';
import {
  classifyOutcome, parseDbUrl, projectRefProblem, runOne, safeText, selectFiles, sqlProblems,
} from '../../scripts/lib/sqlTests.mjs';

/** admin:sql-tests (เจ้าของสั่ง 26 พ.ย. 2569): รันเฉพาะ supabase/tests ทีละไฟล์ในธุรกรรมของตัวเองแล้ว ROLLBACK เสมอ · ค่าทั้งหมดในเทสต์นี้เป็นของสมมติ */
const files = import.meta.glob('/supabase/tests/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const runnerSrc = Object.values(import.meta.glob('/scripts/sql-tests.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const pkg = Object.values(import.meta.glob('/package.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

const OK_BODY = `do $t$ begin raise exception 'TESTS_PASSED (rollback)'; end $t$;`;
const bad = (sql: string) => sqlProblems(`${sql}\n${OK_BODY}`);

describe('sqlProblems: ปฏิเสธไฟล์ที่ทำให้ข้อมูลค้างได้', () => {
  it('ไฟล์เทสต์จริงทุกไฟล์ผ่านด่าน (กัน glob ว่าง)', () => {
    expect(Object.keys(files).length).toBeGreaterThan(25);
    for (const [path, sql] of Object.entries(files)) expect(sqlProblems(sql), path).toEqual([]);
  });
  it.each([
    'commit;',
    'COMMIT ;',
    'select 1; Commit;',
    'commit and chain;',
    'end;',
    'end transaction;',
    'rollback;',
    'abort;',
    'begin;',
    'start transaction;',
    "prepare transaction 'x';",
    'savepoint s1;',
    'release s1;',
    '/* x */ commit;',
    '-- x\ncommit;',
    "select 'a'';'; commit;",
    'select E\'a\\\'b\'; commit;',
    'select "we;ird"; commit;',
    'do $$ begin commit; end $$;',
    'do $a$ begin execute $b$ commit $b$; end $a$;',
    "do $a$ begin perform $$ x = ' $$; commit; end $a$;",
    "do $a$ begin perform $$ ' commit $$; end $a$;",
    'create procedure pg_temp.p() language plpgsql as $$ begin COMMIT; end $$;',
    '\\i other.sql',
    '  \\connect postgres',
  ])('ปฏิเสธ: %s', (sql) => {
    expect(bad(sql).length).toBeGreaterThan(0);
  });
  it.each([
    "-- ล้มตอน commit\nselect 1;",
    '/* commit; /* ซ้อน commit; */ end; */ select 1;',
    "select 'ต้อง commit; ก่อน';",
    'create function pg_temp.f() returns void language plpgsql as $$ begin perform 1; end $$;',
    'do $t$ begin if true then null; end if; end $t$;',
    "select case when 1 = 1 then 'a' end;",
    'create temp table c (x int) on commit drop;',
    "do $t$ begin perform f($$ delete from x where u = '$$ || 'a' || $$' and i = 1 $$); end $t$;",
  ])('ยอมรับ: %s', (sql) => {
    expect(bad(sql)).toEqual([]);
  });
  it('ไม่มี TESTS_PASSED = ปฏิเสธ (รู้ไม่ได้ว่าจบครบ)', () => {
    expect(sqlProblems('select 1;').join(' ')).toMatch(/TESTS_PASSED/);
  });
  it('เครื่องหมายคำพูด/คอมเมนต์ที่ไม่ปิด = ปฏิเสธ (อ่านไฟล์ไม่แน่ใจ)', () => {
    expect(bad("select 'abc;").length).toBeGreaterThan(0);
    expect(sqlProblems(`${OK_BODY}\n/* ไม่ปิด`).length).toBeGreaterThan(0);
    expect(sqlProblems(`${OK_BODY}\ndo $x$ begin`).length).toBeGreaterThan(0);
  });
});

describe('runOne: ธุรกรรมของตัวเองและ ROLLBACK เสมอ', () => {
  const fake = (onFile: () => void, failRollback = false) => {
    const calls: string[] = [];
    return {
      calls,
      client: {
        query: (sql: string) => {
          calls.push(sql);
          if (sql === 'FILE') onFile();
          if (sql === 'rollback' && failRollback) return Promise.reject(new Error('lost'));
          return Promise.resolve({});
        },
      },
    };
  };
  const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

  it('ลำดับ: begin → ตั้ง timeout → ไฟล์ → rollback', async () => {
    const f = fake(() => { throw pgError('P0001', 'TESTS_PASSED (rollback แล้ว)'); });
    expect(await runOne(f.client, 'FILE')).toMatchObject({ passed: true });
    expect(f.calls[0]).toBe('begin');
    expect(f.calls[1]).toMatch(/set local statement_timeout/i);
    expect(f.calls.slice(-2)).toEqual(['FILE', 'rollback']);
  });
  it('ล้ม (FAIL: จากเทสต์ หรือ error อื่น) ก็ rollback', async () => {
    for (const e of [pgError('P0001', 'FAIL: T1 ผิด'), pgError('57014', 'canceling statement due to statement timeout'), pgError('42P01', 'relation does not exist')]) {
      const f = fake(() => { throw e; });
      expect(await runOne(f.client, 'FILE')).toMatchObject({ passed: false, code: e.code });
      expect(f.calls.at(-1)).toBe('rollback');
    }
  });
  it('ไฟล์จบโดยไม่ raise = ไม่ผ่าน และยัง rollback', async () => {
    const f = fake(() => {});
    expect(await runOne(f.client, 'FILE')).toMatchObject({ passed: false });
    expect(f.calls.at(-1)).toBe('rollback');
  });
  it('rollback ล้ม = ไม่ผ่านแม้ขึ้น TESTS_PASSED', async () => {
    const f = fake(() => { throw pgError('P0001', 'TESTS_PASSED'); }, true);
    expect(await runOne(f.client, 'FILE')).toMatchObject({ passed: false });
  });
});

describe('classifyOutcome', () => {
  it('ผ่านเฉพาะ P0001 ที่ขึ้นต้น TESTS_PASSED', () => {
    expect(classifyOutcome({ code: 'P0001', message: 'TESTS_PASSED x' }).passed).toBe(true);
    expect(classifyOutcome({ code: '23505', message: 'TESTS_PASSED x' }).passed).toBe(false);
    expect(classifyOutcome({ code: 'P0001', message: 'FAIL: TESTS_PASSED' }).passed).toBe(false);
    expect(classifyOutcome(null).passed).toBe(false);
  });
});

describe('parseDbUrl', () => {
  const pw = 'p%40ss-W0rd';
  const session = `postgresql://postgres.abcdefghijklmnopqrst:${pw}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
  const direct = `postgres://postgres:${pw}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=disable`;
  it('session pooler และ direct · ถอดรหัส % ในรหัสผ่าน · ไม่เอาพารามิเตอร์ใน URL (ปิด SSL ไม่ได้)', () => {
    const a = parseDbUrl(session);
    expect(a).toMatchObject({ ok: true, config: { host: 'aws-0-ap-southeast-1.pooler.supabase.com', port: 5432, user: 'postgres.abcdefghijklmnopqrst', password: 'p@ss-W0rd', database: 'postgres' }, ref: 'abcdefghijklmnopqrst' });
    const b = parseDbUrl(direct);
    expect(b).toMatchObject({ ok: true, ref: 'abcdefghijklmnopqrst' });
    expect(JSON.stringify(b)).not.toContain('sslmode');
  });
  it.each([
    ['', 'ว่าง'],
    ['not a url secret-pass-123', 'ไม่ใช่ URL'],
    [`https://postgres:secret-pass-123@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`, 'โปรโตคอล'],
    [`postgres://postgres:secret-pass-123@evil.example.com:5432/postgres`, 'โฮสต์อื่น'],
    [`postgres://postgres:secret-pass-123@db.abcdefghijklmnopqrst.supabase.co.evil.com:5432/postgres`, 'โฮสต์ปลอม'],
    [`postgres://postgres.abcdefghijklmnopqrst:secret-pass-123@aws-0-x.pooler.supabase.com:6543/postgres`, 'transaction pooler'],
    [`postgres://postgres:[YOUR-PASSWORD]@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`, 'ยังไม่ใส่รหัส'],
    [`postgres://postgres@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`, 'ไม่มีรหัส'],
  ])('ปฏิเสธ %s (%s) โดยข้อความไม่มีรหัสผ่านหรือ URL', (url) => {
    const r = parseDbUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/secret-pass-123|postgres:\/\/|evil/);
  });
  it('โปรเจกต์ต้องตรงกับ SUPABASE_URL (กันรันผิดฐานข้อมูล)', () => {
    expect(projectRefProblem('abcdefghijklmnopqrst', 'https://abcdefghijklmnopqrst.supabase.co')).toBeNull();
    expect(projectRefProblem('zzzzzzzzzzzzzzzzzzzz', 'https://abcdefghijklmnopqrst.supabase.co')).toMatch(/โปรเจกต์/);
    expect(projectRefProblem('', 'https://abcdefghijklmnopqrst.supabase.co')).toMatch(/โปรเจกต์/);
  });
});

describe('safeText: ไม่พิมพ์ความลับ', () => {
  const secrets = ['pw1', 'postgres.abcdefghijklmnopqrst', 'db.abcdefghijklmnopqrst.supabase.co'];
  it('ตัดความลับ (แม้สั้น) URL โฮสต์ อีเมล และตัวเลขยาว', () => {
    const out = safeText('auth failed pw1 for postgres.abcdefghijklmnopqrst at db.abcdefghijklmnopqrst.supabase.co postgresql://u:x@h/db a@b.com 1234567', secrets);
    for (const s of ['pw1', 'abcdefghijklmnopqrst', 'supabase.co', 'postgresql://', 'a@b.com', '1234567']) expect(out).not.toContain(s);
  });
  it('ข้อความทดสอบปกติยังอ่านได้ และถูกตัดความยาว', () => {
    expect(safeText('FAIL: T11b หมวดต้องยังอยู่', secrets)).toBe('FAIL: T11b หมวดต้องยังอยู่');
    expect(safeText('x'.repeat(900), secrets).length).toBeLessThanOrEqual(300);
  });
});

describe('selectFiles: เฉพาะไฟล์ใน supabase/tests', () => {
  const all = ['b_test.sql', 'a_test.sql', 'notes.md'];
  it('ไม่ระบุ = ทุกไฟล์ .sql เรียงชื่อ · ระบุชื่อ = เฉพาะชื่อนั้น', () => {
    expect(selectFiles(all, [])).toEqual({ ok: true, files: ['a_test.sql', 'b_test.sql'] });
    expect(selectFiles(all, ['b_test.sql'])).toEqual({ ok: true, files: ['b_test.sql'] });
  });
  it.each([['../migrations/x.sql'], ['/etc/passwd'], ['C:\\x.sql'], ['sub/a_test.sql'], ['notes.md'], ['zzz.sql'], ['--force']])('ปฏิเสธ %s', (arg) => {
    expect(selectFiles(all, [arg]).ok).toBe(false);
  });
});

describe('ตัวสคริปต์', () => {
  it('ต้องตั้ง MONEY_BUDDY_SQL_TESTS=yes · โหลดค่าผ่าน loadAdmin · ตรวจ SSL เสมอ · ไม่อ่าน .env ของโปรเจกต์', () => {
    expect(runnerSrc).toContain("process.env.MONEY_BUDDY_SQL_TESTS !== 'yes'");
    expect(runnerSrc).toContain('loadAdmin()');
    expect(runnerSrc).toContain('rejectUnauthorized: true');
    expect(runnerSrc).not.toMatch(/rejectUnauthorized:\s*false/);
    expect(runnerSrc).not.toMatch(/['"]\.env['"]|loadEnvFile/);
    expect(runnerSrc).not.toMatch(/console\.\w+\([^;]*(dbUrl|password|connectionString)/);
    expect(pkg).toContain('"admin:sql-tests": "node scripts/sql-tests.mjs"');
  });
});
