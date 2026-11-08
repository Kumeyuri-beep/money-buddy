import type { MoneyDB } from './db';
import { isEmpty } from './repository';

const OWNER_KEY = 'ownerUserId';

/** เจ้าของข้อมูลในเครื่องนี้ (รหัสผู้ใช้) · null = ยังไม่ผูก */
export async function getLocalOwner(db: MoneyDB): Promise<string | null> {
  const row = await db.meta.get(OWNER_KEY);
  return typeof row?.value === 'string' && row.value !== '' ? row.value : null;
}

export async function setLocalOwner(db: MoneyDB, userId: string): Promise<void> {
  await db.meta.put({ key: OWNER_KEY, value: userId });
}

export async function hasLocalData(db: MoneyDB): Promise<boolean> {
  return !(await isEmpty(db));
}
