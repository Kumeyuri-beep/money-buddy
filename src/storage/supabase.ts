import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RpcApi } from '../app/account';
import type { AuthApi, ProfileRow } from '../app/auth';

/**
 * ตัวต่อ Supabase ฝั่งเว็บ (M2-B) · ใช้เฉพาะ publishable (anon) key ผ่าน VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * ห้ามใส่ key ระดับผู้ดูแล (secret key) ในไฟล์นี้หรือโค้ดเว็บส่วนใดเด็ดขาด (ใช้เฉพาะ scripts/ ในเครื่องเจ้าของ)
 * ไม่มีการสมัครเองจากเว็บ: เว็บไม่เรียกฟังก์ชันสร้างผู้ใช้ใดๆ (เจ้าของสร้างบัญชีให้)
 */
const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;

/** ส่วน auth ที่ use case ใช้ · ออกจากระบบแบบ local (ไม่เตะเครื่องอื่นของผู้ใช้ออก) */
export const authApi: AuthApi | null = supabase
  ? {
      signInWithPassword: (credentials) => supabase.auth.signInWithPassword(credentials),
      updateUser: (attributes) => supabase.auth.updateUser(attributes),
      signOut: () => supabase.auth.signOut({ scope: 'local' }),
      signOutOthers: () => supabase.auth.signOut({ scope: 'others' }),
    }
  : null;

/** ส่วน RPC ที่ use case บัญชีใช้ (ยอมรับนโยบาย / ลบบัญชี) */
export const accountApi: RpcApi | null = supabase ? { rpc: (name, args) => supabase.rpc(name, args) } : null;

/** เวลาที่เปลี่ยนรหัสผ่านล่าสุดของตัวเอง (ใช้แสดง cooldown เท่านั้น · null = ไม่มี/อ่านไม่ได้) */
export async function loadPasswordChangedAt(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.from('profiles').select('password_changed_at').maybeSingle();
  if (error) return null;
  const value = (data as { password_changed_at?: unknown } | null)?.password_changed_at;
  return typeof value === 'string' ? value : null;
}

export type ProfileLoad = { ok: true; profile: ProfileRow | null } | { ok: false };

/** อ่านแถว profiles ของตัวเอง (RLS ให้เห็นแถวเดียว) · ok=false = อ่านไม่สำเร็จ (เครือข่าย/สิทธิ์) */
export async function loadProfile(client: SupabaseClient): Promise<ProfileLoad> {
  const { data, error } = await client.from('profiles').select('must_change_password, consented_at').maybeSingle();
  if (error) return { ok: false };
  return { ok: true, profile: (data as ProfileRow | null) ?? null };
}
