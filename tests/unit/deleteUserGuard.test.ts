import { describe, expect, it } from 'vitest';
import { COUNT_TABLES, PROTECTED_USERNAME, confirmationMatches, confirmationPhrase, parseDeleteArgs, refusalReason } from '../../scripts/lib/deleteUserGuard.mjs';

const scripts = import.meta.glob('/scripts/delete-user.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = Object.values(scripts)[0] ?? '';

describe('parseDeleteArgs (ลบทีละคนตามชื่อเท่านั้น)', () => {
  it('รับชื่อ 1 ตัว', () => {
    expect(parseDeleteArgs(['friend1'])).toEqual({ username: 'friend1', force: false });
  });
  it('รับ --force ก่อนหรือหลังชื่อ', () => {
    expect(parseDeleteArgs(['friend1', '--force'])).toEqual({ username: 'friend1', force: true });
    expect(parseDeleteArgs(['--force', 'friend1'])).toEqual({ username: 'friend1', force: true });
  });
  it('ไม่มีชื่อ / หลายชื่อ = ปฏิเสธ', () => {
    expect(parseDeleteArgs([])).toHaveProperty('error');
    expect(parseDeleteArgs(['--force'])).toHaveProperty('error');
    expect(parseDeleteArgs(['a1b', 'c2d'])).toHaveProperty('error');
  });
  it('ตัวแทน/คั่นหลายชื่อ = ปฏิเสธ', () => {
    for (const bad of ['*', 'test*', 'a%', 'a?b', 'a,b', 'a;b', 'a b', 'a\tb']) {
      expect(parseDeleteArgs([bad]), bad).toHaveProperty('error');
    }
  });
  it('ตัวเลือกอื่น/ใส่ --force ซ้ำ = ปฏิเสธ', () => {
    expect(parseDeleteArgs(['friend1', '--all'])).toHaveProperty('error');
    expect(parseDeleteArgs(['friend1', '-f'])).toHaveProperty('error');
    expect(parseDeleteArgs(['friend1', '--force', '--force'])).toHaveProperty('error');
  });
});

describe('refusalReason (บัญชีสุดท้าย / บัญชีเจ้าของ)', () => {
  it('ผู้ใช้ทั่วไปที่ยังมีคนอื่นเหลือ = ลบได้', () => {
    expect(refusalReason({ username: 'friend1', totalUsers: 2, force: false })).toBeNull();
  });
  it('บัญชีสุดท้าย (1 หรือ 0) = ปฏิเสธ', () => {
    expect(refusalReason({ username: 'friend1', totalUsers: 1, force: false })).toMatch(/สุดท้าย/);
    expect(refusalReason({ username: 'friend1', totalUsers: 0, force: false })).toMatch(/สุดท้าย/);
  });
  it('ชื่อ kumeyuri (ไม่สนตัวพิมพ์/ช่องว่าง) = ปฏิเสธ', () => {
    for (const n of [PROTECTED_USERNAME, 'KUMEYURI', ' Kumeyuri ']) {
      expect(refusalReason({ username: n, totalUsers: 5, force: false }), n).toMatch(/เจ้าของ/);
    }
  });
  it('--force ข้ามได้ทั้งสองกรณี', () => {
    expect(refusalReason({ username: 'kumeyuri', totalUsers: 1, force: true })).toBeNull();
  });
});

describe('confirmationMatches', () => {
  it('ต้องพิมพ์ชื่อเดิมซ้ำ', () => {
    expect(confirmationMatches('friend1', 'friend1')).toBe(true);
    expect(confirmationMatches('  FRIEND1 ', 'friend1')).toBe(true);
  });
  it('ว่าง/ชื่ออื่น/ไม่ใช่ข้อความ = ไม่ผ่าน', () => {
    expect(confirmationMatches('', 'friend1')).toBe(false);
    expect(confirmationMatches('   ', 'friend1')).toBe(false);
    expect(confirmationMatches('friend2', 'friend1')).toBe(false);
    expect(confirmationMatches('y', 'friend1')).toBe(false);
    expect(confirmationMatches(undefined, 'friend1')).toBe(false);
  });
});

describe('confirmationPhrase (ใช้ --force กับบัญชีเสี่ยง = วลียาว)', () => {
  it('ปกติ = ชื่อผู้ใช้', () => {
    expect(confirmationPhrase({ username: ' Friend1 ', totalUsers: 3, force: false })).toBe('friend1');
    expect(confirmationPhrase({ username: 'friend1', totalUsers: 3, force: true })).toBe('friend1');
  });
  it('--force กับ kumeyuri หรือบัญชีสุดท้าย = "ลบ <ชื่อ> ถาวร"', () => {
    expect(confirmationPhrase({ username: 'Kumeyuri', totalUsers: 3, force: true })).toBe('ลบ kumeyuri ถาวร');
    expect(confirmationPhrase({ username: 'friend1', totalUsers: 1, force: true })).toBe('ลบ friend1 ถาวร');
  });
  it('พิมพ์แค่ชื่อไม่พอเมื่อต้องใช้วลียาว', () => {
    const p = confirmationPhrase({ username: 'kumeyuri', totalUsers: 2, force: true });
    expect(confirmationMatches('kumeyuri', p)).toBe(false);
    expect(confirmationMatches('ลบ kumeyuri ถาวร', p)).toBe(true);
  });
});

describe('scripts/delete-user.mjs (โครงสร้าง)', () => {
  it('นับแถวทุกตารางข้อมูลที่ผูกผู้ใช้ ไม่ตกตาราง (รวม profiles)', () => {
    expect([...COUNT_TABLES].sort()).toEqual(['accounts', 'asset_prices', 'assets', 'bills', 'entries', 'lines', 'profiles', 'settings', 'trades']);
  });
  it('นับผู้ใช้ซ้ำหลังรอยืนยัน และยืนยันผลหลังลบเฉพาะ 404/user_not_found', () => {
    expect(src).toContain('rescanned');
    expect(src).toContain("goneStatus !== 404");
    expect(src).toContain("'user_not_found'");
    expect(src).toContain('page > 50');
  });
  it('ลำดับ: แยกอาร์กิวเมนต์ → ตรวจ TTY → หาผู้ใช้ → ปฏิเสธ → นับ → ยืนยัน → ลบ → อ่านกลับ', () => {
    const idx = (s: string) => src.indexOf(s);
    const order = ['parseDeleteArgs(', 'isTTY', 'loadAdmin()', 'refusalReason(', 'countRows(target.id)', 'confirmationMatches(', 'admin.deleteUser(', 'getUserById('];
    for (const s of order) expect(idx(s), s).toBeGreaterThan(-1);
    const positions = order.map(idx);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
  it('ลบด้วย id ของผู้ใช้ที่หาเจอเพียงคนเดียวเท่านั้น (ไม่วนลบ ไม่ใช้ตัวแทน)', () => {
    expect(src.match(/deleteUser\(/g)?.length).toBe(1);
    expect(src).toContain('deleteUser(target.id)');
    expect(src).not.toMatch(/for\s*\([^)]*\)\s*\{[^}]*deleteUser/);
  });
  it('ใช้ฟังก์ชัน username ตัวเดียวกับเว็บ + admin.env แบบเดียวกับ create-user', () => {
    expect(src).toContain('../src/domain/auth/credentials.ts');
    expect(src).toContain('usernameToEmail');
    expect(src).toContain("from './lib/admin.mjs'");
  });
  it('ไม่รับ pipe และไม่แสดงเนื้อหาข้อมูล (นับแถวอย่างเดียว)', () => {
    expect(src).toContain('process.stdin.isTTY');
    expect(src).toContain("head: true");
  });
});
