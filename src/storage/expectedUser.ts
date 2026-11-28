import type { SupabaseClient } from '@supabase/supabase-js';

/** หัวคำขอที่ trigger ของฐานข้อมูลเทียบกับ auth.uid() (migration 20261129000100) · ไม่ตรง = PT412 ไม่เขียน */
export const EXPECTED_USER_HEADER = 'x-expected-user';

/**
 * client ของ repository: ทุกคำขอ (ตารางและ RPC) บอกฐานข้อมูลว่าหน้าจอนี้ตั้งใจทำกับผู้ใช้คนไหน
 * เบราว์เซอร์ใช้เซสชันร่วมกันทุกแท็บ แท็บค้างจึงอาจส่งคำสั่งด้วยเซสชันของอีกบัญชี · ฐานข้อมูลตรวจในธุรกรรมเดียวกับการเขียน
 * ไม่ใช่ด่านกันคนอื่นเข้าถึงข้อมูล (หน้าที่นั้นเป็นของ RLS) · client เดิมไม่ถูกแก้
 */
export function bindExpectedUser(client: SupabaseClient, userId: string): Pick<SupabaseClient, 'auth' | 'from' | 'rpc'> {
  return {
    get auth() {
      return client.auth;
    },
    from: ((table: string) => {
      const query = client.from(table);
      query.headers.set(EXPECTED_USER_HEADER, userId); // from() สร้างชุดหัวคำขอใหม่ทุกครั้ง ไม่ติดไปกับคำขออื่น
      return query;
    }) as SupabaseClient['from'],
    rpc: ((name: string, args?: Record<string, unknown>) => client.rpc(name, args).setHeader(EXPECTED_USER_HEADER, userId)) as SupabaseClient['rpc'],
  };
}
