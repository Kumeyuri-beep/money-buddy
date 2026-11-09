import { MAX_IMPORT_BYTES, parseBackup, type BackupData, type BackupSummary } from '../domain/backup/parseBackup';

/**
 * อ่านไฟล์สำรองที่ผู้ใช้เลือกเองแล้วตรวจด้วยตัวตรวจเดียวกับการย้ายข้อมูล (parseBackup) · ไม่เชื่อไฟล์: ผิดข้อใดข้อหนึ่ง = ปฏิเสธทั้งไฟล์
 * ไม่แตะ DOM, ฐานข้อมูล หรือเครือข่าย (ผู้เรียกส่งอ็อบเจ็กต์คล้าย File เข้ามา) · ไม่ลบหรือแก้ข้อมูลใดทั้งสิ้น
 */
export interface BackupFileLike {
  name: string;
  size: number;
  text(): Promise<string>;
}

export type BackupFileRead =
  | { ok: true; fileName: string; data: BackupData; summary: BackupSummary; warnings: string[] }
  | { ok: false; fileName: string; problems: string[] };

/** ชื่อไฟล์มาจากเครื่องผู้ใช้แต่ไม่ควรเชื่อ: ตัดอักขระควบคุม/ตัวกลับทิศ และจำกัดความยาวก่อนแสดง */
function displayName(name: unknown): string {
  const clean = String(name ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '?');
  const chars = Array.from(clean);
  return chars.length > 60 ? chars.slice(0, 60).join('') + '…' : clean;
}

export async function readBackupFile(file: BackupFileLike, today: string): Promise<BackupFileRead> {
  const fileName = displayName(file.name);
  // ตรวจขนาดก่อนอ่านเนื้อไฟล์ ไม่ให้ไฟล์ใหญ่เกินกินหน่วยความจำของเบราว์เซอร์
  if (!Number.isFinite(file.size) || file.size > MAX_IMPORT_BYTES) {
    return { ok: false, fileName, problems: [`ไฟล์ใหญ่เกินไป (ไม่เกิน ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB)`] };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, fileName, problems: ['อ่านไฟล์ไม่ได้ ลองเลือกไฟล์ใหม่อีกครั้ง'] };
  }
  const parsed = parseBackup(text, today);
  return parsed.ok
    ? { ok: true, fileName, data: parsed.data, summary: parsed.summary, warnings: parsed.warnings }
    : { ok: false, fileName, problems: parsed.problems };
}
