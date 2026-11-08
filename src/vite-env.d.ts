/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Project URL ของ Supabase (ไม่ใช่ความลับ) */
  readonly VITE_SUPABASE_URL?: string;
  /** publishable (anon) key เท่านั้น · ห้ามใส่ key ระดับผู้ดูแล (secret key) ในตัวแปร VITE_* */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
