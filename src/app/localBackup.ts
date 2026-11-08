import type { LedgerRepository } from '../storage/ledgerRepository';
import { thaiIsoDate } from './dates';

export type LocalBackup = { status: 'empty' } | { status: 'ready'; filename: string; json: string; accounts: number; entries: number };

/**
 * เตรียมไฟล์สำรองจากข้อมูลที่เก็บในเบราว์เซอร์นี้ (ใช้ได้โดยไม่ต้องล็อกอิน อ่านจากฐานข้อมูลในเครื่องเท่านั้น ไม่ส่งออกเครือข่าย)
 * ฐานว่าง = ไม่สร้างไฟล์ (กันผู้ใช้เก็บไฟล์เปล่าไว้นึกว่าสำรองแล้ว)
 */
export async function prepareLocalBackup(repo: LedgerRepository, now: Date = new Date()): Promise<LocalBackup> {
  if (await repo.isEmpty()) return { status: 'empty' };
  const snapshot = await repo.exportSnapshot(now);
  return {
    status: 'ready',
    filename: `money-buddy-backup-${thaiIsoDate(now)}.json`,
    json: JSON.stringify(snapshot, null, 2),
    accounts: snapshot.accounts.length,
    entries: snapshot.entries.length,
  };
}
