/**
 * ข้อมูลใน IndexedDB (Dexie) ของเบราว์เซอร์นี้ผูกกับบัญชีเดียว (M2-B1)
 * ก่อน M2-C ย้ายข้อมูลขึ้นฐานข้อมูลแยกตามผู้ใช้ ข้อมูลในเครื่องยังไม่แยกตามผู้ใช้เอง
 * ตรรกะนี้กันผู้ใช้อีกคนที่ล็อกอินบนเบราว์เซอร์เดียวกันเห็นข้อมูลชุดเดิม (กันได้ระดับหน้าจอ ไม่กัน DevTools)
 */

export type LocalDataAccess =
  /** เจ้าของตรงกับผู้ใช้ */
  | 'allow'
  /** ยังไม่มีเจ้าของและฐานว่าง: ผูกให้เลย */
  | 'bind'
  /** ยังไม่มีเจ้าของแต่มีข้อมูลเดิม: ถามผู้ใช้ก่อนผูก */
  | 'ask'
  /** เป็นของบัญชีอื่น หรือไม่รู้ว่าผู้ใช้คือใคร */
  | 'blocked';

export function localDataAccess(input: { ownerId: string | null; userId: string; hasData: boolean }): LocalDataAccess {
  if (typeof input.userId !== 'string' || input.userId === '') return 'blocked';
  const owner = typeof input.ownerId === 'string' && input.ownerId !== '' ? input.ownerId : null;
  if (owner !== null) return owner === input.userId ? 'allow' : 'blocked';
  return input.hasData ? 'ask' : 'bind';
}
