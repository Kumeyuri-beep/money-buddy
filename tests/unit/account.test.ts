import { describe, expect, it } from 'vitest';
import { deleteMyAccount, recordConsent, type RpcApi } from '../../src/app/account';
import { PRIVACY_POLICY, PRIVACY_POLICY_VERSION, PRIVACY_SUMMARY } from '../../src/domain/privacy/policy';

const api = (result: { data?: unknown; error?: { message?: string; code?: string } | null } | 'throw') => {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const impl: RpcApi = {
    rpc: (name, args) => {
      calls.push(args === undefined ? { name } : { name, args });
      if (result === 'throw') return Promise.reject(new Error('Failed to fetch'));
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
  return { impl, calls };
};

describe('ยอมรับนโยบาย (record_consent)', () => {
  it('เรียก RPC ชื่อนี้โดยไม่ส่งเวลา (เวลาตั้งที่เซิร์ฟเวอร์) · สำเร็จ = ok', async () => {
    const { impl, calls } = api({});
    expect(await recordConsent(impl)).toEqual({ ok: true });
    expect(calls).toEqual([{ name: 'record_consent' }]);
  });
  it('ล้มเหลว = ข้อความไทย ไม่รั่วรายละเอียดจากเซิร์ฟเวอร์', async () => {
    const r = await recordConsent(api({ error: { message: 'relation "profiles" permission denied', code: '42501' } }).impl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toMatch(/relation|profiles|42501/);
    const net = await recordConsent(api('throw').impl);
    expect(net).toMatchObject({ ok: false });
  });
});

describe('ลบบัญชีและข้อมูลทั้งหมด (delete_my_account)', () => {
  it('ส่งรหัสผ่านเข้า RPC · true = ลบแล้ว', async () => {
    const { impl, calls } = api({ data: true });
    expect(await deleteMyAccount(impl, 'My-Secret-1')).toEqual({ ok: true });
    expect(calls).toEqual([{ name: 'delete_my_account', args: { p_password: 'My-Secret-1' } }]);
  });
  it('รหัสผิด (false) / ค่าแปลก = ไม่ถือว่าลบ', async () => {
    for (const data of [false, null, 'true', 1, undefined]) {
      const r = await deleteMyAccount(api({ data }).impl, 'x');
      expect(r.ok, String(data)).toBe(false);
    }
    const wrong = await deleteMyAccount(api({ data: false }).impl, 'x');
    if (!wrong.ok) expect(wrong.message).toMatch(/รหัสผ่านไม่ถูกต้อง/);
  });
  it('ไม่มีรหัสผ่าน = ไม่ยิงเซิร์ฟเวอร์เลย', async () => {
    const { impl, calls } = api({ data: true });
    for (const pw of ['', undefined as unknown as string]) {
      expect((await deleteMyAccount(impl, pw)).ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });
  it('เพิ่งเปลี่ยนรหัส (55000) แจ้ง cooldown 24 ชั่วโมงโดยเฉพาะ ไม่ใช่ข้อผิดพลาดทั่วไป', async () => {
    const r = await deleteMyAccount(api({ error: { message: 'x', code: '55000' } }).impl, 'x');
    if (r.ok) throw new Error('ควรไม่สำเร็จ');
    expect(r.message).toMatch(/24 ชั่วโมง/);
  });
  it('ลองผิดหลายครั้ง (53400) แจ้งแยก · เครือข่ายล้ม = ข้อความเครือข่าย · ข้อผิดพลาดอื่นไม่รั่วรายละเอียด', async () => {
    const limited = await deleteMyAccount(api({ error: { message: 'ลองผิดหลายครั้งเกินไป', code: '53400' } }).impl, 'x');
    if (!limited.ok) expect(limited.message).toMatch(/หลายครั้ง/);
    const net = await deleteMyAccount(api('throw').impl, 'x');
    if (!net.ok) expect(net.message).toMatch(/เชื่อมต่อ/);
    const other = await deleteMyAccount(api({ error: { message: 'duplicate key value violates "x_pkey"', code: '23505' } }).impl, 'x');
    if (!other.ok) expect(other.message).not.toMatch(/duplicate|pkey/);
  });
});

describe('นโยบายความเป็นส่วนตัว (เนื้อหาต้องตรงกับพฤติกรรมจริง)', () => {
  const all = [...PRIVACY_SUMMARY, ...PRIVACY_POLICY.flatMap((s) => [s.title, ...s.paragraphs])].join('\n');
  it('มีเวอร์ชัน และทุกหัวข้อมีเนื้อหา id ไม่ซ้ำ', () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ids = PRIVACY_POLICY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of PRIVACY_POLICY) {
      expect(s.title.length, s.id).toBeGreaterThan(2);
      expect(s.paragraphs.length, s.id).toBeGreaterThan(0);
    }
  });
  it('บอกตรงๆ ว่าเจ้าของระบบอ่านข้อมูลได้ทางเทคนิค (ทั้งสรุปและเนื้อหา)', () => {
    expect(PRIVACY_SUMMARY.join(' ')).toMatch(/ผู้ดูแลระบบ.*(เข้าถึง|อ่าน)/);
    expect(all).toMatch(/อ่านข้อมูลของคุณได้/);
  });
  it('ระบุผู้ประมวลผลและที่เก็บข้อมูล: Supabase, Vercel, สิงคโปร์, นอกประเทศไทย, Google Fonts', () => {
    for (const word of ['Supabase', 'Vercel', 'สิงคโปร์', 'นอกประเทศไทย', 'Google Fonts']) expect(all, word).toContain(word);
  });
  it('ระบุสิทธิ: ดาวน์โหลด, ลบบัญชี, ยืนยันด้วยรหัสผ่าน, สำเนาในเบราว์เซอร์ไม่ถูกลบ, ไม่ขายข้อมูล, ไม่เก็บรูปสลิป', () => {
    for (const word of ['ดาวน์โหลดข้อมูลของฉัน', 'ลบบัญชี', 'ยืนยันด้วยรหัสผ่าน', 'ไม่ลบสำเนา', 'ไม่ขาย', 'ไม่เก็บรูปสลิป']) expect(all, word).toContain(word);
  });
  it('ช่องทางติดต่อ: ไม่ระบุช่องทางเฉพาะ ให้ติดต่อผู้ดูแลระบบที่ให้บัญชีโดยตรง (เจ้าของตัดสินใจ 9 พ.ย. 2569)', () => {
    expect(all).toContain('ติดต่อผู้ดูแลระบบที่ให้บัญชีแก่คุณโดยตรง');
    expect(all).not.toMatch(/LINE|@[a-z0-9.-]+\.[a-z]{2,}|โทร/i);
  });
  it('บอกความจริงเรื่องข้อมูลที่ยังค้างหลังลบบัญชีและเรื่องการขอความยินยอมซ้ำ', () => {
    expect(all).toMatch(/บันทึกการเข้าสู่ระบบ.*ไม่ถูกลบตาม/);
    expect(all).toMatch(/ยังไม่บันทึกว่ายอมรับฉบับใด/);
    expect(all).not.toMatch(/ขอความยินยอมอีกครั้ง/);
    expect(all).not.toMatch(/ข้อมูลหายจากฐานข้อมูลหลักทันที[^ ]*ทั้งหมด/);
  });
  it('ไม่อ้างสิ่งที่ระบบไม่ได้ทำ (ไม่มีคำว่า ไม่ระบุตัวตน / เข้ารหัสแบบ end-to-end / ผู้ดูแลอ่านไม่ได้)', () => {
    expect(all).not.toMatch(/end-to-end|ไม่ระบุตัวตน|ผู้ดูแล[^ ]*อ่าน[^ ]*ไม่ได้|ไม่มีใครอ่านข้อมูลการเงิน/);
  });
});
