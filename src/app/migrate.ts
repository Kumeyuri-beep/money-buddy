import { parseBackup, type BackupData, type BackupSummary } from '../domain/backup/parseBackup';
import type { ImportOptions, ImportProgress, LedgerRepository } from '../storage/ledgerRepository';
import { verifyImport, type VerifyReport } from './importVerify';

/**
 * ย้ายข้อมูลในเครื่อง (Dexie) ขึ้นบัญชีออนไลน์ (M2-D2)
 * **ฝั่งต้นทางอ่านอย่างเดียวเสมอ** (isEmpty / exportSnapshot) ไม่มีการเขียน ลบ หรือล้างข้อมูลในเครื่องในไฟล์นี้
 * (เจ้าของสั่ง: ห้ามลบ Dexie จนกว่าจะยืนยันว่านำเข้าครบและยอดตรง · มีเทสต์ยืนยันว่าต้นทางไม่เปลี่ยน)
 */

/** ข้อความที่ใช้บอกว่าผู้ใช้กดยกเลิกตอนถูกขอรหัสผ่านเพื่อล้างข้อมูล (ไม่ใช่ข้อผิดพลาด) */
export const RESET_CANCELLED_MESSAGE = 'ยกเลิกการล้างข้อมูล';

export type LocalRead =
  | { ok: true; data: BackupData; summary: BackupSummary; warnings: string[] }
  | { ok: false; problems: string[] };

/** อ่านข้อมูลในเครื่องแล้วตรวจด้วยตัวตรวจเดียวกับไฟล์สำรอง (ข้อมูลเก่าอาจเสียได้ ต้องไม่เชื่อ) */
export async function readLocalForMigration(local: LedgerRepository, today: string): Promise<LocalRead> {
  const snapshot = await local.exportSnapshot();
  const parsed = parseBackup(JSON.stringify(snapshot), today);
  return parsed.ok ? { ok: true, data: parsed.data, summary: parsed.summary, warnings: parsed.warnings } : { ok: false, problems: parsed.problems };
}

/** อ่านข้อมูลออนไลน์กลับมาเทียบกับต้นทาง (ใช้ทั้งหลังนำเข้าและตอนเปิดแอปใหม่ที่ยังไม่ได้ยืนยัน) */
export async function verifyOnline(source: BackupData, online: LedgerRepository): Promise<VerifyReport> {
  const [ledger, bills, settings] = await Promise.all([online.loadLedger(), online.loadBills(), online.loadSettings()]);
  return verifyImport(source, { accounts: ledger.accounts, entries: ledger.entries, bills, settings });
}

export interface ImportResult {
  counts: { accounts: number; entries: number; bills: number };
  report: VerifyReport;
}

/**
 * นำเข้า (ธุรกรรมเดียวที่ฐานข้อมูล · มีข้อมูลออนไลน์อยู่แล้ว = ปฏิเสธ ไม่ทับ) แล้วอ่านกลับมาตรวจยอด
 * report.ok = false ไม่ได้ย้อนกลับการนำเข้า (ข้อมูลออนไลน์ถูกเขียนแล้ว) · ผู้เรียกต้องแสดงผลให้เจ้าของเห็นและห้ามไปต่อ
 */
export async function importAndVerify(source: BackupData, online: LedgerRepository, onProgress?: ImportProgress, options?: ImportOptions): Promise<ImportResult> {
  const counts = await online.importBackup(source, onProgress, options);
  const report = await verifyOnline(source, online);
  return { counts, report };
}
