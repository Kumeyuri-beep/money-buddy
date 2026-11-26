import { describe, expect, it } from 'vitest';
import {
  classifyOutcome, OUTSIDE_TX_EXTENSIONS, parseDbUrl, pgEnvProblem, PROBES,projectRefProblem, reportDetail, runOne, runProbes, safeText,
  selectFiles, serverProblem, snapshotChanges, sqlProblems,
} from '../../scripts/lib/sqlTests.mjs';

/** admin:sql-tests (เจ้าของสั่ง 26-27 พ.ย. 2569): รันเฉพาะ supabase/tests ทีละไฟล์ในธุรกรรมของตัวเองแล้ว ROLLBACK เสมอ · ค่าทั้งหมดในเทสต์นี้เป็นของสมมติ */
const raw = (g: Record<string, unknown>) => (Object.values(g)[0] as string | undefined) ?? '';
const files = import.meta.glob('/supabase/tests/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const runnerSrc = raw(import.meta.glob('/scripts/sql-tests.mjs', { query: '?raw', import: 'default', eager: true }));
const adminSrc = raw(import.meta.glob('/scripts/lib/admin.mjs', { query: '?raw', import: 'default', eager: true }));
const pkg = raw(import.meta.glob('/package.json', { query: '?raw', import: 'default', eager: true }));

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
  // ช่องที่ผู้ตรวจพบ: ตัวอ่านต่างจาก Postgres จนซ่อน END (= COMMIT) ได้
  it.each([
    ['คอมเมนต์จบที่ \\r', 'select 1; -- x\rEND;'],
    ['$$ ต่อท้ายชื่อที่ไม่ใช่ ASCII ไม่ใช่ dollar quote', 'select 1 as é$$; END; select 2 as é$$;'],
    ['ชื่อที่ลงท้าย $e ไม่ใช่ E-string', "select 1 as a$e'\\'; END; --'"],
    ['dollar tag ที่ไม่ใช่ ASCII', "select $é$ ' $é$; END; select $é$ ' $é$;"],
    ['ROLLBACK ใน body', 'do $$ begin rollback; end $$;'],
  ])('ปฏิเสธ (%s)', (_name, sql) => {
    expect(bad(sql).length).toBeGreaterThan(0);
  });
  it.each([
    'create extension dblink;',
    'CREATE/**/EXTENSION if not exists hstore;',
    "do $t$ begin execute 'create extension hstore'; end $t$;",
    "select dblink_exec('x', 'y');",
    "select * from public.dblink('x') as t(a int);",
    'create extension postgres_fdw;',
    'create server s foreign data wrapper w;',
    'create user mapping for current_user server s;',
    'import foreign schema a from server s into b;',
    'create foreign table t (a int) server s;',
    "create subscription s connection 'x' publication p;",
    "alter system set work_mem = '1MB';",
    "copy pg_temp.t to program 'x';",
    "select lo_export(1, 'x');",
    "select lo_import('x');",
    "select http_get('x');",
    "select setval('s', 1);",
    'select pg_terminate_backend(1);',
    'select pg_cancel_backend(1);',
    'select pg_reload_conf();',
    'select U&"d!0062link" uescape \'!\';',
    "select pg_create_physical_replication_slot('s');",
    'select pg_stat_reset();',
    'set statement_timeout = 0;',
    "do $t$ begin set local lock_timeout = 0; end $t$;",
  ])('ปฏิเสธคำสั่งที่ ROLLBACK ย้อนไม่ถึง: %s', (sql) => {
    expect(bad(sql).length).toBeGreaterThan(0);
  });
  it('begin atomic ... end ไม่ถือเป็นคำสั่งธุรกรรม แต่ end เกินมายังถูกปฏิเสธ', () => {
    const fn = 'create function pg_temp.f() returns int language sql begin atomic select 1; end;';
    expect(bad(fn)).toEqual([]);
    expect(bad(`${fn} end;`).length).toBeGreaterThan(0);
  });
  it.each([
    '-- ล้มตอน commit\nselect 1;',
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

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });

/** ฐานข้อมูลปลอม: จำลองเฉพาะลำดับคำสั่ง · onFile = สิ่งที่เกิดตอน execute ไฟล์ */
const fake = (onFile: (file: string) => void, opts: { failRollback?: boolean; txEnded?: boolean; leftover?: boolean } = {}) => {
  const calls: string[] = [];
  let file = '';
  return {
    calls,
    client: {
      query: (sql: string, params?: string[]) => {
        calls.push(sql);
        try {
          if (sql.includes('set_config(')) file = params?.[0] ?? '';
          if (sql.startsWith('do ')) onFile(file);
        } catch (e) {
          return Promise.reject(e as Error);
        }
        if (sql.startsWith('rollback to savepoint') && opts.txEnded) return Promise.reject(pgError('3B001', 'no such savepoint'));
        if (sql === 'rollback' && opts.failRollback) return Promise.reject(new Error('lost'));
        if (sql.includes('to_regclass')) return Promise.resolve({ rows: [{ gone: !opts.leftover }] });
        return Promise.resolve({ rows: [] });
      },
    },
  };
};

describe('runOne: ครอบทั้งไฟล์ด้วย execute ในบล็อกเดียว ภายในธุรกรรมที่ ROLLBACK เสมอ', () => {
  const passes = () => { throw pgError('P0001', 'TESTS_PASSED (rollback แล้ว)'); };
  it('ลำดับ: begin → timeout → savepoint → ส่งไฟล์เป็นพารามิเตอร์ → DO execute → ตรวจ savepoint → rollback', async () => {
    let seen = '';
    const f = fake((file) => { seen = file; passes(); });
    expect(await runOne(f.client, "FILE $mb$ ' x")).toMatchObject({ passed: true, inTransaction: true });
    expect(seen).toBe("FILE $mb$ ' x");
    expect(f.calls).toHaveLength(7);
    expect(f.calls[0]).toBe('begin');
    expect(f.calls[1]).toMatch(/set local statement_timeout = 120000/i);
    const guard = /^savepoint (mb_guard_[0-9a-f]{32})$/.exec(f.calls[2] ?? '')?.[1];
    expect(guard).toBeTruthy();
    expect(f.calls[3]).toBe("select set_config('money_buddy.sql_file', $1, true)");
    expect(f.calls[4]).toBe("do $mb$ begin execute current_setting('money_buddy.sql_file'); end $mb$");
    expect(f.calls.slice(5)).toEqual([`rollback to savepoint ${guard}`, 'rollback']);
    expect(f.calls.join(' ')).not.toContain('FILE');
  });
  it('ชื่อ savepoint สุ่มใหม่ทุกครั้ง', async () => {
    const a = fake(passes);
    const b = fake(passes);
    await runOne(a.client, 'x');
    await runOne(b.client, 'x');
    expect(a.calls[2]).not.toBe(b.calls[2]);
  });
  it('ธุรกรรมเดิมหายไปหลังรัน = ไม่ผ่านแม้ขึ้น TESTS_PASSED', async () => {
    const f = fake(passes, { txEnded: true });
    expect(await runOne(f.client, 'x')).toMatchObject({ passed: false, inTransaction: false });
    expect(f.calls.at(-1)).toBe('rollback');
  });
  it('ล้ม (FAIL: จากเทสต์ หรือ error อื่น) ก็ตรวจธุรกรรมและ rollback', async () => {
    for (const e of [pgError('P0001', 'FAIL: T1 ผิด'), pgError('57014', 'canceling statement due to statement timeout'), pgError('42P01', 'relation does not exist')]) {
      const f = fake(() => { throw e; });
      expect(await runOne(f.client, 'x')).toMatchObject({ passed: false, code: e.code, inTransaction: true });
      expect(f.calls.at(-1)).toBe('rollback');
    }
  });
  it('ไฟล์จบโดยไม่ raise = ไม่ผ่าน และยัง rollback', async () => {
    const f = fake(() => {});
    expect(await runOne(f.client, 'x')).toMatchObject({ passed: false });
    expect(f.calls.at(-1)).toBe('rollback');
  });
  it('rollback ล้ม = ไม่ผ่านแม้ขึ้น TESTS_PASSED', async () => {
    const f = fake(passes, { failRollback: true });
    expect(await runOne(f.client, 'x')).toMatchObject({ passed: false });
  });
});

describe('runProbes: พิสูจน์กับฐานข้อมูลก่อนรันไฟล์จริง (เขียนเฉพาะ temp table)', () => {
  const behave = (file: string) => {
    if (/(do \$p\$|as \$p\$) begin commit/i.test(file)) throw pgError('2D000', 'invalid transaction termination');
    if (/;\s*(commit|end|rollback|release savepoint \w+|rollback to savepoint \w+|prepare transaction '\w+');$/i.test(file)) {
      throw pgError('0A000', 'EXECUTE of transaction commands is not implemented');
    }
    throw pgError('P0001', 'TESTS_PASSED probe');
  };
  it('พิสูจน์คำสั่งที่ตัวกันพึ่งอยู่ด้วย: savepoint, prepare transaction และ call procedure ที่ commit', () => {
    for (const [re, code] of [[/release savepoint/i, '0A000'], [/rollback to savepoint/i, '0A000'], [/prepare transaction/i, '0A000'], [/call pg_temp\./i, '2D000']] as const) {
      expect(PROBES.some((p) => re.test(p.sql) && p.expect === code), String(re)).toBe(true);
    }
  });
  const connectTo = (f: ReturnType<typeof fake>) => () => Promise.resolve({ ...f.client, end: () => Promise.resolve() });
  it('ทุกข้อเขียนเฉพาะ temp table และมีข้อที่สั่ง COMMIT', () => {
    expect(PROBES.some((p) => /commit;/i.test(p.sql) && p.expect === '0A000')).toBe(true);
    for (const p of PROBES) {
      expect(p.sql).toMatch(/^create temp table mb_probe/);
      expect(p.sql).not.toMatch(/public\.|auth\.|private\.|\bupdate\b|\bdelete\b|\bdrop\b|\balter\b|\btruncate\b/i);
    }
  });
  it('ฐานข้อมูลตอบตามคาดทุกข้อ = ผ่าน', async () => {
    const r = await runProbes(connectTo(fake(behave)));
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(PROBES.length);
  });
  it('COMMIT ไม่ถูกปฏิเสธ = ไม่ผ่าน', async () => {
    const r = await runProbes(connectTo(fake(() => { throw pgError('P0001', 'TESTS_PASSED probe'); })));
    expect(r.ok).toBe(false);
  });
  it('ธุรกรรมหาย หรือ temp table ค้าง = ไม่ผ่าน', async () => {
    expect((await runProbes(connectTo(fake(behave, { txEnded: true })))).ok).toBe(false);
    expect((await runProbes(connectTo(fake(behave, { leftover: true })))).ok).toBe(false);
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

describe('safeText / reportDetail: ไม่พิมพ์ความลับหรือข้อมูลจริง', () => {
  const secrets = ['pw1', 'postgres.abcdefghijklmnopqrst', 'db.abcdefghijklmnopqrst.supabase.co'];
  it('ตัดความลับ (แม้สั้น) URL โฮสต์ อีเมล uuid และตัวเลขตั้งแต่ 4 หลัก', () => {
    const out = safeText('auth failed pw1 for postgres.abcdefghijklmnopqrst at db.abcdefghijklmnopqrst.supabase.co postgresql://u:x@h/db a@b.com 4821 123e4567-e89b-12d3-a456-426614174000 1,234,567.50', secrets);
    for (const s of ['pw1', 'abcdefghijklmnopqrst', 'supabase.co', 'postgresql://', 'a@b.com', '4821', 'e89b', '234', '567']) expect(out).not.toContain(s);
  });
  it('ข้อความทดสอบปกติยังอ่านได้ และถูกตัดความยาว', () => {
    expect(safeText('FAIL: T11b หมวดต้องยังอยู่ 100', secrets)).toBe('FAIL: T11b หมวดต้องยังอยู่ 100');
    expect(safeText('x'.repeat(900), secrets).length).toBeLessThanOrEqual(300);
  });
  it('พิมพ์ข้อความเฉพาะรูปแบบของไฟล์เทสต์ (P0001 FAIL / TESTS_PASSED) · รหัส error ไม่ถูกปิดบัง', () => {
    expect(reportDetail({ code: 'P0001', message: 'FAIL: T2 ผิด' }, secrets)).toBe('P0001 FAIL: T2 ผิด');
    expect(reportDetail({ code: '23505', message: 'Key (name)=(ชื่อสมมติ) already exists' }, secrets)).toBe('23505');
    expect(reportDetail({ code: '57014', message: 'canceling statement ชื่อสมมติ' }, secrets)).toBe('57014');
    expect(reportDetail({ code: 'P0001', message: 'บัญชี ชื่อสมมติ ไม่พอ' }, secrets)).toBe('P0001');
    expect(reportDetail({ code: '0A000', message: 'EXECUTE of transaction commands is not implemented' }, secrets)).toBe('0A000 ฐานข้อมูลปฏิเสธคำสั่งควบคุมธุรกรรม');
    expect(reportDetail({ code: '2D000', message: 'invalid transaction termination' }, secrets)).toBe('2D000 ฐานข้อมูลปฏิเสธคำสั่งควบคุมธุรกรรม');
    expect(reportDetail({ code: 'weird pw1', message: 'x' }, secrets)).not.toContain('pw1');
    expect(reportDetail({ code: 'P0001', message: 'x', note: 'ธุรกรรมเดิมหายไป' }, secrets)).toBe('ธุรกรรมเดิมหายไป · P0001');
  });
});

describe('ด่านฝั่งสภาพแวดล้อม เซิร์ฟเวอร์ และผลหลังรัน', () => {
  it('ปฏิเสธตัวแปร PG* ใน shell (ไลบรารีอ่านเอง) โดยบอกเฉพาะชื่อ', () => {
    const msg = pgEnvProblem({ PGOPTIONS: 'secret-value', PATH: 'x' });
    expect(msg).toContain('PGOPTIONS');
    expect(msg).not.toContain('secret-value');
    for (const k of ['PGHOST', 'pgsslmode', 'PGPASSWORD', 'NODE_PG_FORCE_NATIVE']) expect(pgEnvProblem({ [k]: '1' })).not.toBeNull();
    expect(pgEnvProblem({ PATH: 'x', PGDATA: 'y' })).toBeNull();
  });
  it('เซิร์ฟเวอร์มีส่วนขยายหรือ foreign server ที่ออกนอกธุรกรรมได้ = ไม่รัน', () => {
    expect(serverProblem({ extensions: [], foreignServers: 0 })).toBeNull();
    expect(serverProblem({ extensions: ['dblink'], foreignServers: 0 })).toContain('dblink');
    expect(serverProblem({ extensions: [], foreignServers: 1 })).not.toBeNull();
    expect(OUTSIDE_TX_EXTENSIONS).toEqual(expect.arrayContaining(['dblink', 'postgres_fdw', 'pg_net', 'wrappers']));
  });
  it('snapshotChanges: บอกชื่อรายการที่เปลี่ยน หาย หรือเพิ่ม', () => {
    const before = new Map([['a', '1'], ['b', '2'], ['c', '3']]);
    const after = new Map([['a', '1'], ['b', '9'], ['d', '4']]);
    expect(snapshotChanges(before, after)).toEqual(['b', 'c', 'd']);
    expect(snapshotChanges(before, new Map(before))).toEqual([]);
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
  it('ต้องตั้ง MONEY_BUDDY_SQL_TESTS=yes · โหลดเฉพาะค่าเชื่อมต่อ (ไม่โหลด key ผู้ดูแล) · ตรวจ SSL เสมอ · ไม่อ่านไฟล์ env ของโปรเจกต์', () => {
    expect(runnerSrc).toContain("process.env.MONEY_BUDDY_SQL_TESTS !== 'yes'");
    expect(runnerSrc).toContain('loadDbUrl()');
    expect(runnerSrc).not.toContain('loadAdmin');
    expect(runnerSrc).toContain('rejectUnauthorized: true');
    expect(runnerSrc).toContain('query_timeout: STATEMENT_TIMEOUT_MS + 30_000');
    expect(runnerSrc).not.toMatch(/rejectUnauthorized:\s*false/);
    expect(runnerSrc).not.toMatch(/['"]\.env['"]|loadEnvFile/);
    expect(runnerSrc).not.toMatch(/console\.\w+\([^;]*(dbUrl|password|connectionString)/);
    expect(pkg).toContain('"admin:sql-tests": "node scripts/sql-tests.mjs"');
  });
  it('พิสูจน์ (runProbes) และตรวจเซิร์ฟเวอร์ก่อนรันไฟล์ · มี --prove-only · จับ error ที่หลุดโดยพิมพ์แค่รหัส', () => {
    const probe = runnerSrc.indexOf('await runProbes(');
    expect(probe).toBeGreaterThan(0);
    expect(runnerSrc.indexOf('serverProblem(')).toBeGreaterThan(0);
    expect(runnerSrc.indexOf('await runOne(')).toBeGreaterThan(probe);
    expect(runnerSrc).toContain('--prove-only');
    expect(runnerSrc).toContain('pgEnvProblem(process.env)');
    expect(runnerSrc).toContain("'uncaughtException'");
    expect(runnerSrc).toMatch(/main\(\)\.catch\(/);
  });
  it('loadDbUrl ไม่สร้าง client และไม่แตะ key ผู้ดูแล · loadAdmin กลับเป็นแบบเดิม', () => {
    const at = adminSrc.indexOf('export function loadDbUrl');
    expect(at).toBeGreaterThan(0);
    const fn = adminSrc.slice(at);
    expect(fn).toContain('SUPABASE_DB_URL');
    expect(fn).toContain('checkAdminFile(file)');
    expect(fn).not.toMatch(/createClient|SERVICE_ROLE|SECRET_KEY/);
    expect(adminSrc.slice(0, at)).not.toContain('SUPABASE_DB_URL');
  });
});
