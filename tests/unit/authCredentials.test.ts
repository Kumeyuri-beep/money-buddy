import { describe, expect, it } from 'vitest';
import {
  AUTH_EMAIL_DOMAIN,
  AuthInputError,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES_TEXT,
  normalizeUsername,
  passwordProblem,
  usernameOfEmail,
  usernameProblem,
  usernameToEmail,
} from '../../src/domain/auth/credentials';

describe('normalizeUsername', () => {
  it('ตัดช่องว่างหัวท้ายและแปลงเป็นตัวพิมพ์เล็ก', () => {
    expect(normalizeUsername('  Owen_01 ')).toBe('owen_01');
    expect(normalizeUsername('ABC')).toBe('abc');
  });
});

describe('usernameProblem', () => {
  it('ชื่อปกติผ่าน', () => {
    for (const u of ['abc', 'owen', 'owen_01', 'a.b-c_d', '123', 'a'.repeat(32)]) expect(usernameProblem(u)).toBeNull();
  });
  it('สั้นเกิน/ยาวเกิน/ว่าง', () => {
    expect(usernameProblem('')).not.toBeNull();
    expect(usernameProblem('ab')).not.toBeNull();
    expect(usernameProblem('a'.repeat(33))).not.toBeNull();
  });
  it('อักขระต้องห้าม: ช่องว่าง @ ตัวพิมพ์ใหญ่ ไทย อีโมจิ', () => {
    for (const u of ['a b c', 'a@b', 'ABC', 'ชื่อไทย', 'abc😀', 'a/b', 'a+b', 'abc\n']) {
      expect(usernameProblem(u)).not.toBeNull();
    }
  });
  it('จุดนำหน้า/ท้าย/ซ้อน ไม่ได้ (รูปแบบอีเมลไม่ถูกต้อง)', () => {
    for (const u of ['.abc', 'abc.', 'a..b']) expect(usernameProblem(u)).not.toBeNull();
    expect(usernameProblem('a.b.c')).toBeNull();
  });
});

describe('usernameToEmail', () => {
  it('แปลงเป็นอีเมลภายในตัวพิมพ์เล็ก', () => {
    expect(AUTH_EMAIL_DOMAIN).toBe('users.money-buddy.internal');
    expect(usernameToEmail('Owen')).toBe('owen@users.money-buddy.internal');
    expect(usernameToEmail(' a.b-c_d ')).toBe('a.b-c_d@users.money-buddy.internal');
  });
  it('ชื่อไม่ถูกต้องโยน AuthInputError', () => {
    expect(() => usernameToEmail('a@b')).toThrow(AuthInputError);
    expect(() => usernameToEmail('')).toThrow(AuthInputError);
  });
});

describe('usernameOfEmail', () => {
  it('ดึงชื่อผู้ใช้จากอีเมลภายใน', () => {
    expect(usernameOfEmail('owen@users.money-buddy.internal')).toBe('owen');
    expect(usernameOfEmail(undefined)).toBe('');
    expect(usernameOfEmail('')).toBe('');
    expect(usernameOfEmail('noat')).toBe('noat');
  });
});

describe('passwordProblem', () => {
  it('ขั้นต่ำ 10 ตัว: 9 ไม่ผ่าน 10 ผ่าน', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(passwordProblem('Abcd1234x')).not.toBeNull();
    expect(passwordProblem('Abcd1234xy')).toBeNull();
  });
  it('ยาวเกิน 72 ไบต์ (ขีดจำกัดของ bcrypt) ไม่ผ่าน: ไทย 3 ไบต์/ตัว', () => {
    expect(passwordProblem('aB'.repeat(35) + '12')).toBeNull(); // 72 ไบต์พอดี
    expect(passwordProblem('aB'.repeat(35) + '123')).not.toBeNull(); // 73 ไบต์
    expect(passwordProblem('aB1' + 'กข'.repeat(11))).toBeNull(); // 69 ไบต์
    expect(passwordProblem('aB1' + 'กข'.repeat(12))).not.toBeNull(); // 75 ไบต์
  });
  it('ไม่เท่ากับชื่อผู้ใช้ (ไม่สนตัวพิมพ์)', () => {
    expect(passwordProblem('Longusername1', 'LongUsername1')).not.toBeNull();
    expect(passwordProblem('Longusername1', 'someoneelse')).toBeNull();
  });
  it('รหัสยอดนิยม/ซ้ำตัวเดียว/เรียงลำดับ ไม่ผ่าน', () => {
    for (const p of ['password123', '1234567890', '0123456789', 'qwertyuiop', 'aaaaaaaaaa', '0000000000', 'Password123', 'abcdefghij']) {
      expect(passwordProblem(p)).not.toBeNull();
    }
  });
  it('ช่องว่างล้วนไม่ผ่าน แต่ช่องว่างในรหัสยาวผ่าน', () => {
    expect(passwordProblem('          ')).not.toBeNull();
    expect(passwordProblem('Rain on the roof 9')).toBeNull();
  });
  it('ต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลขครบ (ตรงกับเงื่อนไข Supabase)', () => {
    expect(passwordProblem('abcdef7hijk')).toMatch(/ตัวพิมพ์ใหญ่/);
    expect(passwordProblem('ABCDEF7HIJK')).toMatch(/ตัวพิมพ์เล็ก/);
    expect(passwordProblem('Abcdefghijk')).toMatch(/ตัวเลข/);
    expect(passwordProblem('กขคงจฉชซฌญ12')).not.toBeNull();
    expect(PASSWORD_RULES_TEXT).toMatch(/ตัวพิมพ์เล็ก.*ตัวพิมพ์ใหญ่.*ตัวเลข/);
  });
  it('ผ่านทั้งๆ ที่เป็นอักขระผสม', () => {
    expect(passwordProblem('k9#Tz!pQ2m')).toBeNull();
  });
  it('ไม่ใช่ข้อความ = ไม่ผ่าน', () => {
    expect(passwordProblem(undefined as unknown as string)).not.toBeNull();
  });
});
