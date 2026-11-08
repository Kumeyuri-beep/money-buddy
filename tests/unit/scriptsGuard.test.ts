import { describe, expect, it } from 'vitest';

/**
 * กติกา key ผู้ดูแลสำหรับ scripts/ และไฟล์ตั้งค่า (แผน M2 ข้อ 4.5-4.6, decisions 2026-11-04-m2-auth ข้อ 10)
 * ค้นจากไฟล์จริงด้วย import.meta.glob ไม่ต้องใช้ key ใดๆ
 */
const scripts = import.meta.glob('/scripts/**/*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const pkgRaw = Object.values(import.meta.glob('/package.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const workflows = import.meta.glob('/.github/workflows/*.yml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const gitignore = Object.values(import.meta.glob('/.gitignore', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const claude = Object.values(import.meta.glob('/.claude/settings.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

const named = (name: string) => Object.entries(scripts).find(([p]) => p.endsWith(`/${name}`))?.[1] ?? '';

describe('scripts/ (สคริปต์ผู้ดูแล)', () => {
  it('มีสคริปต์ครบ (กัน glob ว่างแล้วเทสต์ผ่านเปล่าๆ)', () => {
    for (const f of ['create-user.mjs', 'reset-password.mjs', 'spike-auth.mjs', 'check-dist.mjs', 'lib/admin.mjs', 'lib/adminEnv.mjs', 'lib/distScan.mjs']) {
      expect(named(f).length, f).toBeGreaterThan(50);
    }
  });
  it('ไม่ส่งตัวแปรสภาพแวดล้อมหรือ key เข้า console.* และไม่พิมพ์อ็อบเจ็กต์ error ทั้งก้อน', () => {
    for (const [path, text] of Object.entries(scripts)) {
      expect(text, path).not.toMatch(/console\.\w+\([^;]*process\.env/);
      expect(text, path).not.toMatch(/console\.\w+\([^;]*(serviceKey|secretKey|SERVICE_ROLE|SECRET_KEY)/);
      expect(text, path).not.toMatch(/console\.\w+\(\s*(e|err|error)\s*[,)]/);
    }
  });
  it('ไม่รับรหัสผ่านหรือ key ทางอาร์กิวเมนต์ (ค้างใน history ของ shell)', () => {
    for (const [path, text] of Object.entries(scripts)) {
      expect(text, path).not.toMatch(/argv[^\n]*(password|key|secret)/i);
    }
    // รับแค่ username 1 ตัว
    for (const f of ['create-user.mjs', 'reset-password.mjs']) {
      expect(named(f), f).toContain('args.length !== 1');
    }
  });
  it('ไม่อ่านไฟล์ลับในโปรเจกต์: key ผู้ดูแลอ่านจาก admin.env นอกโปรเจกต์เท่านั้น', () => {
    for (const [path, text] of Object.entries(scripts)) {
      expect(text, path).not.toMatch(/\.env\.local|\.env\.admin|\.env\.production/);
    }
    const admin = named('lib/admin.mjs');
    expect(admin).toContain('adminEnvPath(homedir()');
    expect(admin).toContain('isInsideDir(file, projectRoot)');
    // ไฟล์ .env ของโปรเจกต์ (anon key สาธารณะ) อ่านได้เฉพาะ spike เท่านั้น
    for (const [path, text] of Object.entries(scripts)) {
      if (path.endsWith('/spike-auth.mjs')) continue;
      expect(text, path).not.toMatch(/resolve\([^)]*'\.env'\)|loadEnvFile\(\s*['"]\.env/);
    }
  });
  it('สคริปต์ผู้ดูแลใช้ฟังก์ชัน username/รหัสผ่านตัวเดียวกับเว็บ', () => {
    for (const f of ['create-user.mjs', 'reset-password.mjs']) {
      const text = named(f);
      expect(text, f).toContain("../src/domain/auth/credentials.ts");
      expect(text, f).toContain('usernameToEmail');
      expect(text, f).toContain('passwordProblem');
    }
  });
  it('reset-password: ระงับบัญชีก่อน -> เพิกถอน -> ตั้งรหัส -> ตั้งธง -> เพิกถอนซ้ำ -> ยืนยัน -> ปลดระงับเป็นขั้นสุดท้าย', () => {
    const t = named('reset-password.mjs');
    const idx = (s: string) => t.indexOf(s);
    const order = [
      "ban_duration: '876000h'",
      "revoke('ก่อนตั้งรหัส')",
      'updateUserById(userId, { password })',
      'must_change_password: true',
      "revoke('หลังตั้งรหัส')",
      "rpc('admin_session_count'",
      "ban_duration: 'none'",
    ];
    order.forEach((s) => expect(idx(s), s).toBeGreaterThan(-1));
    for (let i = 1; i < order.length; i++) expect(idx(order[i] ?? ''), order[i]).toBeGreaterThan(idx(order[i - 1] ?? ''));
    expect(t).toContain('ห้ามส่งรหัสให้ผู้ใช้');
  });
  it('admin.mjs: อ่านไฟล์ key เอง (parseEnv) ไม่ใส่ process.env · ปฏิเสธ key ใน environment, symlink, พาธเครือข่าย, พาธจริงในโปรเจกต์', () => {
    const a = named('lib/admin.mjs');
    expect(a).toContain('parseEnv(readFileSync(');
    expect(a).not.toMatch(/loadEnvFile/);
    expect(a).toContain('realpathSync.native');
    expect(a).toContain('isSymbolicLink');
    expect(a).toContain('ไม่รองรับพาธเครือข่าย'); // ปฏิเสธพาธที่ขึ้นต้นด้วยแบ็กสแลชคู่ (UNC)
    expect(a).toContain("KEY_NAMES.some((name) => process.env[name])");
    expect(a).toContain('unhandledRejection');
    for (const [path, text] of Object.entries(scripts)) expect(text, path).not.toMatch(/loadEnvFile/);
  });
  it('ไม่มีค่า key จริงในสคริปต์', async () => {
    const { findSecretKeys } = await import('../../scripts/lib/distScan.mjs');
    for (const [path, text] of Object.entries(scripts)) expect(findSecretKeys(text), path).toEqual([]);
  });
  it('ไม่มีการเรียก process ลูก (กัน key ที่ค้างในสภาพแวดล้อมถูกส่งต่อ)', () => {
    for (const [path, text] of Object.entries(scripts)) expect(text, path).not.toMatch(/child_process|spawn\(|execSync|execFile/);
  });
});

describe('ไฟล์ตั้งค่าโปรเจกต์', () => {
  it('package.json: ไม่มี script ที่ฝัง key/secret และตรวจ dist หลัง build เสมอ', () => {
    const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, name).not.toMatch(/KEY|SECRET|SERVICE|PASSWORD/);
    }
    expect(pkg.scripts.postbuild).toContain('scripts/check-dist.mjs');
  });
  it('CI ไม่ใช้ secrets ใดๆ (เทสต์ที่ต้องใช้ฐานข้อมูลจริงรันในเครื่องเท่านั้น)', () => {
    expect(Object.keys(workflows).length).toBeGreaterThan(0);
    for (const [path, text] of Object.entries(workflows)) expect(text, path).not.toMatch(/secrets\./);
  });
  it('.gitignore ครอบไฟล์ .env', () => {
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^\*\.env$/m); // ครอบ admin.env ที่เผลอคัดลอกเข้าโปรเจกต์
    expect(gitignore).toMatch(/^\.money-buddy-admin\/$/m);
  });
  it('.claude/settings.json ห้ามอ่านไฟล์ .env และโฟลเดอร์ key ผู้ดูแล', () => {
    const deny = (JSON.parse(claude) as { permissions: { deny: string[] } }).permissions.deny;
    expect(deny).toContain('Read(./.env*)');
    expect(deny.some((d) => d.startsWith('Read(') && d.includes('.money-buddy-admin'))).toBe(true);
  });
  it('.claude/settings.json ห้ามผู้ช่วย AI รันสคริปต์ผู้ดูแล (เจ้าของรันเองใน terminal เท่านั้น) ทั้ง Bash และ PowerShell', () => {
    const deny = (JSON.parse(claude) as { permissions: { deny: string[] } }).permissions.deny;
    for (const tool of ['Bash', 'PowerShell']) {
      for (const pattern of [
        'npm run admin:*',
        'node *scripts/create-user*',
        'node *scripts/reset-password*',
        'node *scripts/spike-auth*',
      ]) {
        expect(deny, `${tool}(${pattern})`).toContain(`${tool}(${pattern})`);
      }
    }
    // ชุดทดสอบจริงที่ใช้ key ผู้ดูแล: ห้ามสั่ง vitest ตรงๆ ด้วย (เจ้าของอนุญาต 9 พ.ย. 2569)
    for (const tool of ['Bash', 'PowerShell']) {
      expect(deny, tool + ' vitest.live').toContain(tool + '(*vitest.live*)');
    }
    // กฎ git push เดิมยังอยู่ครบ
    expect(deny).toContain('Bash(git push)');
    expect(deny).toContain('Bash(git push --force*)');
  });
  it('สคริปต์รับชื่อตัวแปร key ได้ทั้งแบบ service_role และแบบ sb_secret_ (SUPABASE_SECRET_KEY)', () => {
    const admin = named('lib/admin.mjs');
    expect(admin).toContain('values.SUPABASE_SERVICE_ROLE_KEY || values.SUPABASE_SECRET_KEY');
    expect(admin).toContain("KEY_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']");
  });
});
