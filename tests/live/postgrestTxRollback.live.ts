import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { loadAdmin } from '../../scripts/lib/admin.mjs';

/**
 * ข้อกำหนดการตั้งค่า (docs/decisions/2026-11-09-batched-delete.md ข้อ 3): PostgREST ต้อง "ไม่ยอมรับ" header `Prefer: tx=rollback`
 * (ค่าเริ่มต้นของ Supabase db-tx-end=commit) ไม่งั้นแถวนับรหัสผิดใน private.delete_attempts ถูกย้อนกลับ แล้วเดารหัสได้ไม่จำกัด
 * วิธีพิสูจน์: เขียนแถวจริงด้วย `Prefer: tx=rollback` ต้องได้ 201 และแถว "ค้างอยู่" (commit) ถ้าเซิร์ฟเวอร์ยอมรับ header แถวจะหาย
 * ใช้ /rest/v1/settings แทน RPC ที่เขียน delete_attempts ได้ เพราะ db-tx-end เป็นค่าระดับทั้งเซิร์ฟเวอร์ (ไม่แยกตาม endpoint)
 * ไม่ยอมรับผลแบบ "ถูกปฏิเสธด้วย 4xx/5xx" ว่าผ่าน เพราะแยกไม่ออกจากสาเหตุอื่น (token หมดอายุ, RLS, URL ผิด) · ถ้า Supabase เปลี่ยนไปปฏิเสธ header นี้ เทสต์จะล้ม ให้คนตรวจแล้วปรับเทสต์เอง
 * รัน: npm run admin:live-contract (เครื่องเจ้าของเท่านั้น) · ใช้ผู้ใช้ทดสอบ b และลบแถวที่เขียนทิ้งท้ายทุกครั้ง
 */
const live = inject('liveUsers');
const admin = loadAdmin().client;
const B = live.users[1]!;

/** ด่านกันเผื่ออนาคต: คำสั่งลบด้วยสิทธิ์ผู้ดูแลต้องเป็นผู้ใช้ทดสอบ livetest- เท่านั้น */
function assertTestUser(id: string): void {
  if (id !== B.id || !B.email.startsWith('livetest-')) throw new Error('หยุด: ไม่ใช่ผู้ใช้ทดสอบ b ของรอบนี้ ไม่ลบอะไร');
}

async function clearSettingsOfB(): Promise<void> {
  assertTestUser(B.id);
  const { error } = await admin.from('settings').delete().eq('user_id', B.id);
  if (error) throw new Error('ล้างแถวตั้งค่าของผู้ใช้ทดสอบ b ไม่สำเร็จ');
}

describe('PostgREST ไม่ยอมรับ Prefer: tx=rollback (กันย้อนกลับแถวนับรหัสผิด)', () => {
  afterAll(clearSettingsOfB);

  it('เขียนด้วย Prefer: tx=rollback ได้ 201 แถวยังอยู่ (commit) และเซิร์ฟเวอร์ไม่ตอบว่าใช้ tx=rollback', async () => {
    const client = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await client.auth.signInWithPassword({ email: B.email, password: B.password });
    if (error || !data.user || !data.session) throw new Error('ล็อกอินผู้ใช้ทดสอบ b ไม่สำเร็จ');
    expect(data.user.id).toBe(B.id);
    await clearSettingsOfB();

    const res = await fetch(`${live.url.replace(/\/+$/, '')}/rest/v1/settings`, {
      method: 'POST',
      headers: {
        apikey: live.anonKey,
        Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'tx=rollback,return=minimal',
      },
      body: JSON.stringify({ value: { payDay: 7 } }),
    });
    expect(res.status).toBe(201);
    expect((res.headers.get('preference-applied') ?? '').toLowerCase()).not.toContain('tx=rollback');

    const read = await client.from('settings').select('value').eq('user_id', B.id);
    expect(read.error).toBeNull();
    expect(read.data?.length).toBe(1);
    expect((read.data?.[0]?.value as { payDay?: number } | undefined)?.payDay).toBe(7);
  });
});
