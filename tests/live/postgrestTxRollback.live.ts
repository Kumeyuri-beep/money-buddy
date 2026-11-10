import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { loadAdmin } from '../../scripts/lib/admin.mjs';

/**
 * ข้อกำหนดการตั้งค่า (docs/decisions/2026-11-09-batched-delete.md): PostgREST ต้อง "ไม่ยอมรับ" header `Prefer: tx=rollback`
 * (ค่าเริ่มต้นของ Supabase db-tx-end=commit) ไม่งั้นแถวนับรหัสผิดใน private.delete_attempts ถูกย้อนกลับ แล้วเดารหัสได้ไม่จำกัด
 * วิธีพิสูจน์ที่ไม่ต้องแตะระบบนับรหัส: เขียนแถวจริงด้วย `Prefer: tx=rollback` ถ้าเซิร์ฟเวอร์ยอมรับ แถวจะหาย (ย้อนกลับ) ถ้าเซิร์ฟเวอร์ปฏิเสธ/เมิน แถวต้องค้างอยู่ (commit)
 * รัน: npm run admin:live-contract (เครื่องเจ้าของเท่านั้น) · ใช้ผู้ใช้ทดสอบ b และลบแถวที่เขียนทิ้งท้ายทุกครั้ง
 */
const live = inject('liveUsers');
const admin = loadAdmin().client;

async function signIn(index: number): Promise<{ client: SupabaseClient; id: string; token: string }> {
  const user = live.users[index]!;
  const client = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.user || !data.session) throw new Error('ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ');
  return { client, id: data.user.id, token: data.session.access_token };
}

describe('PostgREST ไม่ยอมรับ Prefer: tx=rollback (กันย้อนกลับแถวนับรหัสผิด)', () => {
  afterAll(async () => {
    const { id } = await signIn(1);
    const { error } = await admin.from('settings').delete().eq('user_id', id);
    if (error) throw new Error('ล้างแถวตั้งค่าของผู้ใช้ทดสอบไม่สำเร็จ');
  });

  it('เขียนด้วย Prefer: tx=rollback แล้วแถวยังอยู่ (commit) และเซิร์ฟเวอร์ไม่ตอบว่าใช้ tx=rollback', async () => {
    const { client, id, token } = await signIn(1);
    await admin.from('settings').delete().eq('user_id', id);

    const url = `${live.url.replace(/\/+$/, '')}/rest/v1/settings`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: live.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'tx=rollback,return=minimal',
      },
      body: JSON.stringify({ value: { payDay: 7 } }),
    });
    // ถ้าเซิร์ฟเวอร์ปฏิเสธ header นี้ตรงๆ (4xx) ก็ถือว่าปลอดภัย แต่ต้องไม่มีแถวค้าง/ไม่มี 2xx ที่ย้อนกลับเงียบๆ
    const applied = res.headers.get('preference-applied') ?? '';
    expect(applied.toLowerCase()).not.toContain('tx=rollback');

    const read = await client.from('settings').select('value').eq('user_id', id);
    expect(read.error).toBeNull();
    if (res.ok) {
      // รับคำขอ = ต้อง commit จริง (ไม่ย้อนกลับ)
      expect(read.data?.length).toBe(1);
      expect((read.data?.[0]?.value as { payDay?: number } | undefined)?.payDay).toBe(7);
    } else {
      expect(read.data?.length ?? 0).toBe(0);
    }
  });
});
