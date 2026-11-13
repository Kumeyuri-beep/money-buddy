import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ตัวช่วยของชุดทดสอบจริง (ลดความไม่นิ่งจากเครือข่าย ไม่ลดความเข้มของสิ่งที่ทดสอบ)
 * สาเหตุที่พบ: การเชื่อมต่อไปยัง Supabase หลุดเป็นระยะ (fetch failed / ล้างข้อมูลด้วยสิทธิ์ผู้ดูแลล้มกลางทาง)
 * ทำให้เทสต์ถัดไปเห็นข้อมูลค้างของเทสต์ก่อนหน้า (เช่น "มีบิลรหัสนี้อยู่แล้ว")
 * พบเพิ่ม 13 พ.ย. 2569: คำขอเดียวค้างราว 50 วินาทีโดยไม่ error (ข้อทดสอบที่ปกติใช้ 8 วินาทีใช้ 57 วินาที ใกล้เพดาน 60 วินาที) → traceFetch.ts บันทึกคำขอที่ช้า/ล้มลง .live-logs/live-requests.log · ที่นี่คำขอที่ทำซ้ำได้ปลอดภัยมีเพดานเวลา
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** คำขอที่ทำซ้ำได้ปลอดภัยไม่ตอบภายในเวลานี้ = ตัดการเชื่อมต่อแล้วลองใหม่ (แทนรอจนเทสต์หมดเวลา) */
export const SAFE_REQUEST_TIMEOUT_MS = 20_000;

/**
 * fetch ที่ลองใหม่เฉพาะเมื่อ "เครือข่ายล้มก่อนได้คำตอบ" และเป็นคำสั่งที่ทำซ้ำได้ปลอดภัย (GET/HEAD/DELETE)
 * ไม่ลองใหม่ POST/PATCH/PUT: ลองซ้ำอาจเขียนซ้ำจนรหัสชน ซึ่งเป็นสิ่งที่เรากำลังกัน
 * คำขอที่ทำซ้ำได้ปลอดภัยมีเพดานเวลา (SAFE_REQUEST_TIMEOUT_MS) ค้างเกินก็ตัดแล้วลองใหม่ · POST/PATCH/PUT ไม่ตัด (ไม่รู้ว่าเซิร์ฟเวอร์ทำไปแล้วหรือยัง)
 */
export const resilientFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const safe = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  for (let attempt = 0; ; attempt++) {
    try {
      const signal = safe ? (init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(SAFE_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(SAFE_REQUEST_TIMEOUT_MS)) : init?.signal;
      return await fetch(input, signal ? { ...init, signal } : init);
    } catch (e) {
      if (!safe || attempt >= 2 || init?.signal?.aborted) throw e; // ผู้เรียกยกเลิกเอง = ไม่ลองใหม่
      await sleep(600 * (attempt + 1));
    }
  }
};

/**
 * ข้อความ error ของการล็อกอิน (status + code + message) ไว้ใส่ในข้อความที่ throw: เดิมทิ้งสาเหตุจริงทำให้วินิจฉัยข้อล้มไม่ได้
 * (error ของ Supabase Auth ไม่มี key/รหัสผ่านอยู่ในข้อความ · ไม่พิมพ์ทั้งอ็อบเจ็กต์)
 */
export function authErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') return 'ไม่มี error แต่ไม่ได้ผู้ใช้กลับมา';
  const e = error as { status?: unknown; code?: unknown; message?: unknown; name?: unknown };
  return [e.name, e.status, e.code, e.message].filter((v) => v !== undefined && v !== '').map(String).join(' ').slice(0, 300);
}

/** ตัวเลือก createClient ของผู้ใช้ทดสอบ */
export const liveClientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: resilientFetch },
} as const;

/**
 * ล้างข้อมูลของผู้ใช้ทดสอบด้วยสิทธิ์ผู้ดูแล: ลองใหม่เมื่อล้ม (การลบซ้ำปลอดภัย) และรายงานสาเหตุจริงของตารางที่ล้ม
 * ผู้เรียกต้องตรวจก่อนว่าเป็นผู้ใช้ทดสอบ livetest- เท่านั้น
 */
export async function wipeUserTables(admin: SupabaseClient, userId: string, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    let lastMessage = '';
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      if (attempt > 0) await sleep(1000 * attempt);
      try {
        const { error } = await admin.from(table).delete().eq('user_id', userId);
        if (!error) done = true;
        else lastMessage = `${error.code ?? ''} ${error.message ?? ''}`.trim();
      } catch (e) {
        lastMessage = e instanceof Error ? e.message : 'ไม่ทราบสาเหตุ';
      }
    }
    if (!done) throw new Error(`ล้างข้อมูลผู้ใช้ทดสอบไม่สำเร็จที่ตาราง ${table} (ลองแล้ว 4 ครั้ง): ${lastMessage}`);
  }
}
