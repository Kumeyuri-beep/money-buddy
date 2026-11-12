import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { GlobalSetupContext } from 'vitest/node';
import { AUTH_EMAIL_DOMAIN } from '../../src/domain/auth/credentials';
import { loadAdmin } from '../../scripts/lib/admin.mjs';
import { generateTempPassword } from '../../scripts/lib/adminEnv.mjs';

/**
 * เตรียมผู้ใช้ทดสอบ 2 คนสำหรับชุดทดสอบจริง (รันโดยเจ้าของ หรือผู้ช่วยในโหมดอัตโนมัติระดับ 2)
 * key ผู้ดูแลใช้เฉพาะที่นี่ (สร้าง/ลบผู้ใช้) · ส่งต่อให้เทสต์เฉพาะอีเมล+รหัสผ่านของผู้ใช้ทดสอบ ไม่ส่ง key
 * ผู้ใช้ทดสอบเปลี่ยนรหัสผ่านจริงผ่าน updateUser (ปลดธงบังคับเปลี่ยนรหัสแบบเดียวกับผู้ใช้จริง)
 * ถ้าโปรเซสถูกฆ่ากลางทาง ผู้ใช้ชื่อ livetest-xxxxxxxx ค้างอยู่ ลบใน Dashboard ได้ (ไม่มีข้อมูลจริง)
 */
declare module 'vitest' {
  export interface ProvidedContext {
    liveUsers: { url: string; anonKey: string; users: { email: string; password: string; id: string }[] };
  }
}

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  // ด่านกันรันโดยไม่ตั้งใจ: ชุดนี้โหลด key ผู้ดูแลและสร้าง/ลบผู้ใช้บนฐานข้อมูลจริง ต้องตั้งตัวแปรนี้ยืนยันก่อนรัน
  // พิมพ์เองแล้ว exit(1) แทนการ throw: vitest บน Node v26 พิมพ์ error จาก globalSetup ไม่ได้ (code.charCodeAt) ข้อความจริงจะหายไป
  if (process.env.MONEY_BUDDY_LIVE_TESTS !== 'yes') {
    console.error("หยุด: ตั้ง MONEY_BUDDY_LIVE_TESTS=yes เพื่อยืนยันก่อนรันชุดทดสอบจริง (PowerShell: $env:MONEY_BUDDY_LIVE_TESTS='yes' · Bash: MONEY_BUDDY_LIVE_TESTS=yes) แล้วรัน npm run admin:live-contract");
    process.exit(1);
  }
  const envFile = resolve(process.cwd(), '.env');
  if (!existsSync(envFile)) throw new Error('ไม่พบ .env ของโปรเจกต์ (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  const projectEnv = parseEnv(readFileSync(envFile, 'utf8'));
  const url = projectEnv.VITE_SUPABASE_URL;
  const anonKey = projectEnv.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('.env ไม่มี VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

  const { client: admin, url: adminUrl, safeMessage } = loadAdmin();
  if (url.replace(/\/+$/, '') !== adminUrl.replace(/\/+$/, '')) {
    throw new Error('URL ใน .env ไม่ตรงกับ admin.env (อาจเป็นคนละโปรเจกต์) หยุดโดยไม่ทำอะไร');
  }

  const created: { email: string; password: string; id: string }[] = [];
  const cleanup = async (): Promise<void> => {
    const failed: string[] = [];
    for (const u of created) {
      const del = await admin.auth.admin.deleteUser(u.id);
      // ผู้ใช้ c ถูกลบโดยเทสต์ลบบัญชีอยู่แล้ว: ไม่พบ = ปกติ
      const gone = del.error && (del.error.status === 404 || /not.?found/i.test(`${del.error.code ?? ''} ${del.error.message ?? ''}`));
      if (del.error && !gone) failed.push(`${u.email}: ${safeMessage(del.error)}`);
    }
    // ลบไม่สำเร็จ = ถือว่าการรันล้มเหลว (เคยพบว่าลบผู้ใช้ที่มีข้อมูลไม่ได้ ซึ่งกระทบ delete_my_account/Dashboard ด้วย)
    if (failed.length > 0) throw new Error('ลบผู้ใช้ทดสอบไม่สำเร็จ โปรดลบใน Dashboard เอง: ' + failed.join(' | '));
  };

  try {
    const suffix = globalThis.crypto.getRandomValues(new Uint8Array(4)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
    for (const who of ['a', 'b', 'c']) {
      const email = `livetest-${suffix}-${who}@${AUTH_EMAIL_DOMAIN}`;
      const temp = generateTempPassword();
      const password = generateTempPassword();
      const made = await admin.auth.admin.createUser({ email, password: temp, email_confirm: true });
      if (made.error || !made.data.user) throw new Error(`สร้างผู้ใช้ทดสอบไม่สำเร็จ: ${safeMessage(made.error)}`);
      created.push({ email, password, id: made.data.user.id });
      const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const signedIn = await user.auth.signInWithPassword({ email, password: temp });
      if (signedIn.error) throw new Error(`ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ: ${safeMessage(signedIn.error)}`);
      const changed = await user.auth.updateUser({ password });
      if (changed.error) throw new Error(`เปลี่ยนรหัสผู้ใช้ทดสอบไม่สำเร็จ: ${safeMessage(changed.error)}`);
      // ข้าม cooldown 24 ชม. ของล้างข้อมูล/ลบบัญชี (M2-F) ด้วยสิทธิ์ผู้ดูแล · ผู้ใช้ c ปล่อยสดไว้เพื่อทดสอบ cooldown จริง
      if (who !== 'c') {
        const aged = await admin.from('profiles').update({ password_changed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }).eq('user_id', made.data.user.id);
        if (aged.error) throw new Error(`ตั้งเวลาเปลี่ยนรหัสผู้ใช้ทดสอบไม่สำเร็จ: ${safeMessage(aged.error)}`);
      }
    }
  } catch (e) {
    await cleanup();
    throw e;
  }
  provide('liveUsers', { url, anonKey, users: created });
  return cleanup;
}
