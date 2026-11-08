import { describe, expect, it } from 'vitest';
import {
  changePassword,
  gateStateFromProfile,
  GENERIC_LOGIN_ERROR,
  signIn,
  signOutQuietly,
  type AuthApi,
  type AuthError,
} from '../../src/app/auth';

/** API จำลอง: บันทึกคำเรียก และตอบตามที่ตั้ง (ไม่ต่อเน็ต) */
function fakeApi(opts: { signIn?: AuthError | null; update?: AuthError | null; signOut?: AuthError | null } = {}) {
  const calls: string[] = [];
  const api: AuthApi = {
    signInWithPassword: async ({ email, password }) => {
      calls.push(`signIn:${email}:${password}`);
      return { error: opts.signIn ?? null };
    },
    updateUser: async ({ password }) => {
      calls.push(`update:${password}`);
      return { error: opts.update ?? null };
    },
    signOut: async () => {
      calls.push('signOut');
      return { error: opts.signOut ?? null };
    },
    signOutOthers: async () => {
      calls.push('signOutOthers');
      return { error: null };
    },
  };
  return { api, calls };
}
const err = (code: string, status = 400, message = code): AuthError => ({ code, status, message });

describe('signIn', () => {
  it('สำเร็จ: ส่งอีเมลภายในตัวพิมพ์เล็กและรหัสผ่านตามที่พิมพ์', async () => {
    const { api, calls } = fakeApi();
    expect(await signIn(api, ' Owen ', 'k9#Tz!pQ2m')).toEqual({ ok: true });
    expect(calls).toEqual(['signIn:owen@users.money-buddy.internal:k9#Tz!pQ2m']);
  });
  it('ชื่อไม่ถูกรูปแบบ: ข้อความเดียวกับรหัสผิด และไม่ยิงเน็ต', async () => {
    const { api, calls } = fakeApi();
    expect(await signIn(api, 'a@b', 'x')).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(await signIn(api, '', 'x')).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(calls).toEqual([]);
  });
  it('รหัสว่างไม่ยิงเน็ต', async () => {
    const { api, calls } = fakeApi();
    expect(await signIn(api, 'owen', '')).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    expect(calls).toEqual([]);
  });
  it('ไม่มีผู้ใช้ / รหัสผิด / email ยังไม่ยืนยัน: ข้อความเดียวกันทุกกรณี (กันเดาว่ามี username ไหน)', async () => {
    for (const e of [err('invalid_credentials'), err('user_not_found', 400), err('email_not_confirmed'), err('xyz', 400, 'Invalid login credentials')]) {
      const { api } = fakeApi({ signIn: e });
      expect(await signIn(api, 'owen', 'pw')).toEqual({ ok: false, message: GENERIC_LOGIN_ERROR });
    }
  });
  it('ถูกจำกัดอัตรา (429 / รหัส rate limit): แจ้งให้ลองใหม่ภายหลัง', async () => {
    for (const e of [err('over_request_rate_limit', 429), { status: 429, message: 'x' }]) {
      const { api } = fakeApi({ signIn: e });
      const r = await signIn(api, 'owen', 'pw');
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.message).toContain('ภายหลัง');
    }
  });
  it('เครือข่ายล้ม: แจ้งเชื่อมต่อไม่ได้', async () => {
    const { api } = fakeApi({ signIn: { message: 'Failed to fetch', status: 0 } });
    const r = await signIn(api, 'owen', 'pw');
    expect(r.ok === false && r.message).toContain('เชื่อมต่อ');
  });
  it('API โยน exception: จับเป็นข้อความทั่วไป ไม่ปล่อยออกมา', async () => {
    const api: AuthApi = { ...fakeApi().api, signInWithPassword: async () => { throw new TypeError('boom'); } };
    const r = await signIn(api, 'owen', 'pw');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).not.toContain('boom');
  });
  it('ข้อความ error ไม่เปิดเผยรหัสผ่านหรือรายละเอียดของเซิร์ฟเวอร์', async () => {
    const { api } = fakeApi({ signIn: err('weird', 500, 'SECRET-DETAIL pw=hunter2') });
    const r = await signIn(api, 'owen', 'hunter2');
    expect(JSON.stringify(r)).not.toContain('hunter2');
    expect(JSON.stringify(r)).not.toContain('SECRET-DETAIL');
  });
});

describe('changePassword', () => {
  const good = { username: 'owen', current: 'old-Pass-1234', next: 'k9#Tz!pQ2m' };
  it('สำเร็จ: ยืนยันรหัสเดิมก่อน แล้วค่อยเปลี่ยน', async () => {
    const { api, calls } = fakeApi();
    expect(await changePassword(api, good)).toEqual({ ok: true });
    expect(calls).toEqual(['signIn:owen@users.money-buddy.internal:old-Pass-1234', 'update:k9#Tz!pQ2m', 'signOutOthers']);
  });
  it('รหัสใหม่อ่อนเกิน: ปฏิเสธก่อนยิงเน็ต', async () => {
    const { api, calls } = fakeApi();
    const r = await changePassword(api, { ...good, next: 'short' });
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('รหัสใหม่เท่ากับ username: ปฏิเสธ', async () => {
    const { api, calls } = fakeApi();
    expect((await changePassword(api, { ...good, username: 'verylongname1', next: 'verylongname1' })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('รหัสใหม่ซ้ำรหัสเดิม: ปฏิเสธก่อนยิงเน็ต', async () => {
    const { api, calls } = fakeApi();
    const r = await changePassword(api, { ...good, current: 'k9#Tz!pQ2m', next: 'k9#Tz!pQ2m' });
    expect(r.ok === false && r.message).toContain('ซ้ำ');
    expect(calls).toEqual([]);
  });
  it('รหัสเดิมไม่ถูก: ไม่เรียก updateUser', async () => {
    const { api, calls } = fakeApi({ signIn: err('invalid_credentials') });
    const r = await changePassword(api, good);
    expect(r.ok === false && r.message).toContain('รหัสผ่านเดิม');
    expect(calls.some((c) => c.startsWith('update'))).toBe(false);
  });
  it('เซิร์ฟเวอร์ตอบ same_password / weak_password: ข้อความเฉพาะ', async () => {
    const same = await changePassword(fakeApi({ update: err('same_password', 422) }).api, good);
    expect(same.ok === false && same.message).toContain('ซ้ำ');
    const weak = await changePassword(fakeApi({ update: err('weak_password', 422) }).api, good);
    expect(weak.ok === false && weak.message).toContain('ตัวพิมพ์ใหญ่');
  });
  it('error อื่นตอนเปลี่ยน: ข้อความทั่วไป ไม่รั่วรายละเอียด', async () => {
    const r = await changePassword(fakeApi({ update: err('x', 500, 'DB-INTERNAL-9') }).api, good);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('DB-INTERNAL-9');
  });
});

describe('gateStateFromProfile', () => {
  it('ไม่มีแถว profile = บัญชีไม่พร้อม (ปิดไว้ก่อน)', () => {
    expect(gateStateFromProfile(null)).toBe('no-profile');
    expect(gateStateFromProfile(undefined)).toBe('no-profile');
  });
  it('ธงบังคับเปลี่ยนรหัสเป็น true = ต้องเปลี่ยนรหัส', () => {
    expect(gateStateFromProfile({ must_change_password: true, consented_at: null })).toBe('must-change');
  });
  it('ธงเป็น false = ใช้งานได้', () => {
    expect(gateStateFromProfile({ must_change_password: false, consented_at: '2026-11-09T01:00:00Z' })).toBe('ready');
    // ยังไม่ยอมรับนโยบาย / ค่าเพี้ยน = ยังไม่ให้เข้าแอป
    expect(gateStateFromProfile({ must_change_password: false, consented_at: null })).toBe('needs-consent');
    expect(gateStateFromProfile({ must_change_password: false, consented_at: '' })).toBe('needs-consent');
    expect(gateStateFromProfile({ must_change_password: false, consented_at: 1 as unknown as string })).toBe('needs-consent');
    // ต้องเปลี่ยนรหัสก่อนเสมอ (ฐานข้อมูลไม่ให้บันทึกการยอมรับถ้ายังไม่เปลี่ยนรหัส)
    expect(gateStateFromProfile({ must_change_password: true, consented_at: null })).toBe('must-change');
  });
  it('ข้อมูลผิดรูป (ไม่ใช่ boolean) = ปิดไว้ก่อน ไม่ใช่ ready', () => {
    expect(gateStateFromProfile({ must_change_password: undefined as unknown as boolean, consented_at: null })).toBe('no-profile');
    expect(gateStateFromProfile({ must_change_password: 'false' as unknown as boolean, consented_at: null })).toBe('no-profile');
  });
});

describe('signOutQuietly', () => {
  it('เรียก signOut และไม่โยนแม้ล้มเหลว', async () => {
    const { api, calls } = fakeApi({ signOut: err('x', 500) });
    await expect(signOutQuietly(api)).resolves.toBeUndefined();
    expect(calls).toEqual(['signOut']);
    const bad: AuthApi = { ...api, signOut: async () => { throw new Error('net'); } };
    await expect(signOutQuietly(bad)).resolves.toBeUndefined();
  });
});
