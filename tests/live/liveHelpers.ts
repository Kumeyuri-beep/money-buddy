import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ตัวช่วยของชุดทดสอบจริง (ลดความไม่นิ่งจากเครือข่าย ไม่ลดความเข้มของสิ่งที่ทดสอบ)
 * สาเหตุที่พบ: การเชื่อมต่อไปยัง Supabase หลุดเป็นระยะ (fetch failed / ล้างข้อมูลด้วยสิทธิ์ผู้ดูแลล้มกลางทาง)
 * ทำให้เทสต์ถัดไปเห็นข้อมูลค้างของเทสต์ก่อนหน้า (เช่น "มีบิลรหัสนี้อยู่แล้ว")
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch ที่ลองใหม่เฉพาะเมื่อ "เครือข่ายล้มก่อนได้คำตอบ" และเป็นคำสั่งที่ทำซ้ำได้ปลอดภัย (GET/HEAD/DELETE)
 * ไม่ลองใหม่ POST/PATCH/PUT: ลองซ้ำอาจเขียนซ้ำจนรหัสชน ซึ่งเป็นสิ่งที่เรากำลังกัน
 */
export const resilientFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
  const safe = method === 'GET' || method === 'HEAD' || method === 'DELETE';
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      if (!safe || attempt >= 2) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
};

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
