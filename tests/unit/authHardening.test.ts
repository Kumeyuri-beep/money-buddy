import { describe, expect, it } from 'vitest';
import { changePassword, type AuthApi, type AuthError } from '../../src/app/auth';
import { AuthInputError, passwordProblem, usernameToEmail } from '../../src/domain/auth/credentials';

/** ผลตรวจความปลอดภัยรอบ B1 (security-auditor 8 พ.ย. 2569) */

describe('ชื่อผู้ใช้ที่ไม่ใช่ ASCII ถูกปฏิเสธก่อนแปลงตัวพิมพ์เล็ก', () => {
  it('เครื่องหมายเคลวิน U+212A (toLowerCase ได้ "k") ไม่ถูกยอมรับเป็น k', () => {
    expect(() => usernameToEmail('Kevin')).toThrow(AuthInputError);
    expect(() => usernameToEmail('kevin')).not.toThrow();
  });
  it('İ (U+0130) และตัวอักษรเต็มความกว้าง/ไทย ถูกปฏิเสธ', () => {
    for (const u of ['İstanbul', 'ａｂｃ', 'ไทยไทย', 'café']) {
      expect(() => usernameToEmail(u)).toThrow(AuthInputError);
    }
  });
  it('ช่องว่างหัวท้ายยังตัดได้ และตัวพิมพ์ใหญ่ ASCII ยังแปลงได้', () => {
    expect(usernameToEmail('  Kevin  ')).toBe('kevin@users.money-buddy.internal');
  });
});

describe('passwordProblem: ห้ามมีชื่อผู้ใช้อยู่ในรหัส (ชื่อ ≥ 4 ตัว)', () => {
  it('รหัสที่มีชื่อผู้ใช้อยู่ข้างใน ไม่ผ่าน', () => {
    expect(passwordProblem('owen2569xyz', 'owen')).not.toBeNull();
    expect(passwordProblem('my-OWEN-roof-top', 'owen')).not.toBeNull();
  });
  it('ชื่อสั้นกว่า 4 ตัวไม่ใช้กฎนี้ (กันปฏิเสธรหัสดีโดยบังเอิญ)', () => {
    expect(passwordProblem('k9#Tz!abc2m', 'abc')).toBeNull();
  });
  it('ไม่มีชื่อผู้ใช้ในรหัส ผ่าน', () => {
    expect(passwordProblem('k9#Tz!pQ2m', 'owen')).toBeNull();
  });
});

describe('changePassword: เพิกถอน session อื่นหลังเปลี่ยนรหัสสำเร็จ', () => {
  const good = { username: 'owen', current: 'old-Pass-1234', next: 'k9#Tz!pQ2m' };
  function api(opts: { update?: AuthError | null; others?: AuthError | null; throwOthers?: boolean } = {}) {
    const calls: string[] = [];
    const a: AuthApi = {
      signInWithPassword: async () => {
        calls.push('signIn');
        return { error: null };
      },
      updateUser: async () => {
        calls.push('update');
        return { error: opts.update ?? null };
      },
      signOut: async () => ({ error: null }),
      signOutOthers: async () => {
        calls.push('signOutOthers');
        if (opts.throwOthers) throw new Error('net');
        return { error: opts.others ?? null };
      },
    };
    return { a, calls };
  }
  it('เรียกหลัง updateUser สำเร็จเท่านั้น', async () => {
    const ok = api();
    expect(await changePassword(ok.a, good)).toEqual({ ok: true });
    expect(ok.calls).toEqual(['signIn', 'update', 'signOutOthers']);
    const failed = api({ update: { code: 'weak_password', status: 422 } });
    expect((await changePassword(failed.a, good)).ok).toBe(false);
    expect(failed.calls).toEqual(['signIn', 'update']);
  });
  it('เพิกถอนไม่สำเร็จ (error หรือโยน) ไม่ทำให้การเปลี่ยนรหัสที่สำเร็จแล้วล้ม', async () => {
    expect(await changePassword(api({ others: { status: 500 } }).a, good)).toEqual({ ok: true });
    expect(await changePassword(api({ throwOthers: true }).a, good)).toEqual({ ok: true });
  });
});
